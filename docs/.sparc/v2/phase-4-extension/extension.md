# Phase 4: Chrome Extension -- Extension Domain Plan

## Objective

Build a Chrome Manifest V3 extension that captures LinkedIn page HTML for server-side parsing, displays task lists from the app, provides a floating status overlay, connects via WebSocket for real-time updates, and manages an offline capture queue. The extension follows a "dumb capture + smart app" model: it captures raw HTML and delegates all parsing and intelligence to the Next.js app.

---

## Prerequisites (from Phases 1-3 and Phase 4 Backend/App)

| Dependency | Phase | Status Required |
|------------|-------|-----------------|
| Extension project scaffolding (MV3, TypeScript, esbuild) | Phase 1 | Created |
| Shared TypeScript types directory | Phase 1 | Created |
| POST /api/extension/capture endpoint | Phase 4 App (A4-1) | Operational |
| GET /api/extension/tasks endpoint | Phase 4 App (A4-2) | Operational |
| PATCH /api/extension/tasks/:id endpoint | Phase 4 App (A4-2) | Operational |
| GET /api/extension/health endpoint | Phase 4 App (A4-2) | Operational |
| POST /api/extension/register endpoint | Phase 4 App (A4-2) | Operational |
| GET /api/extension/settings endpoint | Phase 4 App (A4-2) | Operational |
| GET /api/extension/contact/:url endpoint | Phase 4 App (A4-2) | Operational |
| POST /api/extension/message-render endpoint | Phase 4 App (A4-2) | Operational |
| WebSocket server at /ws/extension | Phase 4 Backend (B4-3) | Operational |
| Token-based auth system | Phase 4 Backend (B4-4, B4-5) | Operational |

---

## Parallel Agent Assignments

| Agent | Role | Tasks | Estimated Effort |
|-------|------|-------|------------------|
| Agent E1 | Content Script Dev | page-capturer.ts, overlay.ts, overlay.css | 10-12 hours |
| Agent E2 | Service Worker Dev | service-worker.ts, message routing, badge management, alarms | 12-16 hours |
| Agent E3 | Popup Dev | popup.html, popup.ts, popup.css | 8-10 hours |
| Agent E4 | Side Panel Dev | sidepanel.html, sidepanel.ts, sidepanel.css | 8-10 hours |
| Agent E5 | Shared/Build Dev | types.ts, app-client.ts, storage.ts, constants.ts, manifest.json, esbuild config, package.json | 8-10 hours |

Agent E5 must start first (shared types and build config). E1, E2, E3, E4 can run in parallel once E5 completes shared types.

---

## Project Structure

```
extension/
  manifest.json
  service-worker.ts
  content-scripts/
    page-capturer.ts
    overlay.ts
    overlay.css
  popup/
    popup.html
    popup.ts
    popup.css
  sidepanel/
    sidepanel.html
    sidepanel.ts
    sidepanel.css
  shared/
    types.ts
    app-client.ts
    storage.ts
    constants.ts
  icons/
    icon-16.png
    icon-48.png
    icon-128.png
  esbuild.config.ts
  tsconfig.json
  package.json
```

---

## Detailed Task Checklist

### Task E4-1: Manifest and Build Configuration (Agent E5)

**BR Refs**: BR-800 (MV3 extension), BR-815 (CSP)

- [ ] E4-1.1: Create manifest.json

**File**: `extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "LinkedIn Network Intelligence",
  "version": "0.1.0",
  "description": "Capture LinkedIn pages for network analysis and relationship intelligence.",
  "permissions": [
    "storage",
    "alarms",
    "sidePanel",
    "activeTab"
  ],
  "host_permissions": [
    "https://www.linkedin.com/*",
    "https://linkedin.com/*",
    "http://localhost:3000/*"
  ],
  "background": {
    "service_worker": "dist/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": [
        "https://www.linkedin.com/*",
        "https://linkedin.com/*"
      ],
      "js": ["dist/content-scripts/page-capturer.js", "dist/content-scripts/overlay.js"],
      "css": ["content-scripts/overlay.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src http://localhost:3000 ws://localhost:3000;"
  }
}
```

- [ ] E4-1.2: Create package.json

**File**: `extension/package.json`

```json
{
  "name": "linkedin-network-intelligence-extension",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --ext .ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@anthropic-ai/sdk": "latest",
    "@types/chrome": "^0.0.270",
    "esbuild": "^0.21.0",
    "eslint": "^9.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] E4-1.3: Create tsconfig.json

**File**: `extension/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false,
    "sourceMap": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome"],
    "paths": {
      "@shared/*": ["./shared/*"]
    }
  },
  "include": [
    "service-worker.ts",
    "content-scripts/**/*.ts",
    "popup/**/*.ts",
    "sidepanel/**/*.ts",
    "shared/**/*.ts"
  ],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] E4-1.4: Create esbuild configuration

**File**: `extension/esbuild.config.mjs`

```javascript
import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'chrome120',
  format: 'esm',
  logLevel: 'info',
};

const entryPoints = [
  { in: 'service-worker.ts', out: 'service-worker' },
  { in: 'content-scripts/page-capturer.ts', out: 'content-scripts/page-capturer' },
  { in: 'content-scripts/overlay.ts', out: 'content-scripts/overlay' },
  { in: 'popup/popup.ts', out: 'popup/popup' },
  { in: 'sidepanel/sidepanel.ts', out: 'sidepanel/sidepanel' },
];

async function build() {
  for (const ep of entryPoints) {
    const ctx = await esbuild.context({
      ...commonOptions,
      entryPoints: [ep.in],
      outfile: `dist/${ep.out}.js`,
    });
    if (isWatch) {
      await ctx.watch();
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  }
}

build().catch(() => process.exit(1));
```

- [ ] E4-1.5: Create placeholder icon files

**Files**: `extension/icons/icon-16.png`, `extension/icons/icon-48.png`, `extension/icons/icon-128.png`

Generate simple placeholder PNGs (solid color squares) for development. Final icons designed in Phase 6.

**Acceptance Criteria**:
- `npm run build` in extension/ produces dist/ with bundled JS files
- `npm run typecheck` passes with no errors
- manifest.json loads in chrome://extensions without errors
- CSP allows connections to localhost:3000 and ws://localhost:3000

---

### Task E4-2: Shared Types (Agent E5)

**BR Refs**: BR-800 (type safety across extension)

**File**: `extension/shared/types.ts`

- [ ] E4-2.1: Define all shared TypeScript types

```typescript
// ============================================================
// Page Types
// ============================================================

export type LinkedInPageType =
  | 'PROFILE'
  | 'PROFILE_ACTIVITY'
  | 'SEARCH_PEOPLE'
  | 'SEARCH_CONTENT'
  | 'FEED'
  | 'COMPANY'
  | 'CONNECTIONS'
  | 'MESSAGES'
  | 'OTHER';

export interface PageUrlPattern {
  pageType: LinkedInPageType;
  pattern: RegExp;
  description: string;
}

// ============================================================
// Capture Types
// ============================================================

export interface CapturePayload {
  captureId: string;
  url: string;
  pageType: LinkedInPageType;
  html: string;
  scrollDepth: number;
  viewportHeight: number;
  documentHeight: number;
  capturedAt: string;
  extensionVersion: string;
  sessionId: string;
  triggerMode: 'manual' | 'auto';
}

export interface CaptureRequest {
  type: 'CAPTURE_PAGE';
  tabId?: number;
}

export interface CaptureResponse {
  success: boolean;
  captureId: string;
  storedBytes: number;
  compressionRatio: number;
  queuedForParsing: boolean;
  pageType: string;
}

// ============================================================
// Task Types
// ============================================================

export type TaskType =
  | 'VISIT_PROFILE'
  | 'CAPTURE_PAGE'
  | 'SEND_MESSAGE'
  | 'REVIEW_CONTACT'
  | 'SEARCH_QUERY'
  | 'CHECK_COMPANY'
  | 'ENGAGE_POST';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface ExtensionTask {
  id: string;
  goalId: string;
  goalTitle: string;
  type: TaskType;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  targetUrl: string | null;
  searchQuery: string | null;
  contactName: string | null;
  appUrl: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Goal {
  id: string;
  title: string;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  tasks: ExtensionTask[];
}

export interface TasksResponse {
  goals: Goal[];
  totalPending: number;
  totalCompleted: number;
}

// ============================================================
// Template Types
// ============================================================

export interface TemplateResponse {
  success: boolean;
  message: string;
  templateId: string;
  templateName: string;
  variables: Record<string, string>;
  nextTemplateId: string | null;
}

// ============================================================
// Health & Settings Types
// ============================================================

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  dbConnected: boolean;
  wsConnected: boolean;
  pendingParseJobs: number;
  uptime: number;
  timestamp: string;
}

export interface ExtensionSettings {
  autoCaptureEnabled: boolean;
  capturePageTypes: LinkedInPageType[];
  dailyCaptureWarningThreshold: number;
  overlayPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  overlayEnabled: boolean;
  healthCheckIntervalMs: number;
  captureStabilityDelayMs: number;
  maxQueueSize: number;
}

// ============================================================
// WebSocket Types
// ============================================================

export type WsPushEventType =
  | 'CAPTURE_CONFIRMED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'GOAL_PROGRESS'
  | 'TEMPLATE_READY'
  | 'ENRICHMENT_COMPLETE'
  | 'SETTINGS_UPDATED'
  | 'PARSE_COMPLETE';

export interface WsMessage {
  type: WsPushEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

export type WsOutEventType = 'PAGE_NAVIGATED' | 'TASK_VIEWED';

export interface WsOutMessage {
  type: WsOutEventType;
  payload: Record<string, unknown>;
}

// ============================================================
// Connection State
// ============================================================

export type AppConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

// ============================================================
// Contact Lookup
// ============================================================

export interface ContactLookupResponse {
  found: boolean;
  contact: {
    id: string;
    name: string;
    headline: string;
    tier: string;
    goldScore: number;
    lastCapturedAt: string | null;
    lastEnrichedAt: string | null;
    tasksPending: number;
  } | null;
}

// ============================================================
// Internal Message Passing (chrome.runtime.sendMessage)
// ============================================================

export type ExtensionMessageType =
  | 'CAPTURE_REQUEST'
  | 'CAPTURE_RESULT'
  | 'PAGE_INFO'
  | 'CONNECTION_STATUS'
  | 'TASKS_UPDATE'
  | 'SETTINGS_UPDATE'
  | 'OVERLAY_STATE'
  | 'GET_STATUS'
  | 'OPEN_SIDE_PANEL';

export interface ExtensionMessage {
  type: ExtensionMessageType;
  payload?: unknown;
}

// ============================================================
// Storage Keys
// ============================================================

export interface StorageSchema {
  extensionToken: string | null;
  extensionId: string | null;
  appUrl: string;
  captureQueue: CapturePayload[];
  settings: ExtensionSettings;
  sessionId: string;
  dailyCaptureCount: number;
  dailyCaptureDate: string;
  pendingTasks: ExtensionTask[];
  lastHealthCheck: string | null;
  connectionState: AppConnectionState;
}
```

**Acceptance Criteria**:
- All types compile without errors
- Types cover every data exchange between extension components and app API
- Storage schema covers all persisted extension state
- Internal message types cover all inter-component communication

---

### Task E4-3: Shared Constants (Agent E5)

**File**: `extension/shared/constants.ts`

- [ ] E4-3.1: Define URL patterns and constants

```typescript
import { PageUrlPattern, LinkedInPageType, ExtensionSettings } from './types';

export const EXTENSION_VERSION = '0.1.0';

export const DEFAULT_APP_URL = 'http://localhost:3000';

export const PAGE_URL_PATTERNS: PageUrlPattern[] = [
  { pageType: 'PROFILE', pattern: /linkedin\.com\/in\/[^/]+\/?$/, description: 'Profile page' },
  { pageType: 'PROFILE_ACTIVITY', pattern: /linkedin\.com\/in\/[^/]+\/recent-activity/, description: 'Profile activity' },
  { pageType: 'SEARCH_PEOPLE', pattern: /linkedin\.com\/search\/results\/people/, description: 'People search' },
  { pageType: 'SEARCH_CONTENT', pattern: /linkedin\.com\/search\/results\/content/, description: 'Content search' },
  { pageType: 'FEED', pattern: /linkedin\.com\/feed\/?$/, description: 'Feed page' },
  { pageType: 'COMPANY', pattern: /linkedin\.com\/company\/[^/]+\/?$/, description: 'Company page' },
  { pageType: 'CONNECTIONS', pattern: /linkedin\.com\/mynetwork\/invite-connect\/connections/, description: 'Connections list' },
  { pageType: 'MESSAGES', pattern: /linkedin\.com\/messaging/, description: 'Messages' },
];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  autoCaptureEnabled: false,
  capturePageTypes: ['PROFILE', 'SEARCH_PEOPLE', 'COMPANY'],
  dailyCaptureWarningThreshold: 100,
  overlayPosition: 'bottom-right',
  overlayEnabled: true,
  healthCheckIntervalMs: 30000,
  captureStabilityDelayMs: 2000,
  maxQueueSize: 50,
};

export const WS_RECONNECT_INITIAL_MS = 5000;
export const WS_RECONNECT_MAX_MS = 60000;
export const WS_RECONNECT_MULTIPLIER = 2;

export const HEALTH_CHECK_ALARM = 'health-check';
export const QUEUE_FLUSH_ALARM = 'queue-flush';

export const CAPTURE_MAX_HTML_BYTES = 10 * 1024 * 1024; // 10MB
```

**Acceptance Criteria**:
- All URL patterns correctly match their target LinkedIn page types
- Default settings match the values specified in the app settings endpoint
- Constants used consistently across all extension components

---

### Task E4-4: Shared Storage Wrapper (Agent E5)

**File**: `extension/shared/storage.ts`

- [ ] E4-4.1: Implement chrome.storage.local wrapper

```typescript
import { StorageSchema, CapturePayload, ExtensionTask, ExtensionSettings, AppConnectionState } from './types';
import { DEFAULT_SETTINGS, DEFAULT_APP_URL } from './constants';

const STORAGE_DEFAULTS: StorageSchema = {
  extensionToken: null,
  extensionId: null,
  appUrl: DEFAULT_APP_URL,
  captureQueue: [],
  settings: DEFAULT_SETTINGS,
  sessionId: crypto.randomUUID(),
  dailyCaptureCount: 0,
  dailyCaptureDate: new Date().toISOString().split('T')[0],
  pendingTasks: [],
  lastHealthCheck: null,
  connectionState: 'disconnected',
};

export async function getStorage<K extends keyof StorageSchema>(
  key: K
): Promise<StorageSchema[K]> {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? STORAGE_DEFAULTS[key];
}

export async function setStorage<K extends keyof StorageSchema>(
  key: K,
  value: StorageSchema[K]
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getMultipleStorage<K extends keyof StorageSchema>(
  keys: K[]
): Promise<Pick<StorageSchema, K>> {
  const result = await chrome.storage.local.get(keys);
  const filled: Partial<StorageSchema> = {};
  for (const key of keys) {
    filled[key] = result[key] ?? STORAGE_DEFAULTS[key];
  }
  return filled as Pick<StorageSchema, K>;
}

// ---- Capture Queue Operations ----

export async function enqueueCapturePayload(payload: CapturePayload): Promise<number> {
  const queue = await getStorage('captureQueue');
  const settings = await getStorage('settings');
  if (queue.length >= settings.maxQueueSize) {
    queue.shift(); // Drop oldest if at max
  }
  queue.push(payload);
  await setStorage('captureQueue', queue);
  return queue.length;
}

export async function dequeueCapturePayload(): Promise<CapturePayload | null> {
  const queue = await getStorage('captureQueue');
  if (queue.length === 0) return null;
  const payload = queue.shift()!;
  await setStorage('captureQueue', queue);
  return payload;
}

export async function getCaptureQueueDepth(): Promise<number> {
  const queue = await getStorage('captureQueue');
  return queue.length;
}

export async function clearCaptureQueue(): Promise<void> {
  await setStorage('captureQueue', []);
}

// ---- Daily Capture Counter ----

export async function incrementDailyCaptureCount(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const storedDate = await getStorage('dailyCaptureDate');
  let count = await getStorage('dailyCaptureCount');

  if (storedDate !== today) {
    count = 0;
    await setStorage('dailyCaptureDate', today);
  }
  count += 1;
  await setStorage('dailyCaptureCount', count);
  return count;
}

// ---- Token Operations ----

export async function getToken(): Promise<string | null> {
  return getStorage('extensionToken');
}

export async function setToken(token: string, extensionId: string): Promise<void> {
  await chrome.storage.local.set({ extensionToken: token, extensionId });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.set({ extensionToken: null, extensionId: null });
}

// ---- Connection State ----

export async function setConnectionState(state: AppConnectionState): Promise<void> {
  await setStorage('connectionState', state);
}
```

**Acceptance Criteria**:
- All storage operations use typed keys
- Defaults applied when keys not yet stored
- Capture queue respects maxQueueSize
- Daily capture counter resets on new day
- Token get/set/clear operations work correctly

---

### Task E4-5: Shared App Client (Agent E5)

**File**: `extension/shared/app-client.ts`

- [ ] E4-5.1: Implement HTTP + WebSocket client

```typescript
import {
  CapturePayload, CaptureResponse, TasksResponse, TemplateResponse,
  HealthResponse, ExtensionSettings, ContactLookupResponse,
  WsMessage, WsOutMessage, AppConnectionState, ExtensionTask
} from './types';
import { WS_RECONNECT_INITIAL_MS, WS_RECONNECT_MAX_MS, WS_RECONNECT_MULTIPLIER } from './constants';
import { getToken, getStorage, setConnectionState } from './storage';

export type WsEventHandler = (event: WsMessage) => void;

export class AppClient {
  private appUrl: string;
  private ws: WebSocket | null = null;
  private wsReconnectDelay: number = WS_RECONNECT_INITIAL_MS;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsEventHandlers: Map<string, WsEventHandler[]> = new Map();
  private connectionState: AppConnectionState = 'disconnected';

  constructor(appUrl: string) {
    this.appUrl = appUrl;
  }

  // ---- HTTP Methods ----

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await getToken();
    if (!token) throw new Error('No extension token configured');

    const response = await fetch(`${this.appUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Token': token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`API error ${response.status}: ${error.message || response.statusText}`);
    }

    return response.json();
  }

  async submitCapture(payload: CapturePayload): Promise<CaptureResponse> {
    return this.request<CaptureResponse>('POST', '/api/extension/capture', payload);
  }

  async fetchTasks(status?: string, limit?: number): Promise<TasksResponse> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return this.request<TasksResponse>('GET', `/api/extension/tasks${query ? '?' + query : ''}`);
  }

  async updateTask(taskId: string, status: 'completed' | 'skipped' | 'in_progress'): Promise<ExtensionTask> {
    return this.request<ExtensionTask>('PATCH', `/api/extension/tasks/${taskId}`, { status });
  }

  async checkHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/api/extension/health');
  }

  async fetchSettings(): Promise<ExtensionSettings> {
    return this.request<ExtensionSettings>('GET', '/api/extension/settings');
  }

  async lookupContact(linkedinUrl: string): Promise<ContactLookupResponse> {
    const encodedUrl = encodeURIComponent(linkedinUrl);
    return this.request<ContactLookupResponse>('GET', `/api/extension/contact/${encodedUrl}`);
  }

  async renderMessage(contactUrl: string, templateType?: string): Promise<TemplateResponse> {
    return this.request<TemplateResponse>('POST', '/api/extension/message-render', {
      contactUrl,
      templateType,
    });
  }

  async register(displayToken: string): Promise<{ extensionId: string; settings: ExtensionSettings }> {
    const response = await fetch(`${this.appUrl}/api/extension/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayToken }),
    });
    if (!response.ok) throw new Error('Registration failed');
    return response.json();
  }

  // ---- WebSocket Methods ----

  async connectWebSocket(): Promise<void> {
    const token = await getToken();
    if (!token) {
      this.connectionState = 'error';
      await setConnectionState('error');
      return;
    }

    this.connectionState = 'connecting';
    await setConnectionState('connecting');

    const wsUrl = this.appUrl.replace(/^http/, 'ws') + `/ws/extension?token=${token}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        this.connectionState = 'connected';
        await setConnectionState('connected');
        this.wsReconnectDelay = WS_RECONNECT_INITIAL_MS;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          const handlers = this.wsEventHandlers.get(msg.type) || [];
          for (const handler of handlers) {
            handler(msg);
          }
          // Also call wildcard handlers
          const wildcardHandlers = this.wsEventHandlers.get('*') || [];
          for (const handler of wildcardHandlers) {
            handler(msg);
          }
        } catch {
          console.error('[AppClient] Failed to parse WS message');
        }
      };

      this.ws.onclose = async () => {
        this.ws = null;
        this.connectionState = 'disconnected';
        await setConnectionState('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = async () => {
        this.connectionState = 'error';
        await setConnectionState('error');
      };
    } catch {
      this.connectionState = 'error';
      await setConnectionState('error');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    this.wsReconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, this.wsReconnectDelay);
    this.wsReconnectDelay = Math.min(
      this.wsReconnectDelay * WS_RECONNECT_MULTIPLIER,
      WS_RECONNECT_MAX_MS
    );
  }

  sendWsMessage(msg: WsOutMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onWsEvent(eventType: string, handler: WsEventHandler): void {
    const handlers = this.wsEventHandlers.get(eventType) || [];
    handlers.push(handler);
    this.wsEventHandlers.set(eventType, handlers);
  }

  getConnectionState(): AppConnectionState {
    return this.connectionState;
  }

  disconnectWebSocket(): void {
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

- [ ] E4-5.2: Write app-client tests

**File**: `tests/unit/extension/app-client.test.ts`

```typescript
// Test: submitCapture sends POST with correct headers and body
// Test: fetchTasks builds query string correctly
// Test: request includes X-Extension-Token header
// Test: request throws on non-ok response
// Test: register does NOT include X-Extension-Token (no token yet)
// Test: WebSocket reconnect uses exponential backoff
// Test: WebSocket reconnect caps at WS_RECONNECT_MAX_MS
// Test: onWsEvent dispatches to registered handlers
// Test: sendWsMessage only sends when WebSocket is OPEN
```

**Acceptance Criteria**:
- All HTTP methods correctly call app API endpoints with auth headers
- Register endpoint works without a token
- WebSocket connects with token, reconnects with exponential backoff
- Event handlers dispatched correctly
- Tests pass

---

### Task E4-6: Content Script -- Page Capturer (Agent E1)

**BR Refs**: BR-801 (page detection), BR-802 (HTML capture), BR-803 (capture payload)

**File**: `extension/content-scripts/page-capturer.ts`

- [ ] E4-6.1: Implement page type detection

```typescript
import { LinkedInPageType, CapturePayload, ExtensionMessage } from '../shared/types';
import { PAGE_URL_PATTERNS, EXTENSION_VERSION } from '../shared/constants';

/**
 * Detect LinkedIn page type from URL.
 * Checks URL patterns in order; first match wins.
 * Returns 'OTHER' if no pattern matches.
 */
export function detectPageType(url: string): LinkedInPageType {
  for (const { pageType, pattern } of PAGE_URL_PATTERNS) {
    if (pattern.test(url)) return pageType;
  }
  return 'OTHER';
}
```

- [ ] E4-6.2: Implement full page capture

```typescript
/**
 * Capture full page HTML.
 * Returns document.documentElement.outerHTML.
 * Strips any injected extension elements (overlay, etc.) before capture.
 */
export function captureFullPage(): string {
  // Remove overlay element temporarily
  const overlay = document.getElementById('lni-overlay');
  if (overlay) overlay.style.display = 'none';

  const html = document.documentElement.outerHTML;

  // Restore overlay
  if (overlay) overlay.style.display = '';

  return html;
}
```

- [ ] E4-6.3: Implement scroll depth tracking

```typescript
let maxScrollDepth = 0;

function trackScrollDepth(): void {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  const currentDepth = (scrollTop + viewportHeight) / documentHeight;
  maxScrollDepth = Math.max(maxScrollDepth, Math.min(currentDepth, 1.0));
}

// Attach scroll listener
window.addEventListener('scroll', trackScrollDepth, { passive: true });
```

- [ ] E4-6.4: Implement DOM stability detection via MutationObserver

```typescript
/**
 * Wait for DOM to stabilize (no mutations for stabilityDelayMs).
 * Resolves when stable; rejects after 30s timeout.
 */
export function waitForDomStability(stabilityDelayMs: number = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('DOM stability timeout after 30s'));
    }, 30000);

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        observer.disconnect();
        clearTimeout(timeout);
        resolve();
      }, stabilityDelayMs);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });

    // Start initial timer in case DOM is already stable
    timer = setTimeout(() => {
      observer.disconnect();
      clearTimeout(timeout);
      resolve();
    }, stabilityDelayMs);
  });
}
```

- [ ] E4-6.5: Implement capture orchestration

```typescript
/**
 * Build CapturePayload from current page state.
 */
export function buildCapturePayload(
  triggerMode: 'manual' | 'auto',
  sessionId: string
): CapturePayload {
  return {
    captureId: crypto.randomUUID(),
    url: window.location.href,
    pageType: detectPageType(window.location.href),
    html: captureFullPage(),
    scrollDepth: maxScrollDepth,
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    capturedAt: new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
    sessionId,
    triggerMode,
  };
}

// Listen for capture requests from service worker / popup
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'CAPTURE_REQUEST') {
    const payload = buildCapturePayload('manual', /* sessionId from storage */ '');
    sendResponse({ type: 'CAPTURE_RESULT', payload });
    return true; // async response
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({
      type: 'PAGE_INFO',
      payload: {
        url: window.location.href,
        pageType: detectPageType(window.location.href),
        scrollDepth: maxScrollDepth,
        documentHeight: document.documentElement.scrollHeight,
      },
    });
    return true;
  }
});
```

- [ ] E4-6.6: Write page capturer tests

**File**: `tests/unit/extension/page-capturer.test.ts`

```typescript
// Test: detectPageType returns PROFILE for /in/username
// Test: detectPageType returns PROFILE for /in/username/ (trailing slash)
// Test: detectPageType returns PROFILE_ACTIVITY for /in/username/recent-activity/
// Test: detectPageType returns SEARCH_PEOPLE for /search/results/people/
// Test: detectPageType returns FEED for /feed/
// Test: detectPageType returns COMPANY for /company/name/
// Test: detectPageType returns CONNECTIONS for /mynetwork/invite-connect/connections/
// Test: detectPageType returns MESSAGES for /messaging/
// Test: detectPageType returns OTHER for /jobs/ or unknown paths
// Test: buildCapturePayload includes all required fields
// Test: buildCapturePayload generates unique captureId
// Test: scrollDepth tracks maximum depth reached
```

**Acceptance Criteria**:
- All 8 LinkedIn page types detected correctly via URL pattern matching
- Full page HTML captured (document.documentElement.outerHTML)
- Overlay element excluded from captured HTML
- Scroll depth tracks maximum depth
- DOM stability waits for 2s of no mutations before signaling ready
- CapturePayload includes all required fields with correct types
- Message listener responds to CAPTURE_REQUEST and GET_STATUS
- Tests pass

---

### Task E4-7: Content Script -- Overlay (Agent E1)

**BR Refs**: BR-809 (status overlay)

- [ ] E4-7.1: Implement overlay component

**File**: `extension/content-scripts/overlay.ts`

```typescript
import { ExtensionMessage } from '../shared/types';

export type OverlayState = 'ready' | 'capturing' | 'synced' | 'scroll-more' | 'error' | 'hidden';

const OVERLAY_ID = 'lni-overlay';
const AUTO_HIDE_MS = 3000;

const STATE_CONFIG: Record<OverlayState, { text: string; className: string; autoHide: boolean }> = {
  ready: { text: 'Ready', className: 'lni-overlay--ready', autoHide: false },
  capturing: { text: 'Capturing...', className: 'lni-overlay--capturing', autoHide: false },
  synced: { text: 'Synced', className: 'lni-overlay--synced', autoHide: true },
  'scroll-more': { text: 'Scroll more', className: 'lni-overlay--scroll-more', autoHide: false },
  error: { text: 'Error', className: 'lni-overlay--error', autoHide: true },
  hidden: { text: '', className: 'lni-overlay--hidden', autoHide: false },
};

let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

function createOverlay(): HTMLDivElement {
  const existing = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (existing) return existing;

  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.className = 'lni-overlay lni-overlay--ready';
  el.setAttribute('aria-hidden', 'true');
  el.style.pointerEvents = 'none';
  el.textContent = 'Ready';
  document.body.appendChild(el);
  return el;
}

export function setOverlayState(state: OverlayState): void {
  const el = createOverlay();
  const config = STATE_CONFIG[state];

  // Remove all state classes
  for (const s of Object.values(STATE_CONFIG)) {
    el.classList.remove(s.className);
  }

  el.className = `lni-overlay ${config.className}`;
  el.textContent = config.text;

  if (autoHideTimer) clearTimeout(autoHideTimer);

  if (config.autoHide) {
    autoHideTimer = setTimeout(() => {
      el.classList.add('lni-overlay--hidden');
    }, AUTO_HIDE_MS);
  }
}

// Listen for overlay state changes from service worker
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'OVERLAY_STATE') {
    setOverlayState(message.payload as OverlayState);
  }
});

// Initialize overlay on load
createOverlay();
```

- [ ] E4-7.2: Implement overlay CSS

**File**: `extension/content-scripts/overlay.css`

```css
.lni-overlay {
  position: fixed;
  bottom: 80px;
  right: 20px;
  z-index: 2147483647;
  padding: 8px 16px;
  border-radius: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  pointer-events: none;
  user-select: none;
  transition: opacity 0.3s ease, transform 0.3s ease, background-color 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  opacity: 1;
  transform: translateY(0);
}

/* State: Ready (green) */
.lni-overlay--ready {
  background-color: #22c55e;
  color: #ffffff;
}

/* State: Capturing (blue, pulse animation) */
.lni-overlay--capturing {
  background-color: #3b82f6;
  color: #ffffff;
  animation: lni-pulse 1.5s ease-in-out infinite;
}

@keyframes lni-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* State: Synced (green, fades out) */
.lni-overlay--synced {
  background-color: #22c55e;
  color: #ffffff;
}

/* State: Scroll More (orange) */
.lni-overlay--scroll-more {
  background-color: #f59e0b;
  color: #ffffff;
}

/* State: Error (red) */
.lni-overlay--error {
  background-color: #ef4444;
  color: #ffffff;
}

/* State: Hidden */
.lni-overlay--hidden {
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
}

/* Position variants */
.lni-overlay--bottom-left {
  right: auto;
  left: 20px;
}

.lni-overlay--top-right {
  bottom: auto;
  top: 80px;
}

.lni-overlay--top-left {
  bottom: auto;
  top: 80px;
  right: auto;
  left: 20px;
}
```

- [ ] E4-7.3: Write overlay tests

**File**: `tests/unit/extension/overlay.test.ts`

```typescript
// Test: createOverlay creates element with correct ID
// Test: createOverlay reuses existing element
// Test: setOverlayState applies correct CSS class
// Test: setOverlayState sets correct text content
// Test: synced state auto-hides after 3 seconds
// Test: error state auto-hides after 3 seconds
// Test: ready state does NOT auto-hide
// Test: pointer-events is none (non-interactive)
```

**Acceptance Criteria**:
- Overlay renders in bottom-right, 80px above fold
- All 6 states have distinct visual appearance
- Capturing state has blue pulse animation
- Transient states (synced, error) auto-hide after 3 seconds
- Overlay is non-interactive (pointer-events: none)
- Overlay excluded from page capture HTML
- Tests pass

---

### Task E4-8: Service Worker (Agent E2)

**BR Refs**: BR-812 (service worker), BR-814 (connection management)

**File**: `extension/service-worker.ts`

- [ ] E4-8.1: Implement service worker initialization

```typescript
import { AppClient } from './shared/app-client';
import { getStorage, setStorage, enqueueCapturePayload, dequeueCapturePayload,
         incrementDailyCaptureCount, getCaptureQueueDepth, setConnectionState } from './shared/storage';
import { CapturePayload, ExtensionMessage, ExtensionTask, WsMessage } from './shared/types';
import { HEALTH_CHECK_ALARM, QUEUE_FLUSH_ALARM, DEFAULT_APP_URL } from './shared/constants';

let appClient: AppClient | null = null;

async function initializeServiceWorker(): Promise<void> {
  const appUrl = await getStorage('appUrl');
  appClient = new AppClient(appUrl || DEFAULT_APP_URL);

  // Set up alarms
  await chrome.alarms.create(HEALTH_CHECK_ALARM, { periodInMinutes: 0.5 });
  await chrome.alarms.create(QUEUE_FLUSH_ALARM, { periodInMinutes: 1 });

  // Connect WebSocket
  const token = await getStorage('extensionToken');
  if (token) {
    await appClient.connectWebSocket();
    registerWsHandlers();
  }

  // Set initial badge
  await updateBadge();
}

// Run on install and startup
chrome.runtime.onInstalled.addListener(() => initializeServiceWorker());
chrome.runtime.onStartup.addListener(() => initializeServiceWorker());
```

- [ ] E4-8.2: Implement message routing

```typescript
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true; // async
  }
);

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'CAPTURE_RESULT':
      return handleCaptureResult(message.payload as CapturePayload);
    case 'GET_STATUS':
      return getExtensionStatus();
    case 'OPEN_SIDE_PANEL':
      if (sender.tab?.windowId) {
        await chrome.sidePanel.open({ windowId: sender.tab.windowId });
      }
      return { success: true };
    default:
      return { error: 'Unknown message type' };
  }
}
```

- [ ] E4-8.3: Implement capture submission with offline queue

```typescript
async function handleCaptureResult(payload: CapturePayload): Promise<CaptureResponse | { queued: true }> {
  if (!appClient) throw new Error('Service worker not initialized');

  // Notify overlay: capturing
  notifyContentScript(payload, 'capturing');

  try {
    const result = await appClient.submitCapture(payload);
    await incrementDailyCaptureCount();
    notifyContentScript(payload, 'synced');
    await updateBadge();
    return result;
  } catch (error) {
    // App unreachable: queue for later
    const queueDepth = await enqueueCapturePayload(payload);
    notifyContentScript(payload, 'error');
    console.warn(`[SW] Capture queued (depth: ${queueDepth}):`, error);
    return { queued: true };
  }
}

async function flushCaptureQueue(): Promise<void> {
  if (!appClient) return;
  let payload = await dequeueCapturePayload();
  while (payload) {
    try {
      await appClient.submitCapture(payload);
      await incrementDailyCaptureCount();
    } catch {
      // Re-queue and stop flushing
      await enqueueCapturePayload(payload);
      break;
    }
    payload = await dequeueCapturePayload();
  }
  await updateBadge();
}

function notifyContentScript(payload: CapturePayload, state: string): void {
  // Send overlay state to the tab that initiated the capture
  chrome.tabs.query({ url: '*://www.linkedin.com/*' }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id && tab.url === payload.url) {
        chrome.tabs.sendMessage(tab.id, { type: 'OVERLAY_STATE', payload: state });
      }
    }
  });
}
```

- [ ] E4-8.4: Implement alarm handlers

```typescript
chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case HEALTH_CHECK_ALARM:
      await performHealthCheck();
      break;
    case QUEUE_FLUSH_ALARM:
      await flushCaptureQueue();
      break;
  }
});

async function performHealthCheck(): Promise<void> {
  if (!appClient) return;
  try {
    const health = await appClient.checkHealth();
    await setStorage('lastHealthCheck', new Date().toISOString());
    if (health.status === 'healthy') {
      await setConnectionState('connected');
    } else {
      await setConnectionState('error');
    }
  } catch {
    await setConnectionState('disconnected');
  }
  await updateBadge();
}
```

- [ ] E4-8.5: Implement badge management

```typescript
async function updateBadge(): Promise<void> {
  const connectionState = await getStorage('connectionState');
  const pendingTasks = await getStorage('pendingTasks');
  const pendingCount = pendingTasks.filter(t => t.status === 'pending').length;

  // Determine current tab context
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnLinkedIn = activeTab?.url?.includes('linkedin.com') ?? false;

  if (!isOnLinkedIn) {
    // Grey dot: not on LinkedIn
    await chrome.action.setBadgeBackgroundColor({ color: '#9ca3af' });
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  if (connectionState === 'disconnected' || connectionState === 'error') {
    // Orange "!": app offline
    await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    await chrome.action.setBadgeText({ text: '!' });
    return;
  }

  if (pendingCount > 0) {
    // Blue number: pending task count
    await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    await chrome.action.setBadgeText({ text: String(pendingCount > 99 ? '99+' : pendingCount) });
    return;
  }

  // Green dot: connected, on LinkedIn, no pending tasks
  await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  await chrome.action.setBadgeText({ text: '' });
}
```

- [ ] E4-8.6: Implement WebSocket event handlers

```typescript
function registerWsHandlers(): void {
  if (!appClient) return;

  appClient.onWsEvent('TASK_CREATED', async (msg: WsMessage) => {
    const tasks = await getStorage('pendingTasks');
    tasks.push(msg.payload as unknown as ExtensionTask);
    await setStorage('pendingTasks', tasks);
    await updateBadge();
  });

  appClient.onWsEvent('TASK_UPDATED', async (msg: WsMessage) => {
    const tasks = await getStorage('pendingTasks');
    const updated = tasks.map(t =>
      t.id === (msg.payload as { taskId: string }).taskId
        ? { ...t, status: (msg.payload as { status: string }).status as ExtensionTask['status'] }
        : t
    );
    await setStorage('pendingTasks', updated);
    await updateBadge();
  });

  appClient.onWsEvent('SETTINGS_UPDATED', async (msg: WsMessage) => {
    await setStorage('settings', msg.payload as unknown as ExtensionSettings);
  });

  appClient.onWsEvent('CAPTURE_CONFIRMED', async () => {
    // No-op in service worker; overlay handles visual feedback
  });
}
```

- [ ] E4-8.7: Implement SPA navigation detection and task auto-completion

```typescript
// LinkedIn is a SPA; detect navigation via webNavigation API
chrome.webNavigation.onHistoryStateUpdated.addListener(
  async (details) => {
    if (!details.url.includes('linkedin.com')) return;

    // Notify app of navigation
    if (appClient) {
      appClient.sendWsMessage({
        type: 'PAGE_NAVIGATED',
        payload: { url: details.url, tabId: details.tabId },
      });
    }

    // Check for task auto-completion
    await checkTaskCompletion(details.url);
    await updateBadge();
  },
  { url: [{ hostContains: 'linkedin.com' }] }
);

async function checkTaskCompletion(currentUrl: string): Promise<void> {
  const tasks = await getStorage('pendingTasks');
  for (const task of tasks) {
    if (task.status !== 'pending') continue;
    if (!task.targetUrl) continue;

    // Normalize both URLs for comparison
    const normalizedCurrent = normalizeLinkedInUrl(currentUrl);
    const normalizedTarget = normalizeLinkedInUrl(task.targetUrl);

    if (normalizedCurrent === normalizedTarget) {
      try {
        if (appClient) {
          await appClient.updateTask(task.id, 'completed');
        }
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
      } catch {
        console.warn(`[SW] Failed to auto-complete task ${task.id}`);
      }
    }
  }
  await setStorage('pendingTasks', tasks);
}

function normalizeLinkedInUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip tracking params
    u.searchParams.delete('miniProfileUrn');
    u.searchParams.delete('trk');
    u.searchParams.delete('lipi');
    u.searchParams.delete('lici');
    u.searchParams.delete('midToken');
    // Remove trailing slash
    let path = u.pathname.replace(/\/$/, '');
    return `${u.origin}${path}`;
  } catch {
    return url;
  }
}
```

- [ ] E4-8.8: Write service worker tests

**File**: `tests/unit/extension/service-worker.test.ts`

```typescript
// Test: handleCaptureResult submits to app and returns CaptureResponse
// Test: handleCaptureResult queues capture when app unreachable
// Test: flushCaptureQueue submits queued captures in chronological order
// Test: flushCaptureQueue re-queues on failure and stops
// Test: performHealthCheck updates connection state
// Test: updateBadge shows green when connected on LinkedIn
// Test: updateBadge shows blue number for pending tasks
// Test: updateBadge shows orange "!" when app offline
// Test: updateBadge shows grey when not on LinkedIn
// Test: checkTaskCompletion completes task when URL matches
// Test: checkTaskCompletion normalizes URLs before comparison
// Test: normalizeLinkedInUrl strips tracking parameters
// Test: SPA navigation triggers PAGE_NAVIGATED WebSocket message
```

**Acceptance Criteria**:
- Service worker initializes on install and startup
- Capture submission falls back to offline queue on failure
- Queue flushed in chronological order on reconnect
- Health check runs every 30 seconds via alarm
- Badge reflects connection state and task count
- Task auto-completion detects URL match after navigation
- WebSocket events update local task/settings state
- All tests pass

---

### Task E4-9: Popup (Agent E3)

**BR Refs**: BR-807 (popup UI)

- [ ] E4-9.1: Create popup HTML

**File**: `extension/popup/popup.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LinkedIn Network Intelligence</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="popup-root">
    <!-- Header -->
    <header class="popup-header">
      <div class="popup-header__title">Network Intelligence</div>
      <button id="settings-btn" class="popup-header__settings" title="Settings">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/>
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.902 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.116l.094-.318z"/>
        </svg>
      </button>
    </header>

    <!-- Connection Status -->
    <div id="connection-status" class="status-bar">
      <span class="status-bar__dot"></span>
      <span class="status-bar__text">Checking...</span>
    </div>

    <!-- Page Info Section -->
    <section id="page-info" class="section">
      <div class="section__label">Current Page</div>
      <div id="page-type" class="page-info__type">--</div>
      <div id="page-capture-status" class="page-info__capture-status"></div>
    </section>

    <!-- Capture Button -->
    <button id="capture-btn" class="capture-btn" disabled>
      Capture This Page
    </button>

    <!-- Today's Stats -->
    <div id="daily-stats" class="stats-row">
      <span class="stats-row__label">Today's captures:</span>
      <span id="capture-count" class="stats-row__value">0</span>
    </div>

    <!-- Top Tasks -->
    <section id="tasks-section" class="section">
      <div class="section__label">Tasks</div>
      <div id="tasks-list" class="tasks-list">
        <div class="tasks-list__empty">No pending tasks</div>
      </div>
      <button id="open-sidepanel-btn" class="link-btn">
        See All Tasks in Side Panel
      </button>
    </section>

    <!-- Message Template (shown on profile pages) -->
    <section id="template-section" class="section section--hidden">
      <div class="section__label">Message Template</div>
      <div id="template-content" class="template-content"></div>
      <button id="copy-template-btn" class="capture-btn capture-btn--secondary">
        Copy to Clipboard
      </button>
    </section>

    <!-- Settings Panel (hidden by default) -->
    <section id="settings-panel" class="section section--hidden">
      <div class="section__label">Settings</div>
      <div class="settings-field">
        <label for="app-url-input">App URL</label>
        <input id="app-url-input" type="url" value="http://localhost:3000">
      </div>
      <div class="settings-field">
        <label for="token-input">Extension Token</label>
        <input id="token-input" type="password" placeholder="Paste token from app">
      </div>
      <button id="register-btn" class="capture-btn capture-btn--secondary">
        Register
      </button>
    </section>
  </div>
  <script src="../dist/popup/popup.js" type="module"></script>
</body>
</html>
```

- [ ] E4-9.2: Implement popup TypeScript

**File**: `extension/popup/popup.ts`

```typescript
import { AppClient } from '../shared/app-client';
import { getStorage, getMultipleStorage, setStorage, setToken } from '../shared/storage';
import { ExtensionMessage, ExtensionTask, AppConnectionState, LinkedInPageType } from '../shared/types';
import { DEFAULT_APP_URL } from '../shared/constants';

// DOM element references
const connectionDot = document.querySelector('.status-bar__dot') as HTMLElement;
const connectionText = document.querySelector('.status-bar__text') as HTMLElement;
const pageType = document.getElementById('page-type') as HTMLElement;
const pageCaptureStatus = document.getElementById('page-capture-status') as HTMLElement;
const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement;
const captureCount = document.getElementById('capture-count') as HTMLElement;
const tasksList = document.getElementById('tasks-list') as HTMLElement;
const openSidePanelBtn = document.getElementById('open-sidepanel-btn') as HTMLButtonElement;
const templateSection = document.getElementById('template-section') as HTMLElement;
const templateContent = document.getElementById('template-content') as HTMLElement;
const copyTemplateBtn = document.getElementById('copy-template-btn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsPanel = document.getElementById('settings-panel') as HTMLElement;
const appUrlInput = document.getElementById('app-url-input') as HTMLInputElement;
const tokenInput = document.getElementById('token-input') as HTMLInputElement;
const registerBtn = document.getElementById('register-btn') as HTMLButtonElement;

async function init(): Promise<void> {
  await updateConnectionStatus();
  await updatePageInfo();
  await updateDailyStats();
  await loadTasks();
  setupEventListeners();
}

async function updateConnectionStatus(): Promise<void> {
  const state = await getStorage('connectionState');
  setConnectionDisplay(state);
}

function setConnectionDisplay(state: AppConnectionState): void {
  connectionDot.className = `status-bar__dot status-bar__dot--${state}`;
  const labels: Record<AppConnectionState, string> = {
    connected: 'Connected to app',
    connecting: 'Connecting...',
    disconnected: 'App offline',
    error: 'Connection error',
  };
  connectionText.textContent = labels[state];
}

async function updatePageInfo(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes('linkedin.com')) {
    pageType.textContent = 'Not on LinkedIn';
    captureBtn.disabled = true;
    return;
  }

  // Ask content script for page info
  chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, (response) => {
    if (response?.type === 'PAGE_INFO') {
      pageType.textContent = response.payload.pageType;
      captureBtn.disabled = false;

      // Show template section on profile pages
      if (response.payload.pageType === 'PROFILE') {
        templateSection.classList.remove('section--hidden');
        loadTemplate(tab.url!);
      }
    }
  });
}

async function loadTasks(): Promise<void> {
  const tasks = await getStorage('pendingTasks');
  const pending = tasks.filter(t => t.status === 'pending').slice(0, 3);

  if (pending.length === 0) {
    tasksList.innerHTML = '<div class="tasks-list__empty">No pending tasks</div>';
    return;
  }

  tasksList.innerHTML = pending.map(task => `
    <div class="task-item" data-task-id="${task.id}">
      <span class="task-item__icon">${getTaskIcon(task.type)}</span>
      <div class="task-item__content">
        <div class="task-item__title">${escapeHtml(task.title)}</div>
        <div class="task-item__goal">${escapeHtml(task.goalTitle)}</div>
      </div>
      ${task.targetUrl ? `<a href="${task.targetUrl}" target="_blank" class="task-item__link" title="Open in LinkedIn">&#8599;</a>` : ''}
    </div>
  `).join('');
}

function getTaskIcon(type: string): string {
  const icons: Record<string, string> = {
    VISIT_PROFILE: '&#128100;',
    CAPTURE_PAGE: '&#128247;',
    SEND_MESSAGE: '&#9993;',
    REVIEW_CONTACT: '&#128269;',
    SEARCH_QUERY: '&#128270;',
    CHECK_COMPANY: '&#127970;',
    ENGAGE_POST: '&#128172;',
  };
  return icons[type] || '&#9679;';
}

async function loadTemplate(profileUrl: string): Promise<void> {
  try {
    const appUrl = await getStorage('appUrl');
    const client = new AppClient(appUrl || DEFAULT_APP_URL);
    const result = await client.renderMessage(profileUrl);
    templateContent.textContent = result.message;
  } catch {
    templateContent.textContent = 'Template unavailable';
  }
}

function setupEventListeners(): void {
  captureBtn.addEventListener('click', handleCapture);
  openSidePanelBtn.addEventListener('click', handleOpenSidePanel);
  copyTemplateBtn.addEventListener('click', handleCopyTemplate);
  settingsBtn.addEventListener('click', toggleSettings);
  registerBtn.addEventListener('click', handleRegister);
}

async function handleCapture(): Promise<void> {
  captureBtn.disabled = true;
  captureBtn.textContent = 'Capturing...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_REQUEST' }, async (response) => {
    if (response?.type === 'CAPTURE_RESULT') {
      // Forward capture payload to service worker
      const result = await chrome.runtime.sendMessage({
        type: 'CAPTURE_RESULT',
        payload: response.payload,
      });
      captureBtn.textContent = 'Captured!';
      await updateDailyStats();
      setTimeout(() => {
        captureBtn.textContent = 'Capture This Page';
        captureBtn.disabled = false;
      }, 2000);
    }
  });
}

async function handleOpenSidePanel(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
}

async function handleCopyTemplate(): Promise<void> {
  const text = templateContent.textContent || '';
  await navigator.clipboard.writeText(text);
  copyTemplateBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyTemplateBtn.textContent = 'Copy to Clipboard';
  }, 2000);
}

function toggleSettings(): void {
  settingsPanel.classList.toggle('section--hidden');
}

async function handleRegister(): Promise<void> {
  const appUrl = appUrlInput.value.trim();
  const displayToken = tokenInput.value.trim();
  if (!appUrl || !displayToken) return;

  try {
    const client = new AppClient(appUrl);
    const result = await client.register(displayToken);
    await setToken(displayToken, result.extensionId);
    await setStorage('appUrl', appUrl);
    await setStorage('settings', result.settings);
    registerBtn.textContent = 'Registered!';
    toggleSettings();
    await updateConnectionStatus();
  } catch {
    registerBtn.textContent = 'Failed - try again';
  }
}

async function updateDailyStats(): Promise<void> {
  const count = await getStorage('dailyCaptureCount');
  captureCount.textContent = String(count);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
init();
```

- [ ] E4-9.3: Create popup CSS

**File**: `extension/popup/popup.css`

```css
/* Popup: 360px wide, max 500px tall */
body {
  width: 360px;
  max-height: 500px;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: #1a1a2e;
  background: #ffffff;
  overflow-y: auto;
}

#popup-root { padding: 12px; }

.popup-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 12px;
}
.popup-header__title { font-size: 15px; font-weight: 600; }
.popup-header__settings {
  background: none; border: none; cursor: pointer; color: #6b7280; padding: 4px;
  border-radius: 4px;
}
.popup-header__settings:hover { background: #f3f4f6; color: #1a1a2e; }

.status-bar {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: #f9fafb; border-radius: 8px; margin-bottom: 12px;
}
.status-bar__dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.status-bar__dot--connected { background: #22c55e; }
.status-bar__dot--connecting { background: #f59e0b; animation: blink 1s infinite; }
.status-bar__dot--disconnected { background: #ef4444; }
.status-bar__dot--error { background: #ef4444; }
.status-bar__text { font-size: 12px; color: #6b7280; }

@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.section { margin-bottom: 12px; }
.section__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; margin-bottom: 6px; }
.section--hidden { display: none; }

.page-info__type { font-size: 14px; font-weight: 500; }
.page-info__capture-status { font-size: 11px; color: #6b7280; margin-top: 2px; }

.capture-btn {
  width: 100%; padding: 10px; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  background: #3b82f6; color: #ffffff; margin-bottom: 8px;
  transition: background 0.2s;
}
.capture-btn:hover:not(:disabled) { background: #2563eb; }
.capture-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.capture-btn--secondary { background: #e5e7eb; color: #374151; }
.capture-btn--secondary:hover:not(:disabled) { background: #d1d5db; }

.stats-row { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; margin-bottom: 12px; padding: 0 4px; }
.stats-row__value { font-weight: 600; color: #1a1a2e; }

.tasks-list { display: flex; flex-direction: column; gap: 6px; }
.tasks-list__empty { font-size: 12px; color: #9ca3af; text-align: center; padding: 12px; }

.task-item {
  display: flex; align-items: center; gap: 8px; padding: 8px;
  background: #f9fafb; border-radius: 6px;
}
.task-item__icon { font-size: 14px; flex-shrink: 0; }
.task-item__content { flex: 1; min-width: 0; }
.task-item__title { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-item__goal { font-size: 11px; color: #9ca3af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-item__link { font-size: 14px; text-decoration: none; color: #3b82f6; flex-shrink: 0; }

.link-btn {
  display: block; width: 100%; text-align: center; padding: 8px;
  background: none; border: 1px solid #e5e7eb; border-radius: 6px;
  font-size: 12px; color: #3b82f6; cursor: pointer; margin-top: 8px;
}
.link-btn:hover { background: #f9fafb; }

.template-content {
  background: #f9fafb; border-radius: 6px; padding: 10px;
  font-size: 12px; line-height: 1.5; white-space: pre-wrap;
  max-height: 120px; overflow-y: auto; margin-bottom: 8px;
}

.settings-field { margin-bottom: 10px; }
.settings-field label { display: block; font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
.settings-field input {
  width: 100%; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px;
  font-size: 13px; box-sizing: border-box;
}
.settings-field input:focus { outline: none; border-color: #3b82f6; }
```

- [ ] E4-9.4: Write popup tests

**File**: `tests/unit/extension/popup.test.ts`

```typescript
// Test: init loads connection status from storage
// Test: updatePageInfo disables capture on non-LinkedIn pages
// Test: updatePageInfo enables capture on LinkedIn pages
// Test: handleCapture sends CAPTURE_REQUEST to content script
// Test: loadTasks renders top 3 pending tasks
// Test: loadTasks shows empty state with no tasks
// Test: handleCopyTemplate copies to clipboard
// Test: handleRegister stores token and settings on success
// Test: escapeHtml prevents XSS
```

**Acceptance Criteria**:
- Popup displays connection status with colored dot
- Current page type shown
- "Capture This Page" button triggers capture via content script
- Today's capture count displayed
- Top 3 tasks shown with icons
- "See All Tasks in Side Panel" opens side panel
- Message template section shown only on profile pages
- "Copy to Clipboard" works
- Settings panel allows token registration
- Tests pass

---

### Task E4-10: Side Panel (Agent E4)

**BR Refs**: BR-808 (side panel UI)

- [ ] E4-10.1: Create side panel HTML

**File**: `extension/sidepanel/sidepanel.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Network Intelligence</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <div id="sidepanel-root">
    <header class="sp-header">
      <h1 class="sp-header__title">Network Intelligence</h1>
      <div id="sp-connection" class="sp-connection">
        <span class="sp-connection__dot"></span>
      </div>
    </header>

    <!-- Current Page Section -->
    <section id="sp-current-page" class="sp-section">
      <h2 class="sp-section__title">Current Page</h2>
      <div id="sp-page-info" class="sp-page-info">
        <span id="sp-page-type">Not on LinkedIn</span>
        <button id="sp-recapture-btn" class="sp-btn sp-btn--small sp-btn--hidden">Re-capture</button>
      </div>
    </section>

    <!-- Filter Bar -->
    <div class="sp-filter-bar">
      <select id="sp-filter-goal" class="sp-select">
        <option value="">All Goals</option>
      </select>
      <select id="sp-filter-priority" class="sp-select">
        <option value="">All Priorities</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
    </div>

    <!-- Goals & Tasks -->
    <section id="sp-goals" class="sp-section">
      <h2 class="sp-section__title">Goals & Tasks</h2>
      <div id="sp-goals-list" class="sp-goals-list">
        <div class="sp-empty">No goals yet</div>
      </div>
    </section>

    <!-- Message Template -->
    <section id="sp-template" class="sp-section sp-section--hidden">
      <h2 class="sp-section__title">Message Template</h2>
      <div id="sp-template-content" class="sp-template-content"></div>
      <div class="sp-template-actions">
        <button id="sp-copy-btn" class="sp-btn">Copy to Clipboard</button>
        <button id="sp-next-template-btn" class="sp-btn sp-btn--secondary">Next Template</button>
      </div>
    </section>

    <!-- Session Stats -->
    <section class="sp-section sp-section--stats">
      <h2 class="sp-section__title">Session Stats</h2>
      <div class="sp-stats-grid">
        <div class="sp-stat">
          <div class="sp-stat__value" id="sp-stat-captured">0</div>
          <div class="sp-stat__label">Captured</div>
        </div>
        <div class="sp-stat">
          <div class="sp-stat__value" id="sp-stat-done">0</div>
          <div class="sp-stat__label">Tasks Done</div>
        </div>
        <div class="sp-stat">
          <div class="sp-stat__value" id="sp-stat-pending">0</div>
          <div class="sp-stat__label">Pending</div>
        </div>
      </div>
    </section>
  </div>
  <script src="../dist/sidepanel/sidepanel.js" type="module"></script>
</body>
</html>
```

- [ ] E4-10.2: Implement side panel TypeScript

**File**: `extension/sidepanel/sidepanel.ts`

```typescript
import { AppClient } from '../shared/app-client';
import { getStorage, getMultipleStorage, setStorage } from '../shared/storage';
import { Goal, ExtensionTask, TaskPriority, AppConnectionState } from '../shared/types';
import { DEFAULT_APP_URL } from '../shared/constants';

// DOM refs
const spConnectionDot = document.querySelector('.sp-connection__dot') as HTMLElement;
const spPageType = document.getElementById('sp-page-type') as HTMLElement;
const spRecaptureBtn = document.getElementById('sp-recapture-btn') as HTMLButtonElement;
const spFilterGoal = document.getElementById('sp-filter-goal') as HTMLSelectElement;
const spFilterPriority = document.getElementById('sp-filter-priority') as HTMLSelectElement;
const spGoalsList = document.getElementById('sp-goals-list') as HTMLElement;
const spTemplateSection = document.getElementById('sp-template') as HTMLElement;
const spTemplateContent = document.getElementById('sp-template-content') as HTMLElement;
const spCopyBtn = document.getElementById('sp-copy-btn') as HTMLButtonElement;
const spNextTemplateBtn = document.getElementById('sp-next-template-btn') as HTMLButtonElement;
const spStatCaptured = document.getElementById('sp-stat-captured') as HTMLElement;
const spStatDone = document.getElementById('sp-stat-done') as HTMLElement;
const spStatPending = document.getElementById('sp-stat-pending') as HTMLElement;

let allGoals: Goal[] = [];
let currentTemplateId: string | null = null;
let nextTemplateId: string | null = null;

async function init(): Promise<void> {
  await updateConnectionStatus();
  await updateCurrentPage();
  await loadGoalsAndTasks();
  await updateSessionStats();
  setupEventListeners();
  setupStorageListener();
}

async function loadGoalsAndTasks(): Promise<void> {
  try {
    const appUrl = await getStorage('appUrl');
    const client = new AppClient(appUrl || DEFAULT_APP_URL);
    const response = await client.fetchTasks();
    allGoals = response.goals;
    populateGoalFilter();
    renderGoals();
  } catch {
    // Fall back to cached tasks
    const tasks = await getStorage('pendingTasks');
    // Group tasks by goal
    allGoals = groupTasksByGoal(tasks);
    renderGoals();
  }
}

function groupTasksByGoal(tasks: ExtensionTask[]): Goal[] {
  const goalMap = new Map<string, Goal>();
  for (const task of tasks) {
    if (!goalMap.has(task.goalId)) {
      goalMap.set(task.goalId, {
        id: task.goalId,
        title: task.goalTitle,
        progress: 0,
        totalTasks: 0,
        completedTasks: 0,
        tasks: [],
      });
    }
    const goal = goalMap.get(task.goalId)!;
    goal.tasks.push(task);
    goal.totalTasks += 1;
    if (task.status === 'completed') goal.completedTasks += 1;
    goal.progress = goal.totalTasks > 0 ? goal.completedTasks / goal.totalTasks : 0;
  }
  return Array.from(goalMap.values());
}

function populateGoalFilter(): void {
  spFilterGoal.innerHTML = '<option value="">All Goals</option>';
  for (const goal of allGoals) {
    const opt = document.createElement('option');
    opt.value = goal.id;
    opt.textContent = goal.title;
    spFilterGoal.appendChild(opt);
  }
}

function renderGoals(): void {
  const goalFilter = spFilterGoal.value;
  const priorityFilter = spFilterPriority.value as TaskPriority | '';

  let filteredGoals = allGoals;
  if (goalFilter) filteredGoals = filteredGoals.filter(g => g.id === goalFilter);

  if (filteredGoals.length === 0) {
    spGoalsList.innerHTML = '<div class="sp-empty">No goals match filters</div>';
    return;
  }

  spGoalsList.innerHTML = filteredGoals.map(goal => {
    let tasks = goal.tasks;
    if (priorityFilter) tasks = tasks.filter(t => t.priority === priorityFilter);

    const sortedTasks = [...tasks].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
    });

    return `
      <div class="sp-goal">
        <div class="sp-goal__header">
          <div class="sp-goal__title">${escapeHtml(goal.title)}</div>
          <div class="sp-goal__progress-text">${Math.round(goal.progress * 100)}%</div>
        </div>
        <div class="sp-goal__progress-bar">
          <div class="sp-goal__progress-fill" style="width: ${goal.progress * 100}%"></div>
        </div>
        <div class="sp-tasks">
          ${sortedTasks.map(task => renderTask(task)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderTask(task: ExtensionTask): string {
  const statusClass = task.status === 'completed' ? 'sp-task--completed' : '';
  const priorityClass = `sp-task--${task.priority}`;

  let action = '';
  if (task.targetUrl) {
    action = `<a href="${task.targetUrl}" target="_blank" class="sp-task__action" title="Open">&#8599;</a>`;
  } else if (task.searchQuery) {
    action = `<button class="sp-task__action sp-task__copy-query" data-query="${escapeHtml(task.searchQuery)}" title="Copy search query">&#128203;</button>`;
  } else if (task.appUrl) {
    action = `<a href="${task.appUrl}" target="_blank" class="sp-task__action" title="Open in app">&#127760;</a>`;
  }

  return `
    <div class="sp-task ${statusClass} ${priorityClass}" data-task-id="${task.id}">
      <div class="sp-task__priority-dot"></div>
      <div class="sp-task__content">
        <div class="sp-task__title">${escapeHtml(task.title)}</div>
        <div class="sp-task__description">${escapeHtml(task.description)}</div>
      </div>
      ${action}
    </div>
  `;
}

async function updateSessionStats(): Promise<void> {
  const { dailyCaptureCount, pendingTasks } = await getMultipleStorage(['dailyCaptureCount', 'pendingTasks']);
  const done = pendingTasks.filter(t => t.status === 'completed').length;
  const pending = pendingTasks.filter(t => t.status === 'pending').length;
  spStatCaptured.textContent = String(dailyCaptureCount);
  spStatDone.textContent = String(done);
  spStatPending.textContent = String(pending);
}

async function updateConnectionStatus(): Promise<void> {
  const state = await getStorage('connectionState');
  spConnectionDot.className = `sp-connection__dot sp-connection__dot--${state}`;
}

async function updateCurrentPage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('linkedin.com')) {
    spPageType.textContent = 'Not on LinkedIn';
    spRecaptureBtn.classList.add('sp-btn--hidden');
    return;
  }

  chrome.tabs.sendMessage(tab.id!, { type: 'GET_STATUS' }, (response) => {
    if (response?.type === 'PAGE_INFO') {
      spPageType.textContent = `${response.payload.pageType} page`;
      spRecaptureBtn.classList.remove('sp-btn--hidden');

      if (response.payload.pageType === 'PROFILE') {
        spTemplateSection.classList.remove('sp-section--hidden');
        loadTemplate(tab.url!);
      }
    }
  });
}

async function loadTemplate(url: string): Promise<void> {
  try {
    const appUrl = await getStorage('appUrl');
    const client = new AppClient(appUrl || DEFAULT_APP_URL);
    const result = await client.renderMessage(url);
    spTemplateContent.textContent = result.message;
    currentTemplateId = result.templateId;
    nextTemplateId = result.nextTemplateId;
    spNextTemplateBtn.disabled = !nextTemplateId;
  } catch {
    spTemplateContent.textContent = 'Template unavailable';
  }
}

function setupEventListeners(): void {
  spFilterGoal.addEventListener('change', renderGoals);
  spFilterPriority.addEventListener('change', renderGoals);

  spRecaptureBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_REQUEST' }, async (response) => {
        if (response?.type === 'CAPTURE_RESULT') {
          await chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', payload: response.payload });
          spRecaptureBtn.textContent = 'Captured!';
          setTimeout(() => { spRecaptureBtn.textContent = 'Re-capture'; }, 2000);
          await updateSessionStats();
        }
      });
    }
  });

  spCopyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(spTemplateContent.textContent || '');
    spCopyBtn.textContent = 'Copied!';
    setTimeout(() => { spCopyBtn.textContent = 'Copy to Clipboard'; }, 2000);
  });

  spNextTemplateBtn.addEventListener('click', async () => {
    if (nextTemplateId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) await loadTemplate(tab.url);
    }
  });

  // Delegate clicks on copy-query buttons
  spGoalsList.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('sp-task__copy-query')) {
      const query = target.dataset.query || '';
      await navigator.clipboard.writeText(query);
      target.textContent = 'Copied';
      setTimeout(() => { target.innerHTML = '&#128203;'; }, 1500);
    }
  });
}

function setupStorageListener(): void {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.pendingTasks) {
      allGoals = groupTasksByGoal(changes.pendingTasks.newValue);
      populateGoalFilter();
      renderGoals();
      updateSessionStats();
    }
    if (changes.connectionState) {
      updateConnectionStatus();
    }
    if (changes.dailyCaptureCount) {
      updateSessionStats();
    }
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

init();
```

- [ ] E4-10.3: Create side panel CSS

**File**: `extension/sidepanel/sidepanel.css`

```css
body {
  margin: 0; padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px; color: #1a1a2e; background: #ffffff;
}

#sidepanel-root { padding: 16px; }

.sp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.sp-header__title { font-size: 16px; font-weight: 700; }

.sp-connection__dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.sp-connection__dot--connected { background: #22c55e; }
.sp-connection__dot--connecting { background: #f59e0b; animation: sp-blink 1s infinite; }
.sp-connection__dot--disconnected { background: #ef4444; }
.sp-connection__dot--error { background: #ef4444; }
@keyframes sp-blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }

.sp-section { margin-bottom: 20px; }
.sp-section__title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 8px; }
.sp-section--hidden { display: none; }

.sp-page-info { display: flex; justify-content: space-between; align-items: center; }

.sp-btn {
  padding: 8px 14px; border: none; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  background: #3b82f6; color: #ffffff;
}
.sp-btn:hover { background: #2563eb; }
.sp-btn--secondary { background: #e5e7eb; color: #374151; }
.sp-btn--secondary:hover { background: #d1d5db; }
.sp-btn--secondary:disabled { opacity: 0.4; cursor: not-allowed; }
.sp-btn--small { padding: 4px 10px; font-size: 11px; }
.sp-btn--hidden { display: none; }

.sp-filter-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.sp-select {
  flex: 1; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 6px;
  font-size: 12px; background: #ffffff; cursor: pointer;
}

.sp-empty { text-align: center; color: #9ca3af; padding: 20px; font-size: 12px; }

.sp-goal { background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.sp-goal__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.sp-goal__title { font-size: 13px; font-weight: 600; }
.sp-goal__progress-text { font-size: 11px; font-weight: 600; color: #3b82f6; }
.sp-goal__progress-bar { height: 4px; background: #e5e7eb; border-radius: 2px; margin-bottom: 10px; overflow: hidden; }
.sp-goal__progress-fill { height: 100%; background: #3b82f6; border-radius: 2px; transition: width 0.3s; }

.sp-tasks { display: flex; flex-direction: column; gap: 6px; }
.sp-task {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px;
  background: #ffffff; border-radius: 6px; border: 1px solid #f3f4f6;
}
.sp-task--completed { opacity: 0.5; text-decoration: line-through; }
.sp-task__priority-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.sp-task--high .sp-task__priority-dot { background: #ef4444; }
.sp-task--medium .sp-task__priority-dot { background: #f59e0b; }
.sp-task--low .sp-task__priority-dot { background: #22c55e; }
.sp-task__content { flex: 1; min-width: 0; }
.sp-task__title { font-size: 12px; font-weight: 500; }
.sp-task__description { font-size: 11px; color: #6b7280; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-task__action { font-size: 14px; text-decoration: none; color: #3b82f6; background: none; border: none; cursor: pointer; padding: 2px; flex-shrink: 0; }

.sp-template-content {
  background: #f9fafb; border-radius: 6px; padding: 12px;
  font-size: 12px; line-height: 1.6; white-space: pre-wrap;
  max-height: 200px; overflow-y: auto; margin-bottom: 8px;
}
.sp-template-actions { display: flex; gap: 8px; }

.sp-section--stats { border-top: 1px solid #f3f4f6; padding-top: 16px; }
.sp-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.sp-stat { text-align: center; }
.sp-stat__value { font-size: 20px; font-weight: 700; color: #1a1a2e; }
.sp-stat__label { font-size: 11px; color: #9ca3af; margin-top: 2px; }
```

- [ ] E4-10.4: Write side panel tests

**File**: `tests/unit/extension/sidepanel.test.ts`

```typescript
// Test: init loads goals and renders
// Test: groupTasksByGoal correctly groups tasks
// Test: renderGoals applies goal and priority filters
// Test: renderTask shows correct action for VISIT_PROFILE (link)
// Test: renderTask shows correct action for SEARCH_QUERY (copy button)
// Test: renderTask shows correct action for REVIEW_CONTACT (app link)
// Test: progress bar width matches goal.progress percentage
// Test: session stats update from storage changes
// Test: template section only shown on PROFILE pages
// Test: copy to clipboard works
// Test: storage.onChanged listener updates UI
```

**Acceptance Criteria**:
- Goals listed with progress bars
- Tasks grouped by goal, sorted by priority
- Filter by goal and priority works
- Task interactions: clickable profile links, copyable search queries, app links
- Current page info with re-capture option
- Message template with copy and next-template buttons
- Session stats (captured, done, pending) update in real time
- Tests pass

---

## Orchestrator Instructions

### Execution Order

```
Phase 4 Extension Orchestration:

1. WAIT for Phase 4 App endpoints (A4-1, A4-2) and Backend WebSocket (B4-3) to be operational

2. Start Agent E5 FIRST:
   - manifest.json, package.json, tsconfig.json, esbuild config
   - shared/types.ts, shared/constants.ts, shared/storage.ts, shared/app-client.ts
   - Run: npm install && npm run build (verify build succeeds)

3. When E5 completes shared types and build config:
   - Start Agents E1, E2, E3, E4 in PARALLEL:
     - E1: page-capturer.ts, overlay.ts, overlay.css
     - E2: service-worker.ts (message routing, badge, alarms, WS, queue, task auto-completion)
     - E3: popup.html, popup.ts, popup.css
     - E4: sidepanel.html, sidepanel.ts, sidepanel.css

4. When all agents complete:
   - Run: npm run build && npm run typecheck
   - Sideload extension in Chrome
   - Manual integration test:
     a. Load extension in chrome://extensions
     b. Navigate to LinkedIn profile
     c. Click "Capture This Page"
     d. Verify HTML arrives at app capture endpoint
     e. Verify overlay shows "Synced" state
     f. Open side panel, verify tasks load
     g. Disconnect app, verify queue stores capture
     h. Reconnect app, verify queue flushes
```

### Agent Spawn Configuration

```bash
# Agent E5 - Shared/Build Dev (START FIRST)
npx @claude-flow/cli@latest agent spawn -t coder --name phase4-ext-shared \
  --instructions "Create extension project structure: manifest.json (MV3), package.json, tsconfig.json, esbuild.config.mjs. Implement shared/types.ts (all TypeScript interfaces), shared/constants.ts (URL patterns, defaults), shared/storage.ts (chrome.storage.local wrapper), shared/app-client.ts (HTTP + WebSocket client). Verify npm run build succeeds."

# Agent E1 - Content Script Dev (after E5)
npx @claude-flow/cli@latest agent spawn -t coder --name phase4-ext-content \
  --instructions "Implement page-capturer.ts (URL detection for 8 page types, outerHTML capture, MutationObserver stability, scroll depth tracking, message listener). Implement overlay.ts (6 states, auto-hide, non-interactive) and overlay.css. Tests in tests/unit/extension/."

# Agent E2 - Service Worker Dev (after E5)
npx @claude-flow/cli@latest agent spawn -t coder --name phase4-ext-sw \
  --instructions "Implement service-worker.ts: initialization, message routing, capture submission with offline queue, alarm-based health check (30s), queue flush, badge management (4 states), WebSocket event handlers, SPA navigation detection via webNavigation API, task auto-completion via URL matching. Tests in tests/unit/extension/."

# Agent E3 - Popup Dev (after E5)
npx @claude-flow/cli@latest agent spawn -t coder --name phase4-ext-popup \
  --instructions "Implement popup.html (connection status, page info, capture button, daily stats, top 3 tasks, template section, settings panel), popup.ts (event handling, capture flow, registration, template copy), popup.css. Tests in tests/unit/extension/."

# Agent E4 - Side Panel Dev (after E5)
npx @claude-flow/cli@latest agent spawn -t coder --name phase4-ext-sidepanel \
  --instructions "Implement sidepanel.html (goals with progress, tasks grouped and filtered, current page, template, session stats), sidepanel.ts (data loading, filtering, real-time updates via storage listener), sidepanel.css. Tests in tests/unit/extension/."
```

---

## Dependencies (Cross-Domain)

### Extension -> App (requires from)

| Artifact | Provider | Description |
|----------|----------|-------------|
| POST /api/extension/capture | App A4-1 | Submit captured HTML |
| GET /api/extension/tasks | App A4-2 | Load task list |
| PATCH /api/extension/tasks/:id | App A4-2 | Mark tasks complete/skipped |
| GET /api/extension/health | App A4-2 | Health check every 30s |
| POST /api/extension/register | App A4-2 | Token exchange |
| GET /api/extension/settings | App A4-2 | Load settings |
| GET /api/extension/contact/:url | App A4-2 | Contact lookup |
| POST /api/extension/message-render | App A4-2 | Render message template |

### Extension -> Backend (requires from)

| Artifact | Provider | Description |
|----------|----------|-------------|
| WebSocket at /ws/extension | Backend B4-3 | Real-time push events |
| Token authentication | Backend B4-4 | X-Extension-Token auth |

### Extension -> Extension (internal)

| Provider | Consumer | Description |
|----------|----------|-------------|
| shared/types.ts | All components | Type definitions |
| shared/app-client.ts | service-worker, popup, sidepanel | HTTP + WS client |
| shared/storage.ts | All components | chrome.storage.local wrapper |
| shared/constants.ts | All components | URL patterns, defaults |
| content-scripts/page-capturer.ts | service-worker (via message) | Capture HTML on request |
| content-scripts/overlay.ts | service-worker (via message) | Display capture state |
| service-worker.ts | popup, sidepanel (via message) | Message routing, capture handling |

---

## Gate Criteria

- [ ] Extension loads in Chrome via sideloading (chrome://extensions developer mode)
- [ ] `npm run build` in extension/ produces valid dist/ output
- [ ] `npm run typecheck` passes with no errors
- [ ] Content script detects all 8 LinkedIn page types correctly
- [ ] "Capture This Page" button in popup sends HTML to app capture endpoint
- [ ] App stores captured HTML in page_cache (verified via DB query)
- [ ] Overlay shows correct state transitions: ready -> capturing -> synced
- [ ] Side panel displays goals with progress bars and tasks grouped by goal
- [ ] Task filters (goal, priority) work in side panel
- [ ] Badge shows green when connected on LinkedIn
- [ ] Badge shows blue number for pending task count
- [ ] Badge shows orange "!" when app is offline
- [ ] WebSocket connects with token and receives push events
- [ ] Offline queue stores captures when app is unreachable
- [ ] Queue flushes in chronological order when app reconnects
- [ ] Task auto-completion triggers when user visits matching LinkedIn URL
- [ ] SPA navigation detected via webNavigation.onHistoryStateUpdated
- [ ] Registration flow: paste token in popup -> stored in chrome.storage.local -> connection established
- [ ] Message template renders and copies to clipboard on profile pages
- [ ] DOM stability detection waits 2 seconds of no mutations before capture
- [ ] Scroll depth tracked as maximum depth reached
- [ ] All unit tests pass
- [ ] No CSP violations in extension console

---

## Files Created/Modified Summary

| File | Action | Agent |
|------|--------|-------|
| `extension/manifest.json` | Create | E5 |
| `extension/package.json` | Create | E5 |
| `extension/tsconfig.json` | Create | E5 |
| `extension/esbuild.config.mjs` | Create | E5 |
| `extension/shared/types.ts` | Create | E5 |
| `extension/shared/constants.ts` | Create | E5 |
| `extension/shared/storage.ts` | Create | E5 |
| `extension/shared/app-client.ts` | Create | E5 |
| `extension/icons/icon-16.png` | Create | E5 |
| `extension/icons/icon-48.png` | Create | E5 |
| `extension/icons/icon-128.png` | Create | E5 |
| `extension/content-scripts/page-capturer.ts` | Create | E1 |
| `extension/content-scripts/overlay.ts` | Create | E1 |
| `extension/content-scripts/overlay.css` | Create | E1 |
| `extension/service-worker.ts` | Create | E2 |
| `extension/popup/popup.html` | Create | E3 |
| `extension/popup/popup.ts` | Create | E3 |
| `extension/popup/popup.css` | Create | E3 |
| `extension/sidepanel/sidepanel.html` | Create | E4 |
| `extension/sidepanel/sidepanel.ts` | Create | E4 |
| `extension/sidepanel/sidepanel.css` | Create | E4 |
| `tests/unit/extension/app-client.test.ts` | Create | E5 |
| `tests/unit/extension/page-capturer.test.ts` | Create | E1 |
| `tests/unit/extension/overlay.test.ts` | Create | E1 |
| `tests/unit/extension/service-worker.test.ts` | Create | E2 |
| `tests/unit/extension/popup.test.ts` | Create | E3 |
| `tests/unit/extension/sidepanel.test.ts` | Create | E4 |
