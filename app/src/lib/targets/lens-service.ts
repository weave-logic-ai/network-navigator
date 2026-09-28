// Per-target ICP selection through lenses. Migration 053 makes
// research_target_icps.lens_id the canonical lens-to-ICP association.
//
// A "lens" is a saved view of a research target — a (target, config) bundle
// stored in `research_lenses` (schema: `data/db/init/035-targets-schema.sql`).
// Phase 1.5 threads per-target ICP selection through the scoring pipeline so
// that the same contact can score differently depending on which lens is
// active for the target being researched.
//
// Active lens selection uses research_target_state.last_used_lens_id, then
// the default/oldest lens fallback. Null-lens ICP rows remain legacy target
// associations and never become lens associations by inference.

import { query, transaction } from '../db/client';
import type { PoolClient, QueryResultRow } from 'pg';
import type { IcpProfile, IcpCriteria } from '../scoring/types';

export interface ResearchLens {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  primaryTargetId: string | null;
  secondaryTargetId: string | null;
  config: Record<string, unknown>;
  icpProfileIds: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  /** Populated by migration 044 — non-null means the lens was soft-deleted. */
  deletedAt: string | null;
}

export interface LensScope { tenantId: string; ownerId: string }

function scopedQuery<T extends QueryResultRow>(
  sql: string, params: unknown[], client?: PoolClient
) {
  return client ? client.query<T>(sql, params) : query<T>(sql, params);
}

function rowToLens(row: Record<string, unknown>): ResearchLens {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    userId: (row.user_id as string | null) ?? null,
    name: row.name as string,
    primaryTargetId: (row.primary_target_id as string | null) ?? null,
    secondaryTargetId: (row.secondary_target_id as string | null) ?? null,
    config: (row.config as Record<string, unknown>) ?? {},
    icpProfileIds: (row.icp_profile_ids as string[] | null) ?? [],
    isDefault: Boolean(row.is_default),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

const lensSelect = `lens.*, ARRAY(
  SELECT rti.icp_profile_id FROM research_target_icps rti
  WHERE rti.target_id = lens.primary_target_id AND rti.lens_id = lens.id
  ORDER BY rti.icp_profile_id
) AS icp_profile_ids`;

function mapIcpRow(row: Record<string, unknown>): IcpProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    isActive: Boolean(row.is_active),
    criteria: (row.criteria as IcpCriteria) ?? {},
    weightOverrides: (row.weight_overrides as Record<string, number>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * List every non-deleted lens attached to a target as `primary_target_id`,
 * ordered default-first then by creation time.
 *
 * Soft-deleted lenses (deleted_at IS NOT NULL) are filtered out. Callers
 * that need the soft-deleted row (e.g. the deep-link "this lens was
 * deleted" banner path) should use `getLensById` which returns any row
 * regardless of delete state.
 */
export async function listLensesForTarget(targetId: string, scope: LensScope, client?: PoolClient): Promise<ResearchLens[]> {
  const res = await scopedQuery<Record<string, unknown>>(
    `SELECT ${lensSelect} FROM research_lenses lens
     JOIN research_targets target ON target.id = lens.primary_target_id
     WHERE lens.primary_target_id = $1 AND lens.deleted_at IS NULL
       AND lens.tenant_id = $2 AND target.tenant_id = $2
       AND (target.kind <> 'self' OR target.owner_id = $3)
       AND (lens.user_id IS NULL OR lens.user_id = $3)
     ORDER BY lens.is_default DESC, lens.created_at ASC`,
    [targetId, scope.tenantId, scope.ownerId], client
  );
  return res.rows.map(rowToLens);
}

/**
 * Fetch a single lens by id regardless of soft-delete state. Used by the
 * deep-link deserializer so we can render a "this lens was deleted" banner
 * instead of a 404.
 */
export async function getLensById(lensId: string, scope: LensScope): Promise<ResearchLens | null> {
  const res = await query<Record<string, unknown>>(
    `SELECT ${lensSelect} FROM research_lenses lens
     JOIN research_targets target ON target.id = lens.primary_target_id
     WHERE lens.id = $1
     AND lens.tenant_id = $2 AND target.tenant_id = $2
       AND (lens.user_id IS NULL OR lens.user_id = $3)
       AND (target.kind <> 'self' OR target.owner_id = $3)
     LIMIT 1`,
    [lensId, scope.tenantId, scope.ownerId]
  );
  return res.rows[0] ? rowToLens(res.rows[0]) : null;
}

/**
 * Soft-delete a lens. Sets deleted_at on the row without removing it, so
 * shared URLs can distinguish "this lens never existed" (404) from "this
 * lens was deleted" (banner + fall through to default).
 *
 * If the target-scoped lens being deleted was the active default, we do NOT
 * promote a sibling — activation is an explicit user action. The UI simply
 * renders the target's default view until the user activates a new lens.
 */
export async function softDeleteLens(
  targetId: string,
  lensId: string,
  scope: LensScope
): Promise<ResearchLens | null> {
  return transaction(async (client: PoolClient) => {
    // Match CAS lock order: current state rows first, then the lens row.
    // The initial lens read only locates its tenant; the UPDATE below is the
    // authoritative deletion check after all relevant state locks are held.
    const found = await client.query<{ tenant_id: string }>(
      `SELECT lens.tenant_id FROM research_lenses lens
       JOIN research_targets target ON target.id = lens.primary_target_id
       WHERE lens.id = $1 AND lens.primary_target_id = $2 AND lens.tenant_id = $3
         AND target.tenant_id = $3
         AND (target.kind <> 'self' OR target.owner_id = $4)
         AND (lens.user_id IS NULL OR lens.user_id = $4) AND lens.deleted_at IS NULL`,
      [lensId, targetId, scope.tenantId, scope.ownerId]
    );
    const tenantId = found.rows[0]?.tenant_id;
    if (!tenantId) return null;

    const states = await client.query<{ tenant_id: string; user_id: string }>(
      `SELECT tenant_id, user_id FROM research_target_state
       WHERE tenant_id = $1 AND
         (last_used_lens_id = $2 OR secondary_target_id = $3 OR
          (secondary_target_id IS NULL AND primary_target_id = $3))
       ORDER BY user_id FOR UPDATE`,
      [tenantId, lensId, targetId]
    );
    const deleted = await client.query<Record<string, unknown>>(
      `UPDATE research_lenses
       SET deleted_at = NOW(), is_default = FALSE, updated_at = NOW()
       WHERE id = $1 AND primary_target_id = $2 AND tenant_id = $3
         AND (user_id IS NULL OR user_id = $4)
         AND EXISTS (SELECT 1 FROM research_targets target
           WHERE target.id = $2 AND target.tenant_id = $3
             AND (target.kind <> 'self' OR target.owner_id = $4))
         AND deleted_at IS NULL RETURNING *`,
      [lensId, targetId, tenantId, scope.ownerId]
    );
    if (!deleted.rows[0]) return null;

    // Only touch rows locked above; new CAS commands cannot activate a lens
    // after its UPDATE commits, and the revision trigger covers each clear.
    for (const state of states.rows) {
      await client.query(
        `UPDATE research_target_state SET last_used_lens_id = NULL,
         updated_at = NOW() WHERE tenant_id = $1 AND user_id = $2
         AND last_used_lens_id = $3`,
        [state.tenant_id, state.user_id, lensId]
      );
    }
    return rowToLens(deleted.rows[0]);
  });
}

/**
 * Read the current owner's `research_target_state.last_used_lens_id`.
 * Reads only the supplied owner and tenant. An optional transaction client
 * keeps scoring previews on their authorized database snapshot.
 *
 * Returns null when there is no state row.
 */
async function readCurrentLensPointer(scope: LensScope, client?: PoolClient): Promise<{
  lensId: string | null; currentTargetId: string | null;
} | null> {
  const res = await scopedQuery<{
    last_used_lens_id: string | null;
    primary_target_id: string | null;
    secondary_target_id: string | null;
  }>(
    `SELECT last_used_lens_id, primary_target_id, secondary_target_id
     FROM research_target_state
     WHERE tenant_id = $1 AND user_id = $2
     LIMIT 1`,
    [scope.tenantId, scope.ownerId], client
  );
  const row = res.rows[0];
  return row ? {
    lensId: row.last_used_lens_id,
    currentTargetId: row.secondary_target_id ?? row.primary_target_id,
  } : null;
}

/**
 * Resolve the "active" lens for a target. Resolution order (migration 046):
 *
 *   1. `research_target_state.last_used_lens_id` for the current owner.
 *      Must be a non-deleted lens whose `primary_target_id` matches the
 *      argument — if not, we fall through (prevents a stale pointer from
 *      another target leaking in).
 *   2. The target's `is_default = TRUE` lens (oldest-wins on tie).
 *   3. The oldest non-deleted lens attached to the target.
 *
 * Returns null if the target has no lenses at all.
 */
export async function getActiveLensForTarget(targetId: string, scope: LensScope, client?: PoolClient): Promise<ResearchLens | null> {
  const pointer = await readCurrentLensPointer(scope, client);
  const lastUsedLensId = pointer?.lensId;
  if (lastUsedLensId) {
    const res = await scopedQuery<Record<string, unknown>>(
      `SELECT ${lensSelect} FROM research_lenses lens
       JOIN research_targets target ON target.id = lens.primary_target_id
       WHERE lens.id = $1 AND lens.primary_target_id = $2 AND lens.deleted_at IS NULL
         AND lens.tenant_id = $3 AND target.tenant_id = $3
         AND (target.kind <> 'self' OR target.owner_id = $4)
         AND (lens.user_id IS NULL OR lens.user_id = $4)
       LIMIT 1`,
      [lastUsedLensId, targetId, scope.tenantId, scope.ownerId], client
    );
    if (res.rows[0]) {
      return rowToLens(res.rows[0]);
    }
    // A stale/deleted pointer on the current context is an explicit no-lens state.
  }

  if (pointer?.currentTargetId === targetId) return null;

  // Fallback: ORDER BY is_default DESC, created_at ASC picks the default
  // first and the oldest lens otherwise.
  const lenses = await listLensesForTarget(targetId, scope, client);
  return lenses[0] ?? null;
}

/**
 * Return the ICP profiles associated with the target's currently-active
 * lens. The association is read from research_target_icps.lens_id. Legacy
 * null-lens rows are deliberately excluded: they do not identify a lens.
 *
 * Returns `[]` if the target has no lens, the lens has no ICP rows, or the
 * referenced ICPs are all inactive. Callers must use that empty-array result
 * as a signal to fall back to the owner-default ICP list.
 */
export async function getActiveLensIcps(targetId: string, scope: LensScope, client?: PoolClient): Promise<IcpProfile[]> {
  const lens = await getActiveLensForTarget(targetId, scope, client);
  if (!lens) return [];

  const res = await scopedQuery<Record<string, unknown>>(
    `SELECT ip.id, ip.name, ip.description, ip.is_active, ip.criteria,
            ip.weight_overrides, ip.created_at, ip.updated_at
     FROM research_target_icps rti
     JOIN icp_profiles ip ON ip.id = rti.icp_profile_id
     JOIN research_lenses lens ON lens.id = rti.lens_id
     JOIN research_targets target ON target.id = rti.target_id
     WHERE rti.target_id = $1 AND rti.lens_id = $2 AND ip.is_active = TRUE
       AND lens.deleted_at IS NULL AND lens.primary_target_id = target.id
       AND lens.tenant_id = $3 AND target.tenant_id = $3
       AND (target.kind <> 'self' OR target.owner_id = $4)
       AND (lens.user_id IS NULL OR lens.user_id = $4)
     ORDER BY ip.name`,
    [targetId, lens.id, scope.tenantId, scope.ownerId], client
  );
  return res.rows.map(mapIcpRow);
}

/**
 * Create a lens and its ICP associations atomically. First lens for a target
 * is automatically marked default.
 */
export async function createLensForTarget(input: {
  targetId: string;
  tenantId: string;
  name: string;
  userId?: string | null;
  icpProfileIds?: string[];
  secondaryTargetId?: string | null;
  configExtras?: Record<string, unknown>;
}): Promise<ResearchLens> {
  const { icpProfileIds: _legacyIds, ...config } = input.configExtras ?? {};
  const icpIds = [...new Set(input.icpProfileIds ?? [])];

  return transaction(async (client: PoolClient) => {
    // Serialize creators on the target, including when no lens exists yet.
    const target = await client.query(
      `SELECT 1 FROM research_targets WHERE id = $1 AND tenant_id = $2
       AND (kind <> 'self' OR owner_id = $3) FOR UPDATE`,
      [input.targetId, input.tenantId, input.userId ?? null]
    );
    if (!target.rows[0]) throw new Error('Target not found');
    const existing = await client.query(
      `SELECT 1 FROM research_lenses WHERE primary_target_id = $1
       AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [input.targetId, input.tenantId]
    );
    const isDefault = existing.rows.length === 0;
    const res = await client.query<Record<string, unknown>>(
      `INSERT INTO research_lenses
       (tenant_id, user_id, name, primary_target_id, secondary_target_id,
        config, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
      [
        input.tenantId,
        input.userId ?? null,
        input.name,
        input.targetId,
        input.secondaryTargetId ?? null,
        JSON.stringify(config),
        isDefault,
      ]
    );
    if (icpIds.length > 0) {
      const inserted = await client.query(
        `INSERT INTO research_target_icps (target_id, icp_profile_id, lens_id)
         SELECT $1, ip.id, $2 FROM icp_profiles ip
         WHERE ip.id = ANY($3::uuid[])
         ON CONFLICT DO NOTHING`,
        [input.targetId, res.rows[0].id, icpIds]
      );
      if (inserted.rowCount !== icpIds.length) {
        throw new Error('One or more ICP profiles do not exist');
      }
    }
    return { ...rowToLens(res.rows[0]), icpProfileIds: icpIds };
  });
}

/** Legacy activation cannot bypass the revisioned state transaction. */
export async function activateLensForTarget(
  targetId: string,
  lensId: string
): Promise<ResearchLens | null> {
  void targetId;
  void lensId;
  throw new Error('Use revisioned target state commands');
}
