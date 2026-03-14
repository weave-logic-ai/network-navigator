# Phase 3: App UI -- Extension Domain Plan (Weeks 9-12)

## Status: No Extension Work in Phase 3

There is no extension development work in Phase 3. The Chrome extension domain is inactive during Weeks 9-12.

## Rationale

Phase 3 focuses exclusively on the App UI build and supporting Backend API endpoints. The extension:

- Was scaffolded in Phase 1 (project structure, Manifest V3, TypeScript, esbuild build chain, shared types)
- Has no deliverables until Phase 4 (Weeks 13-16), when content scripts, service worker, popup, side panel, and capture logic are built
- Does not block any Phase 3 work -- all App UI components use direct API calls, not extension data

## Phase 4 Preview

The following extension work is planned for Phase 4: Chrome Extension (Weeks 13-16):

| Task Area | Description | Agent Count |
|---|---|---|
| Content Scripts | page-capturer.ts (URL detection + outerHTML capture), overlay.ts (capture status display) | 2 |
| Service Worker | Message routing, HTTP client, capture queue, WebSocket client with auto-reconnect | 2 |
| Popup | Capture button, connection status, top tasks | 1 |
| Side Panel | Goal progress, task list, current page info | 1 |
| Infrastructure | chrome.storage.local, registration flow, task auto-completion, badge updates, SPA detection | 2 |

See `phase-4-extension/extension.md` for the full plan (created when Phase 4 planning begins).

## Dependencies on Phase 3

Phase 4 Extension depends on the following Phase 3 deliverables:

| Phase 3 Deliverable | Used By Extension In Phase 4 |
|---|---|
| `GET /api/dashboard` response shape | Side panel goal progress display |
| Contact detail page at `/contacts/:slug` | Extension "View in App" links |
| Task system UI patterns from TaskQueueWidget | Extension task list display |
| Command palette search API (`GET /api/contacts/search`) | Extension contact lookup |

## Gate Criteria

Phase 3 Extension gate is automatically passed: there are no deliverables to verify.

- [x] No extension work required in Phase 3 (confirmed by orchestration plan)
