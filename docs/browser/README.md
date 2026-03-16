# Chrome Browser Extension -- LinkedIn Network Intelligence

## 1. Overview

The LinkedIn Network Intelligence (LNI) extension follows a **"dumb capture + smart app"** architecture. The extension itself performs no parsing, scoring, or data analysis. Its sole responsibility is to capture raw HTML from LinkedIn pages and send it to the ctox Next.js application, which handles all parsing, enrichment, and storage.

This design keeps the extension lightweight, avoids LinkedIn detection heuristics that target DOM scraping extensions, and centralizes all intelligence logic in the server where it can be updated without pushing extension updates.

**Key capabilities:**
- Capture full-page HTML from any LinkedIn page with one click
- Detect LinkedIn page types (profile, company, search, feed, etc.)
- Queue captures locally when the app is offline, flush when reconnected
- Display tasks and goals pushed from the app
- Maintain a persistent WebSocket connection for real-time updates
- Show a non-intrusive overlay with capture status on LinkedIn pages


## 2. Architecture

```
+-------------------+        +-------------------+        +------------+
|  Content Script   |        |  Service Worker   |        |  Next.js   |
|  (LinkedIn page)  | -----> |  (background)     | -----> |  App API   |
|                   |        |                   |        |            |
|  - Capture HTML   |  msg   |  - Route messages |  HTTP  |  - Store   |
|  - Detect page    | -----> |  - Queue captures | -----> |  - Parse   |
|  - Show overlay   |        |  - Manage WS conn |        |  - Enrich  |
|  - Track scroll   |        |  - Health checks  |  WS    |  - Score   |
|                   |        |  - Badge updates  | <----- |  - Push    |
+-------------------+        +-------------------+        +------------+
        ^                            |
        |                            |
   +---------+              +-------------+
   |  Popup  |              |  Side Panel |
   |  (320px)|              |  (full)     |
   +---------+              +-------------+
```

### Component Responsibilities

| Component | File | Role |
|-----------|------|------|
| **Content Script** | `src/content/index.ts` | Runs on LinkedIn pages. Captures DOM HTML, detects page type from URL, tracks scroll depth, shows the floating overlay widget. |
| **Service Worker** | `src/service-worker.ts` | Background process. Routes messages between content script/popup/side panel. Submits captures to the app API. Manages the offline queue. Maintains WebSocket connection. Runs periodic health checks and queue flushes via Chrome alarms. |
| **Popup** | `src/popup/popup.ts` | Toolbar popup (320x500px). Shows connection status, capture stats, current page type, capture button, top 5 tasks, and a link to open the side panel. Also handles first-time registration. |
| **Side Panel** | `src/sidepanel/sidepanel.ts` | Chrome side panel. Shows goals with progress bars, full task lists with completion toggles, current page info with scroll depth, and activity stats. Updates in real-time via `chrome.storage.onChanged`. |
| **App Client** | `src/shared/app-client.ts` | HTTP + WebSocket client. Handles all communication with the Next.js app. Token-based authentication via `X-Extension-Token` header. Exponential backoff WebSocket reconnection. |
| **Storage** | `src/utils/storage.ts` | Type-safe wrapper around `chrome.storage.local`. Manages capture queue, settings, tokens, connection state, and daily counters. |
| **Types** | `src/types/index.ts` | Shared TypeScript types for page types, capture payloads, tasks, goals, WebSocket messages, settings, and storage schema. |
| **Constants** | `src/shared/constants.ts` | URL patterns for page type detection, default settings, reconnect parameters, alarm names, size limits. |

### Data Flow: Capture Lifecycle

1. User clicks "Capture" on the overlay or popup
2. Content script waits for DOM stability (MutationObserver, 1-2s)
3. Content script captures `document.documentElement.outerHTML` (overlay hidden during capture)
4. Content script builds a `CapturePayload` with URL, page type, scroll depth, viewport dimensions, timestamp
5. Payload is sent to the service worker via `chrome.runtime.sendMessage`
6. Service worker submits to `POST /api/extension/capture`
7. On success: daily capture counter incremented, badge cleared
8. On failure: payload queued in `chrome.storage.local`, badge shows queue depth
9. Queue flush alarm fires every 60 seconds, retries queued captures
10. App stores HTML in `page_cache` table, queues for parsing
11. App pushes `CAPTURE_CONFIRMED` event via WebSocket


## 3. Setup & Installation

### Prerequisites

- **Node.js** >= 18.0.0
- **Chrome** >= 120 (for MV3 side panel API)
- **ctox app** running on `http://localhost:3000` (via Docker or `npm run dev`)

### Build Instructions

```bash
# Navigate to the browser extension directory
cd /home/aepod/dev/ctox/browser

# Install dependencies (first time only)
npm install

# Build all bundles (production, minified)
npm run build

# Or watch mode for development (unminified, auto-rebuild)
npm run watch
```

The build produces 4 bundles in `browser/dist/`:

| Bundle | Source | Size (approx) |
|--------|--------|---------------|
| `service-worker.js` | `src/service-worker.ts` | ~8KB |
| `content.js` | `src/content/index.ts` | ~5KB |
| `popup.js` | `src/popup/popup.ts` | ~4KB |
| `sidepanel.js` | `src/sidepanel/sidepanel.ts` | ~4KB |

### Chrome Sideloading

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Browse to and select the `browser/` directory (the one that contains `manifest.json`)
   - Do NOT select `browser/dist/` or `browser/src/`
5. The extension appears as **"LinkedIn Network Intelligence"** with its icon
6. Pin the extension to the toolbar by clicking the puzzle-piece icon in the toolbar and clicking the pin next to the extension name

### Verify Installation

- The extension icon should appear in the Chrome toolbar
- Click the icon -- you should see the popup with "Connect to App" registration form
- No errors should appear on the extension card in `chrome://extensions`


## 4. Configuration

### App URL

The extension connects to `http://localhost:3000` by default (defined in `src/shared/constants.ts` as `DEFAULT_APP_URL`). This can be changed by updating the `appUrl` value in `chrome.storage.local`:

```javascript
// In the service worker DevTools console:
chrome.storage.local.set({ appUrl: 'http://your-app-host:3000' });
```

### Extension Settings

Settings are fetched from the app at registration time and pushed via WebSocket when updated. Available settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autoCaptureEnabled` | boolean | `false` | Auto-capture pages on navigation (not yet implemented) |
| `capturePageTypes` | string[] | `["PROFILE", "SEARCH_PEOPLE", "COMPANY"]` | Page types eligible for auto-capture |
| `dailyCaptureWarningThreshold` | number | `100` | Warning when daily captures exceed this |
| `overlayPosition` | string | `"bottom-right"` | Overlay widget position on LinkedIn pages |
| `overlayEnabled` | boolean | `true` | Show/hide the floating overlay |
| `healthCheckIntervalMs` | number | `30000` | Health check polling interval (ms) |
| `captureStabilityDelayMs` | number | `2000` | Wait time for DOM stability before capture (ms) |
| `maxQueueSize` | number | `50` | Maximum offline queue depth (oldest dropped when exceeded) |

### Content Security Policy

The extension's CSP (defined in `manifest.json`) allows connections to:
- `http://localhost:3000` (HTTP API)
- `ws://localhost:3000` (WebSocket)

For production deployment, update the CSP in `manifest.json`:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; connect-src https://your-app.example.com wss://your-app.example.com;"
}
```


## 5. Usage Guide

### Registration (First-Time Setup)

1. Ensure the ctox app is running and the database is initialized
2. Generate an extension token (via admin UI or database insert)
3. Click the extension icon in the Chrome toolbar
4. Enter the display token in the "Connect to App" input field
5. Click "Connect"
6. On success, the popup switches to the main dashboard view

The extension stores the token in `chrome.storage.local` and uses it for all subsequent API requests via the `X-Extension-Token` header.

### Capturing Pages

**Manual capture (overlay):**
1. Navigate to any LinkedIn page
2. A floating overlay widget appears in the bottom-right corner showing "LNI"
3. Click the blue "Capture" button on the overlay
4. The status dot turns yellow ("Capturing..."), then green ("Captured!")

**Manual capture (popup):**
1. While on a LinkedIn page, click the extension icon
2. The popup shows the detected page type (e.g., "PROFILE", "COMPANY")
3. Click "Capture This Page"
4. The button text changes to "Capturing..." then "Captured!"

**What pages can be captured:**
Any LinkedIn page can be captured. The extension detects the page type from the URL but captures all pages regardless of type.

### Viewing Tasks

**In the popup:**
- The popup shows up to 5 pending tasks with priority indicators (red=high, yellow=medium, green=low)
- Tasks with target URLs show a "Go" link to navigate to that page

**In the side panel:**
1. Click "Open Side Panel" in the popup footer, or click the overlay widget (anywhere except the Capture button)
2. Tasks are grouped by goal with progress bars showing completion percentage
3. Click the circular checkbox next to a task to mark it as completed
4. Stats at the bottom show today's capture count and queue depth

### Understanding the Overlay

The floating overlay widget appears on all LinkedIn pages (when `overlayEnabled` is true):

| Status Dot | Label | Meaning |
|-----------|-------|---------|
| Green | "LNI" | Connected to app, ready to capture |
| Gray | "LNI (offline)" | App unreachable, captures will be queued |
| Yellow | "Capturing..." | Capture in progress |
| Green | "Captured!" | Capture succeeded (reverts after 2s) |
| Red | "LNI (error)" | Connection error |

Clicking the overlay (not the Capture button) opens the side panel.

### Offline Mode

When the app is unreachable:
1. Captures are stored in a local queue (up to 50 items, configurable)
2. The extension badge shows the queue depth as a yellow number
3. The overlay status dot turns gray
4. A queue flush alarm runs every 60 seconds
5. When connectivity is restored, queued captures are submitted in order
6. If a queued capture fails during flush, it is re-queued and the flush stops

The queue uses FIFO ordering. If the queue reaches `maxQueueSize`, the oldest entry is dropped to make room for new captures.


## 6. Supported LinkedIn Pages

The extension detects the following page types from URL patterns:

| Page Type | URL Pattern | Description | Example URL |
|-----------|-------------|-------------|-------------|
| `PROFILE` | `/in/{username}/` | Individual profile | `linkedin.com/in/johndoe/` |
| `PROFILE_ACTIVITY` | `/in/{username}/recent-activity` | Profile activity feed | `linkedin.com/in/johndoe/recent-activity` |
| `SEARCH_PEOPLE` | `/search/results/people` | People search results | `linkedin.com/search/results/people/?keywords=cto` |
| `SEARCH_CONTENT` | `/search/results/content` | Content search results | `linkedin.com/search/results/content/?keywords=ai` |
| `FEED` | `/feed/` | Main feed | `linkedin.com/feed/` |
| `COMPANY` | `/company/{slug}/` | Company page | `linkedin.com/company/acme-corp/` |
| `CONNECTIONS` | `/mynetwork/invite-connect/connections` | Connections list | `linkedin.com/mynetwork/invite-connect/connections/` |
| `MESSAGES` | `/messaging` | Messaging inbox | `linkedin.com/messaging/` |
| `OTHER` | (any other LinkedIn URL) | Unrecognized page | `linkedin.com/jobs/`, `linkedin.com/events/` |

All page types can be captured manually. The `capturePageTypes` setting controls which types are eligible for auto-capture (when implemented).


## 7. Extension Permissions

Permissions declared in `manifest.json` and why each is needed:

### `permissions`

| Permission | Why |
|-----------|-----|
| `storage` | Store extension token, capture queue, settings, connection state in `chrome.storage.local` |
| `activeTab` | Access the currently active tab to send messages to the content script for capture |
| `sidePanel` | Open and render the Chrome side panel UI |
| `alarms` | Schedule periodic health checks (every 30s) and queue flushes (every 60s) |

### `host_permissions`

| Host | Why |
|------|-----|
| `https://www.linkedin.com/*` | Inject content script on LinkedIn pages |
| `https://linkedin.com/*` | Inject content script on LinkedIn pages (without www) |
| `http://localhost:3000/*` | Send API requests to the local ctox app |


## 8. Development Guide

### Project Structure

```
browser/
  manifest.json              # Chrome MV3 manifest
  package.json               # Build dependencies (esbuild, typescript, @types/chrome)
  tsconfig.json              # TypeScript config (ES2022, strict, bundler resolution)
  esbuild.config.mjs         # Build config (4 entry points, ESM, sourcemaps)
  icons/                     # Extension icons (16, 32, 48, 128px)
  dist/                      # Build output (gitignored in production)
    service-worker.js
    content.js
    popup.js
    sidepanel.js
  src/
    service-worker.ts         # Background service worker
    content/
      index.ts                # Content script (capture + overlay)
    popup/
      popup.html              # Popup HTML (loaded by manifest action.default_popup)
      popup.css               # Popup styles (320px wide)
      popup.ts                # Popup logic (registration, status, capture, tasks)
    sidepanel/
      sidepanel.html           # Side panel HTML (loaded by manifest side_panel.default_path)
      sidepanel.css            # Side panel styles
      sidepanel.ts             # Side panel logic (goals, tasks, real-time updates)
    shared/
      app-client.ts            # HTTP + WebSocket client class
      constants.ts             # URL patterns, default settings, alarm names
    types/
      index.ts                 # All TypeScript type definitions
    utils/
      storage.ts               # Type-safe chrome.storage.local wrapper
      logger.ts                # Console logger with [LNI] prefix
```

### Build System

The extension uses **esbuild** (`esbuild.config.mjs`) for fast TypeScript bundling:

- **Format**: ESM (`format: 'esm'`)
- **Target**: Chrome 120 (`target: 'chrome120'`)
- **Source maps**: Always enabled
- **Minification**: Enabled for production build, disabled in watch mode
- **Entry points**: 4 separate bundles (service-worker, content, popup, sidepanel)
- **Path aliases**: `@shared` maps to `../shared`

```bash
# Production build (minified)
npm run build

# Watch mode (auto-rebuild on save, unminified)
npm run watch

# TypeScript type checking only (no emit)
npm run typecheck

# Clean build output
npm run clean
```

### Adding a New Page Type Parser

The extension itself does not parse pages -- it only captures HTML and detects the page type. Parsing is done server-side. To add support for a new page type:

1. **Add the URL pattern** in `browser/src/shared/constants.ts`:
   ```typescript
   // In PAGE_URL_PATTERNS array:
   {
     pageType: 'EVENTS',
     pattern: /linkedin\.com\/events\/[^/]+/,
     description: 'Event page',
   },
   ```

2. **Add the page type** to the `LinkedInPageType` union in `browser/src/types/index.ts`:
   ```typescript
   export type LinkedInPageType =
     | 'PROFILE'
     | ... existing types ...
     | 'EVENTS'  // new
     | 'OTHER';
   ```

3. **Add a server-side parser** in `app/src/lib/parser/parsers/events-parser.ts` (see existing parsers for the interface)

4. **Register the parser** in `app/src/lib/parser/parser-registry.ts`

5. **Add selector config** in the database:
   ```sql
   INSERT INTO selector_configs (page_type, selector_name, selectors_json, is_active)
   VALUES ('EVENTS', 'default', '{"title": [".events-top-card__title"]}', true);
   ```

6. **Rebuild the extension**: `cd browser && npm run build`

### Testing Locally

1. Build the extension: `npm run build`
2. Load in Chrome via `chrome://extensions` > "Load unpacked"
3. After code changes, rebuild and click the reload button on the extension card
4. For watch mode: `npm run watch` -- Chrome requires manual reload even with watch mode
5. Debug the service worker: `chrome://extensions` > click "service worker" link
6. Debug the content script: Open DevTools on a LinkedIn page, check Console for `[LNI]` messages
7. Debug the popup: Right-click the extension icon > "Inspect popup"
8. Debug the side panel: Open side panel, right-click inside it > "Inspect"


## 9. API Reference

All endpoints are served by the Next.js app at `http://localhost:3000`. Unless noted, all endpoints require the `X-Extension-Token` header.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/extension/register` | POST | None (origin only) | Token exchange -- registers extension with display token |
| `/api/extension/capture` | POST | Token required | Submit captured HTML for storage and parsing |
| `/api/extension/health` | GET | Token required | Health check (DB, WS, parse queue) |
| `/api/extension/settings` | GET | Token required | Fetch extension settings |
| `/api/extension/tasks` | GET | Token required | List tasks grouped by goal |
| `/api/extension/tasks/:id` | PATCH | Token required | Update task status |
| `/api/extension/contact/[...url]` | GET | Token required | Look up contact by LinkedIn URL |
| `/api/extension/message-render` | POST | Token required | Render message template for a contact |

### POST /api/extension/register

No `X-Extension-Token` required. Origin validation only.

**Request:**
```json
{
  "displayToken": "string (required)"
}
```

**Response (200):**
```json
{
  "success": true,
  "extensionId": "string",
  "settings": { ...ExtensionSettings }
}
```

**Errors:** 400 (missing displayToken), 401 (invalid token or origin), 500 (internal)

---

### POST /api/extension/capture

**Request:**
```json
{
  "captureId": "string (UUID)",
  "url": "string (LinkedIn URL)",
  "pageType": "PROFILE | SEARCH_PEOPLE | FEED | COMPANY | CONNECTIONS | MESSAGES | OTHER",
  "html": "string (full page HTML, max 10MB)",
  "scrollDepth": "number (0.0-1.0)",
  "viewportHeight": "number (pixels)",
  "documentHeight": "number (pixels)",
  "capturedAt": "string (ISO 8601)",
  "extensionVersion": "string",
  "sessionId": "string",
  "triggerMode": "manual | auto"
}
```

**Response (200):**
```json
{
  "success": true,
  "captureId": "string",
  "storedBytes": "number",
  "compressionRatio": "number (0.0-1.0)",
  "queuedForParsing": true,
  "pageType": "string"
}
```

**Errors:** 400 (validation), 401 (auth), 429 (rate limit), 500 (internal)

---

### GET /api/extension/health

**Response (200):**
```json
{
  "status": "healthy | degraded | unhealthy",
  "version": "2.0.0",
  "dbConnected": true,
  "wsConnected": false,
  "pendingParseJobs": 0,
  "uptime": 1234,
  "timestamp": "2026-03-15T12:00:00.000Z"
}
```

Status logic: `unhealthy` if DB is down, `degraded` if WS is down, `healthy` otherwise.

**Errors:** 401 (auth), 429 (rate limit), 503 (unhealthy)

---

### GET /api/extension/settings

**Response (200):**
```json
{
  "settings": {
    "autoCaptureEnabled": false,
    "capturePageTypes": ["PROFILE", "SEARCH_PEOPLE", "COMPANY"],
    "dailyCaptureWarningThreshold": 100,
    "overlayPosition": "bottom-right",
    "overlayEnabled": true,
    "healthCheckIntervalMs": 30000,
    "captureStabilityDelayMs": 2000,
    "maxQueueSize": 50
  }
}
```

**Errors:** 401 (auth), 429 (rate limit), 500 (internal)

---

### GET /api/extension/tasks

**Query Parameters:**
- `status` (optional): Filter by task status (`pending`, `in_progress`, `completed`, `skipped`)
- `goalId` (optional): Filter by goal ID
- `limit` (optional, default 50): Maximum tasks to return

**Response (200):**
```json
{
  "goals": [
    {
      "id": "string",
      "title": "string",
      "progress": 0.33,
      "totalTasks": 3,
      "completedTasks": 1,
      "tasks": [
        {
          "id": "string",
          "goalId": "string",
          "goalTitle": "string",
          "type": "VISIT_PROFILE | CAPTURE_PAGE | SEND_MESSAGE | ...",
          "title": "string",
          "description": "string",
          "priority": "high | medium | low",
          "status": "pending | in_progress | completed | skipped",
          "targetUrl": "string | null",
          "searchQuery": "string | null",
          "contactName": "string | null",
          "appUrl": "string | null",
          "dueDate": "string | null",
          "completedAt": "string | null",
          "createdAt": "string"
        }
      ]
    }
  ],
  "totalPending": 2,
  "totalCompleted": 1
}
```

**Errors:** 401 (auth), 429 (rate limit), 500 (internal)

---

### PATCH /api/extension/tasks/:id

**Request:**
```json
{
  "status": "completed | skipped | in_progress",
  "completionNote": "string (optional)"
}
```

**Response (200):**
```json
{
  "success": true,
  "taskId": "string",
  "status": "completed",
  "completedAt": "string | null"
}
```

Also pushes `TASK_UPDATED` and (if goal exists) `GOAL_PROGRESS` WebSocket events.

**Errors:** 400 (invalid status), 401 (auth), 404 (task not found), 429 (rate limit), 500 (internal)

---

### GET /api/extension/contact/[...url]

The LinkedIn URL is passed as path segments after `/contact/`. The protocol prefix is stripped by the client.

Example: `/api/extension/contact/www.linkedin.com/in/johndoe`

**Response (200, found):**
```json
{
  "found": true,
  "contact": {
    "id": "string",
    "name": "string",
    "headline": "string",
    "tier": "gold | silver | bronze | unscored",
    "goldScore": 0.85,
    "lastCapturedAt": "string | null",
    "lastEnrichedAt": "string | null",
    "tasksPending": 2
  }
}
```

**Response (200, not found):**
```json
{
  "found": false,
  "contact": null
}
```

**Errors:** 400 (missing URL), 401 (auth), 429 (rate limit), 500 (internal)

---

### POST /api/extension/message-render

**Request:**
```json
{
  "contactUrl": "string (LinkedIn URL, required)",
  "templateId": "string (optional, specific template ID)",
  "templateType": "initial | followup | meeting_request (optional, default: initial)"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Hi John, I noticed your work as CTO and would love to connect...",
  "templateId": "default-initial",
  "templateName": "Initial Outreach",
  "variables": {
    "name": "John",
    "fullName": "John Doe",
    "headline": "CTO at Acme",
    "company": "Acme"
  },
  "nextTemplateId": "default-followup"
}
```

**Errors:** 400 (missing contactUrl), 401 (auth), 404 (contact not found), 429 (rate limit), 500 (internal)

---

### WebSocket Connection

**URL:** `ws://localhost:3000/ws/extension?token={extensionToken}`

**Push events (server to extension):**

| Event Type | Payload | Trigger |
|-----------|---------|---------|
| `CAPTURE_CONFIRMED` | `{ captureId, url, pageType }` | After successful capture storage |
| `TASK_CREATED` | `{ taskId, title, type }` | New task created for this extension |
| `TASK_UPDATED` | `{ taskId, status }` | Task status changed |
| `GOAL_PROGRESS` | `{ goalId, progress }` | Goal completion percentage changed |
| `SETTINGS_UPDATED` | `{ settings: {...} }` | Extension settings changed by admin |
| `TEMPLATE_READY` | `{ templateId }` | Template available for rendering |
| `ENRICHMENT_COMPLETE` | `{ contactId }` | Contact enrichment finished |
| `PARSE_COMPLETE` | `{ captureId, contactId }` | Page parsing completed |

**Outbound events (extension to server):**

| Event Type | Payload | Trigger |
|-----------|---------|---------|
| `PAGE_NAVIGATED` | `{ url, pageType }` | LinkedIn SPA navigation detected |
| `TASK_VIEWED` | `{ taskId }` | User viewed a task in the side panel |

**Reconnection:** Exponential backoff starting at 5s, maxing at 60s, with 2x multiplier.

### Authentication

All authenticated endpoints require the `X-Extension-Token` header:
```
X-Extension-Token: <full-token-string>
```

The token is validated by computing its SHA-256 hash and looking it up in the `extension_tokens` table. Revoked tokens return 401.

**Error response format:**
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

Error codes: `MISSING_TOKEN`, `INVALID_TOKEN`, `REVOKED_TOKEN`, `INVALID_ORIGIN`, `RATE_LIMIT_EXCEEDED`, `VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`


## 10. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Extension won't load | Wrong directory selected | Select `browser/` (with `manifest.json`), not `browser/dist/` |
| Service worker error | Stale build output | Run `npm run build` in `browser/`, reload extension |
| No overlay on LinkedIn | Content script not injected | Verify extension is enabled, check `host_permissions` in manifest |
| "Registration failed" | Invalid or revoked token | Verify token in DB: `SELECT * FROM extension_tokens` |
| API returns 401 | Missing or wrong token | Check `X-Extension-Token` header value matches stored token |
| API returns 429 | Rate limit exceeded | Wait for `Retry-After` seconds, reduce request frequency |
| Captures not in DB | App not running | Verify `curl http://localhost:3000/api/extension/health` returns 200 |
| Queue not flushing | Alarm not firing | Reload extension from `chrome://extensions` to reset alarms |
| Side panel won't open | Chrome too old | Requires Chrome 120+, update browser |
| WebSocket disconnected | No custom server | Default `next dev` doesn't serve WS; extension falls back to HTTP polling |
| CORS errors | Origin blocked | Set `ALLOW_DEV_ORIGIN=true` in app `.env` for non-standard origins |
| Build fails | Missing dependencies | Run `npm install` in `browser/`, check Node.js >= 18 |
| TypeScript errors | Type mismatch | Run `npx tsc --noEmit` to see specific errors |
