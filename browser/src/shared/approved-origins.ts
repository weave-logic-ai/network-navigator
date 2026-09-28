// WS-3 Phase 6 §7 — revoke-origin sync.
//
// The sidebar maintains `chrome.storage.local.approvedOrigins` as a mirror of
// Chrome's native permission patterns. Keep the exact scheme/pattern: an
// http or wildcard grant cannot be revoked by removing an invented https one.
//
// When the user revokes an origin via chrome://extensions, we need to:
//   1. Remove that origin from the stored list.
//   2. Trigger the sidebar's `storage.onChanged` listener so the UI updates
//      without the sidebar needing its own `permissions.onRemoved` wiring
//      (we want the broadcast to be single-sourced from here).
//
// `chrome.permissions.onAdded` is also wired so that a grant made outside the
// sidebar (e.g. via context menu) still propagates.

const APPROVED_ORIGINS_KEY = 'approvedOrigins';

async function getApprovedOrigins(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(APPROVED_ORIGINS_KEY, (v) => {
      const raw = v[APPROVED_ORIGINS_KEY];
      resolve(Array.isArray(raw) ? (raw as string[]) : []);
    });
  });
}

async function setApprovedOrigins(next: string[]): Promise<void> {
  const deduped = Array.from(new Set(next)).sort();
  const current = [...(await getApprovedOrigins())].sort();
  if (current.length !== deduped.length || current.some((item, index) => item !== deduped[index])) {
    await chrome.storage.local.set({ [APPROVED_ORIGINS_KEY]: deduped });
  }
}

/**
 * Validate a Chrome origin pattern without changing the native grant it names.
 * `<all_urls>` is an optional grant and must remain visible and revocable.
 */
function canonicalizeOrigin(pattern: string): string | null {
  if (pattern === '<all_urls>') return pattern;
  const match = pattern.match(/^(\*|https?):\/\/([^/\s]+)\/\*$/i);
  return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}/*` : null;
}

/**
 * Remove each origin in `removed` from the stored approved list. Called from
 * the service worker's `permissions.onRemoved` listener.
 */
export async function removeApprovedOrigins(
  removed: ReadonlyArray<string>
): Promise<string[]> {
  if (!removed || removed.length === 0) return getApprovedOrigins();
  const canonRemoved = new Set(
    removed.map(canonicalizeOrigin).filter((v): v is string => !!v)
  );
  const current = await getApprovedOrigins();
  const next = current.filter((origin) => !canonRemoved.has(origin));
  if (next.length !== current.length) {
    await setApprovedOrigins(next);
  }
  return next;
}

/**
 * Add each origin in `added` to the stored approved list.
 */
export async function addApprovedOrigins(
  added: ReadonlyArray<string>
): Promise<string[]> {
  if (!added || added.length === 0) return getApprovedOrigins();
  const canon = added
    .map(canonicalizeOrigin)
    .filter((v): v is string => !!v);
  if (canon.length === 0) return getApprovedOrigins();
  const current = await getApprovedOrigins();
  const merged = Array.from(new Set([...current, ...canon]));
  if (merged.length !== current.length) {
    await setApprovedOrigins(merged);
  }
  return merged;
}

/** Read the native grant list without writing the storage mirror. */
export async function listApprovedOriginsFromChrome(): Promise<string[]> {
  const perms = await chrome.permissions.getAll();
  const origins = (perms.origins ?? [])
    .map(canonicalizeOrigin)
    .filter((v): v is string => !!v);
  return Array.from(new Set(origins)).sort();
}

// Only the service worker calls this in production. Serialize event-driven
// reads and writes so a late response from an earlier grant/revoke cannot
// overwrite a newer native snapshot in the storage mirror.
let reconciliation: Promise<void> = Promise.resolve();

export function syncApprovedOriginsFromChrome(): Promise<string[]> {
  const result = reconciliation.then(async () => {
    const origins = await listApprovedOriginsFromChrome();
    await setApprovedOrigins(origins);
    return origins;
  });
  reconciliation = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * ADR-028 clause 6 — revoke a single origin from the sidebar's "Approved
 * sites" list. This is the single entry point callers (the sidebar's revoke
 * button) should use instead of calling chrome.permissions.remove and
 * writing the storage mirror separately: it calls the native permission
 * removal first, then reads Chrome again. The service worker is the sole
 * production writer of the mirror through its permission-change listener.
 * Native
 * `remove()` can return false for built-in grants and broader permissions can
 * still cover the same origin after an exact grant is removed.
 */
export async function revokeOrigin(origin: string): Promise<{
  origins: string[];
  revoked: boolean;
}> {
  const pattern = canonicalizeOrigin(origin);
  if (!pattern) return { origins: await getApprovedOrigins(), revoked: false };
  let removed = false;
  try {
    removed = await chrome.permissions.remove({ origins: [pattern] });
  } catch {
    return { origins: await getApprovedOrigins(), revoked: false };
  }
  let origins: string[];
  try {
    origins = await listApprovedOriginsFromChrome();
  } catch {
    return { origins: await getApprovedOrigins(), revoked: false };
  }
  let stillGranted = true;
  try {
    stillGranted = await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    // If Chrome cannot confirm the result, do not claim access is gone.
  }
  return { origins, revoked: removed && !stillGranted && !origins.includes(pattern) };
}
