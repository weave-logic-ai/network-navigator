// WS-4 §3.2 — graph shift-click helpers.
//
// Lives in its own module so the component file stays a "use client"
// bundle while these pure helpers can be imported from tests without
// dragging React or the sigma runtime along. The sigma-graph component
// imports from here; tests import from here directly.

/**
 * Narrow a sigma node-click payload to "was the original event a shift
 * click?" — sigma delivers mouse + touch together, so we only recognise
 * MouseEvent and check the shift modifier.
 */
export function isShiftClick(
  event: { original?: MouseEvent | TouchEvent } | undefined
): boolean {
  const original = event?.original;
  if (!original) return false;
  // Use a structural check so environments without MouseEvent global
  // (e.g. Node-side tests) still work — we pass through the fields we
  // care about.
  const maybeMouse = original as { shiftKey?: boolean; type?: string };
  return Boolean(maybeMouse.shiftKey);
}

/** Serializes focus writes while allowing only the latest request to update UI. */
export class LatestFocusQueue<T> {
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();

  enqueue(
    action: () => Promise<T>,
    onResult: (result: T, isCurrent: () => boolean) => void | Promise<void>,
    onError: (isCurrent: () => boolean) => void | Promise<void>,
  ): Promise<void> {
    const revision = ++this.revision;
    const isCurrent = () => revision === this.revision;
    this.tail = this.tail.catch(() => {}).then(async () => {
      if (!isCurrent()) return;
      try {
        const result = await action();
        if (isCurrent()) await onResult(result, isCurrent);
      } catch {
        if (isCurrent()) await onError(isCurrent);
      }
    });
    return this.tail;
  }
}

/** Back uses the same serialized target-state lane as graph Focus. */
export async function writeGraphBack(previous: string | null, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; secondaryTargetId: string | null }> {
  const response = await fetchImpl("/api/targets/state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secondaryTargetId: previous }),
  });
  return { ok: response.ok, secondaryTargetId: previous };
}

/** A pending Focus has not entered history yet, so Back returns to the visible root. */
export function getGraphBackDecision(
  current: string | null,
  history: readonly (string | null)[],
  focusPending: boolean,
  retry: { target: string | null; popHistory: boolean } | null = null,
): { target: string | null; popHistory: boolean } {
  if (retry) return retry;
  return {
    target: focusPending ? current : history.length ? history[history.length - 1] : null,
    popHistory: !focusPending,
  };
}

/** A failed Back remains retryable even when the visible root is Self. */
export function canGraphGoBack(
  current: string | null,
  history: readonly (string | null)[],
  focusPending: boolean,
  retry: { target: string | null; popHistory: boolean } | null,
): boolean {
  return retry !== null || current !== null || history.length > 0 || focusPending;
}

/**
 * POST /api/targets with `{kind: 'contact', id}` to get-or-create the
 * target row, then PUT /api/targets/state with `secondaryTargetId`. Silent
 * on failure — the breadcrumb UI polls state on a timer so a missed write
 * self-heals on the next render.
 *
 * Exported so the graph component and its tests both use the same flow.
 */
export async function setSecondaryTargetViaShiftClick(
  contactId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; secondaryTargetId?: string }> {
  try {
    const createRes = await fetchImpl("/api/targets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "contact", id: contactId }),
    });
    if (!createRes.ok) return { ok: false };
    const createJson = (await createRes.json()) as { data: { id: string } };
    const putRes = await fetchImpl("/api/targets/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secondaryTargetId: createJson.data.id }),
    });
    if (!putRes.ok) return { ok: false, secondaryTargetId: createJson.data.id };
    return { ok: true, secondaryTargetId: createJson.data.id };
  } catch {
    return { ok: false };
  }
}
