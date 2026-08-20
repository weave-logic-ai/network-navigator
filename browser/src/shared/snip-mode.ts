// ADR-028 clause 4 — Snip mode session state.
//
// Snip mode gates the snippet-capture widget in the side panel (text
// selection capture, image fetch-from-URL, drag/drop, paste, and link prep).
// Granting an origin permission (see approved-origins.ts) only controls
// *where* the content script is allowed to run — it must not, by itself,
// turn capturing on. The ADR calls for snip mode to be a separate,
// deliberate per-session opt-in via a popup toggle or the Ctrl+Shift+S
// hotkey (`03-snippet-editor.md` §7.3).
//
// `chrome.storage.session` is the right backing store here: it survives a
// side-panel close/reopen within the same browser session (so toggling
// doesn't fight the user every time they reopen the panel) but is cleared on
// browser restart — unlike `chrome.storage.local`, which backs the
// `approvedOrigins` permission mirror and SHOULD survive restarts.

const SNIP_MODE_KEY = 'snipModeActive';

export async function getSnipModeActive(): Promise<boolean> {
  try {
    const stored = await chrome.storage.session.get(SNIP_MODE_KEY);
    return Boolean(stored[SNIP_MODE_KEY]);
  } catch {
    // storage.session should always be available given the "storage"
    // permission already in the manifest, but default closed (off) rather
    // than risk snip mode silently reading as "on" if the API is ever
    // unavailable.
    return false;
  }
}

export async function setSnipModeActive(active: boolean): Promise<void> {
  await chrome.storage.session.set({ [SNIP_MODE_KEY]: active });
}
