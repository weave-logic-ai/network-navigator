# Phase 6: Polish -- Extension Domain Plan (Weeks 21-24)

## Objective

Add daily capture rate tracking, rate awareness overlays, auto-capture opt-in functionality, and a comprehensive settings UI. Harden error handling with retry logic and graceful degradation throughout the extension. Deliver production-grade visual polish with final icons, consistent styling, and proper loading/empty states.

## Prerequisites (from Phases 1-5)

| Prerequisite | Phase | Verified By |
|---|---|---|
| Extension loads in Chrome (sideloaded) with Manifest V3 | 4 | Phase 4 gate |
| Content script captures LinkedIn page HTML | 4 | Phase 4 gate |
| Service worker handles message routing, HTTP client, capture queue | 4 | Phase 4 gate |
| WebSocket client with auto-reconnect operational | 4 | Phase 4 gate |
| Popup shows capture button, connection status, top tasks | 4 | Phase 4 gate |
| Side panel shows goal progress, task list, current page info | 4 | Phase 4 gate |
| chrome.storage.local stores token and capture queue | 4 | Phase 4 gate |
| Registration flow (token exchange) operational | 4 | Phase 4 gate |
| Task auto-completion detection working | 4 | Phase 4 gate |
| Badge updates (task count, connection status) working | 4 | Phase 4 gate |
| Scroll depth tracking and DOM stability detection working | 4 | Phase 4 gate |
| SPA navigation detection working | 4 | Phase 4 gate |
| Message template display in popup + side panel | 5 | Phase 5 gate |
| Clipboard copy workflow for templates | 5 | Phase 5 gate |
| Template selection UI operational | 5 | Phase 5 gate |
| Token rotation endpoint available (Phase 6 Backend) | 6 | Phase 6 Backend task B3-3 |

---

## Parallel Agent Assignments

| Agent | Role | Tasks | Est. Effort |
|---|---|---|---|
| Agent E1 | Rate + Settings | Daily capture tracking, rate awareness overlay, auto-capture toggle, settings UI | High |
| Agent E2 | Polish + Error Handling | Retry logic, queue overflow warning, network error recovery, icons, styling, loading/empty states | Medium |

Both agents can run in parallel. Agent E1 focuses on new features (rate tracking, auto-capture, settings). Agent E2 focuses on hardening and visual polish of existing features.

---

## Detailed Task Checklist

### Task E1-1: Daily Capture Tracking

**File**: `extension/src/services/capture-tracker.ts`
**Tests**: `extension/tests/services/capture-tracker.test.ts`

**Description**: Track the number of page captures performed per day to enforce rate limits and display usage information to the user.

**Data Model**:
```typescript
interface DailyCaptureData {
  date: string;                    // YYYY-MM-DD (local time)
  count: number;
  captures: {
    timestamp: number;             // Unix ms
    url: string;
    pageType: 'profile' | 'search' | 'feed' | 'company';
    success: boolean;
  }[];
}

interface CaptureSettings {
  warningThreshold: number;        // default 30
  hardLimit: number;               // default 50 (extension stops auto-capture)
  resetHour: number;               // default 0 (midnight local time)
}
```

**Sub-tasks**:
- [ ] Create `CaptureTracker` class that manages daily capture state in `chrome.storage.local`
- [ ] Storage key: `captureData_{YYYY-MM-DD}` to automatically namespace by date
- [ ] `increment(url, pageType, success)`: add capture record, increment count
- [ ] `getToday()`: return current day's `DailyCaptureData`
- [ ] `getRemainingCaptures()`: return `warningThreshold - todayCount` (or hardLimit-based)
- [ ] `isAtWarning()`: return `true` when count >= warningThreshold * 0.8`
- [ ] `isAtLimit()`: return `true` when count >= hardLimit
- [ ] Implement midnight reset using `chrome.alarms` API:
  - Create alarm `capture-reset` that fires at `resetHour` local time each day
  - On alarm, set count to 0 for the new day (old day data retained for 7 days)
  - Clean up capture data older than 7 days to prevent storage growth
- [ ] Load configurable thresholds from `chrome.storage.sync` (synced across devices)
- [ ] Emit events when thresholds are crossed: `onWarning`, `onLimit`, `onReset`
- [ ] Write unit tests: increment tracking, date rollover, threshold detection, alarm scheduling, cleanup of old data

**Acceptance Criteria**:
- Capture count accurately tracks all captures (both manual and auto)
- Midnight reset creates a new day counter without losing historical data
- Thresholds are configurable and persist across extension restarts
- Old data is cleaned up after 7 days
- Events fire at correct threshold levels (80% warning, 100% limit)

**BR References**: BR-816

---

### Task E1-2: Rate Awareness Overlay

**Files**:
- `extension/src/content/rate-overlay.ts`
- `extension/src/content/rate-overlay.css`
**Tests**: `extension/tests/content/rate-overlay.test.ts`

**Description**: Visual overlay displayed on LinkedIn pages when the user approaches or exceeds their daily capture limit. Provides real-time awareness of capture usage.

**Component Specification**:
```typescript
interface RateOverlayState {
  visible: boolean;
  level: 'info' | 'warning' | 'critical';
  capturesUsed: number;
  capturesRemaining: number;
  warningThreshold: number;
  hardLimit: number;
  message: string;
}
```

**Sub-tasks**:
- [ ] Create `RateOverlay` class injected by content script into LinkedIn pages
- [ ] Overlay renders as a small, non-intrusive banner at a configurable position (bottom-right default)
- [ ] Three overlay levels:
  - **Info** (count >= 50% of threshold): subtle gray banner, "X captures today (Y remaining)"
  - **Warning** (count >= 80% of threshold): amber banner, "Approaching daily capture limit: X of Y used"
  - **Critical** (count >= 100% of limit): red banner, "Daily capture limit reached. Auto-capture paused."
- [ ] Overlay auto-dismisses after 5 seconds for info level; persists for warning and critical
- [ ] Dismiss button (X) hides overlay until next capture or page navigation
- [ ] Overlay uses Shadow DOM to prevent CSS conflicts with LinkedIn styles
- [ ] Overlay position configurable: bottom-right, bottom-left, top-right, top-left (from settings)
- [ ] Animate in/out with CSS transitions (slide + fade)
- [ ] Listen for `CaptureTracker` events to update display in real-time
- [ ] Do not show overlay on non-LinkedIn pages
- [ ] Write unit tests: overlay rendering at each level, auto-dismiss timing, position configuration, Shadow DOM isolation

**Acceptance Criteria**:
- Overlay appears at correct threshold levels
- Info overlay auto-dismisses, warning/critical persist
- Overlay does not interfere with LinkedIn page functionality
- Shadow DOM prevents CSS leaks in both directions
- Position is configurable via settings

**BR References**: BR-815

---

### Task E1-3: Auto-Capture Toggle

**File**: `extension/src/services/auto-capture.ts`
**Tests**: `extension/tests/services/auto-capture.test.ts`

**Description**: Opt-in automatic capture that captures LinkedIn pages on navigation without requiring manual button clicks. Respects daily capture limits and page type filters.

**Configuration**:
```typescript
interface AutoCaptureConfig {
  enabled: boolean;                 // default false (opt-in)
  capturePageTypes: ('profile' | 'search' | 'feed' | 'company')[];  // default ['profile']
  delayMs: number;                  // wait for DOM stability, default 2000ms
  respectDailyLimit: boolean;       // default true
  skipDuplicateUrls: boolean;       // default true (skip if URL captured in last 24h)
  captureOnScroll: boolean;         // default false (capture even if user hasn't scrolled)
}
```

**Sub-tasks**:
- [ ] Create `AutoCapture` class that listens for LinkedIn page navigation events
- [ ] Navigation detection: combine `chrome.webNavigation.onCompleted` (service worker) with content script `popstate` + `MutationObserver` for SPA navigation
- [ ] When navigation detected on LinkedIn:
  1. Check if auto-capture is enabled
  2. Check if page type is in `capturePageTypes` list
  3. Check if daily limit not exceeded (via `CaptureTracker`)
  4. Check if URL was already captured in last 24h (dedup via storage)
  5. Wait for DOM stability (`delayMs` + MutationObserver idle detection)
  6. Trigger capture using existing page-capturer content script
- [ ] Integrate with `CaptureTracker`: each auto-capture increments the daily count
- [ ] When daily limit reached: pause auto-capture, show critical overlay, update badge
- [ ] Resume auto-capture on day reset (midnight alarm)
- [ ] Log auto-capture events to `chrome.storage.local` for the capture history in settings
- [ ] URL dedup: store captured URLs with timestamps in `chrome.storage.local`, key `capturedUrls`
- [ ] Clean up URL dedup cache daily (remove entries older than 24h)
- [ ] Write unit tests: navigation detection, page type filtering, daily limit respect, URL dedup, DOM stability wait

**Acceptance Criteria**:
- Auto-capture is off by default (opt-in)
- Only captures page types specified in settings
- Respects daily capture limit and stops when limit reached
- Skips duplicate URLs captured in the last 24 hours
- Waits for DOM stability before capturing (no incomplete captures)
- Integrates with existing capture pipeline without modifications

**BR References**: BR-815

---

### Task E1-4: Settings UI

**Files**:
- `extension/src/popup/settings.html`
- `extension/src/popup/settings.ts`
- `extension/src/popup/settings.css`
- OR: `extension/src/sidepanel/settings-tab.ts` (if settings is a tab in the side panel)
**Tests**: `extension/tests/popup/settings.test.ts`

**Description**: Comprehensive settings interface accessible from the popup or side panel for configuring all extension preferences.

**Settings Schema**:
```typescript
interface ExtensionSettings {
  // Connection
  appUrl: string;                   // default 'http://localhost:3000'

  // Auto-Capture
  autoCaptureEnabled: boolean;      // default false
  capturePageTypes: string[];       // default ['profile']

  // Rate Limiting
  dailyCaptureWarning: number;      // default 30
  dailyCaptureLimit: number;        // default 50

  // Display
  overlayPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';  // default 'bottom-right'
  showCaptureNotification: boolean; // default true

  // Advanced
  domStabilityDelay: number;        // default 2000 (ms)
  skipDuplicateUrls: boolean;       // default true
}
```

**Sub-tasks**:
- [ ] App URL Configuration:
  - Text input with URL validation
  - "Test Connection" button that pings `{appUrl}/api/extension/health`
  - Connection status indicator: green checkmark (connected), red X (failed), spinner (testing)
  - Default: `http://localhost:3000`
- [ ] Auto-Capture Section:
  - Toggle switch with explanation text: "When enabled, the extension will automatically capture LinkedIn pages as you browse. This counts toward your daily limit."
  - Page type checkboxes: Profile, Search Results, Feed, Company Page
  - Only visible/editable when toggle is on
- [ ] Rate Limiting Section:
  - Warning threshold number input (1-100, default 30)
  - Hard limit number input (1-200, default 50)
  - Validation: warning must be <= hard limit
  - "Captures today" display: "X of Y used" with mini progress bar
- [ ] Display Section:
  - Overlay position radio buttons with position preview
  - Show capture notification toggle
- [ ] Data Management:
  - "Clear Capture Queue" button with confirmation: "This will discard X queued captures. Continue?"
  - Display queue size next to button
  - "Clear Capture History" button (clears the daily tracking data)
- [ ] Authentication:
  - "Re-register Token" button: triggers token exchange flow, shows new token status
  - Current token status: "Valid (expires in X days)" or "Expired (re-register required)"
- [ ] Extension Info:
  - Version number from manifest
  - Build date
  - "View on GitHub" link (if applicable)
- [ ] All settings stored in `chrome.storage.sync` (synced across Chrome instances)
- [ ] Settings changes take effect immediately (no restart required)
- [ ] Write unit tests: form rendering, validation, save/load, test connection, queue clear

**Acceptance Criteria**:
- All settings are editable and persist across browser restart
- URL validation prevents invalid app URLs
- Test connection provides clear success/failure feedback
- Auto-capture settings are gated behind the enable toggle
- Queue clear requires confirmation
- Token status reflects actual token validity
- Settings sync across Chrome instances via `chrome.storage.sync`

---

### Task E2-1: Retry Logic for Failed Captures

**File**: `extension/src/services/retry-manager.ts`
**Tests**: `extension/tests/services/retry-manager.test.ts`

**Description**: Implement robust retry logic for failed capture submissions with exponential backoff.

**Specification**:
```typescript
interface RetryConfig {
  maxRetries: number;              // default 3
  baseDelay: number;               // default 1000 (ms)
  maxDelay: number;                // default 30000 (ms)
  backoffMultiplier: number;       // default 2
  retryableStatuses: number[];     // [408, 429, 500, 502, 503, 504]
}

interface RetryableOperation {
  id: string;
  type: 'capture' | 'task_update' | 'registration';
  payload: unknown;
  attempt: number;
  nextRetryAt: number;             // Unix ms
  lastError: string | null;
  createdAt: number;
}
```

**Sub-tasks**:
- [ ] Create `RetryManager` class with configurable retry policy
- [ ] Implement exponential backoff: `delay = min(baseDelay * (backoffMultiplier ^ attempt), maxDelay)`
  - Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s (capped at 30s)
- [ ] Add jitter to prevent thundering herd: `delay * (0.5 + Math.random() * 0.5)`
- [ ] Determine retryability based on HTTP status code:
  - Retryable: 408 (timeout), 429 (rate limited), 500, 502, 503, 504 (server errors)
  - Not retryable: 400 (bad request), 401 (auth), 403 (forbidden), 404 (not found), 422 (validation)
- [ ] Store retry queue in `chrome.storage.local` key `retryQueue`
- [ ] Process retry queue using `chrome.alarms` API: schedule alarm for next retry time
- [ ] On service worker startup, check for pending retries and reschedule alarms
- [ ] Emit events: `onRetry(operation, attempt)`, `onRetrySuccess(operation)`, `onRetryExhausted(operation)`
- [ ] When retries exhausted (3 failures), move to dead letter queue and notify user via badge
- [ ] Dead letter queue viewable in settings (with option to retry or discard)
- [ ] Write unit tests: backoff calculation, jitter range, retryable status detection, queue persistence, alarm scheduling, dead letter queue

**Acceptance Criteria**:
- Failed captures automatically retry with exponential backoff
- Retry queue persists across service worker restarts
- Non-retryable errors fail immediately without retry
- Dead letter queue captures permanently failed operations
- User is notified of failed operations via badge

---

### Task E2-2: Queue Overflow Warning

**File**: `extension/src/services/queue-monitor.ts`
**Tests**: `extension/tests/services/queue-monitor.test.ts`

**Description**: Monitor the capture queue depth and warn the user when approaching the maximum queue size.

**Sub-tasks**:
- [ ] Create `QueueMonitor` class that watches capture queue depth in `chrome.storage.local`
- [ ] Define queue limits:
  - Warning at 40 items (80% of 50 max)
  - Critical at 50 items (queue full)
- [ ] When queue reaches warning threshold:
  - Show badge with queue count
  - Show notification: "Capture queue is filling up. X captures waiting to sync."
- [ ] When queue is full:
  - Prevent new captures (return error to content script)
  - Show critical overlay: "Capture queue full. Please check your connection to the app."
  - Badge shows "!" icon
- [ ] Monitor app connectivity: when app comes back online, queue drains automatically
- [ ] Show queue status in popup: "X captures queued" with progress indicator during drain
- [ ] Write unit tests: threshold detection, notification trigger, capture prevention at limit, drain monitoring

**Acceptance Criteria**:
- Warning appears at 80% queue capacity
- New captures are blocked when queue is full (with clear user feedback)
- Queue drains automatically when connectivity is restored
- Badge reflects queue status

---

### Task E2-3: Network Error Recovery

**Files**:
- `extension/src/services/connectivity-monitor.ts`
- Update: `extension/src/services/http-client.ts`
- Update: `extension/src/services/websocket-client.ts`
**Tests**: `extension/tests/services/connectivity-monitor.test.ts`

**Description**: Comprehensive network error recovery across HTTP and WebSocket connections.

**Sub-tasks**:
- [ ] Create `ConnectivityMonitor` class that tracks connection state to the app
- [ ] Connection states: `connected`, `reconnecting`, `offline`
- [ ] HTTP error recovery:
  - Detect connection refused, timeout, and DNS errors
  - Classify as `offline` after 3 consecutive HTTP failures
  - Periodic health check ping: `GET {appUrl}/api/extension/health` every 30 seconds when offline
  - Transition to `connected` on successful health check
- [ ] WebSocket error recovery (enhance existing auto-reconnect):
  - Exponential backoff on reconnect: 1s, 2s, 4s, 8s, 16s, 30s max
  - Jitter on reconnect delay
  - After 10 consecutive failures, transition to `offline` state
  - Resume reconnect attempts on HTTP health check success
- [ ] Graceful degradation when app is offline:
  - Queue all captures (up to queue limit)
  - Hide task list and goal display in popup/side panel (show "App offline" message)
  - Continue to function as a standalone capture tool
  - Badge indicator: orange dot for `reconnecting`, red dot for `offline`
- [ ] Flush capture queue when connectivity restores:
  - Send queued captures in order (oldest first)
  - Rate limit flush to 5 captures/second to avoid overwhelming the app
  - Show progress in popup: "Syncing X captures..."
- [ ] Log connectivity events for debugging: store last 50 events in `chrome.storage.local`
- [ ] Write unit tests: state transitions, HTTP failure detection, WebSocket reconnect, queue flush ordering, rate-limited flush

**Acceptance Criteria**:
- Extension remains functional when app is offline (capture queuing works)
- Connectivity state is accurately detected and displayed
- WebSocket reconnects with exponential backoff
- Queued captures sync in order when connectivity restores
- No data loss during offline periods (up to queue limit)

---

### Task E2-4: Extension Icons

**Files**:
- `extension/icons/icon-16.png`
- `extension/icons/icon-48.png`
- `extension/icons/icon-128.png`
- `extension/icons/icon-16-inactive.png`
- `extension/icons/icon-48-inactive.png`
- `extension/icons/icon-128-inactive.png`
**Tests**: Manual visual testing

**Description**: Create production-quality extension icons at all required sizes.

**Sub-tasks**:
- [ ] Design or source a clean, recognizable icon representing network intelligence
  - Primary concept: stylized network graph node or connection icon
  - Must be legible at 16x16px
  - Color palette aligned with app brand colors
- [ ] Generate icons at required sizes:
  - 16x16px: toolbar icon (must be clear and recognizable at this tiny size)
  - 48x48px: extension management page icon
  - 128x128px: Chrome Web Store icon and installation dialog
- [ ] Create inactive/grayscale variants for each size (used when extension is disconnected)
- [ ] Update `manifest.json` to reference new icon paths:
  ```json
  {
    "icons": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    },
    "action": {
      "default_icon": {
        "16": "icons/icon-16.png",
        "48": "icons/icon-48.png"
      }
    }
  }
  ```
- [ ] Implement dynamic icon switching in service worker: active icon when connected, inactive icon when disconnected
  - `chrome.action.setIcon({ path: { '16': 'icons/icon-16-inactive.png', '48': 'icons/icon-48-inactive.png' } })`
- [ ] Verify icons render correctly on both light and dark Chrome themes

**Acceptance Criteria**:
- Icons are crisp and recognizable at all sizes
- Inactive variants are clearly distinguishable from active
- Icons switch dynamically based on connection state
- Icons work on both light and dark Chrome toolbar themes

---

### Task E2-5: Popup and Side Panel Styling

**Files**:
- `extension/src/popup/popup.css`
- `extension/src/sidepanel/sidepanel.css`
- `extension/src/popup/popup.html`
- `extension/src/sidepanel/sidepanel.html`
**Tests**: Manual visual testing + snapshot tests

**Description**: Achieve visual consistency between popup, side panel, and the main app. Apply production-grade styling throughout.

**Sub-tasks**:
- [ ] Align typography with app (font-family, sizes, weights):
  - Use Inter or system font stack matching the Next.js app
  - Consistent heading sizes: h1=24px, h2=20px, h3=16px, body=14px, caption=12px
- [ ] Align color palette with app:
  - Primary: app brand color
  - Tier colors: gold=#F59E0B, silver=#9CA3AF, bronze=#D97706, watch=#6B7280
  - Status colors: success=#10B981, warning=#F59E0B, error=#EF4444, info=#3B82F6
- [ ] Popup styling (400x500px max):
  - Header: extension name + connection indicator + settings gear icon
  - Capture button: prominent, full-width, with page type indicator
  - Task list: compact cards with priority indicator, truncated title, status badge
  - Template section: collapsible, shows selected template name
  - Footer: "Open App" link + version number
- [ ] Side panel styling (300px width):
  - Goal progress: horizontal progress bars with percentage labels
  - Task list: full task cards with action buttons (complete, skip, dismiss)
  - Current page info: detected page type, capture availability
  - Template display: full template text with copy button
- [ ] Consistent spacing: 4px grid system (4, 8, 12, 16, 20, 24px)
- [ ] Consistent border radius: 6px for cards, 4px for inputs, 9999px for pills
- [ ] Dark mode support: detect `prefers-color-scheme: dark` and adjust colors
- [ ] Smooth transitions: 150ms ease for hover states, 200ms for visibility transitions
- [ ] Write snapshot tests for popup and side panel rendered states

**Acceptance Criteria**:
- Popup and side panel look like they belong to the same product as the app
- Typography, colors, and spacing are consistent
- Dark mode renders correctly
- No scrollbar jitter or layout shifts
- Popup fits within 400x500px Chrome popup constraints

---

### Task E2-6: Loading States for All Async Operations

**Files**: Updates across all popup and side panel TypeScript files
**Tests**: `extension/tests/ui/loading-states.test.ts`

**Description**: Add proper loading states for every asynchronous operation in the extension UI.

**Sub-tasks**:
- [ ] Capture button loading state:
  - Button shows spinner during capture
  - Button text changes: "Capture" -> "Capturing..." -> "Captured!" (then reset after 2s)
  - Disable button during capture to prevent double-clicks
- [ ] Task list loading state:
  - Show 3 skeleton rows while loading tasks from app
  - Error state: "Couldn't load tasks. Check connection."
  - Empty state: "No tasks right now. You're all caught up!"
- [ ] Goal progress loading state:
  - Show skeleton progress bars while loading
  - Error state: "Couldn't load goals."
  - Empty state: "No active goals. Open the app to create one."
- [ ] Template loading state:
  - Show skeleton text block while loading
  - Error state: "Couldn't load template. Check connection."
  - Empty state: "No template selected for this contact."
- [ ] Connection check loading state:
  - Settings "Test Connection": button shows spinner, then green checkmark or red X
- [ ] Queue sync loading state:
  - During queue flush: progress indicator "Syncing 3/10 captures..."
- [ ] Registration flow loading state:
  - "Registering..." spinner during token exchange
  - Success: "Connected!" with green checkmark
  - Failure: "Registration failed. Check the app URL." with retry button
- [ ] Write unit tests: each loading state renders correctly, transitions between states work

**Acceptance Criteria**:
- Every async operation shows visual loading feedback
- No blank/flickering UI during data fetching
- Error states provide actionable guidance
- Empty states are descriptive and helpful
- Loading indicators are consistent in style across all UI surfaces

---

### Task E2-7: Empty States for All Data Displays

**Files**: Updates across all popup and side panel TypeScript files
**Tests**: `extension/tests/ui/empty-states.test.ts`

**Description**: Add meaningful empty states for every data display in the extension.

**Sub-tasks**:
- [ ] No tasks empty state:
  - Icon: checkmark in circle
  - Message: "All caught up! No tasks to do."
  - Sub-message: "Tasks are created automatically as you capture contacts."
- [ ] No goals empty state:
  - Icon: target
  - Message: "No active goals"
  - Sub-message: "Open the app to let Claude analyze your network and suggest goals."
  - CTA: "Open App" button
- [ ] No template empty state:
  - Icon: message bubble
  - Message: "No template for this contact"
  - Sub-message: "Navigate to a contact's profile to see outreach templates."
- [ ] No capture history empty state (in settings):
  - Icon: camera
  - Message: "No captures yet today"
  - Sub-message: "Visit a LinkedIn page and click Capture to get started."
- [ ] Disconnected state (replaces all data):
  - Icon: WiFi off
  - Message: "Not connected to app"
  - Sub-message: "Make sure the app is running at {appUrl}"
  - CTA: "Test Connection" button
- [ ] Write unit tests: each empty state renders with correct message and CTA

**Acceptance Criteria**:
- Every data display has a designed empty state (no blank sections)
- Empty states provide context about what should appear there
- CTAs guide users toward resolution
- Disconnected state replaces all data displays consistently

---

## Orchestrator Instructions

### Execution Strategy

1. **Spawn 2 agents** (E1 and E2) in parallel at phase start
2. Agent E1 (Rate + Settings): Start with daily capture tracking (E1-1), then rate overlay (E1-2), then auto-capture (E1-3), then settings UI (E1-4). E1-2 and E1-3 depend on E1-1. E1-4 depends on all three.
3. Agent E2 (Polish): Start with retry logic (E2-1) and icons (E2-4) in parallel, then queue monitor (E2-2), connectivity (E2-3), styling (E2-5), loading states (E2-6), empty states (E2-7).
4. Each agent should:
   a. Read existing extension code before modifying (understand current architecture)
   b. Follow existing patterns in service worker message routing
   c. Use `chrome.storage.local` for per-device data, `chrome.storage.sync` for settings
   d. Use `chrome.alarms` API for scheduled tasks (service worker may be killed)
   e. Write unit tests for all services
   f. Run extension build and verify loading in Chrome after changes

### Shared Patterns

All extension services must follow these patterns:

```typescript
// Service class with chrome.storage
export class CaptureTracker {
  private static STORAGE_KEY = 'captureData';

  async increment(url: string, pageType: string, success: boolean): Promise<void> {
    const today = this.getTodayKey();
    const data = await this.getStorageData(today);
    data.count += 1;
    data.captures.push({ timestamp: Date.now(), url, pageType, success });
    await chrome.storage.local.set({ [today]: data });
  }

  private getTodayKey(): string {
    const now = new Date();
    return `captureData_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private async getStorageData(key: string): Promise<DailyCaptureData> {
    const result = await chrome.storage.local.get(key);
    return result[key] || { date: key, count: 0, captures: [] };
  }
}
```

```typescript
// Content script with Shadow DOM
export function createOverlay(container: HTMLElement): ShadowRoot {
  const host = document.createElement('div');
  host.id = 'li-prospector-overlay';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `/* Isolated CSS */`;
  shadow.appendChild(style);

  container.appendChild(host);
  return shadow;
}
```

```typescript
// Exponential backoff
function getRetryDelay(attempt: number, config: RetryConfig): number {
  const delay = Math.min(
    config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelay
  );
  // Add jitter: 50-100% of calculated delay
  return delay * (0.5 + Math.random() * 0.5);
}
```

### Testing Requirements

For each service/component, write tests covering:
- Core functionality with normal inputs
- Edge cases (midnight rollover, empty storage, max values)
- Error handling (storage failures, network errors)
- Chrome API mocking (use `jest-chrome` or manual mocks for `chrome.storage`, `chrome.alarms`, `chrome.action`)
- State transitions (connected -> disconnected -> reconnecting)

Test files:
- `extension/tests/services/capture-tracker.test.ts`
- `extension/tests/content/rate-overlay.test.ts`
- `extension/tests/services/auto-capture.test.ts`
- `extension/tests/popup/settings.test.ts`
- `extension/tests/services/retry-manager.test.ts`
- `extension/tests/services/queue-monitor.test.ts`
- `extension/tests/services/connectivity-monitor.test.ts`
- `extension/tests/ui/loading-states.test.ts`
- `extension/tests/ui/empty-states.test.ts`

### Build Verification

After all changes:
```bash
cd extension && npm run build
```

Verify:
- Extension loads in Chrome without errors
- `chrome://extensions` shows no warnings
- Manifest is valid
- All content scripts inject correctly on LinkedIn pages
- Service worker starts and registers alarms

---

## Dependencies

### Upstream (required before this work)

| Dependency | Source | Status |
|---|---|---|
| Extension Phase 4 complete (all core functionality) | Phase 4 Extension | Must pass Phase 4 gate |
| Extension Phase 5 complete (templates, clipboard) | Phase 5 Extension | Must pass Phase 5 gate |
| Token rotation endpoint | Phase 6 Backend (B3-3) | Concurrent -- mock until available |
| Extension health endpoint | Phase 4 App | Must pass Phase 4 gate |
| Extension settings endpoint | Phase 4 App | Must pass Phase 4 gate |

### Downstream (blocks these)

| Dependent | Domain | Blocked Tasks |
|---|---|---|
| Final integration testing | QA | Extension polish must be complete for end-to-end testing |
| App extension management page (A4-2) | App | Extension settings format must be finalized |

### Mitigation

Both extension agents work on existing extension code from Phases 4-5. The only external dependency is the token rotation endpoint from Phase 6 Backend (B3-3). Mock the token rotation response initially; switch to real endpoint when available. All other dependencies are on extension code that already exists.

---

## Gate Criteria

All of the following must pass before Phase 6 Extension is considered complete:

### Daily Capture Tracking
- [ ] Capture count increments on each capture (manual and auto)
- [ ] Count resets at midnight local time via chrome.alarms
- [ ] Historical data retained for 7 days, older data cleaned up
- [ ] Thresholds configurable via settings

### Rate Awareness
- [ ] Info overlay appears at 50% of warning threshold
- [ ] Warning overlay appears at 80% of warning threshold (amber)
- [ ] Critical overlay appears at 100% of hard limit (red, persists)
- [ ] Overlay uses Shadow DOM (no CSS conflicts with LinkedIn)
- [ ] Overlay position configurable

### Auto-Capture
- [ ] Auto-capture is off by default
- [ ] When enabled, captures on LinkedIn navigation after DOM stability
- [ ] Respects page type filter (only captures configured types)
- [ ] Respects daily capture limit (pauses at limit)
- [ ] Skips duplicate URLs captured in last 24 hours
- [ ] Integrates with capture tracker (counts toward daily limit)

### Settings UI
- [ ] App URL configurable with test connection
- [ ] Auto-capture toggle with page type selection
- [ ] Capture limit thresholds configurable
- [ ] Overlay position selectable
- [ ] Clear queue button with confirmation
- [ ] Token re-registration button
- [ ] Extension version displayed
- [ ] All settings persist via chrome.storage.sync

### Error Handling
- [ ] Failed captures retry 3 times with exponential backoff (1s, 2s, 4s)
- [ ] Non-retryable errors fail immediately (400, 401, 404)
- [ ] Dead letter queue captures exhausted retries
- [ ] Queue overflow warning at 80% capacity
- [ ] New captures blocked at 100% queue capacity with user feedback
- [ ] Network error recovery detects offline state after 3 consecutive failures
- [ ] WebSocket reconnects with exponential backoff
- [ ] Queued captures sync in order when connectivity restores
- [ ] Rate-limited flush (5/second) prevents overwhelming app on reconnect

### Visual Polish
- [ ] Extension icons at 16, 48, 128px (active and inactive variants)
- [ ] Icons switch dynamically based on connection state
- [ ] Popup and side panel typography matches app
- [ ] Color palette consistent with app
- [ ] Dark mode supported
- [ ] Consistent spacing on 4px grid

### Loading and Empty States
- [ ] Every async operation shows loading indicator
- [ ] Capture button shows spinner during capture
- [ ] Task/goal/template loading shows skeletons
- [ ] Every data display has a meaningful empty state
- [ ] Disconnected state replaces all data displays
- [ ] Error states provide actionable guidance

### Quality
- [ ] All service tests pass
- [ ] Extension builds without errors
- [ ] Extension loads in Chrome without console errors
- [ ] Manifest is valid (no warnings on `chrome://extensions`)
- [ ] Content scripts inject only on LinkedIn domains

### Production Readiness
- [ ] No hardcoded URLs (all configurable via settings)
- [ ] No console.log statements in production build (use structured logging)
- [ ] chrome.storage usage within quota limits (< 5MB local, < 100KB sync)
- [ ] Service worker handles restart gracefully (alarms, retry queue, connection state restored)
- [ ] Extension functions correctly in offline mode (capture queuing only)
- [ ] All Chrome APIs used have appropriate permissions declared in manifest.json
- [ ] Extension is ready for Chrome Web Store submission (icons, description, permissions justified)
