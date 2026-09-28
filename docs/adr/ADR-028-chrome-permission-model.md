# ADR-028: Chrome permission model — curated host_permissions plus optional_host_permissions plus sidebar "Add host" button

**Status**: Accepted (date: 2026-04-17) — **Updated: 2026-08-19**

> **Update 2026-08-19**: Two clauses of this ADR are unimplemented in
> `browser/src`, verified by grep across the whole tree.
> 1. Decision point 4 ("Snip mode stays opt-in per session via the existing
>    popup toggle or the `Ctrl+Shift+S` hotkey — permission does not
>    auto-activate the widget") is not what shipped: no `Ctrl+Shift+S`
>    command registration and no opt-in toggle gating snip-mode activation
>    exist anywhere in `browser/src`. This is a permission-scope drift from
>    clause 4's stated model — snip mode auto-activates rather than being
>    opt-in — not a cosmetic gap.
> 2. The Neutral section's "Revoke" UI ("still works — it calls
>    `chrome.permissions.remove`") does not exist. `chrome.permissions.remove`
>    appears nowhere in `browser/src`. Only `chrome.permissions.request`,
>    `.getAll()`, and `.contains()` are called, plus the `onAdded`/`onRemoved`
>    listeners in `browser/src/service-worker.ts:596,607` and
>    `browser/src/sidepanel/sidepanel.ts:1289,1326` — those *react* to a
>    revocation made through Chrome's own extension-settings page; there is
>    no popup revoke button that calls `.remove()` itself.

## Context

WS-3 (`.planning/research-tools-sprint/03-snippet-editor.md`) lets the user
capture snippets from arbitrary research pages — Wayback snapshots, EDGAR
filings, press releases, news articles. That requires the extension to read
DOM content on origins beyond LinkedIn.

Chrome Manifest V3 offers three viable shapes for this (see
`.planning/research-tools-sprint/09-open-questions.md` Q2, lines 36-58):

- **A**: `optional_host_permissions: ["<all_urls>"]` plus per-origin runtime
  requests. Flexible but shows a scary "read all pages" prompt to CWS reviewers
  and end users.
- **B**: Enumerate specific origins in `host_permissions`. Narrow and
  reviewer-friendly; every new origin requires a Chrome Web Store update.
- **C**: Use `activeTab` — no host permissions; only active on toolbar-click.
  Removes the fright but disables hotkey and context-menu UX on un-invoked
  pages.

`09-open-questions.md` recommended A-for-dev / B-for-CWS behind a compile flag.
The operator rejected that shape and gave a fourth:

> "Add a button that will allow you to add current hostname to approved list in
> the sidebar. It'd be a good idea to use B as well, to give them a creative
> list to start with." (`10-decisions.md` Q2, lines 32-34)

## Decision

Ship one manifest that combines B (curated seed) with A (runtime per-origin
requests), surfaced via a sidebar affordance:

1. **`host_permissions`** in `browser/src/manifest.json` ships a curated seed
   list: LinkedIn (already required), `web.archive.org`, `*.sec.gov`, plus the
   ten most-common research origins enumerated in `03-snippet-editor.md` §5.4.
2. **`optional_host_permissions`** includes `<all_urls>` so the sidebar can
   call `chrome.permissions.request({ origins: [origin] })` at runtime without
   a manifest update. (`10-decisions.md` Q2, lines 35-47)
3. **Sidebar "Add this site to approved sources" button** appears in the
   Target Panel when (a) the active tab's origin is not in the already-granted
   origin set AND (b) the sidebar has loaded on that origin (so the prompt has
   context).
4. ~~**Snip mode** stays opt-in per session via the existing popup toggle or
   the `Ctrl+Shift+S` hotkey — permission does not auto-activate the
   widget.~~ **Not implemented (2026-08-19)**: no hotkey and no opt-in
   toggle exist in `browser/src`; snip mode auto-activates. See the update
   note at the top of this file.
   (`03-snippet-editor.md` §7.3, lines 235-237)
5. **Grant persistence**: grants live in Chrome's permissions store (source of
   truth) and are mirrored in a local `approvedOrigins` storage key for
   sidebar UX state (checkbox rendering, revocation UI).

Phase sequencing: the manifest shape (seed list + `optional_host_permissions`)
ships in Phase 0; the sidebar "Add host" button ships in Phase 1.
(`10-decisions.md` §Updates-to-phased-delivery, lines 202-208)

## Consequences

### Positive

- **CWS review surface is narrow**: the seeded `host_permissions` list is
  reviewable; `<all_urls>` only appears under `optional_host_permissions`,
  which reviewers treat as user-gated.
- **Power users get flexibility without a CWS redeploy**: adding a new origin
  is a sidebar click, not a release.
- **One artifact, one manifest, one review surface.** No dev-vs-CWS compile
  flag split, no alternate build pipeline. (`10-decisions.md` Q2, lines 44-47)
- **Existing LinkedIn flows unchanged**. The seed list is a superset of what
  ships today, so no existing capture path is affected.

### Negative

- Chrome still shows a runtime prompt each time the user adds a new origin.
  That is expected behavior for `chrome.permissions.request` and cannot be
  further quieted.
- The curated seed list is a maintenance surface — when a research origin
  becomes common enough to include, we add it in a versioned manifest update.
  We accept this; the alternative is either silent bloat or no baseline at all.
- The local `approvedOrigins` mirror can drift from Chrome's permissions store
  if the user revokes from Chrome's settings page. The sidebar must reconcile
  on startup by reading `chrome.permissions.getAll()`.

### Neutral

- ~~The "Revoke" UI in the popup (`03-snippet-editor.md` §7.4, lines 239-244)
  still works — it calls `chrome.permissions.remove` and drops the mirror
  entry.~~ **Not implemented (2026-08-19)**: `chrome.permissions.remove`
  does not appear anywhere in `browser/src`. There is no popup revoke
  button; the extension only reconciles when revocation happens through
  Chrome's own settings page. See the update note at the top of this file.
- Impulses / backend writes are unaffected; the app server never sees the
  permission state (`03-snippet-editor.md` §7.4, line 244).

## Alternatives considered

### Q2 Option A (`<all_urls>` everywhere, dev build) and Option B (CWS with flag split)

Original recommendation in `09-open-questions.md`. Rejected because compile-flag
dev/CWS split complicates release pipelines and ops, and the runtime-grant path
in the sidebar achieves the same flexibility with a single artifact.
(`10-decisions.md` Q2, lines 44-47)

### Q2 Option C — `activeTab` only

Snipping requires clicking the toolbar on every page. Rejected: degrades UX
(no hotkey, no context menu) and the research workflow the sprint is built for
is explicitly hotkey-driven.
(`09-open-questions.md` Q2 Option C, lines 48-52)

### Pure A without the seed list

Ship only `optional_host_permissions: ["<all_urls>"]`, no `host_permissions`
beyond LinkedIn. Rejected: leaves users staring at an empty permitted-origins
list on install; seed list anchors the "creative list to start with" the
operator called for. (`10-decisions.md` Q2, line 33)

## Related

- Source: `.planning/research-tools-sprint/03-snippet-editor.md`
  §7 (permission model, lines 218-244), §5.4 (curated origin list)
- Source: `.planning/research-tools-sprint/10-decisions.md`
  Q2 (lines 27-49)
- Source: `.planning/research-tools-sprint/09-open-questions.md`
  Q2 (lines 36-58)
- Manifest: `browser/src/manifest.json`
- Content script: `browser/src/content-snippet/` (introduced in WS-3)
- Cross-ref: ADR-027 (sidebar Target Panel hosts the "Add host" button)
- Cross-ref: ADR-029 (snippets captured via this permission model flow into
  the per-target chain defined there)
