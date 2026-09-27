// WS-4 §3.2 — graph shift-click helpers.
import { contextController } from "@/lib/targets/context-controller";
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

/**
 * Queue target creation and focus as one invocation in the shared controller.
 *
 * Exported so the graph component and its tests both use the same flow.
 */
export async function setSecondaryTargetViaShiftClick(
  contactId: string,
): Promise<{ ok: boolean; secondaryTargetId?: string }> {
  try {
    const snapshot = await contextController.createAndFocus("contact", contactId);
    return { ok: true, secondaryTargetId: snapshot.secondaryTargetId ?? undefined };
  } catch {
    return { ok: false };
  }
}
