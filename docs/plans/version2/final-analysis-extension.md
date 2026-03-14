# V2 Final Analysis: Chrome Extension Stream

## Critical Architecture Shift from Panel Recommendation

The product owner's Q15 answer fundamentally changed the extension architecture from the panel's original design. The panel designed per-page-type DOM extractors running inside content scripts. The product owner rejected this entirely:

> "Extension should be completely lightweight and unaware of the DOM, it will only SAVE the page into the local cache via the app. This way we have a cached copy of the page (we should keep at least the last 5 copies), so we can adjust changes to DOM etc. The user does all interaction, and the extension is only guiding the interactions and pushing cache into local app, which can then be acted on through rounds of enrichment."

This means: **the extension captures raw rendered HTML and sends it to the app. All DOM parsing, data extraction, and selector management live in the Next.js application, not in the extension.**

---

## 1. Extension Architecture Overview

### The "Dumb Capture + Smart App" Model

The V2 extension follows a strict separation of concerns:

| Layer | Responsibility | Where |
|-------|---------------|-------|
| **Page Capture** | Capture full rendered HTML (post-JS execution) | Extension content script |
| **Page Transport** | Push raw HTML to app via WebSocket/HTTP | Extension service worker |
| **Capture UX** | Small overlay showing capture status, scroll prompts | Extension content script (injected CSS/DOM) |
| **Goal/Task Display** | Show goals, tasks, progress, clickable profile links | Extension popup + side panel |
| **Message Templates** | Fetch rendered messages from app, copy to clipboard | Extension popup |
| **DOM Parsing** | Parse cached HTML, extract structured data | Next.js app |
| **Selector Config** | Maintain and update CSS selectors per page type | Next.js app |
| **Intelligence** | Claude analysis, ICP scoring, task generation | Next.js app |
| **Storage** | PostgreSQL for contacts, cached HTML, enrichment data | Next.js app |

The extension has **zero knowledge** of LinkedIn's DOM structure. It does not contain any CSS selectors, does not know what a "profile page" looks like internally, and does not extract any fields. It captures the entire `document.documentElement.outerHTML` after JavaScript has rendered the page and sends it wholesale.

### Manifest V3 Structure

```
linkedin-network-extension/
  manifest.json
  service-worker.ts          # Background: message routing, HTTP/WS client, badge
  content-scripts/
    page-capturer.ts         # Captures full rendered HTML, detects page URL pattern
    overlay.ts               # Injects small floating status overlay
    overlay.css              # Overlay styles
  popup/
    popup.html               # Main popup shell
    popup.ts                 # Task list, goal progress, template access
    popup.css                # Popup styles
  sidepanel/
    sidepanel.html           # Persistent side panel shell
    sidepanel.ts             # Full task/goal/template UI
    sidepanel.css            # Side panel styles
  shared/
    types.ts                 # TypeScript interfaces
    app-client.ts            # HTTP + WebSocket client for app communication
    storage.ts               # chrome.storage wrapper (token, capture queue)
    constants.ts             # App URL defaults, message types, page URL patterns
  icons/
    icon-16.png
    icon-48.png
    icon-128.png
```

---

## 2. Architecture Diagram

```
+------------------------------------------------------------------+
|                     USER'S CHROME BROWSER                         |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |  LinkedIn Tab (linkedin.com/in/*, /search/*, /feed, etc.)  |  |
|  |                                                             |  |
|  |  +-------------------------------------------------------+ |  |
|  |  | Content Script: page-capturer.ts                       | |  |
|  |  |                                                        | |  |
|  |  | 1. Detect page URL pattern (profile? search? feed?)    | |  |
|  |  | 2. Wait for DOM stability (MutationObserver settles)   | |  |
|  |  | 3. Capture document.documentElement.outerHTML           | |  |
|  |  | 4. Send raw HTML + URL + metadata to service worker    | |  |
|  |  +------------------------------|------------------------+ |  |
|  |  | Overlay: overlay.ts                                    | |  |
|  |  | Small floating badge: "Captured" / "Scroll for more"  | |  |
|  |  +-------------------------------------------------------+ |  |
|  +------------------------------------------------------------+  |
|                              |                                    |
|                   chrome.runtime.sendMessage()                    |
|                              |                                    |
|  +------------------------------------------------------------+  |
|  |  Service Worker: service-worker.ts                          |  |
|  |                                                              |  |
|  |  - Receives raw HTML from content script                     |  |
|  |  - Queues in chrome.storage.local if app offline             |  |
|  |  - Sends via HTTP POST to app /api/extension/capture         |  |
|  |  - Maintains WebSocket to ws://localhost:3000/ws/extension    |  |
|  |  - Receives task updates, capture confirmations via WS       |  |
|  |  - Updates badge icon/count                                  |  |
|  +-----------------------------+--------------------------------+  |
|                                |                                   |
|  +-----------------------------+-----+  +-----------------------+  |
|  |  Popup / Side Panel               |  |  Badge Notifications  |  |
|  |  - Current goals + progress       |  |  - Task count         |  |
|  |  - Task list (clickable links)    |  |  - Capture status     |  |
|  |  - Message templates + clipboard  |  |  - App connection     |  |
|  |  - Session capture stats          |  +-----------------------+  |
|  +------------------------------------+                            |
+----------------------------------|---------------------------------+
                                   |
                    HTTP POST + WebSocket
                    to localhost:3000
                                   |
+----------------------------------|---------------------------------+
|                     NEXT.JS APP (LOCAL)                             |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | /api/extension/capture   <-- Receives raw HTML + metadata     | |
|  | /api/extension/tasks     <-- Serves goal/task list            | |
|  | /api/extension/templates <-- Serves Claude-rendered messages  | |
|  | /api/extension/health    <-- Connection health check          | |
|  | /ws/extension            <-- WebSocket for push updates       | |
|  +--------------------------------------------------------------+ |
|                          |                                         |
|  +--------------------------------------------------------------+ |
|  | PAGE PARSER ENGINE                                            | |
|  |                                                               | |
|  | 1. Receive raw HTML + URL                                     | |
|  | 2. Detect page type from URL pattern                          | |
|  | 3. Load appropriate parser (profile, search, feed, etc.)      | |
|  | 4. Parse HTML using server-side DOM (jsdom/cheerio)           | |
|  | 5. Extract structured data using configurable selectors       | |
|  | 6. Store parsed data in PostgreSQL                            | |
|  | 7. Store raw HTML in page cache (last 5 versions)             | |
|  | 8. Trigger Claude analysis pipeline                           | |
|  | 9. Push task updates to extension via WebSocket                | |
|  +--------------------------------------------------------------+ |
|                          |                                         |
|  +--------------------------------------------------------------+ |
|  | PostgreSQL + RuVector                                         | |
|  | - contacts, companies, enrichment tables                      | |
|  | - page_cache (raw HTML, versioned)                            | |
|  | - goals, tasks                                                | |
|  | - selector_configs (updatable per page type)                  | |
|  | - message_templates                                           | |
|  +--------------------------------------------------------------+ |
+--------------------------------------------------------------------+
```

---

## 3. Manifest V3 Configuration

```json
{
  "manifest_version": 3,
  "name": "LinkedIn Network Intelligence",
  "version": "2.0.0",
  "description": "Capture LinkedIn pages for local network analysis and guided prospecting",

  "permissions": [
    "storage",
    "clipboardWrite",
    "sidePanel"
  ],

  "host_permissions": [
    "https://www.linkedin.com/*",
    "http://localhost:3000/*",
    "ws://localhost:3000/*"
  ],

  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },

  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/*"],
      "js": ["content-scripts/page-capturer.js"],
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

  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' http://localhost:3000 ws://localhost:3000"
  },

  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

### Permission Justification

| Permission | Why Needed | Why Minimal |
|-----------|-----------|-------------|
| `storage` | Capture queue buffer, auth token, settings cache | No `unlimitedStorage` -- queue is small and ephemeral |
| `clipboardWrite` | Copy message templates for user to paste | No `clipboardRead` -- one-way only |
| `sidePanel` | Persistent task/goal panel alongside LinkedIn | Chrome 114+ built-in feature |
| `host_permissions: linkedin.com` | Content script injection on LinkedIn pages | Scoped to `linkedin.com` only, not `<all_urls>` |
| `host_permissions: localhost:3000` | HTTP + WebSocket communication with local app | localhost only, no external hosts |

**Not requested**: `tabs`, `activeTab`, `webRequest`, `declarativeNetRequest`, `cookies`, `history`, `nativeMessaging`, `<all_urls>`, `clipboardRead`, `unlimitedStorage`.

### Service Worker Design

The service worker is event-driven per MV3 requirements. It registers all listeners at the top level and persists no in-memory state (all state lives in `chrome.storage.local` or `chrome.storage.session`).

Key responsibilities:
- Route messages between content script, popup, and side panel
- Manage HTTP client for capture submission and task fetching
- Maintain WebSocket connection with auto-reconnect
- Update badge icon and text based on app connection state and task count
- Flush capture queue when app becomes available
- Use `chrome.alarms` for periodic health checks (every 30 seconds)

---

## 4. Page Capture System

### 4.1 How Full Rendered HTML Is Captured

The content script captures the complete DOM after JavaScript execution. This is the same approach V1's `cache.mjs` used via Playwright's `page.content()`, but triggered by the user's own browsing instead of automated navigation.

```typescript
// content-scripts/page-capturer.ts

interface CapturePayload {
  captureId: string;
  url: string;
  pageType: PageUrlPattern;
  html: string;
  scrollDepth: number;
  viewportHeight: number;
  documentHeight: number;
  capturedAt: string;
  extensionVersion: string;
  sessionId: string;
  triggerMode: 'manual' | 'auto';
}

type PageUrlPattern =
  | 'PROFILE'
  | 'PROFILE_ACTIVITY'
  | 'SEARCH_PEOPLE'
  | 'SEARCH_CONTENT'
  | 'FEED'
  | 'COMPANY'
  | 'CONNECTIONS'
  | 'MESSAGES'
  | 'OTHER';

function detectPageType(url: string): PageUrlPattern {
  const path = new URL(url).pathname;
  if (path.match(/^\/in\/[^/]+\/?$/)) return 'PROFILE';
  if (path.match(/^\/in\/[^/]+\/recent-activity/)) return 'PROFILE_ACTIVITY';
  if (path.includes('/search/results/people')) return 'SEARCH_PEOPLE';
  if (path.includes('/search/results/content')) return 'SEARCH_CONTENT';
  if (path === '/feed/' || path === '/feed') return 'FEED';
  if (path.match(/^\/company\/[^/]+/)) return 'COMPANY';
  if (path.includes('/mynetwork') || path.includes('/search/results/people/?network')) return 'CONNECTIONS';
  if (path.includes('/messaging')) return 'MESSAGES';
  return 'OTHER';
}

function captureFullPage(): CapturePayload {
  const html = document.documentElement.outerHTML;
  const scrollDepth = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;

  return {
    captureId: crypto.randomUUID(),
    url: window.location.href,
    pageType: detectPageType(window.location.href),
    html,
    scrollDepth,
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    capturedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    sessionId: '', // filled by service worker from chrome.storage.session
    triggerMode: 'manual',
  };
}
```

The content script does NOT parse any elements. It reads `document.documentElement.outerHTML` which is the full rendered HTML including all content loaded by LinkedIn's React application.

### 4.2 Scroll Completion Detection

The extension does not scroll the page. The user scrolls naturally. The extension tracks scroll depth and uses a MutationObserver to detect when LinkedIn's lazy-loaded content finishes rendering.

```typescript
// content-scripts/page-capturer.ts (scroll tracking)

interface ScrollState {
  maxScrollDepth: number;
  lastMutationTime: number;
  isStable: boolean;
}

const scrollState: ScrollState = {
  maxScrollDepth: 0,
  lastMutationTime: Date.now(),
  isStable: false,
};

// Track maximum scroll depth reached by the user
window.addEventListener('scroll', () => {
  const depth = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
  scrollState.maxScrollDepth = Math.max(scrollState.maxScrollDepth, depth);
});

// Detect when DOM settles after lazy loading
const stabilityObserver = new MutationObserver(() => {
  scrollState.lastMutationTime = Date.now();
  scrollState.isStable = false;
});

stabilityObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// Check stability: no mutations for 2 seconds = page is settled
function checkStability(): boolean {
  return Date.now() - scrollState.lastMutationTime > 2000;
}
```

The overlay displays scroll guidance based on page type and scroll depth:
- Profile page, scrollDepth < 0.8: "Scroll down to capture full profile"
- Search results, scrollDepth < 0.5: "Scroll to load more results"
- When stable and scrolled far enough: "Page ready for capture"

### 4.3 Overlay UX for Capture Status

A small, non-intrusive floating overlay in the bottom-right corner of the LinkedIn tab. It must not interfere with LinkedIn's own UI elements (messaging widget, notification badges).

```typescript
// content-scripts/overlay.ts

type OverlayState = 'ready' | 'capturing' | 'synced' | 'scroll-more' | 'error' | 'hidden';

function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = 'lni-capture-overlay';
  overlay.setAttribute('data-lni-ext', 'true');
  document.body.appendChild(overlay);
  return overlay;
}

function updateOverlay(state: OverlayState, detail?: string): void {
  const overlay = document.getElementById('lni-capture-overlay');
  if (!overlay) return;

  const messages: Record<OverlayState, string> = {
    'ready': 'Ready to capture',
    'capturing': 'Capturing page...',
    'synced': 'Synced!',
    'scroll-more': detail || 'Scroll down for more content',
    'error': detail || 'App offline',
    'hidden': '',
  };

  overlay.textContent = messages[state];
  overlay.className = `lni-overlay lni-overlay--${state}`;

  // Auto-hide after 3 seconds for transient states
  if (state === 'synced') {
    setTimeout(() => updateOverlay('hidden'), 3000);
  }
}
```

```css
/* content-scripts/overlay.css */
#lni-capture-overlay {
  position: fixed;
  bottom: 80px;  /* above LinkedIn's messaging widget */
  right: 20px;
  z-index: 9999;
  padding: 8px 16px;
  border-radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
  transition: opacity 0.3s ease, transform 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.lni-overlay--ready     { background: #e8f5e9; color: #2e7d32; }
.lni-overlay--capturing { background: #e3f2fd; color: #1565c0; }
.lni-overlay--synced    { background: #e8f5e9; color: #2e7d32; }
.lni-overlay--scroll-more { background: #fff3e0; color: #e65100; }
.lni-overlay--error     { background: #ffebee; color: #c62828; }
.lni-overlay--hidden    { opacity: 0; transform: translateY(10px); }
```

### 4.4 Storage of Last 5 Page Versions per URL

The app stores versioned page captures. The extension sends every capture; the app manages the 5-version rotation.

```typescript
// App-side: this is a specification for the Next.js app, not extension code

interface PageCacheEntry {
  id: string;                // UUID
  url: string;               // Canonical LinkedIn URL (no query params)
  urlHash: string;           // SHA-256 of canonical URL for fast lookup
  pageType: PageUrlPattern;
  html: string;              // Full rendered HTML (compressed with gzip)
  htmlSizeBytes: number;     // Original uncompressed size
  scrollDepth: number;
  capturedAt: string;        // ISO 8601
  version: number;           // 1-5, rotates
  extensionVersion: string;
  parsedAt: string | null;   // Set after parser runs
  parseVersion: string | null; // Selector config version used for parsing
}

// Retention: keep last 5 captures per canonical URL
// On 6th capture for same URL, delete the oldest
// This enables: re-parsing when selectors update, DOM change detection,
// debugging extraction issues, and comparing page snapshots over time
```

### 4.5 Supported Page Types

All page types that V1 supported, plus additional types. The extension detects page type by URL pattern only (no DOM inspection). The app's parser engine handles the actual extraction.

| Page Type | URL Pattern | V1 Equivalent | Capture Notes |
|-----------|-------------|---------------|---------------|
| Profile | `/in/{slug}` | `enrich.mjs` | User should scroll to bottom for full experience/education |
| Profile Activity | `/in/{slug}/recent-activity/*` | `activity-scanner.mjs` | Captures visible posts; user scrolls to load more |
| Search People | `/search/results/people/*` | `search.mjs` | Each page of results is a separate capture |
| Search Content | `/search/results/content/*` | N/A (new) | Post search results |
| Feed | `/feed` | Partial in `activity-scanner.mjs` | Main feed; captures visible posts |
| Company | `/company/{slug}` | N/A (new) | Company overview page |
| Connections | `/mynetwork/*`, `/search/results/people/?network=F` | `deep-scan.mjs` | User's own connections list |
| Messages | `/messaging/*` | N/A (new) | Conversation threads |

**Gaps annotated (per Q11 answer)**: V1 extractors exist for profiles, search results, activity feeds, and connections. The following page types have data that V1 does not capture:
- **Company pages**: Employee count, specialties, recent updates, jobs posted. V1 captures company name from profile experience only.
- **Messages**: Full conversation history. V1 uses CSV export for message metadata only.
- **Search content**: Post search results are not captured in V1.
- **Profile skills endorsements**: V1 captures skill names but not endorsement counts.
- **Profile recommendations**: Not captured in V1.
- **Profile certifications/licenses**: Not captured in V1.

---

## 5. Communication Protocol

### 5.1 HTTP Endpoints

The extension calls these REST endpoints on the local Next.js app. All requests include the `X-Extension-Token` header.

```typescript
// Endpoint specifications for the Next.js app API routes

// POST /api/extension/capture
// Submit a captured page (raw HTML + metadata)
interface CaptureRequest {
  captureId: string;
  url: string;
  pageType: PageUrlPattern;
  html: string;               // Full rendered HTML
  scrollDepth: number;
  viewportHeight: number;
  documentHeight: number;
  capturedAt: string;
  extensionVersion: string;
  sessionId: string;
  triggerMode: 'manual' | 'auto';
}

interface CaptureResponse {
  accepted: boolean;
  cacheVersion: number;       // Which version slot this was stored in (1-5)
  contactId: string | null;   // If a contact was identified from this page
  parseStatus: 'queued' | 'immediate';
  nextSuggestion: string | null;  // e.g., "Visit their activity page next"
}

// GET /api/extension/tasks
// Fetch current task list grouped by goals
interface TaskListResponse {
  goals: Goal[];
  ungroupedTasks: ExtensionTask[];
}

// PATCH /api/extension/tasks/:id
// Mark a task as complete or skipped
interface TaskUpdateRequest {
  status: 'completed' | 'skipped';
  completedUrl?: string;       // URL the user was on when completing
}

// GET /api/extension/templates?contactUrl={url}&type={templateType}
// Fetch a Claude-rendered message template for a specific contact
interface TemplateResponse {
  contactName: string;
  templateType: string;
  renderedMessage: string;     // Fully personalized by Claude
  templateId: string;
  alternatives: number;        // How many other templates are available
}

// GET /api/extension/health
// Connection health check (lightweight, called every 30s)
interface HealthResponse {
  status: 'ok';
  pendingTasks: number;
  queuedCaptures: number;
}

// POST /api/extension/register
// Initial extension registration; returns auth token
interface RegisterRequest {
  extensionId: string;         // chrome.runtime.id
  extensionVersion: string;
}

interface RegisterResponse {
  token: string;               // Store in chrome.storage.local
  appVersion: string;
  settings: ExtensionSettings;
}

// GET /api/extension/settings
// Fetch app-managed extension settings
interface ExtensionSettings {
  autoCaptureEnabled: boolean;
  capturePageTypes: PageUrlPattern[];  // Which page types to capture
  dailyCaptureWarningThreshold: number; // e.g., 30
  overlayPosition: 'bottom-right' | 'bottom-left' | 'top-right';
  overlayAutoHideMs: number;
}
```

### 5.2 WebSocket Events

The WebSocket connection at `ws://localhost:3000/ws/extension` provides real-time push from the app to the extension.

```typescript
// WebSocket message types (app -> extension)

type WsMessage =
  | { type: 'CAPTURE_CONFIRMED'; data: { captureId: string; contactId: string | null; parseStatus: string } }
  | { type: 'TASK_CREATED';     data: { task: ExtensionTask } }
  | { type: 'TASK_UPDATED';     data: { taskId: string; status: string } }
  | { type: 'GOAL_PROGRESS';    data: { goalId: string; progress: number; total: number } }
  | { type: 'TEMPLATE_READY';   data: { contactUrl: string; templateType: string } }
  | { type: 'ENRICHMENT_COMPLETE'; data: { contactId: string; contactName: string; newFields: string[] } }
  | { type: 'SETTINGS_UPDATED'; data: ExtensionSettings }
  | { type: 'PARSE_COMPLETE';   data: { captureId: string; extractedFields: string[]; confidence: number } }
  ;

// WebSocket message types (extension -> app)
type WsOutMessage =
  | { type: 'PAGE_NAVIGATED'; data: { url: string; pageType: PageUrlPattern; timestamp: string } }
  | { type: 'TASK_VIEWED';    data: { taskId: string } }
  ;
```

### 5.3 Connection Management

```typescript
// shared/app-client.ts

interface AppConnectionState {
  httpConnected: boolean;
  wsConnected: boolean;
  lastHealthCheck: number;
  reconnectAttempts: number;
  queuedCaptures: number;
}

class AppClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private wsReconnectMs = 5000;
  private maxReconnectMs = 60000;
  private healthCheckIntervalMs = 30000;
  private token: string = '';
  private wsHandlers: Map<string, (data: unknown) => void> = new Map();

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async initialize(): Promise<void> {
    const stored = await chrome.storage.local.get(['extensionToken', 'appUrl']);
    this.token = stored.extensionToken || '';
    if (stored.appUrl) this.baseUrl = stored.appUrl;
  }

  // HTTP methods
  async submitCapture(payload: CaptureRequest): Promise<CaptureResponse> {
    const res = await fetch(`${this.baseUrl}/api/extension/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Token': this.token,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Capture submit failed: ${res.status}`);
    return res.json();
  }

  async fetchTasks(): Promise<TaskListResponse> {
    const res = await fetch(`${this.baseUrl}/api/extension/tasks`, {
      headers: { 'X-Extension-Token': this.token },
    });
    return res.json();
  }

  async fetchTemplate(contactUrl: string, type: string): Promise<TemplateResponse> {
    const params = new URLSearchParams({ contactUrl, type });
    const res = await fetch(`${this.baseUrl}/api/extension/templates?${params}`, {
      headers: { 'X-Extension-Token': this.token },
    });
    return res.json();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/extension/health`, {
        headers: { 'X-Extension-Token': this.token },
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // WebSocket methods
  connectWebSocket(): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws/extension';
    this.ws = new WebSocket(`${wsUrl}?token=${this.token}`);

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WsMessage;
      const handler = this.wsHandlers.get(msg.type);
      if (handler) handler(msg.data);
    };

    this.ws.onclose = () => {
      // Exponential backoff reconnect
      setTimeout(() => this.connectWebSocket(),
        Math.min(this.wsReconnectMs, this.maxReconnectMs));
      this.wsReconnectMs = Math.min(this.wsReconnectMs * 2, this.maxReconnectMs);
    };

    this.ws.onopen = () => {
      this.wsReconnectMs = 5000; // Reset backoff on successful connect
    };
  }

  onWsEvent(type: string, handler: (data: unknown) => void): void {
    this.wsHandlers.set(type, handler);
  }
}
```

### 5.4 App-Down Detection

When the app is not running:
1. Health check fails (30-second interval via `chrome.alarms`).
2. Badge icon turns orange with "!" indicator.
3. Overlay shows "App offline - captures queued locally".
4. Captures are queued in `chrome.storage.local` (max ~50 captures or 5MB).
5. On reconnect, the service worker flushes the queue in chronological order.
6. The extension does NOT work without the app (per Q39 answer). No offline export. Queue is a buffer, not a feature.

### 5.5 Authentication

Token-based authentication with origin validation.

1. **Registration flow**: User navigates to `http://localhost:3000/extension/setup`. The app displays a token. User enters the token in the extension popup settings, or the app page uses `chrome.runtime.sendMessage` (if extension ID is known) to inject the token directly.
2. **Token storage**: Stored in `chrome.storage.local` under key `extensionToken`.
3. **Request validation**: Every HTTP request includes `X-Extension-Token` header. Every WebSocket connection includes token as query parameter.
4. **App-side validation**: The Next.js middleware validates the token and checks the `Origin` header starts with `chrome-extension://`.

```typescript
// App-side middleware (Next.js) -- specification only
// File: app/api/extension/middleware.ts

export function validateExtensionRequest(request: Request): boolean {
  const token = request.headers.get('X-Extension-Token');
  const origin = request.headers.get('Origin');

  // Reject if no token
  if (!token) return false;

  // Validate token against stored value
  if (token !== getStoredExtensionToken()) return false;

  // Validate origin is chrome extension or localhost (for WebSocket upgrade)
  if (origin && !origin.startsWith('chrome-extension://')) return false;

  return true;
}
```

---

## 6. Goal & Task System in Extension

### 6.1 Core Data Model

Per the product owner: "The extension should be 80% goals and task based, with the other bit accommodating interactions and connectivity and communications."

```typescript
// shared/types.ts

interface Goal {
  id: string;
  title: string;                    // e.g., "Map AI decision-makers at target companies"
  description: string;
  progress: number;                 // 0-100
  totalTasks: number;
  completedTasks: number;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'paused' | 'completed';
}

interface ExtensionTask {
  id: string;
  goalId: string | null;           // null for ungrouped tasks
  type: TaskType;
  title: string;                   // e.g., "Visit Sarah Chen's profile"
  description: string | null;      // Context: "Sarah is a 2nd-degree connection..."
  status: 'pending' | 'completed' | 'skipped';
  priority: 'high' | 'medium' | 'low';

  // Task-type-specific data
  targetUrl: string | null;        // LinkedIn URL for profile tasks
  searchQuery: string | null;      // Search query for search tasks
  contactName: string | null;
  contactTitle: string | null;

  createdAt: string;
  completedAt: string | null;
  autoDetectable: boolean;         // Can auto-complete when user visits targetUrl
}

type TaskType =
  | 'visit_profile'      // Clickable link to a LinkedIn profile
  | 'search_query'       // Copy search query to clipboard
  | 'capture_page'       // Capture a specific page type
  | 'review_enrichment'  // Review enriched data in the app (link to app)
  | 'send_message'       // Message template ready, copy to clipboard
  | 'explore_connections' // Visit someone's connections list
  ;
```

### 6.2 Task Types and Interactions

| Task Type | User Action in Extension | How It Works |
|-----------|-------------------------|--------------|
| `visit_profile` | Click a link in the task list | Opens `linkedin.com/in/{slug}` in the current tab. Extension auto-detects arrival and marks task complete. |
| `search_query` | Click "Copy Query" button | Copies search string (e.g., `"machine learning engineer" site:linkedin.com`) to clipboard. User pastes into LinkedIn search. |
| `capture_page` | Navigate to page, click capture | Extension prompts capture on the relevant page. |
| `review_enrichment` | Click "Open in App" | Opens `localhost:3000/contacts/{id}` in a new tab (app URL, not LinkedIn). |
| `send_message` | Click "Copy Message" | Fetches Claude-rendered template from app, copies to clipboard. |
| `explore_connections` | Click link to connections page | Opens the target contact's connections page in LinkedIn. |

**Per Q38**: Profile tasks show clickable links in the extension. Search tasks copy the query to clipboard. The app (Next.js dashboard) uses clipboard-only links to avoid exposing the app to LinkedIn.

### 6.3 Auto-Detection of Task Completion

When the user navigates to a LinkedIn URL that matches a pending task's `targetUrl`, the extension automatically marks the task as completed.

```typescript
// service-worker.ts (task auto-completion logic)

async function checkTaskCompletion(currentUrl: string): Promise<void> {
  const canonicalUrl = currentUrl.split('?')[0].replace(/\/$/, '');
  const { pendingTasks } = await chrome.storage.session.get('pendingTasks');

  if (!pendingTasks) return;

  for (const task of pendingTasks as ExtensionTask[]) {
    if (task.autoDetectable && task.targetUrl && task.status === 'pending') {
      const taskUrl = task.targetUrl.split('?')[0].replace(/\/$/, '');
      if (canonicalUrl === taskUrl) {
        // Auto-complete
        await appClient.updateTask(task.id, { status: 'completed', completedUrl: currentUrl });
      }
    }
  }
}
```

### 6.4 Proactive Task Surfacing

Per Q37: "It should be 'You need to visit Sarah Chen's profile' with a clickable link that opens it in the current tab. There would be a list of people to explore this way, broken down into goals."

The popup and side panel show tasks grouped under their parent goal, with highest-priority tasks first. The side panel is the primary interface for this (persistent alongside LinkedIn).

---

## 7. Message Template Delivery

### 7.1 How Templates Flow

1. The app stores message templates (user-editable, as specified in `docs/plans/messages_templates.md`).
2. When a contact reaches a certain outreach stage, Claude personalizes the template using contact data, enrichment data, and graph context (mutual connections, shared interests, ICP match reasons).
3. The extension fetches the rendered message via `GET /api/extension/templates?contactUrl={url}&type={type}`.
4. The popup or side panel displays the message in a read-only text area with a "Copy to Clipboard" button.
5. User clicks "Copy to Clipboard", pastes into LinkedIn's message composer, reviews, and sends manually.
6. Per Q25: "NO message should ever be sent through any medium without the user approving it."

### 7.2 Clipboard Copy Workflow

```typescript
// popup/popup.ts or sidepanel/sidepanel.ts

async function copyTemplateToClipboard(templateText: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(templateText);
    showToast('Message copied! Paste it in the LinkedIn compose box.');
    return true;
  } catch {
    // Fallback for contexts where clipboard API is restricted
    const textarea = document.createElement('textarea');
    textarea.value = templateText;
    textarea.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Message copied! Paste it in the LinkedIn compose box.');
    return true;
  }
}
```

### 7.3 Template Selection UI

The popup shows available template types for the current contact (if on a profile page):
- "Initial Outreach" (Message 1 from the template flow)
- "Follow-up" (Message 3/4 from the template flow)
- "Meeting Request" (Message 2 from the template flow)

Each template shows a preview (first 80 characters) and a "Copy" button. Clicking "Next Template" cycles through alternatives.

---

## 8. Overlay/Popup UX Design

### 8.1 Floating Overlay (Content Script)

A minimal floating indicator injected into the LinkedIn page. It communicates capture state at a glance without requiring the user to open the popup.

**States:**
- **Ready** (green): On a capturable page, app connected
- **Capturing** (blue, pulsing): HTML capture in progress
- **Synced** (green, fades after 3s): Capture successfully sent to app
- **Scroll for more** (orange): Page has lazy-loaded content below the fold
- **App offline** (red): Cannot reach localhost:3000
- **Hidden**: Not on a LinkedIn page, or user dismissed

**Positioning**: Bottom-right, 80px above the fold to avoid LinkedIn's messaging widget. Not draggable (to keep it simple). Overlay is purely informational, not interactive (pointer-events: none).

### 8.2 Popup Panel (Click Extension Icon)

Quick-access dashboard. Opens on extension icon click.

```
+--------------------------------------------------+
|  Network Intelligence                     [gear]  |
+--------------------------------------------------+
|  App: Connected                          [green]  |
|  Today: 8 pages captured                          |
+--------------------------------------------------+
|                                                    |
|  CURRENT PAGE                                      |
|  Profile: linkedin.com/in/example-person           |
|  Status: Not yet captured                          |
|                                                    |
|  [    Capture This Page    ]                       |
|                                                    |
+--------------------------------------------------+
|                                                    |
|  TOP TASKS (3 of 12)                               |
|  > Visit Jane Doe's profile         [link icon]   |
|  > Search "AI platform engineer"    [copy icon]   |
|  > Capture CompanyX company page    [link icon]   |
|                                                    |
|  [  See All Tasks in Side Panel  ]                 |
|                                                    |
+--------------------------------------------------+
|                                                    |
|  MESSAGE TEMPLATE                                  |
|  For: Current contact (if on profile)              |
|  "Hi [Name], I noticed your work on..."            |
|  [  Copy to Clipboard  ]                           |
|                                                    |
+--------------------------------------------------+
```

### 8.3 Side Panel (Persistent, Chrome 114+)

The primary workspace for goal and task management. Opens via popup button or extension context menu.

```
+--------------------------------------------------+
|  NETWORK INTELLIGENCE                     [close] |
+--------------------------------------------------+
|  GOALS                                   [2 of 4] |
|                                                    |
|  1. Map AI decision-makers at targets              |
|     [==========>                      ] 35%        |
|     12 of 34 tasks complete                        |
|                                                    |
|  2. Find warm intros to 5 VPs                      |
|     [===>                             ] 15%        |
|     3 of 20 tasks complete                         |
|                                                    |
|  [Show all goals]                                  |
+--------------------------------------------------+
|  TASKS FOR: "Map AI decision-makers"      [filter] |
|                                                    |
|  High Priority                                     |
|  [x] Visit Sarah Chen's profile                    |
|      VP Engineering, Acme Corp                     |
|  [ ] Visit Tom Lee's profile             [>]       |
|      CTO, BuildTech Inc                            |
|  [ ] Search "ML engineer Bay Area"       [copy]    |
|                                                    |
|  Medium Priority                                   |
|  [ ] Capture CompanyX company page       [>]       |
|  [ ] Review enrichment for 3 contacts    [app]     |
|                                                    |
+--------------------------------------------------+
|  CURRENT PAGE                                      |
|  Profile: John Smith                               |
|  Last captured: 2 days ago (version 3 of 5)        |
|  [  Re-capture  ]                                  |
|                                                    |
+--------------------------------------------------+
|  MESSAGE FOR: John Smith                           |
|  +----------------------------------------------+ |
|  | Hi John, I noticed your work on AI            | |
|  | infrastructure at Acme. I'm building...       | |
|  +----------------------------------------------+ |
|  [  Copy  ]   [  Next Template  ]                  |
+--------------------------------------------------+
|  Session: 8 captured | 5 tasks done | 7 pending    |
+--------------------------------------------------+
```

### 8.4 Badge Notifications

| Badge State | Visual | Meaning |
|-------------|--------|---------|
| Green dot | No number | App connected, on LinkedIn, ready |
| Blue number (e.g., "7") | Number on icon | Pending task count |
| Orange "!" | Exclamation | App offline, captures queued |
| Grey dot | Muted | Not on LinkedIn |

The badge number shows the count of pending tasks (not captures). This keeps the user focused on their prospecting workflow.

---

## 9. App-Side Page Parser

This section specifies the Next.js app's HTML parsing system. The extension sends raw HTML; the app does all the parsing.

### 9.1 Receiving and Storing Raw HTML

The `/api/extension/capture` endpoint:
1. Validates the request (token, origin).
2. Compresses the HTML with gzip before storage (LinkedIn profile pages are typically 500KB-2MB of HTML).
3. Stores compressed HTML in the `page_cache` PostgreSQL table.
4. Rotates versions: keeps last 5 per canonical URL, deletes the oldest when a 6th arrives.
5. Queues the capture for parsing.

```typescript
// App-side: /api/extension/capture route handler specification

interface PageCacheRow {
  id: string;                    // UUID
  canonical_url: string;         // URL without query params, trailing slash
  url_hash: string;              // SHA-256 for fast lookup
  page_type: string;             // From extension's URL pattern detection
  html_compressed: Buffer;       // gzip-compressed HTML
  html_size_original: number;
  scroll_depth: number;
  captured_at: Date;
  version_number: number;        // 1-5, rotates
  extension_version: string;
  session_id: string;
  parsed_at: Date | null;
  parse_config_version: string | null;
  trigger_mode: string;          // 'manual' | 'auto'
}

// On capture receive:
// 1. Compute canonical URL: strip query params and trailing slash
// 2. Count existing versions for this canonical URL
// 3. If count >= 5, delete the oldest (by captured_at)
// 4. Insert new row with next version number
// 5. Queue for parsing
```

### 9.2 Parser Architecture: Pluggable Extractors

The parser engine follows the same pattern as V1's `reparse.mjs` but runs server-side using `cheerio` (lightweight HTML parser, no headless browser needed) instead of Playwright.

```typescript
// App-side parser engine specification

interface ParserConfig {
  version: string;               // e.g., "2024.03.15"
  pageType: string;
  selectors: SelectorChain[];    // Ordered fallback chains per field
  heuristics: HeuristicRule[];   // Text-based fallback rules
}

interface SelectorChain {
  field: string;                 // e.g., "name", "headline", "location"
  selectors: string[];           // CSS selectors tried in order
  transform?: 'trim' | 'truncate:300' | 'extractNumber';
  confidence: Record<number, 'high' | 'medium' | 'low'>; // index -> confidence
}

interface HeuristicRule {
  field: string;
  type: 'regex' | 'textSearch' | 'linePosition';
  pattern: string;
  relativeToField?: string;      // e.g., "after:name" for line-based
}

// Parser registry
interface ParserRegistry {
  parsers: Map<string, PageParser>;
  register(pageType: string, parser: PageParser): void;
  parse(pageType: string, html: string, config: ParserConfig): ParseResult;
}

interface PageParser {
  pageType: string;
  parse(html: string, config: ParserConfig): ParseResult;
}

interface ParseResult {
  success: boolean;
  fields: Record<string, ExtractedField>;
  overallConfidence: number;      // 0-1
  warnings: string[];             // Fields that used heuristic fallback
}

interface ExtractedField {
  value: string | string[] | Record<string, string>[];
  confidence: 'high' | 'medium' | 'low';
  selectorUsed: string;          // Which selector succeeded
  selectorIndex: number;         // Position in fallback chain
}
```

### 9.3 Selector Configuration (Lives in App)

Selectors are stored in the database, not in code. They can be updated without redeploying either the app or the extension.

```typescript
// App-side selector config stored in PostgreSQL

interface SelectorConfig {
  id: string;
  page_type: string;             // 'PROFILE' | 'SEARCH_PEOPLE' | etc.
  version: string;               // Semantic version of this config
  config_json: ParserConfig;     // The full selector + heuristic config
  created_at: Date;
  is_active: boolean;            // Only one active config per page type
  notes: string;                 // e.g., "Updated for LinkedIn Q1 2026 DOM changes"
}
```

Example selector config for the profile parser (replicating V1's selectors):

```json
{
  "version": "2026.03.15",
  "pageType": "PROFILE",
  "selectors": [
    {
      "field": "name",
      "selectors": [
        "h1.text-heading-xlarge",
        "h1"
      ],
      "transform": "trim",
      "confidence": { "0": "high", "1": "medium" }
    },
    {
      "field": "headline",
      "selectors": [
        ".text-body-medium.break-words",
        "[data-generated-suggestion-target]",
        "h2"
      ],
      "transform": "trim",
      "confidence": { "0": "high", "1": "medium", "2": "low" }
    },
    {
      "field": "location",
      "selectors": [
        ".text-body-small.inline.t-black--light.break-words"
      ],
      "transform": "trim",
      "confidence": { "0": "high" }
    },
    {
      "field": "about",
      "selectors": [
        "#about ~ div .inline-show-more-text",
        "#about"
      ],
      "transform": "truncate:500",
      "confidence": { "0": "high", "1": "medium" }
    },
    {
      "field": "experience",
      "selectors": [
        "#experience ~ div ul > li"
      ],
      "confidence": { "0": "high" }
    },
    {
      "field": "education",
      "selectors": [
        "#education ~ div ul > li"
      ],
      "confidence": { "0": "high" }
    },
    {
      "field": "skills",
      "selectors": [
        "#skills ~ div span[aria-hidden='true']"
      ],
      "confidence": { "0": "high" }
    },
    {
      "field": "connections",
      "selectors": [],
      "confidence": {}
    }
  ],
  "heuristics": [
    {
      "field": "connections",
      "type": "textSearch",
      "pattern": "(\\d[\\d,]+)\\s+(connections|followers)"
    }
  ]
}
```

### 9.4 Re-Parsing When Selectors Update

Because the app keeps the last 5 raw HTML captures per URL, when selectors are updated the app can re-parse all cached pages with the new selectors without requiring the user to re-visit any LinkedIn pages.

```typescript
// App-side re-parse workflow specification

interface ReparseJob {
  id: string;
  pageType: string;
  oldConfigVersion: string;
  newConfigVersion: string;
  totalPages: number;
  parsedPages: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: Date | null;
  completedAt: Date | null;
}

// Re-parse workflow:
// 1. Admin updates selector config for a page type (e.g., PROFILE)
// 2. App creates a ReparseJob
// 3. Job queries page_cache for all rows matching that page_type
//    where parse_config_version != new config version
// 4. For each cached page:
//    a. Decompress HTML
//    b. Run parser with new config
//    c. Compare extracted data with existing contact record
//    d. Update contact record if new data is better (higher confidence)
//    e. Mark cache row with new parse_config_version
// 5. This runs as a background job (not blocking the user)
```

This is exactly what V1's `reparse.mjs` does, but without needing Playwright. The app uses `cheerio` (a server-side jQuery-like library that parses HTML without a browser engine) for fast parsing.

### 9.5 Extracted Data Flow into PostgreSQL

After parsing, extracted data flows into the same tables used by CSV import and API enrichment:

```
Raw HTML capture
      |
      v
Page Parser (cheerio + selector config)
      |
      v
Structured data (name, headline, location, experience, etc.)
      |
      v
Contact upsert logic:
  - If contact exists (matched by profile URL): merge new fields
  - If new contact: create contact record
      |
      v
PostgreSQL tables:
  - contacts (core fields: name, headline, location, profile_url)
  - contact_experience (role, company, duration, source='extension')
  - contact_education (school, degree, source='extension')
  - contact_skills (skill_name, source='extension')
  - behavioral_observations (type='post'|'engagement', json_value, source='extension')
  - enrichment_sources (provider='chrome_extension', enriched_at, fields_added)
      |
      v
Vector embedding update (RuVector):
  - Profile similarity space (384-dim)
  - Content/topic similarity space (384-dim)
```

---

## 10. Security Model

### 10.1 Authentication: Token-Based

- Extension stores a single token in `chrome.storage.local`.
- Token is generated during registration and can be rotated from the app's admin panel.
- Every HTTP request includes `X-Extension-Token` header.
- WebSocket connections authenticate via query parameter on initial connection.
- App validates token and `Origin` header (must be `chrome-extension://{id}`).

### 10.2 Localhost-Only Communication

- The extension only communicates with `http://localhost:3000` (and `ws://localhost:3000`).
- No external HTTP requests are made by the extension.
- No data leaves the user's machine.
- The CSP in the manifest enforces `connect-src 'self' http://localhost:3000 ws://localhost:3000`.

### 10.3 No External Data Transmission

- Raw HTML from LinkedIn stays local (stored in PostgreSQL on the user's machine).
- Enrichment API calls (PDL, Apollo, etc.) are made by the app, not the extension.
- Claude API calls are made by the app, not the extension.
- The extension has no knowledge of any API keys.

### 10.4 Content Security Policy

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' http://localhost:3000 ws://localhost:3000"
  }
}
```

- No inline scripts in extension pages.
- No remote script loading.
- No `eval()` or `new Function()`.
- Content scripts run in an isolated world (cannot access LinkedIn's JavaScript variables).

### 10.5 Data Sanitization

Although the extension does not parse LinkedIn's DOM, the content script still reads `outerHTML` which could contain malicious content embedded in user-generated posts. The service worker sanitizes metadata fields (URL, page type) before sending to the app. The HTML itself is treated as opaque binary data by the extension -- only the app parses it, server-side, in a sandboxed environment.

The app's parser must treat all HTML content as untrusted:
- Use `cheerio` (which does not execute JavaScript) rather than a full browser engine.
- Sanitize all extracted text before storing in the database.
- Never render cached HTML directly in the app's UI (only display extracted, sanitized fields).

### 10.6 What the Extension Does NOT Do

- Does NOT read or modify LinkedIn cookies.
- Does NOT intercept LinkedIn API calls (XHR/fetch).
- Does NOT access LinkedIn's Voyager API.
- Does NOT auto-navigate or click any LinkedIn UI elements.
- Does NOT send messages, connection requests, or perform any LinkedIn actions.
- Does NOT store LinkedIn session credentials.
- Does NOT communicate with any server other than localhost.

---

## 11. Implementation Phases

### Phase 1: Core Capture Pipeline (Weeks 1-3)

**Goal**: Extension captures full HTML and sends it to the app. App receives, stores, and parses it.

Extension work:
- Manifest V3 project setup with TypeScript build toolchain (esbuild or webpack)
- Content script: `page-capturer.ts` with URL pattern detection and `outerHTML` capture
- Content script: `overlay.ts` with capture status display
- Service worker: message routing, HTTP client for capture submission
- Basic popup UI: "Capture This Page" button, app connection status
- `chrome.storage.local` for token and capture queue
- Registration flow with token exchange

App work:
- `POST /api/extension/capture` endpoint
- `page_cache` PostgreSQL table with 5-version rotation
- Profile parser using `cheerio` with V1 selector chains
- Search results parser using V1 selector chains
- `GET /api/extension/health` endpoint

### Phase 2: Task System + Additional Parsers (Weeks 4-6)

**Goal**: App generates goals and tasks. Extension displays them. Additional page parsers.

Extension work:
- Side panel UI with goal progress and task list
- Task interaction: clickable profile links, clipboard copy for search queries
- Task auto-completion detection (URL matching)
- SPA navigation detection (MutationObserver + popstate)
- Badge updates (task count, connection status)
- `GET /api/extension/tasks` integration

App work:
- `GET /api/extension/tasks` endpoint
- `PATCH /api/extension/tasks/:id` endpoint
- Goal and task data model in PostgreSQL
- Feed/activity parser
- Connections list parser
- Company page parser
- Messages page parser
- Selector config table with versioning

### Phase 3: Real-Time + Templates (Weeks 7-9)

**Goal**: WebSocket for real-time push. Message templates. Auto-capture toggle.

Extension work:
- WebSocket client with auto-reconnect and exponential backoff
- Real-time task updates, capture confirmations, goal progress
- Message template display in popup and side panel
- Clipboard copy workflow for templates
- Auto-capture opt-in toggle (captures on every LinkedIn page navigation)
- Scroll depth tracking and "scroll for more" guidance

App work:
- WebSocket server at `/ws/extension`
- Push events: task created/updated, capture confirmed, enrichment complete
- `GET /api/extension/templates` endpoint
- Claude integration for template personalization
- `GET /api/extension/settings` endpoint
- Re-parse job system (background re-parsing when selectors update)

### Phase 4: Polish + Compliance (Weeks 10-12)

**Goal**: Production readiness. Rate awareness. Security hardening.

Extension work:
- Daily capture count tracking with configurable warning threshold
- Rate awareness overlay warnings
- Capture queue drain on reconnect
- Settings UI (app URL configuration, auto-capture toggle)
- Error handling and retry logic throughout

App work:
- Selector resilience testing against LinkedIn DOM variations
- Parser confidence scoring and low-confidence flagging
- Admin UI for selector config editing
- Admin UI for re-parse job management
- Privacy policy document for future Chrome Web Store submission
- Token rotation mechanism
- Security audit of all extension API endpoints

---

## Key Differences from Panel 3 Recommendation

| Aspect | Panel 3 Recommended | Product Owner Decision |
|--------|---------------------|----------------------|
| DOM parsing location | Content scripts in extension | App-side only (cheerio) |
| Content scripts | 6 page-type extractors | 1 generic HTML capturer |
| Selector management | In extension with remote update | In app database, extension unaware |
| Data sent to app | Structured JSON per page type | Raw HTML (full page) |
| Extension complexity | Medium (parsing + UI) | Low (capture + UI) |
| App complexity | Low (receives structured data) | Medium (parses raw HTML) |
| Re-parsing capability | None (data already structured) | Full (re-run parsers on cached HTML) |
| DOM change resilience | Extension update or remote config | App-side config update + re-parse cached pages |
| Offline capability | Buffer + export as JSON/CSV | No offline mode; requires app to be running |
| Auto-capture | Manual default, opt-in auto | Opt-in auto-capture toggle |
| Task navigation | Auto-navigate or clipboard | Clickable links in extension, clipboard-only in app |
