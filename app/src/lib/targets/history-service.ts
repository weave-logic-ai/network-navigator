// Research Tools Sprint — WS-4 Phase 4 Track H: secondary-target history
// ring-buffer.
//
// Each time the user changes the secondary target, the state endpoint pushes a small
// `(targetId, lensId, openedAt)` entry onto this ring-buffer. The buffer is
// stored as a JSONB array on `research_target_state.history` (migration 043)
// and capped at 20 entries — the cap is enforced here at write time, not by
// a DB constraint, because we want the ring-buffer semantics (oldest entry
// falls off) rather than a hard failure.
//
// Why JSONB instead of the existing `target_history` append-only table?
//   - `target_history` is designed for audit / switching-trend analytics —
//     a forever-growing log with switch_source enum and index on
//     (user_id, switched_at DESC). Reading the last 5 entries is fine but
//     the table is shared with other switch paths (primary swap in future,
//     migration bootstrap writes, etc.) so filtering to "just the
//     secondary timeline" requires a join.
//   - The breadcrumb hover card reads *every* page load. A cheap JSONB
//     column fetch alongside the existing `research_target_state` read
//     keeps that hot path to one query.
//   - The two stores are complementary — `target_history` is the audit,
//     `research_target_state.history` is the view cache.

import { query } from '../db/client';
import { getResearchTargetState } from './service';

export const HISTORY_LIMIT = 20;

export interface TargetHistoryEntry {
  targetId: string;
  lensId: string | null;
  openedAt: string; // ISO-8601
}

function coerceEntry(value: unknown): TargetHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.targetId !== 'string' || v.targetId.length === 0) return null;
  if (typeof v.openedAt !== 'string' || v.openedAt.length === 0) return null;
  const lensId =
    typeof v.lensId === 'string' && v.lensId.length > 0 ? v.lensId : null;
  return { targetId: v.targetId, lensId, openedAt: v.openedAt };
}

/**
 * Apply a history entry onto an existing array in ring-buffer fashion.
 * Exported for unit tests so the cap + de-dupe semantics are test-covered
 * without a DB.
 *
 * Semantics:
 *   - Newest entry is index 0.
 *   - Consecutive duplicates on the same targetId are NOT stored — instead
 *     the existing entry's `openedAt` / `lensId` is refreshed in place so
 *     the breadcrumb does not show the same target twice in a row.
 *   - Hard cap at HISTORY_LIMIT entries; older entries fall off the tail.
 */
export function applyHistoryEntry(
  existing: readonly TargetHistoryEntry[],
  next: TargetHistoryEntry
): TargetHistoryEntry[] {
  const head = existing[0];
  if (head && head.targetId === next.targetId) {
    // De-dupe: refresh the head instead of pushing a duplicate.
    const updated = [next, ...existing.slice(1)];
    return updated.slice(0, HISTORY_LIMIT);
  }
  return [next, ...existing].slice(0, HISTORY_LIMIT);
}

/**
 * Read the most-recent N history entries for the current user. Returns an
 * empty array if no state row exists or the history column is missing /
 * malformed.
 */
export async function readTargetHistory(
  ownerId: string,
  limit = 5
): Promise<TargetHistoryEntry[]> {
  const state = await getResearchTargetState(ownerId);
  if (!state) return [];

  const res = await query<{ history: unknown }>(
    `SELECT history FROM research_target_state
     WHERE tenant_id = $1 AND user_id = $2`,
    [state.tenantId, ownerId]
  );
  const raw = res.rows[0]?.history;
  if (!Array.isArray(raw)) return [];
  const entries = raw.map(coerceEntry).filter((e): e is TargetHistoryEntry => e !== null);
  return entries.slice(0, limit);
}

/**
 * Append (or refresh) a history entry for the current user. Enforces the
 * HISTORY_LIMIT ring-buffer cap.
 */
export async function pushTargetHistory(
  ownerId: string,
  entry: TargetHistoryEntry
): Promise<TargetHistoryEntry[]> {
  const state = await getResearchTargetState(ownerId);
  if (!state) return [];

  const res = await query<{ history: unknown }>(
    `SELECT history FROM research_target_state
     WHERE tenant_id = $1 AND user_id = $2`,
    [state.tenantId, ownerId]
  );
  const raw = res.rows[0]?.history;
  const existing = Array.isArray(raw)
    ? (raw.map(coerceEntry).filter((e): e is TargetHistoryEntry => e !== null))
    : [];
  const next = applyHistoryEntry(existing, entry);

  await query(
    `UPDATE research_target_state
     SET history = $3::jsonb, updated_at = NOW()
     WHERE tenant_id = $1 AND user_id = $2`,
    [state.tenantId, ownerId, JSON.stringify(next)]
  );
  return next;
}
