# Phase 5: Intelligence -- Extension Plan (Weeks 17-20)

## Objective

Extend the Chrome extension with outreach template display, clipboard copy workflows, and template selection UI. The extension becomes the delivery mechanism for Claude-personalized messages: users browse LinkedIn profiles, the extension fetches the right template, and users copy the message directly into LinkedIn's messaging interface. All template content comes from the app's API; the extension is a thin rendering and clipboard layer.

## Prerequisites (Phases 1-4 Complete)

| Phase | Required Artifact | Status Gate |
|-------|-------------------|-------------|
| 4 | Extension loads in Chrome (sideloaded) | `chrome://extensions` shows it active |
| 4 | Service worker: HTTP client operational | Extension makes authenticated API calls |
| 4 | Service worker: WebSocket client connected | Extension receives push events from app |
| 4 | Popup: renders with capture button and task list | Popup opens with functional UI |
| 4 | Side panel: renders with goal progress and task list | Side panel opens with functional UI |
| 4 | `chrome.storage.local` stores auth token | Token persists across restarts |
| 4 | URL detection in content script (`page-capturer.ts`) | Extension knows current LinkedIn page type |
| 5-App | `GET /api/outreach/templates` returns templates | Templates API operational |
| 5-App | `POST /api/outreach/render` returns personalized message | Render API operational |
| 5-App | `GET /api/tasks/extension` returns extension-formatted tasks | Tasks API operational |
| 5-App | WebSocket `TEMPLATE_READY` event defined | App pushes template notifications |

## Parallel Agent Assignments

| Agent | Role | Primary Files | Estimated Effort |
|-------|------|---------------|------------------|
| Agent E1 | Template Display + Clipboard | `extension/src/popup/TemplateSection.tsx`, `extension/src/sidepanel/TemplatePanel.tsx`, `extension/src/shared/clipboard.ts`, `extension/src/shared/template-api.ts` | 3-4 days |

**Single agent note**: Phase 5 extension work is focused and cohesive -- one agent handles all template display, selection, and clipboard functionality. The work is small enough that splitting across agents would add coordination overhead without benefit.

---

## Detailed Task Checklist

### Task E5-1: Template API Client

**BR Reference**: BR-807
**File**: `extension/src/shared/template-api.ts`
**Agent**: E1

- [ ] Create `TemplateApiClient` class wrapping the extension's HTTP client:
  ```typescript
  class TemplateApiClient {
    constructor(private httpClient: ExtensionHttpClient) {}

    /**
     * Fetch available templates for a contact on a specific LinkedIn profile URL.
     * @param contactUrl - LinkedIn profile URL (e.g., https://linkedin.com/in/john-doe)
     * @param type - Optional filter by template category
     * @returns Array of templates with preview text
     */
    async getTemplates(
      contactUrl: string,
      type?: TemplateCategory
    ): Promise<ExtensionTemplate[]>;

    /**
     * Render a specific template for a contact, returning the personalized message.
     * @param templateId - Template UUID
     * @param contactUrl - LinkedIn profile URL (used to resolve contact_id on server)
     * @returns Rendered message text with metadata
     */
    async renderTemplate(
      templateId: string,
      contactUrl: string
    ): Promise<RenderedMessage>;

    /**
     * Get the recommended template for the current contact based on outreach state.
     * @param contactUrl - LinkedIn profile URL
     * @returns Single best template recommendation
     */
    async getRecommendedTemplate(
      contactUrl: string
    ): Promise<ExtensionTemplate | null>;
  }
  ```

- [ ] Extension-specific types:
  ```typescript
  interface ExtensionTemplate {
    id: string;
    name: string;
    category: TemplateCategory;
    channel: string;
    preview: string;             // first 80 chars of rendered body
    charCount: number;
    isRecommended: boolean;
  }

  interface RenderedMessage {
    text: string;
    charCount: number;
    charLimit: number;
    personalizationScore: number;
    templateName: string;
    contactName: string;
  }
  ```

- [ ] API endpoint mapping:
  - `getTemplates()` -> `GET /api/extension/templates?contactUrl={url}&type={type}`
    - Note: the app resolves `contactUrl` to `contact_id` internally
  - `renderTemplate()` -> `POST /api/outreach/render` with `{ template_id, contact_url }`
    - App resolves contact_url -> contact_id, then renders
  - `getRecommendedTemplate()` -> `GET /api/extension/templates?contactUrl={url}&recommended=true`

- [ ] Caching strategy:
  - Cache templates per contact URL for 5 minutes in `chrome.storage.session`
  - Cache rendered messages until contact URL changes
  - Invalidate cache on `TEMPLATE_READY` WebSocket event
  - Cache key format: `tpl:{contactUrl}:{type}` and `rendered:{templateId}:{contactUrl}`

- [ ] Error handling:
  - Network failure: show cached template if available, else "Templates unavailable offline"
  - 404 (contact not found): show "Import this contact first" message
  - 429 (rate limited): show "Too many requests, try again shortly"
  - 500 (server error): show "Template service error" with retry button

**Acceptance Criteria**:
- `getTemplates()` returns templates for a known contact URL
- `renderTemplate()` returns personalized message text
- `getRecommendedTemplate()` returns the top suggestion
- Templates are cached for 5 minutes and invalidated on WebSocket event
- Error states show user-friendly messages in the extension UI
- API calls include the extension auth token in headers

---

### Task E5-2: Clipboard Utility

**BR Reference**: BR-807
**File**: `extension/src/shared/clipboard.ts`
**Agent**: E1

- [ ] Create clipboard utility with extension-context handling:
  ```typescript
  /**
   * Copy text to the system clipboard.
   * Handles both standard web contexts and Chrome extension restricted contexts
   * where navigator.clipboard may not be available.
   *
   * @param text - The text to copy to clipboard
   * @returns true if copy succeeded, false otherwise
   */
  async function copyToClipboard(text: string): Promise<boolean> {
    // Strategy 1: navigator.clipboard API (works in most contexts)
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('navigator.clipboard.writeText failed, trying fallback', err);
      }
    }

    // Strategy 2: document.execCommand('copy') fallback
    // Required for Chrome extension popup/sidepanel contexts where
    // navigator.clipboard is restricted
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      // Position off-screen to prevent visual flash
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (err) {
      console.error('Fallback clipboard copy failed', err);
      return false;
    }
  }

  /**
   * Read text from the system clipboard.
   * Used for detecting if user has pasted and confirming send.
   */
  async function readFromClipboard(): Promise<string | null> {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        return await navigator.clipboard.readText();
      }
    } catch {
      // Clipboard read often restricted in extension contexts
    }
    return null;
  }
  ```

- [ ] Clipboard event wrapper for UI components:
  ```typescript
  interface ClipboardResult {
    success: boolean;
    method: 'clipboard-api' | 'execCommand' | 'failed';
    charsCopied: number;
  }

  /**
   * Copy message to clipboard and return result for UI feedback.
   */
  async function copyMessage(message: RenderedMessage): Promise<ClipboardResult>;
  ```

- [ ] Extension permission verification:
  - Check if `clipboardWrite` permission is granted (declared in manifest.json)
  - If not, guide user to grant permission
  - Manifest V3 permissions needed: `"permissions": ["clipboardWrite"]`

**Acceptance Criteria**:
- `copyToClipboard()` works in Chrome extension popup context
- `copyToClipboard()` works in Chrome extension side panel context
- Fallback `execCommand` method works when `navigator.clipboard` is restricted
- `ClipboardResult` correctly reports which method was used
- No visual flash from the fallback textarea method

---

### Task E5-3: Popup Template Section

**BR Reference**: BR-807
**File**: `extension/src/popup/TemplateSection.tsx`
**Agent**: E1

- [ ] Template section in popup (displayed when user is on a LinkedIn profile page):
  ```
  +-- Popup (320px wide) ----------------------+
  | [Connection Status: Connected]              |
  | [Capture Button]                            |
  |                                             |
  | --- Templates for John Doe ---              |
  | +----------------------------------------+ |
  | | Recommended: Connection Request         | |
  | | "Hi John, I noticed we're both..."      | |
  | | [Copy to Clipboard]                     | |
  | +----------------------------------------+ |
  | | Follow-up                               | |
  | | "Hi John, thanks for connecting..."     | |
  | | [Copy]                                  | |
  | +----------------------------------------+ |
  | | Meeting Request                         | |
  | | "Hi John, I'd love to chat about..."   | |
  | | [Copy]                                  | |
  | +----------------------------------------+ |
  |                                             |
  | [Next Template >>]                          |
  +---------------------------------------------+
  ```

- [ ] Component structure:
  ```typescript
  interface TemplateSectionProps {
    contactUrl: string;           // current LinkedIn profile URL
    contactName: string;          // extracted from page
    isProfilePage: boolean;       // only show on profile pages
  }

  function TemplateSection({ contactUrl, contactName, isProfilePage }: TemplateSectionProps) {
    // Only render on profile pages
    if (!isProfilePage) return null;

    const [templates, setTemplates] = useState<ExtensionTemplate[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [renderedMessage, setRenderedMessage] = useState<RenderedMessage | null>(null);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
    const [loading, setLoading] = useState(true);

    // Fetch templates on mount / URL change
    // Render selected template on selection change
    // ...
  }
  ```

- [ ] Behavior:
  - On popup open (profile page): fetch templates for current contact URL
  - Show loading skeleton while fetching
  - Display recommended template first (pre-rendered)
  - Show other templates with preview text (first 80 chars)
  - Clicking "Copy to Clipboard" on any template:
    1. If not yet rendered: call `renderTemplate()` first, show brief loading
    2. Copy rendered text to clipboard
    3. Show "Copied!" state for 2 seconds
    4. After copy: show subtle prompt "Mark as sent?" (transitions outreach state)
  - "Next Template" button: cycles `selectedIndex` through alternatives
  - If contact not in database: show "Import this contact to get templates"
  - If no templates available: show "No templates configured" with link to app

- [ ] Contact URL detection:
  - Receive `contactUrl` from the popup's existing URL detection logic (Phase 4)
  - URL format: `https://www.linkedin.com/in/{slug}/`
  - Extract `contactName` from page title or existing capture data

**Acceptance Criteria**:
- Template section appears only on LinkedIn profile pages
- Templates load within 2s of popup opening
- Recommended template is highlighted and shown first
- Copy button copies rendered message to clipboard
- "Copied!" feedback shows for 2s then reverts
- "Next Template" cycles through available templates
- Non-profile pages show no template section
- Unknown contacts show import prompt

---

### Task E5-4: Side Panel Template Panel

**BR Reference**: BR-807
**File**: `extension/src/sidepanel/TemplatePanel.tsx`
**Agent**: E1

- [ ] Full template section in side panel (more space than popup):
  ```
  +-- Side Panel (400px wide) ----------------------+
  | [Goal Progress Section - from Phase 4]           |
  | [Task List Section - from Phase 4]               |
  |                                                  |
  | === Message Templates ===                        |
  | Contact: John Doe - VP Engineering at Acme       |
  | Outreach State: Planned                          |
  |                                                  |
  | +-- Recommended Template -----------------+      |
  | | Connection Request                       |      |
  | | Category: connection-request             |      |
  | | Channel: LinkedIn Connection             |      |
  | | Chars: 245 / 300                         |      |
  | |                                          |      |
  | | +-- Message Preview ----------------+   |      |
  | | | Hi John, I noticed we're both in  |   |      |
  | | | the SaaS infrastructure space and |   |      |
  | | | share a connection with Sarah Chen.|  |      |
  | | | Your recent post about cloud costs|   |      |
  | | | resonated with me - we've been    |   |      |
  | | | tackling similar challenges.      |   |      |
  | | | Would love to connect!            |   |      |
  | | +-----------------------------------+   |      |
  | |                                          |      |
  | | Personalization: 78/100                  |      |
  | | [Copy to Clipboard] [Mark as Sent]       |      |
  | +------------------------------------------+     |
  |                                                  |
  | +-- Other Templates -----------------------+     |
  | | [Follow-up] "Hi John, thanks for..."  [Copy] | |
  | | [Meeting]   "Hi John, I'd love to..." [Copy] | |
  | | [Value-add] "Hi John, saw your post..." [Copy]| |
  | +----------------------------------------------+ |
  |                                                  |
  | [<< Prev Template]  [Next Template >>]           |
  +--------------------------------------------------+
  ```

- [ ] Extended features vs popup:
  - Full rendered message display (not just preview)
  - Personalization score with visual indicator
  - Character count with limit bar (turns red when over limit)
  - "Mark as Sent" button (calls `PATCH /api/outreach/states/:id` to transition planned -> sent)
  - Outreach state display for current contact
  - Contact metadata header (name, role, company, tier badge)
  - Template category and channel labels

- [ ] Component structure:
  ```typescript
  interface TemplatePanelProps {
    contactUrl: string;
    contactName: string;
    contactMetadata?: {
      role: string;
      company: string;
      tier: string;
      outreachState?: OutreachState;
    };
    isProfilePage: boolean;
  }
  ```

- [ ] "Mark as Sent" flow:
  1. User clicks "Mark as Sent" after copying
  2. Confirmation dialog: "Mark outreach to {name} as sent?"
  3. On confirm: `PATCH /api/outreach/states/:id` with `{ to_state: 'sent', metadata: { template_id, triggered_by: 'extension' } }`
  4. Update outreach state display in panel
  5. Toast: "Outreach marked as sent"

- [ ] Template navigation:
  - Prev/Next buttons cycle through all available templates
  - Each switch triggers a new render call
  - Loading state between template switches (skeleton for message preview area)

**Acceptance Criteria**:
- Full message preview renders in side panel
- Personalization score is displayed
- Character count shows current/limit with visual indicator
- "Mark as Sent" transitions outreach state and updates UI
- Prev/Next navigation cycles through templates with re-rendering
- Contact metadata header shows name, role, company, tier
- Panel handles missing data gracefully (no crash on null enrichment)

---

### Task E5-5: WebSocket Template Events

**BR Reference**: BR-807
**File**: `extension/src/shared/websocket-handlers.ts` (extend existing)
**Agent**: E1

- [ ] Add `TEMPLATE_READY` event handler to existing WebSocket client:
  ```typescript
  interface TemplateReadyEvent {
    type: 'TEMPLATE_READY';
    payload: {
      contactUrl: string;
      contactName: string;
      templateId: string;
      templateName: string;
      category: TemplateCategory;
    };
  }
  ```

- [ ] On `TEMPLATE_READY` event:
  1. Update extension badge:
     - Set badge text to "T" (for template)
     - Set badge background color to green
     - Badge clears after user opens popup/panel or after 30 seconds
  2. Show browser notification (if user has granted notification permission):
     ```typescript
     chrome.notifications.create(`template-${payload.templateId}`, {
       type: 'basic',
       iconUrl: 'icons/icon-48.png',
       title: 'Template Ready',
       message: `${payload.templateName} ready for ${payload.contactName}`,
       buttons: [{ title: 'View' }],
     });
     ```
  3. Invalidate template cache for this contact URL:
     ```typescript
     await chrome.storage.session.remove(`tpl:${payload.contactUrl}:*`);
     await chrome.storage.session.remove(`rendered:*:${payload.contactUrl}`);
     ```
  4. If popup or side panel is open and showing this contact: auto-refresh templates

- [ ] Notification click handler:
  - Clicking notification opens the side panel
  - Side panel auto-navigates to the template section for the relevant contact

- [ ] Event deduplication:
  - If same `templateId + contactUrl` event received within 60 seconds, ignore duplicate
  - Track recent events in memory (service worker) with TTL

**Acceptance Criteria**:
- Badge shows "T" indicator when template becomes available
- Badge clears after 30 seconds or when popup/panel opened
- Browser notification appears with template name and contact name
- Cache invalidation triggers fresh template fetch on next popup/panel open
- Duplicate events within 60 seconds are suppressed
- Notification click opens side panel

---

### Task E5-6: Template Section Integration with Existing Extension UI

**BR Reference**: BR-807
**File**: `extension/src/popup/Popup.tsx` (modify), `extension/src/sidepanel/SidePanel.tsx` (modify)
**Agent**: E1

- [ ] Integrate `TemplateSection` into existing popup layout:
  - Add below the task list section
  - Only show when `isProfilePage === true`
  - Popup URL detection (from Phase 4) determines `isProfilePage` and extracts `contactUrl`
  - Smooth section transition: slide in when navigating to a profile page

- [ ] Integrate `TemplatePanel` into existing side panel layout:
  - Add as a new collapsible section below task list
  - Section header: "Message Templates" with expand/collapse toggle
  - Default: expanded on profile pages, collapsed on other pages
  - Pass contact metadata from existing side panel data (Phase 4 already fetches contact info)

- [ ] Manifest V3 permission additions:
  ```json
  {
    "permissions": [
      "clipboardWrite",
      "notifications"
    ]
  }
  ```
  - Verify `clipboardWrite` works in both popup and side panel contexts
  - Verify `notifications` permission allows `chrome.notifications.create()`

- [ ] Keyboard shortcut for clipboard copy:
  - `Ctrl+Shift+C` (or `Cmd+Shift+C` on Mac) copies the recommended template
  - Shortcut registered in manifest: `"commands": { "copy-template": { ... } }`
  - Service worker listens for command and triggers copy flow
  - Note: keyboard shortcut requires content script cooperation to access clipboard

**Acceptance Criteria**:
- Popup shows template section on profile pages, hides on non-profile pages
- Side panel shows collapsible template section
- `clipboardWrite` permission granted and functional
- Notification permission requested on first use (not forced)
- Keyboard shortcut copies recommended template when on a profile page
- Extension builds and loads without permission errors

---

## Orchestrator Instructions

### Spawn Order

```
[Single Agent - Sequential within agent, no inter-agent coordination needed]:
  Agent E1: Template Display + Clipboard (Tasks E5-1 through E5-6)
```

### Recommended Task Order (within Agent E1)

Agent E1 should follow this sequence for optimal flow:

1. **E5-1: Template API Client** -- foundation for all other tasks
2. **E5-2: Clipboard Utility** -- standalone utility, no UI dependency
3. **E5-3: Popup Template Section** -- first UI integration
4. **E5-4: Side Panel Template Panel** -- builds on popup learnings, richer UI
5. **E5-5: WebSocket Template Events** -- extends existing WebSocket handlers
6. **E5-6: Integration + Permissions** -- final wiring into existing extension

### Testing Strategy

1. **Unit tests** (in `extension/tests/`):
   - `template-api.test.ts`: Mock HTTP responses, verify caching behavior
   - `clipboard.test.ts`: Test both clipboard strategies (mock `navigator.clipboard`)
   - `websocket-handlers.test.ts`: Test `TEMPLATE_READY` event processing

2. **Manual testing checklist** (no automated E2E for extension):
   - [ ] Open popup on LinkedIn profile -> templates load
   - [ ] Open popup on LinkedIn feed -> no template section
   - [ ] Click "Copy" in popup -> message copied to clipboard
   - [ ] Paste into LinkedIn message box -> message appears correctly
   - [ ] Open side panel on profile -> full template panel renders
   - [ ] Click "Mark as Sent" in side panel -> state transitions
   - [ ] Receive TEMPLATE_READY WebSocket -> badge appears
   - [ ] Click notification -> side panel opens to templates
   - [ ] Disconnect app -> templates show "unavailable offline"
   - [ ] Reconnect app -> templates refresh automatically

3. **Build verification**:
   ```bash
   cd extension && npm run build
   # Load unpacked extension in chrome://extensions
   # Verify no console errors on any LinkedIn page
   ```

### Integration with App Phase 5

- Extension template work depends on App Agent A4 completing outreach API routes
- Extension can start with mock API responses and swap to real endpoints
- Template API contract (request/response shapes) must be agreed with App team before coding
- WebSocket event shape must be agreed with Backend team (B1)

---

## Dependencies

### Upstream (this phase needs)

| Dependency | Source | Status Check |
|------------|--------|--------------|
| Extension project builds and loads | Phase 4 | `npm run build` succeeds, extension loads in Chrome |
| HTTP client in service worker | Phase 4 | `ExtensionHttpClient` class exists and makes authenticated calls |
| WebSocket client with auto-reconnect | Phase 4 | WebSocket connects to `/ws/extension` |
| URL detection in content script | Phase 4 | `isProfilePage()` correctly identifies LinkedIn profile URLs |
| Popup and side panel render | Phase 4 | Both open without errors |
| `GET /api/extension/templates` endpoint | Phase 5 App (Agent A4) | Returns template list for contact URL |
| `POST /api/outreach/render` endpoint | Phase 5 App (Agent A4) | Returns rendered message for template + contact |
| `PATCH /api/outreach/states/:id` endpoint | Phase 5 App (Agent A4) | Transitions outreach state |
| `TEMPLATE_READY` WebSocket event | Phase 5 Backend (Agent B1) / App (Agent A4) | App pushes event on template generation |
| `clipboardWrite` permission in manifest | Phase 5 Extension (this plan) | Added to manifest.json |

### Downstream (Phase 6 needs from this)

| Consumer | What They Need | Interface |
|----------|---------------|-----------|
| Phase 6: Auto-capture | Template section coexists with auto-capture toggle | Popup/panel layout |
| Phase 6: Rate awareness | Rate warning overlays don't conflict with template display | Content script coordination |
| Phase 6: Settings UI | Settings page includes template preferences (default category, auto-render) | Settings storage in `chrome.storage.local` |

---

## Gate Criteria

- [ ] Extension popup shows templates when viewing a LinkedIn profile page
- [ ] Extension popup hides template section on non-profile pages (feed, search, messaging)
- [ ] "Copy to Clipboard" copies the rendered message text in popup context
- [ ] "Copy to Clipboard" copies the rendered message text in side panel context
- [ ] Pasting copied text into a LinkedIn message box produces the correct message
- [ ] Side panel shows full rendered message with personalization score and character count
- [ ] "Mark as Sent" in side panel transitions outreach state from planned to sent
- [ ] Template selection shows available categories: Connection Request, Follow-up, Meeting Request (minimum)
- [ ] "Next Template" cycles through available templates and re-renders each
- [ ] WebSocket `TEMPLATE_READY` event triggers badge update ("T" indicator)
- [ ] Badge clears after popup/panel opened or after 30-second timeout
- [ ] Browser notification appears on `TEMPLATE_READY` with correct contact name
- [ ] Templates are cached for 5 minutes and refresh on WebSocket invalidation
- [ ] Contact not in database shows "Import this contact first" message
- [ ] App offline shows "Templates unavailable offline" message
- [ ] Extension builds without errors: `cd extension && npm run build` succeeds
- [ ] No console errors when navigating LinkedIn with extension active
- [ ] Keyboard shortcut `Ctrl+Shift+C` copies recommended template on profile pages
