# Phase 4: Chrome Extension -- Gate Verification

## Backend Domain (B4)

### B4-1: Selector Configuration Table
- [x] `selector_configs` table exists with proper columns (selectors_json, heuristics, notes, created_by added)
- [x] 6 page types seeded with `version: 1`, `is_active: true` (PROFILE, SEARCH_PEOPLE, FEED, COMPANY, CONNECTIONS, MESSAGES)
- [x] Deactivation trigger works (trg_selector_config_activate)
- [x] TypeScript interfaces compile: `app/src/types/selector-config.ts`
- [x] Verified via: `SELECT page_type, is_active FROM selector_configs` returns 6 active rows

### B4-2: Page Cache Rotation Trigger
- [x] `page_cache` table exists with all required columns (capture_id, extension_version, session_id, scroll_depth, viewport_height, document_height, trigger_mode, parse_version added)
- [x] 5-version rotation trigger `trg_rotate_page_cache` exists and operational
- [x] Additional indexes created: idx_page_cache_unparsed, idx_page_cache_url_created

### B4-4: Extension Token Management
- [x] `extension_tokens` table created in DB with token_hash, extension_id, display_prefix columns
- [x] Token generation: `ext_` prefix + 32 random bytes (base64url)
- [x] Token validation via SHA-256 hash lookup
- [x] Token revocation marks is_revoked=true
- [x] Token listing masks full token values
- [x] Display token validation for registration flow
- [x] Implementation: `app/src/lib/auth/extension-auth.ts`

### B4-5: Token-Based Auth Middleware
- [x] `withExtensionAuth()` validates X-Extension-Token header
- [x] Origin validation accepts `chrome-extension://` scheme
- [x] Origin validation allows localhost in development
- [x] Rate limiting per extensionId per endpoint
- [x] 401 responses include structured JSON error bodies
- [x] 429 responses include Retry-After header
- [x] Implementation: `app/src/lib/middleware/extension-auth-middleware.ts`, `extension-rate-limiter.ts`

## App Domain (A4)

### A4-1: POST /api/extension/capture
- [x] Endpoint accepts CaptureRequestBody, validates with Zod
- [x] Stores HTML in page_cache table
- [x] Pushes CAPTURE_CONFIRMED WebSocket event
- [x] Returns CaptureResponse with storedBytes, compressionRatio
- [x] Rejects non-LinkedIn URLs, HTML > 10MB

### A4-2: Extension Task & Status Endpoints
- [x] GET /api/extension/tasks - returns tasks grouped by goal, sorted by priority
- [x] PATCH /api/extension/tasks/:id - updates task status, recalculates goal progress
- [x] GET /api/extension/health - DB check, WS check, parse queue depth
- [x] POST /api/extension/register - display token exchange (no auth required)
- [x] GET /api/extension/settings - returns extension settings with defaults
- [x] GET /api/extension/contact/[...url] - contact lookup by LinkedIn URL
- [x] POST /api/extension/message-render - template variable substitution

### A4-3: Parser Engine
- [x] cheerio installed and configured
- [x] Parser interfaces defined: `app/src/lib/parser/types.ts`
- [x] Parser registry: `app/src/lib/parser/parser-registry.ts`
- [x] Selector extractor with chain fallback and heuristics: `selector-extractor.ts`
- [x] Profile parser: extracts name, headline, location, about, experience, education, skills
- [x] Search parser: extracts result list with names, headlines, URLs
- [x] Feed parser: extracts posts with author info and engagement counts
- [x] Company parser: extracts company info, size, specialties
- [x] Connections parser: extracts connection list
- [x] Messages parser: extracts conversation list
- [x] Parse engine orchestrator: loads config, dispatches to parser, marks as parsed

### A4-4: Contact Upsert
- [x] Confidence-based field merging (higher confidence wins)
- [x] Inserts new contacts with source='extension_capture'
- [x] Updates existing contacts matched by LinkedIn URL
- [x] Upserts work_history and education records

## Extension Domain (E4)

### E4-1: Manifest and Build Config
- [x] manifest.json updated with host_permissions for localhost, CSP for ws://
- [x] esbuild config builds all entry points (service-worker, content, popup, sidepanel)
- [x] TypeScript compiles cleanly (npx tsc --noEmit)
- [x] Extension build succeeds (4 bundles produced)

### E4-2: Shared Types and Constants
- [x] Full type definitions: LinkedInPageType, CapturePayload, ExtensionTask, StorageSchema, etc.
- [x] URL patterns for all LinkedIn page types
- [x] Default settings constants
- [x] WebSocket reconnect constants

### E4-3: Content Script (Page Capturer + Overlay)
- [x] Page type detection from URL patterns
- [x] Full page HTML capture (strips overlay before capture)
- [x] Scroll depth tracking
- [x] DOM stability detection via MutationObserver
- [x] SPA navigation detection (URL change monitoring)
- [x] Floating overlay with capture button and status indicator
- [x] Message handler for CAPTURE_REQUEST, GET_STATUS, CONNECTION_STATUS

### E4-4: Service Worker
- [x] Message routing for all message types
- [x] Capture processing with error queue fallback
- [x] Queue flush mechanism
- [x] Health check via alarm (every 30s)
- [x] Badge management (queue depth, connection status)
- [x] WebSocket connection with event handlers
- [x] Tab-based content script communication

### E4-5: Popup UI
- [x] Registration flow with display token input
- [x] Connection status indicator
- [x] Capture stats (today's count, queue depth, task count)
- [x] Current page type display
- [x] Capture button
- [x] Pending tasks list (top 5)
- [x] Open side panel button

### E4-6: Side Panel UI
- [x] Connection status
- [x] Current page type and scroll depth
- [x] Goals with progress bars
- [x] Task list with completion toggle
- [x] Activity stats (captures today, queued)
- [x] Real-time updates via storage.onChanged listener
- [x] Tab change listener for page info updates

## Build Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (app) | PASS - no errors |
| `npx tsc --noEmit` (browser) | PASS - no errors |
| `npm run lint` (app) | PASS - warnings only (unused params) |
| `npm run build` (app) | PASS - 47 routes, 8 extension API routes |
| `npm run build` (browser) | PASS - 4 bundles (8.2kb, 5.1kb, 4.1kb, 3.6kb) |
| DB schema applied | PASS - 6 selector configs, extension_tokens, extension_settings tables |

## Files Created/Modified

### Database
| File | Action |
|------|--------|
| `db/init/017-extension-schema.sql` | Created |

### App (Next.js)
| File | Action |
|------|--------|
| `app/src/types/selector-config.ts` | Created |
| `app/src/types/extension-auth.ts` | Created |
| `app/src/lib/auth/extension-auth.ts` | Created |
| `app/src/lib/middleware/extension-auth-middleware.ts` | Created |
| `app/src/lib/middleware/extension-rate-limiter.ts` | Created |
| `app/src/lib/websocket/ws-server.ts` | Created |
| `app/src/lib/websocket/ws-events.ts` | Created |
| `app/src/lib/capture/capture-schema.ts` | Created |
| `app/src/lib/capture/capture-store.ts` | Created |
| `app/src/lib/parser/types.ts` | Created |
| `app/src/lib/parser/parser-registry.ts` | Created |
| `app/src/lib/parser/selector-extractor.ts` | Created |
| `app/src/lib/parser/parse-engine.ts` | Created |
| `app/src/lib/parser/contact-upsert.ts` | Created |
| `app/src/lib/parser/parsers/profile-parser.ts` | Created |
| `app/src/lib/parser/parsers/search-parser.ts` | Created |
| `app/src/lib/parser/parsers/feed-parser.ts` | Created |
| `app/src/lib/parser/parsers/company-parser.ts` | Created |
| `app/src/lib/parser/parsers/connections-parser.ts` | Created |
| `app/src/lib/parser/parsers/messages-parser.ts` | Created |
| `app/src/app/api/extension/capture/route.ts` | Created |
| `app/src/app/api/extension/tasks/route.ts` | Created |
| `app/src/app/api/extension/tasks/[id]/route.ts` | Created |
| `app/src/app/api/extension/health/route.ts` | Created |
| `app/src/app/api/extension/register/route.ts` | Created |
| `app/src/app/api/extension/settings/route.ts` | Created |
| `app/src/app/api/extension/contact/[...url]/route.ts` | Created |
| `app/src/app/api/extension/message-render/route.ts` | Created |

### Browser Extension
| File | Action |
|------|--------|
| `browser/manifest.json` | Modified |
| `browser/src/types/index.ts` | Modified (full rewrite) |
| `browser/src/shared/constants.ts` | Created |
| `browser/src/shared/app-client.ts` | Created |
| `browser/src/utils/storage.ts` | Modified (full rewrite) |
| `browser/src/utils/logger.ts` | Modified |
| `browser/src/content/index.ts` | Modified (full rewrite) |
| `browser/src/service-worker.ts` | Modified (full rewrite) |
| `browser/src/popup/popup.html` | Modified (full rewrite) |
| `browser/src/popup/popup.css` | Modified (full rewrite) |
| `browser/src/popup/popup.ts` | Modified (full rewrite) |
| `browser/src/sidepanel/sidepanel.html` | Modified (full rewrite) |
| `browser/src/sidepanel/sidepanel.css` | Modified (full rewrite) |
| `browser/src/sidepanel/sidepanel.ts` | Modified (full rewrite) |

### Other
| File | Action |
|------|--------|
| `.gitignore` | Modified (added extension token/settings paths) |
| `app/package.json` | Modified (ws, zod, cheerio added) |

---

## Manual Testing Guide

This section provides step-by-step instructions for manually testing every component of the Chrome extension and its backend integration.

### 1. Prerequisites

Before testing, ensure the following are running:

**Docker containers** (from project root):
```bash
cd /home/aepod/dev/ctox
docker compose up -d
```

This starts:
- **PostgreSQL** on port 5432 with all schema migrations applied (including `db/init/017-extension-schema.sql`)
- **Next.js app** on port 3000 (or run `cd app && npm run dev` for hot-reloading)

**Verify the app is reachable:**
```bash
curl -s http://localhost:3000/ | head -20
```
You should see the Next.js HTML response.

**Verify the database has extension tables:**
```bash
docker exec ctox-db psql -U netnav -d netnav -c "\dt extension_tokens"
docker exec ctox-db psql -U netnav -d netnav -c "\dt page_cache"
docker exec ctox-db psql -U netnav -d netnav -c "\dt selector_configs"
```
Each command should return a table listing.

**Chrome browser**: Version 120+ required (for MV3 side panel API support).

### 2. Building the Extension

```bash
cd /home/aepod/dev/ctox/browser

# Install dependencies (first time only)
npm install

# Build all bundles
npm run build
```

**Expected output**: 4 bundles created in `browser/dist/`:
- `service-worker.js` + `.map`
- `content.js` + `.map`
- `popup.js` + `.map`
- `sidepanel.js` + `.map`

**Verify the build succeeded:**
```bash
ls -la dist/
```
You should see 8 files (4 `.js` + 4 `.map`). Total size should be roughly 20-25KB.

**TypeScript check (optional):**
```bash
npx tsc --noEmit
```
Should complete with 0 errors.

### 3. Loading in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Navigate to and select the `browser/` directory (the one containing `manifest.json`, NOT `browser/dist/`)
5. The extension should appear in the list as **"LinkedIn Network Intelligence"** v0.1.0

**What you should see:**
- The extension appears in the extensions list with its icon
- No errors should be shown (if errors appear, click "Errors" to see details)
- The extension icon appears in the Chrome toolbar (you may need to pin it via the puzzle-piece icon)

**Troubleshooting at this step:**
- If you see "Service worker registration failed", rebuild with `npm run build` and click the reload button on the extension card
- If you see "Manifest file is missing or unreadable", make sure you selected the `browser/` directory, not `browser/dist/`

### 4. Registration Flow

Before the extension can communicate with the app, it must be registered with a valid token.

**Step 1: Generate a token in the database**

Since the admin UI for token generation may not yet be built, insert a token directly:

```bash
docker exec ctox-db psql -U netnav -d netnav -c "
  INSERT INTO extension_tokens (
    extension_id, token_hash, display_prefix, created_at
  ) VALUES (
    'ext-test-001',
    encode(sha256('test-extension-token-12345'::bytea), 'hex'),
    'test-exte',
    now()
  )
  ON CONFLICT DO NOTHING;
"
```

The display token (what you enter in the popup) is: `test-extension-token-12345`

**Step 2: Register in the popup**

1. Click the extension icon in the Chrome toolbar
2. The popup opens showing "Connect to App" with a text input
3. Enter the display token: `test-extension-token-12345`
4. Click "Connect"

**What you should see:**
- If registration succeeds: the registration section disappears, replaced by the main dashboard with stats (Captures Today: 0, Queued: 0, Tasks: 0)
- If registration fails: an error message appears below the input ("Registration failed. Check your token and try again.")

**Verify registration in the database:**
```bash
docker exec ctox-db psql -U netnav -d netnav -c "
  SELECT extension_id, display_prefix, is_revoked, last_used_at
  FROM extension_tokens
  WHERE display_prefix = 'test-exte';
"
```

### 5. Testing Capture

**Step 1: Navigate to a LinkedIn profile**

Open a LinkedIn profile page, e.g., `https://www.linkedin.com/in/someperson/`

**What you should see:**
- A small dark floating overlay appears in the bottom-right corner of the page
- The overlay shows "LNI" with a colored status dot and a blue "Capture" button
- Green dot = connected to app, gray dot = disconnected, red dot = error

**Step 2: Trigger a capture**

Click the "Capture" button on the overlay (or click "Capture This Page" in the popup).

**What you should see:**
- The overlay text changes to "Capturing..." with a yellow dot
- After 1-2 seconds, it changes to "Captured!" with a green dot
- Then reverts to "LNI" after 2 seconds

**Step 3: Verify in the database**

```bash
docker exec ctox-db psql -U netnav -d netnav -c "
  SELECT id, url, page_type, parsed,
         length(html_content) as html_bytes,
         created_at
  FROM page_cache
  ORDER BY created_at DESC
  LIMIT 5;
"
```

You should see a new row with:
- `url` matching the LinkedIn profile URL
- `page_type` = `PROFILE`
- `parsed` = `false` (initially)
- `html_bytes` > 0 (typically 200KB-2MB for a LinkedIn page)

**Step 4: Verify in the popup**

Click the extension icon. The "Captures Today" counter should have incremented by 1.

### 6. Testing Task Display

Tasks are displayed in both the popup (top 5) and the side panel (grouped by goal).

**Step 1: Insert test tasks**

```bash
docker exec ctox-db psql -U netnav -d netnav -c "
  INSERT INTO goals (id, title, status, target_value, current_value)
  VALUES ('goal-test-1', 'Research Prospects', 'active', 5, 0)
  ON CONFLICT DO NOTHING;

  INSERT INTO tasks (id, goal_id, title, description, task_type, status, priority, url)
  VALUES
    ('task-001', 'goal-test-1', 'Visit John Smith profile', 'Capture and review', 'VISIT_PROFILE', 'pending', 1, 'https://www.linkedin.com/in/johnsmith/'),
    ('task-002', 'goal-test-1', 'Capture Acme Corp page', 'Get company details', 'CAPTURE_PAGE', 'pending', 3, 'https://www.linkedin.com/company/acme/'),
    ('task-003', 'goal-test-1', 'Send intro message', 'Use initial template', 'SEND_MESSAGE', 'pending', 5, NULL)
  ON CONFLICT DO NOTHING;
"
```

**Step 2: Verify in popup**

Click the extension icon. Under "Pending Tasks" you should see the 3 tasks listed with priority indicators:
- Red dot = high priority (priority <= 3)
- Yellow dot = medium priority (priority 4-6)
- Green dot = low priority (priority >= 7)

Tasks with URLs show a "Go" link that opens the target page.

**Step 3: Verify in side panel**

1. Click "Open Side Panel" in the popup footer, or click the overlay on a LinkedIn page
2. The side panel opens on the right side of the browser
3. Under "Goals & Tasks" you should see the "Research Prospects" goal with a progress bar (0/3)
4. Each task has a circular checkbox -- clicking it marks the task as completed

### 7. Testing WebSocket

The extension maintains a WebSocket connection for real-time push events.

**Verify WebSocket connection status:**

1. Open Chrome DevTools on the extension's service worker:
   - Go to `chrome://extensions`
   - Click "service worker" link under the extension
   - Check the Console tab

2. You should see log messages:
   ```
   [LNI] Service worker loaded
   [LNI] WebSocket connected  (if app is running with WS support)
   ```

**Note:** The WebSocket server requires a custom Node.js server setup (not the default Next.js dev server). In development mode, the extension falls back to HTTP polling via health checks every 30 seconds. The WebSocket connection will show as "disconnected" unless you have wired up the `ws-server.ts` singleton to the HTTP server.

**Testing WebSocket events (when WS is available):**

The following events are pushed to the extension:
- `CAPTURE_CONFIRMED` -- after a successful capture submission
- `TASK_CREATED` / `TASK_UPDATED` -- when tasks change server-side
- `GOAL_PROGRESS` -- when goal completion percentage changes
- `SETTINGS_UPDATED` -- when admin changes extension settings
- `PARSE_COMPLETE` -- when a captured page finishes parsing
- `TEMPLATE_READY` / `ENRICHMENT_COMPLETE` -- future phase events

### 8. Testing Offline Queue

The extension queues captures locally when the app is unreachable and flushes them when connectivity is restored.

**Step 1: Stop the app**

```bash
docker compose down
# or: cd app && kill the dev server
```

**Step 2: Attempt a capture**

Navigate to a LinkedIn page and click "Capture" on the overlay.

**What you should see:**
- The capture processes but fails to submit
- The service worker logs: `[LNI] Capture failed, queuing: ...`
- The extension badge shows a yellow number (queue depth)
- The popup shows the queue depth under "Queued"

**Step 3: Verify queue in storage**

In the service worker DevTools console:
```javascript
chrome.storage.local.get('captureQueue', (r) => console.log(r.captureQueue.length));
```
Should show 1 (or however many captures were attempted offline).

**Step 4: Restart the app**

```bash
docker compose up -d
# or: cd app && npm run dev
```

**What you should see:**
- Within 60 seconds (the queue flush alarm interval), the queued capture is submitted
- The badge clears
- The "Queued" count in the popup returns to 0
- The service worker logs: `[LNI] Flushing capture queue: 1 items` followed by `[LNI] Queue flush complete: 1 items processed`

**Step 5: Verify in database**

```bash
docker exec ctox-db psql -U netnav -d netnav -c "
  SELECT id, url, page_type, created_at
  FROM page_cache
  ORDER BY created_at DESC
  LIMIT 3;
"
```
The previously queued capture should now appear.

### 9. Verifying API Endpoints

Each endpoint can be tested independently with curl. Replace `YOUR_TOKEN` with the token string stored in the extension (e.g., `test-extension-token-12345`).

**Health Check:**
```bash
curl -s -H "X-Extension-Token: test-extension-token-12345" \
  http://localhost:3000/api/extension/health | jq .
```

Expected response:
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "dbConnected": true,
  "wsConnected": false,
  "pendingParseJobs": 0,
  "uptime": 1234,
  "timestamp": "2026-03-15T12:00:00.000Z"
}
```

**Registration (no auth required):**
```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"displayToken": "test-extension-token-12345"}' \
  http://localhost:3000/api/extension/register | jq .
```

Expected response:
```json
{
  "success": true,
  "extensionId": "ext-test-001",
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

**Settings:**
```bash
curl -s -H "X-Extension-Token: test-extension-token-12345" \
  http://localhost:3000/api/extension/settings | jq .
```

Expected response:
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

**Capture Submission:**
```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-Extension-Token: test-extension-token-12345" \
  -d '{
    "captureId": "test-capture-001",
    "url": "https://www.linkedin.com/in/testuser/",
    "pageType": "PROFILE",
    "html": "<html><body>Test HTML content</body></html>",
    "scrollDepth": 0.5,
    "viewportHeight": 900,
    "documentHeight": 3000,
    "capturedAt": "2026-03-15T12:00:00.000Z",
    "extensionVersion": "0.1.0",
    "sessionId": "test-session-001",
    "triggerMode": "manual"
  }' \
  http://localhost:3000/api/extension/capture | jq .
```

Expected response:
```json
{
  "success": true,
  "captureId": "test-capture-001",
  "storedBytes": 42,
  "compressionRatio": 0,
  "queuedForParsing": true,
  "pageType": "PROFILE"
}
```

**Tasks (list):**
```bash
curl -s -H "X-Extension-Token: test-extension-token-12345" \
  "http://localhost:3000/api/extension/tasks?status=pending&limit=10" | jq .
```

Expected response:
```json
{
  "goals": [
    {
      "id": "goal-test-1",
      "title": "Research Prospects",
      "progress": 0,
      "totalTasks": 3,
      "completedTasks": 0,
      "tasks": [...]
    }
  ],
  "totalPending": 3,
  "totalCompleted": 0
}
```

**Task Update:**
```bash
curl -s -X PATCH \
  -H "Content-Type: application/json" \
  -H "X-Extension-Token: test-extension-token-12345" \
  -d '{"status": "completed"}' \
  http://localhost:3000/api/extension/tasks/task-001 | jq .
```

Expected response:
```json
{
  "success": true,
  "taskId": "task-001",
  "status": "completed",
  "completedAt": "2026-03-15T12:00:00.000Z"
}
```

**Contact Lookup:**
```bash
curl -s -H "X-Extension-Token: test-extension-token-12345" \
  http://localhost:3000/api/extension/contact/www.linkedin.com/in/testuser | jq .
```

Expected response (if contact exists):
```json
{
  "found": true,
  "contact": {
    "id": "...",
    "name": "Test User",
    "headline": "Software Engineer",
    "tier": "unscored",
    "goldScore": 0,
    "lastCapturedAt": "2026-03-15T12:00:00.000Z",
    "lastEnrichedAt": null,
    "tasksPending": 0
  }
}
```

**Message Render:**
```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-Extension-Token: test-extension-token-12345" \
  -d '{"contactUrl": "https://www.linkedin.com/in/testuser/", "templateType": "initial"}' \
  http://localhost:3000/api/extension/message-render | jq .
```

Expected response:
```json
{
  "success": true,
  "message": "Hi Test, I noticed your work as Software Engineer and would love to connect...",
  "templateId": "default-initial",
  "templateName": "Initial Outreach",
  "variables": { "name": "Test", "fullName": "Test User", "headline": "Software Engineer", "company": "" },
  "nextTemplateId": "default-followup"
}
```

**Testing auth failure (missing token):**
```bash
curl -s http://localhost:3000/api/extension/health | jq .
```

Expected:
```json
{
  "error": "MISSING_TOKEN",
  "message": "X-Extension-Token header is required"
}
```
HTTP status: 401

**Testing rate limiting:**

Send many rapid requests to trigger the rate limiter:
```bash
for i in $(seq 1 100); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "X-Extension-Token: test-extension-token-12345" \
    http://localhost:3000/api/extension/health
done
```

After exceeding the limit, responses return HTTP 429 with a `Retry-After` header.

### 10. Troubleshooting

#### Extension not loading in Chrome
- **Symptom**: "Manifest file is missing or unreadable"
- **Fix**: Ensure you selected the `browser/` directory (containing `manifest.json`), not `browser/dist/` or `browser/src/`

#### Build errors
- **Symptom**: `npm run build` fails in `browser/`
- **Fix**: Run `npm install` first. Check Node.js version >= 18. If esbuild binary issues occur, delete `node_modules` and reinstall.

#### Service worker registration failed
- **Symptom**: Error shown on extension card in `chrome://extensions`
- **Fix**: Rebuild with `cd browser && npm run build`, then click the reload (circular arrow) button on the extension card.

#### CORS / Origin errors
- **Symptom**: API requests return `{"error":"INVALID_ORIGIN"}`
- **Fix**: In development, the origin validation allows `chrome-extension://` and `http://localhost:*`. If testing from a different origin, set `ALLOW_DEV_ORIGIN=true` in the app's `.env` file. Requests with no Origin header (e.g., curl) are always allowed.

#### Token invalid / registration fails
- **Symptom**: "Registration failed. Check your token and try again."
- **Fix**: Verify the token exists in the database and is not revoked:
  ```bash
  docker exec ctox-db psql -U netnav -d netnav -c "
    SELECT extension_id, display_prefix, is_revoked
    FROM extension_tokens;
  "
  ```
  Ensure `is_revoked` is `false`. The display token entered in the popup must match what was used to generate the hash.

#### Overlay not appearing on LinkedIn
- **Symptom**: No floating "LNI" widget on LinkedIn pages
- **Fix**: Check that the content script is loaded. Open DevTools on the LinkedIn page (F12), go to Console, and look for `[LNI] Content script loaded`. If absent, verify the extension is enabled and that `host_permissions` in `manifest.json` includes `https://www.linkedin.com/*`.

#### Captures not appearing in database
- **Symptom**: Capture button shows "Captured!" but no rows in `page_cache`
- **Fix**: Check the service worker console for error messages. Common causes:
  - App not running on port 3000
  - Token not registered (extension not authenticated)
  - Database connection error
  Run `curl -s http://localhost:3000/api/extension/health -H "X-Extension-Token: YOUR_TOKEN"` to verify app connectivity.

#### Queue not flushing
- **Symptom**: Badge shows queued captures that never submit
- **Fix**: The queue flush alarm fires every 60 seconds. Verify the app is reachable. Check the service worker console for `[LNI] Queue flush` messages. If the alarm isn't firing, reload the extension from `chrome://extensions`.

#### Side panel not opening
- **Symptom**: "Open Side Panel" button does nothing
- **Fix**: Chrome requires the side panel API to be triggered from a user gesture. Ensure you are clicking the button directly (not programmatically). Also verify Chrome version >= 120.

#### WebSocket not connecting
- **Symptom**: Connection status shows "Disconnected" even though app is running
- **Fix**: The WebSocket server requires a custom Node.js server setup. The default `next dev` server does not serve WebSocket connections. The extension falls back to HTTP health checks (every 30s) when WebSocket is unavailable. This is expected behavior in development.
