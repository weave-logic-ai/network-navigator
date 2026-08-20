// WS-3 Phase 6 §7 — revoke-origin sync.
//
// The sidebar maintains `chrome.storage.local.approvedOrigins` as a mirror of
// Chrome's native per-origin permission grants. The native state is
// authoritative, but the stored list drives the sidebar UI (adding/removing
// rows) and the content-script gating check.
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
  // Deduplicate and sort so `storage.onChanged` doesn't churn when the list
  // is semantically equal.
  const deduped = Array.from(new Set(next)).sort();
  await chrome.storage.local.set({ [APPROVED_ORIGINS_KEY]: deduped });
}

/**
 * Normalise a permissions.Permissions origin pattern to the sidebar's
 * `https://host.tld/*` form. chrome.permissions can return patterns like
 * `*://example.com/*` when wildcard-scheme; we collapse to https so the
 * sidebar's display list stays tidy.
 */
function canonicalizeOrigin(pattern: string): string | null {
  if (!pattern) return null;
  // Keep existing https://host/* patterns untouched.
  if (/^https:\/\/[^/]+\/\*$/.test(pattern)) return pattern;
  // `*://host/*` or `http://host/*` → https://host/*
  const m = pattern.match(/^(?:\*|https?):\/\/([^/]+)\/\*$/);
  if (m) return `https://${m[1]}/*`;
  return null;
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

/**
 * Full reconciliation: read chrome.permissions.getAll() and rewrite the
 * approved-origins list to match. Called on service-worker startup so a
 * revoke that happened while the SW was asleep is still reflected.
 */
export async function syncApprovedOriginsFromChrome(): Promise<string[]> {
  try {
    const perms = await chrome.permissions.getAll();
    const origins = (perms.origins ?? [])
      .map(canonicalizeOrigin)
      .filter((v): v is string => !!v);
    await setApprovedOrigins(origins);
    return origins;
  } catch {
    // Permissions API failure shouldn't block SW startup.
    return getApprovedOrigins();
  }
}

/**
 * ADR-028 clause 6 — revoke a single origin from the sidebar's "Approved
 * sites" list. This is the single entry point callers (the sidebar's revoke
 * button) should use instead of calling chrome.permissions.remove and
 * writing the storage mirror separately: it calls the native permission
 * removal first (source of truth) and only then drops the entry from the
 * mirror via `removeApprovedOrigins`, so the two never disagree.
 *
 * If the native call throws, the mirror is left untouched — better to show
 * a stale-but-accurate list than to claim a revoke happened when it didn't.
 */
export async function revokeOrigin(origin: string): Promise<string[]> {
  try {
    await chrome.permissions.remove({ origins: [origin] });
  } catch {
    return getApprovedOrigins();
  }
  return removeApprovedOrigins([origin]);
}
