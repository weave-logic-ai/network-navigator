# Phase 1: Foundation -- Extension Plan

## Objective

Scaffold the Chrome Extension project with Manifest V3, TypeScript, and esbuild build configuration -- producing a loadable (but feature-empty) extension that establishes the directory structure, shared types, and build pipeline for Phase 4 implementation.

## Prerequisites

- Node.js 20+ installed
- Chrome browser available for sideloading the extension
- Familiarity with Chrome Manifest V3 API surface
- No backend or app dependencies -- extension scaffolding is fully independent in Phase 1

---

## Parallel Agent Assignments

### Agent 1: Extension Scaffolder

**Scope**: Full project scaffolding -- single agent is sufficient for Phase 1 extension work. This includes manifest, TypeScript config, esbuild build, directory structure, shared types, and icon placeholders.

**Runs in parallel with**: Backend and App agents (no cross-domain dependencies in Phase 1).

**Output files**:
- `extension/manifest.json` -- Manifest V3 configuration
- `extension/package.json` -- Extension-specific dependencies and scripts
- `extension/tsconfig.json` -- TypeScript configuration for extension
- `extension/esbuild.config.mjs` -- esbuild build configuration
- `extension/src/service-worker.ts` -- Service worker entry point (empty scaffold)
- `extension/src/content/index.ts` -- Content script entry point (empty scaffold)
- `extension/src/popup/popup.html` -- Popup HTML shell
- `extension/src/popup/popup.ts` -- Popup script entry point (empty scaffold)
- `extension/src/popup/popup.css` -- Popup styles (minimal)
- `extension/src/sidepanel/sidepanel.html` -- Side panel HTML shell
- `extension/src/sidepanel/sidepanel.ts` -- Side panel script entry point (empty scaffold)
- `extension/src/sidepanel/sidepanel.css` -- Side panel styles (minimal)
- `extension/src/types/index.ts` -- Extension-specific types
- `extension/src/utils/logger.ts` -- Simple logging utility
- `extension/src/utils/storage.ts` -- chrome.storage wrapper scaffold
- `extension/icons/icon-16.png` -- 16x16 icon placeholder
- `extension/icons/icon-32.png` -- 32x32 icon placeholder
- `extension/icons/icon-48.png` -- 48x48 icon placeholder
- `extension/icons/icon-128.png` -- 128x128 icon placeholder
- `shared/types/capture.ts` -- Shared CapturePayload type
- `shared/types/task.ts` -- Shared ExtensionTask type
- `shared/types/message.ts` -- Shared message protocol types
- `shared/types/settings.ts` -- Shared settings types
- `shared/types/index.ts` -- Barrel export for shared types
- `shared/tsconfig.json` -- TypeScript config for shared types

---

## Detailed Task Checklist

### T1: Extension Directory Structure

**Agent**: Extension Scaffolder
**BR**: BR-801 (Extension Foundation)
**Parallel**: Can start immediately

- [ ] T1.1: Create the extension directory tree:
  ```
  extension/
    src/
      content/         # Content scripts injected into LinkedIn pages
      popup/           # Browser action popup
      sidepanel/       # Chrome side panel
      service-worker/  # Background service worker (MV3)
      types/           # Extension-internal types
      utils/           # Shared utilities
    icons/             # Extension icons at 16, 32, 48, 128 px
    dist/              # Build output (gitignored)
  ```
- [ ] T1.2: Create the shared types directory tree:
  ```
  shared/
    types/             # Types shared between app and extension
  ```
- [ ] T1.3: Add `extension/dist/` to `.gitignore`

**Acceptance Criteria**:
- All directories exist
- `dist/` is gitignored
- Directory structure follows Chrome extension conventions

---

### T2: Manifest V3 Configuration

**Agent**: Extension Scaffolder
**File**: `extension/manifest.json`
**BR**: BR-801 (Extension Manifest)
**Parallel**: After T1

- [ ] T2.1: Create `manifest.json` with Manifest V3:
  ```json
  {
    "manifest_version": 3,
    "name": "LinkedIn Network Intelligence",
    "version": "0.1.0",
    "description": "Capture LinkedIn pages for network intelligence analysis",
    "permissions": [
      "storage",
      "activeTab",
      "sidePanel",
      "alarms"
    ],
    "host_permissions": [
      "https://www.linkedin.com/*",
      "https://linkedin.com/*"
    ],
    "background": {
      "service_worker": "dist/service-worker.js",
      "type": "module"
    },
    "content_scripts": [
      {
        "matches": ["https://www.linkedin.com/*", "https://linkedin.com/*"],
        "js": ["dist/content.js"],
        "run_at": "document_idle"
      }
    ],
    "action": {
      "default_popup": "src/popup/popup.html",
      "default_icon": {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png"
      },
      "default_title": "LinkedIn Network Intelligence"
    },
    "side_panel": {
      "default_path": "src/sidepanel/sidepanel.html"
    },
    "icons": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    },
    "content_security_policy": {
      "extension_pages": "script-src 'self'; object-src 'self'"
    }
  }
  ```

- [ ] T2.2: Permissions justification (document why each permission is needed):
  - `storage`: Store auth token, capture queue, settings
  - `activeTab`: Access current tab URL and title for capture context
  - `sidePanel`: Display task list and goal progress in Chrome side panel
  - `alarms`: Schedule periodic sync with app server
  - `host_permissions` for linkedin.com: Content script injection for page capture

**Acceptance Criteria**:
- Manifest validates against Chrome's Manifest V3 schema
- No deprecated MV2 fields are present
- Permissions are minimal (only what is needed)
- Content scripts are scoped to LinkedIn domains only

---

### T3: Extension package.json

**Agent**: Extension Scaffolder
**File**: `extension/package.json`
**BR**: BR-801 (Extension Build)
**Parallel**: After T1

- [ ] T3.1: Create `package.json` with:
  ```json
  {
    "name": "linkedin-network-intelligence-extension",
    "version": "0.1.0",
    "private": true,
    "scripts": {
      "build": "node esbuild.config.mjs",
      "watch": "node esbuild.config.mjs --watch",
      "clean": "rm -rf dist",
      "typecheck": "tsc --noEmit"
    },
    "devDependencies": {
      "esbuild": "^0.24.0",
      "typescript": "^5.7.0",
      "@anthropic-ai/sdk": "^0.39.0",
      "@types/chrome": "^0.0.287"
    }
  }
  ```
- [ ] T3.2: Note: `@anthropic-ai/sdk` is listed but not used in Phase 1 -- included for Phase 5 preparation

**Acceptance Criteria**:
- `npm install` in `extension/` directory succeeds
- All declared scripts are functional
- `@types/chrome` provides type definitions for chrome.* APIs

---

### T4: TypeScript Configuration

**Agent**: Extension Scaffolder
**File**: `extension/tsconfig.json`
**BR**: BR-801 (Extension Build)
**Parallel**: After T3

- [ ] T4.1: Create `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ES2022",
      "moduleResolution": "bundler",
      "lib": ["ES2022", "DOM", "DOM.Iterable"],
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "outDir": "./dist",
      "rootDir": "./src",
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "noImplicitReturns": true,
      "noFallthroughCasesInSwitch": true,
      "paths": {
        "@shared/*": ["../shared/*"]
      }
    },
    "include": ["src/**/*", "../shared/**/*"],
    "exclude": ["node_modules", "dist"]
  }
  ```

**Acceptance Criteria**:
- `npx tsc --noEmit` passes with zero errors on scaffold code
- Shared types path alias resolves correctly
- Strict mode is enabled

---

### T5: esbuild Build Configuration

**Agent**: Extension Scaffolder
**File**: `extension/esbuild.config.mjs`
**BR**: BR-801 (Extension Build)
**Parallel**: After T3

- [ ] T5.1: Create esbuild config that bundles:
  - `src/service-worker.ts` -> `dist/service-worker.js`
  - `src/content/index.ts` -> `dist/content.js`
  - `src/popup/popup.ts` -> `dist/popup.js`
  - `src/sidepanel/sidepanel.ts` -> `dist/sidepanel.js`
- [ ] T5.2: Configuration:
  ```javascript
  import * as esbuild from 'esbuild';

  const isWatch = process.argv.includes('--watch');

  const buildOptions = {
    entryPoints: [
      'src/service-worker.ts',
      'src/content/index.ts',
      'src/popup/popup.ts',
      'src/sidepanel/sidepanel.ts',
    ],
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    target: 'chrome120',
    sourcemap: true,
    minify: !isWatch,
    logLevel: 'info',
    alias: {
      '@shared': '../shared',
    },
  };

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }
  ```
- [ ] T5.3: Service worker entry needs `format: 'iife'` or `format: 'esm'` depending on MV3 module support -- use `'esm'` since manifest declares `"type": "module"`

**Acceptance Criteria**:
- `npm run build` produces files in `dist/` directory
- `npm run watch` rebuilds on file changes
- Source maps are generated
- Output targets Chrome 120+

---

### T6: Service Worker Scaffold

**Agent**: Extension Scaffolder
**File**: `extension/src/service-worker.ts`
**BR**: BR-801 (Extension Background)
**Parallel**: After T4

- [ ] T6.1: Create minimal service worker:
  ```typescript
  // LinkedIn Network Intelligence - Service Worker
  // Phase 1: Scaffold only. Full implementation in Phase 4.

  console.log('[LNI] Service worker loaded');

  // Placeholder: Message routing will be implemented in Phase 4
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[LNI] Message received:', message.type);
    sendResponse({ status: 'ok' });
    return true; // Keep message channel open for async response
  });

  // Placeholder: Extension install handler
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('[LNI] Extension installed:', details.reason);
    if (details.reason === 'install') {
      // Phase 4: Open registration page or setup wizard
    }
  });
  ```

**Acceptance Criteria**:
- Service worker loads without errors in Chrome
- Message listener is registered
- Install handler fires on extension load

---

### T7: Content Script Scaffold

**Agent**: Extension Scaffolder
**File**: `extension/src/content/index.ts`
**BR**: BR-801 (Extension Content Script)
**Parallel**: After T4

- [ ] T7.1: Create minimal content script:
  ```typescript
  // LinkedIn Network Intelligence - Content Script
  // Phase 1: Scaffold only. Page capture implemented in Phase 4.

  console.log('[LNI] Content script loaded on:', window.location.href);

  // Placeholder: URL detection and page type classification
  // Placeholder: Page capture trigger
  // Placeholder: Overlay rendering
  // Placeholder: MutationObserver for SPA navigation
  ```

**Acceptance Criteria**:
- Content script loads on LinkedIn pages without errors
- Console log confirms script injection
- No interference with LinkedIn page functionality

---

### T8: Popup HTML and Script

**Agent**: Extension Scaffolder
**Files**: `extension/src/popup/popup.html`, `extension/src/popup/popup.ts`, `extension/src/popup/popup.css`
**BR**: BR-801 (Extension Popup)
**Parallel**: After T4

- [ ] T8.1: Create `popup.html`:
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
      <header class="popup-header">
        <h1>LinkedIn Network Intelligence</h1>
        <span id="connection-status" class="status-indicator disconnected">
          Disconnected
        </span>
      </header>
      <main class="popup-content">
        <p class="placeholder-text">
          Extension setup will be available in a future update.
        </p>
        <p class="version-text">v0.1.0 - Phase 1 Scaffold</p>
      </main>
    </div>
    <script src="../dist/popup.js" type="module"></script>
  </body>
  </html>
  ```
- [ ] T8.2: Create `popup.ts`:
  ```typescript
  // LinkedIn Network Intelligence - Popup
  // Phase 1: Scaffold only. Full popup in Phase 4.

  console.log('[LNI] Popup loaded');

  // Placeholder: Connection status check
  // Placeholder: Capture button
  // Placeholder: Task list display
  ```
- [ ] T8.3: Create `popup.css` with minimal styling:
  - Popup dimensions: 320px wide, auto height (max 500px)
  - Clean, minimal design matching app theme
  - Connection status indicator (red dot = disconnected, green dot = connected)

**Acceptance Criteria**:
- Popup opens when clicking extension icon
- Popup renders title, connection status, and placeholder text
- Popup is correctly sized (320px wide)

---

### T9: Side Panel HTML and Script

**Agent**: Extension Scaffolder
**Files**: `extension/src/sidepanel/sidepanel.html`, `extension/src/sidepanel/sidepanel.ts`, `extension/src/sidepanel/sidepanel.css`
**BR**: BR-801 (Extension Side Panel)
**Parallel**: After T4

- [ ] T9.1: Create `sidepanel.html`:
  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LinkedIn Network Intelligence - Side Panel</title>
    <link rel="stylesheet" href="sidepanel.css">
  </head>
  <body>
    <div id="sidepanel-root">
      <header class="panel-header">
        <h1>Network Intelligence</h1>
      </header>
      <main class="panel-content">
        <section class="panel-section">
          <h2>Goals</h2>
          <p class="placeholder-text">Goal tracking will be available in Phase 5.</p>
        </section>
        <section class="panel-section">
          <h2>Tasks</h2>
          <p class="placeholder-text">Task list will be available in Phase 4.</p>
        </section>
        <section class="panel-section">
          <h2>Current Page</h2>
          <p class="placeholder-text">Page info will be available in Phase 4.</p>
        </section>
      </main>
    </div>
    <script src="../dist/sidepanel.js" type="module"></script>
  </body>
  </html>
  ```
- [ ] T9.2: Create `sidepanel.ts`:
  ```typescript
  // LinkedIn Network Intelligence - Side Panel
  // Phase 1: Scaffold only. Full side panel in Phase 4.

  console.log('[LNI] Side panel loaded');

  // Placeholder: Goal progress display
  // Placeholder: Task list with auto-completion
  // Placeholder: Current page info
  ```
- [ ] T9.3: Create `sidepanel.css` with section-based layout

**Acceptance Criteria**:
- Side panel opens via Chrome's side panel API
- Renders three placeholder sections (Goals, Tasks, Current Page)
- Clean layout that matches app design language

---

### T10: Extension-Internal Types

**Agent**: Extension Scaffolder
**File**: `extension/src/types/index.ts`
**BR**: BR-801 (Extension Types)
**Parallel**: After T4

- [ ] T10.1: Define extension-internal types:
  ```typescript
  // Extension configuration stored in chrome.storage.local
  export interface ExtensionConfig {
    appUrl: string;
    authToken: string | null;
    isRegistered: boolean;
    autoCaptureEnabled: boolean;
    overlayPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    dailyCaptureLimit: number;
    captureWarningThreshold: number;
  }

  // Capture queue item for offline buffering
  export interface QueuedCapture {
    id: string;
    url: string;
    pageType: string;
    html: string;
    capturedAt: string;
    retryCount: number;
  }

  // Extension state managed by service worker
  export interface ExtensionState {
    isConnected: boolean;
    lastSyncAt: string | null;
    pendingCaptureCount: number;
    todayCaptureCount: number;
    taskCount: number;
  }

  // Message types for chrome.runtime.sendMessage
  export type ExtensionMessage =
    | { type: 'CAPTURE_PAGE'; payload: { url: string; pageType: string } }
    | { type: 'GET_STATUS'; payload?: never }
    | { type: 'SYNC_TASKS'; payload?: never }
    | { type: 'UPDATE_CONFIG'; payload: Partial<ExtensionConfig> }
    | { type: 'QUEUE_FLUSH'; payload?: never };

  export type ExtensionResponse =
    | { status: 'ok'; data?: unknown }
    | { status: 'error'; error: string };

  // LinkedIn page type classification
  export type LinkedInPageType =
    | 'profile'
    | 'search_results'
    | 'feed'
    | 'company'
    | 'group'
    | 'event'
    | 'messaging'
    | 'unknown';
  ```

**Acceptance Criteria**:
- All types compile without errors
- Types cover configuration, state, messaging, and page classification
- Types are exported and importable from other extension modules

---

### T11: Utility Scaffolds

**Agent**: Extension Scaffolder
**Files**: `extension/src/utils/logger.ts`, `extension/src/utils/storage.ts`
**BR**: BR-801 (Extension Utilities)
**Parallel**: After T10

- [ ] T11.1: Create `logger.ts`:
  ```typescript
  // Structured logging for extension debugging
  const PREFIX = '[LNI]';

  export const logger = {
    info: (message: string, ...args: unknown[]) =>
      console.log(`${PREFIX} ${message}`, ...args),
    warn: (message: string, ...args: unknown[]) =>
      console.warn(`${PREFIX} ${message}`, ...args),
    error: (message: string, ...args: unknown[]) =>
      console.error(`${PREFIX} ${message}`, ...args),
    debug: (message: string, ...args: unknown[]) => {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(`${PREFIX} ${message}`, ...args);
      }
    },
  };
  ```
- [ ] T11.2: Create `storage.ts`:
  ```typescript
  import type { ExtensionConfig, QueuedCapture, ExtensionState } from '../types';

  // Type-safe chrome.storage.local wrapper
  // Phase 1: Scaffold with type signatures. Full implementation in Phase 4.

  const STORAGE_KEYS = {
    CONFIG: 'lni_config',
    STATE: 'lni_state',
    CAPTURE_QUEUE: 'lni_capture_queue',
  } as const;

  const DEFAULT_CONFIG: ExtensionConfig = {
    appUrl: 'http://localhost:3000',
    authToken: null,
    isRegistered: false,
    autoCaptureEnabled: false,
    overlayPosition: 'top-right',
    dailyCaptureLimit: 100,
    captureWarningThreshold: 80,
  };

  export async function getConfig(): Promise<ExtensionConfig> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
    return { ...DEFAULT_CONFIG, ...(result[STORAGE_KEYS.CONFIG] || {}) };
  }

  export async function setConfig(config: Partial<ExtensionConfig>): Promise<void> {
    const current = await getConfig();
    await chrome.storage.local.set({
      [STORAGE_KEYS.CONFIG]: { ...current, ...config },
    });
  }

  export async function getState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.STATE);
    return result[STORAGE_KEYS.STATE] || {
      isConnected: false,
      lastSyncAt: null,
      pendingCaptureCount: 0,
      todayCaptureCount: 0,
      taskCount: 0,
    };
  }

  export async function getCaptureQueue(): Promise<QueuedCapture[]> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CAPTURE_QUEUE);
    return result[STORAGE_KEYS.CAPTURE_QUEUE] || [];
  }
  ```

**Acceptance Criteria**:
- Logger provides prefixed console output at all levels
- Storage wrapper is type-safe with default values
- Functions compile without chrome API type errors (via @types/chrome)

---

### T12: Shared Types Package

**Agent**: Extension Scaffolder
**Files**: `shared/types/capture.ts`, `shared/types/task.ts`, `shared/types/message.ts`, `shared/types/settings.ts`, `shared/types/index.ts`, `shared/tsconfig.json`
**BR**: BR-801 (Shared Types)
**Parallel**: After T1

- [ ] T12.1: Create `shared/types/capture.ts`:
  ```typescript
  // CapturePayload: sent from extension to app when a page is captured
  export interface CapturePayload {
    url: string;
    pageType: 'profile' | 'search_results' | 'feed' | 'company' | 'group' | 'event';
    html: string;
    capturedAt: string;  // ISO 8601
    scrollDepth: number; // 0-100 percentage
    viewportHeight: number;
    documentHeight: number;
    metadata: {
      title?: string;
      linkedinId?: string;
      searchQuery?: string;
    };
  }

  // CaptureResult: returned from app after processing a capture
  export interface CaptureResult {
    success: boolean;
    cacheId: string;
    contactId?: string;   // If a contact was created/updated
    companyId?: string;    // If a company was created/updated
    parsedFields: string[];
    errors: string[];
  }
  ```

- [ ] T12.2: Create `shared/types/task.ts`:
  ```typescript
  // ExtensionTask: task pushed from app to extension
  export interface ExtensionTask {
    id: string;
    goalId?: string;
    contactId?: string;
    title: string;
    description?: string;
    taskType: 'visit_profile' | 'send_message' | 'capture_page' | 'review_contact' | 'manual';
    url?: string;
    priority: number;     // 1-10
    dueDate?: string;     // ISO 8601
    status: 'pending' | 'in_progress' | 'completed' | 'skipped';
    metadata: Record<string, unknown>;
  }

  // TaskCompletion: sent from extension to app when a task is done
  export interface TaskCompletion {
    taskId: string;
    completedAt: string;
    autoCompleted: boolean;  // true if auto-detected by URL match
    captureId?: string;      // If task completion triggered a capture
  }
  ```

- [ ] T12.3: Create `shared/types/message.ts`:
  ```typescript
  // WebSocket message protocol between extension and app
  export type WsMessage =
    | { type: 'TASK_PUSH'; tasks: ExtensionTask[] }
    | { type: 'TASK_UPDATE'; taskId: string; status: string }
    | { type: 'SETTINGS_UPDATE'; settings: Partial<ExtensionSettings> }
    | { type: 'CAPTURE_ACK'; captureId: string; result: CaptureResult }
    | { type: 'PING' }
    | { type: 'PONG' };

  // Import types for reference
  import type { ExtensionTask } from './task';
  import type { CaptureResult } from './capture';
  import type { ExtensionSettings } from './settings';
  ```

- [ ] T12.4: Create `shared/types/settings.ts`:
  ```typescript
  // Settings managed by the app, synced to the extension
  export interface ExtensionSettings {
    captureEnabled: boolean;
    autoCapturePages: string[];    // Page types to auto-capture
    captureInterval: number;       // Minimum seconds between captures
    maxDailyCaptures: number;
    showOverlay: boolean;
    overlayPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    syncIntervalSeconds: number;
  }

  export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
    captureEnabled: true,
    autoCapturePages: [],
    captureInterval: 30,
    maxDailyCaptures: 100,
    showOverlay: true,
    overlayPosition: 'top-right',
    syncIntervalSeconds: 60,
  };
  ```

- [ ] T12.5: Create `shared/types/index.ts` barrel export:
  ```typescript
  export * from './capture';
  export * from './task';
  export * from './message';
  export * from './settings';
  ```

- [ ] T12.6: Create `shared/tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ES2022",
      "moduleResolution": "bundler",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "declaration": true,
      "declarationMap": true,
      "outDir": "./dist",
      "rootDir": "./types"
    },
    "include": ["types/**/*"],
    "exclude": ["node_modules", "dist"]
  }
  ```

**Acceptance Criteria**:
- All shared types compile without errors
- Types are importable from both the extension and the app (via path aliases or direct import)
- CapturePayload covers all page types
- ExtensionTask covers all task types from the goals/tasks system
- WebSocket message protocol covers all push/ack scenarios
- Default settings provide sensible values

---

### T13: Icon Placeholders

**Agent**: Extension Scaffolder
**Files**: `extension/icons/icon-16.png`, `extension/icons/icon-32.png`, `extension/icons/icon-48.png`, `extension/icons/icon-128.png`
**BR**: BR-801 (Extension Assets)
**Parallel**: After T1

- [ ] T13.1: Generate simple placeholder icons at all 4 sizes (16, 32, 48, 128 px)
  - Option A: Use a simple script to generate solid-color PNGs with a letter "L" or "N"
  - Option B: Create minimal SVG and convert to PNG
  - Option C: Use placeholder PNGs (solid color squares) that can be replaced with real icons later
- [ ] T13.2: Icons must be valid PNG files that Chrome accepts

**Acceptance Criteria**:
- All 4 icon files exist and are valid PNGs
- Chrome loads the extension without icon-related warnings
- Icons display in the extensions toolbar, though they are placeholders

---

### T14: Build Verification

**Agent**: Extension Scaffolder
**BR**: BR-801 (Extension Build)
**Depends on**: T1-T13 (all files created)

- [ ] T14.1: Run `npm install` in `extension/` directory
- [ ] T14.2: Run `npm run typecheck` -- verify zero TypeScript errors
- [ ] T14.3: Run `npm run build` -- verify esbuild produces output files:
  - `dist/service-worker.js`
  - `dist/content.js`
  - `dist/popup.js`
  - `dist/sidepanel.js`
- [ ] T14.4: Verify source maps are generated alongside each output file
- [ ] T14.5: Load extension in Chrome via `chrome://extensions` -> "Load unpacked" -> select `extension/` directory
- [ ] T14.6: Verify extension appears in toolbar with placeholder icon
- [ ] T14.7: Navigate to a LinkedIn page and verify content script console log appears
- [ ] T14.8: Click extension icon and verify popup renders
- [ ] T14.9: Open side panel and verify it renders (if Chrome version supports it)

**Acceptance Criteria**:
- TypeScript compilation passes with zero errors
- esbuild produces all 4 output bundles
- Extension loads in Chrome without errors
- Content script executes on LinkedIn pages
- Popup and side panel render placeholder content

---

## Orchestrator Instructions

The Phase 1 Extension Sub-Orchestrator has a simple delegation model since only one agent is needed.

### Wave 1 (Single Agent)
Launch Agent 1 (Extension Scaffolder).

- Agent 1 works through T1-T13 in sequence, with minor parallelism possible within tasks
- T1 (directory structure) must come first
- T2 (manifest), T3 (package.json), T12 (shared types), T13 (icons) can be parallel after T1
- T4 (tsconfig), T5 (esbuild) depend on T3
- T6-T11 depend on T4

### Verification (T14)
After all files are created:
- Run the build and type-check commands
- Load the extension in Chrome
- Verify all scaffolds are functional

### Coordination with App Team
- Notify the App team that `shared/types/` directory is created and contains types they should import for API contracts
- The App team's API routes (Phase 4) should use `CapturePayload`, `ExtensionTask`, etc. from `shared/types/`

---

## Dependencies

### Internal (within Extension)

```
T1 -> T2, T3, T12, T13 (directories before files)
T3 -> T4, T5 (package.json before tsconfig, esbuild)
T4 -> T6, T7, T8, T9, T10, T11 (tsconfig before source files)
T10 -> T11 (types before utils that use them)
T1-T13 -> T14 (all files before build verification)
```

### External (cross-domain)

- **No backend dependencies** in Phase 1
- **No app dependencies** in Phase 1
- **Shared types** (`shared/types/`) will be consumed by both the app and extension starting in Phase 4
- The app's `tsconfig.json` should add a path alias for `@shared/*` pointing to `shared/*` (coordinate with App Agent 1)

---

## Gate Criteria

All of the following must pass before Phase 2 begins (extension Phase 2 has no work, but this gate validates the scaffold):

- [ ] `npm install` in `extension/` completes without errors
- [ ] `npm run typecheck` passes with zero TypeScript errors
- [ ] `npm run build` produces all 4 bundles in `dist/`
- [ ] Extension loads in Chrome via "Load unpacked" without errors
- [ ] Extension icon appears in Chrome toolbar
- [ ] Popup opens and renders placeholder content
- [ ] Content script logs to console on LinkedIn pages
- [ ] Side panel renders placeholder sections
- [ ] All shared type files compile without errors
- [ ] Shared types are importable from the extension source files
- [ ] No Chrome console errors or warnings related to the extension
- [ ] Manifest permissions are minimal and justified
- [ ] No deprecated MV2 APIs are used

---

## Estimated Agent Count and Specializations

| Agent | Type | Specialization | Estimated Duration |
|-------|------|---------------|-------------------|
| Agent 1 | Extension Developer | Chrome MV3, TypeScript, esbuild, extension architecture | 0.5-1 day |

**Total agents**: 1
**Parallelism**: None (single agent is sufficient)
**Critical path**: Linear -- approximately 0.5-1 day total
**Note**: This is the lightest Phase 1 domain. Extension work ramps up significantly in Phase 4.
