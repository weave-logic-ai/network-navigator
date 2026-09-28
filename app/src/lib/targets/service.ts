// Research Tools Sprint — WS-4 target state service
//
// Single source of truth for "what target is this session about?" reads and
// writes. Every (app)/** layout calls `getResearchTargetState(ownerId)` which
// lazy-creates the state row on first access and always returns a valid
// ResearchTargetState with `primary_target_id` pointing at the owner's
// `kind='self'` row.
//
// Per ADR-027 + `10-decisions.md` Q4: primary is immutable in v1 and always
// equals the self-target for the requesting user. Secondary is nullable.

import { query, transaction } from '../db/client';
import type { PoolClient } from 'pg';
import { HISTORY_LIMIT, type TargetHistoryEntry } from './history-service';
import { getDefaultTenantId } from '../db/tenants';
import type { ResearchTarget, ResearchTargetState, TargetKind } from './types';

// Re-export so existing `import { getDefaultTenantId } from '@/lib/targets/service'`
// call-sites keep working. Canonical implementation lives in `@/lib/db/tenants`.
export { getDefaultTenantId };

function rowToTarget(row: Record<string, unknown>): ResearchTarget {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    kind: row.kind as TargetKind,
    ownerId: (row.owner_id as string | null) ?? null,
    contactId: (row.contact_id as string | null) ?? null,
    companyId: (row.company_id as string | null) ?? null,
    label: row.label as string,
    pinned: Boolean(row.pinned),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastUsedAt: String(row.last_used_at),
  };
}

function rowToState(row: Record<string, unknown>): ResearchTargetState {
  return {
    tenantId: row.tenant_id as string,
    userId: (row.user_id as string | null) ?? null,
    primaryTargetId: (row.primary_target_id as string | null) ?? null,
    secondaryTargetId: (row.secondary_target_id as string | null) ?? null,
    revision: String(row.revision ?? 0),
    activeLensId: (row.last_used_lens_id as string | null) ?? null,
    updatedAt: String(row.updated_at),
  };
}

/**
 * Get the current owner profile. Returns null if no owner exists yet. Used by
 * `getResearchTargetState` and the tenant-resolution fallback for scoring.
 */
export async function getCurrentOwnerProfileId(): Promise<string | null> {
  const res = await query<{ id: string }>(
    `SELECT id FROM owner_profiles WHERE is_current = TRUE LIMIT 1`
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Find (or lazy-create) the owner's self-target. Returns `null` if the owner
 * does not exist — callers then fall back to the no-op behavior documented in
 * the "self-target migration" section of ADR-027.
 */
export async function getOrCreateSelfTarget(
  ownerId: string, scopeTenantId?: string
): Promise<ResearchTarget | null> {
  const tenantId = scopeTenantId ?? await getDefaultTenantId();
  const existing = await query<Record<string, unknown>>(
    `SELECT * FROM research_targets
     WHERE owner_id = $1 AND tenant_id = $2 AND kind = 'self' LIMIT 1`,
    [ownerId, tenantId]
  );
  if (existing.rows[0]) {
    return rowToTarget(existing.rows[0]);
  }

  const labelRes = await query<{ label: string | null }>(
    `SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), 'Self') AS label
     FROM owner_profiles WHERE id = $1`,
    [ownerId]
  );
  const label = labelRes.rows[0]?.label ?? 'Self';

  const inserted = await query<Record<string, unknown>>(
    `INSERT INTO research_targets (tenant_id, kind, owner_id, label)
     VALUES ($1, 'self', $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [tenantId, ownerId, label]
  );
  if (inserted.rows[0]) {
    return rowToTarget(inserted.rows[0]);
  }
  // Race: the row was created by a concurrent call. Re-read.
  const reread = await query<Record<string, unknown>>(
    `SELECT * FROM research_targets
     WHERE owner_id = $1 AND tenant_id = $2 AND kind = 'self' LIMIT 1`,
    [ownerId, tenantId]
  );
  return reread.rows[0] ? rowToTarget(reread.rows[0]) : null;
}

/**
 * Read-or-create the per-user research target state. Called by every server
 * component in `(app)/**`. If no self-target exists yet, we create one and
 * seed the state row. Returns null only if no owner_profile exists — then
 * the caller should proceed with legacy behavior (no breadcrumbs, etc.).
 */
export async function getResearchTargetState(
  ownerId?: string
): Promise<ResearchTargetState | null> {
  const resolvedOwnerId = ownerId ?? (await getCurrentOwnerProfileId());
  if (!resolvedOwnerId) return null;

  const tenantId = await getDefaultTenantId();
  const selfTarget = await getOrCreateSelfTarget(resolvedOwnerId, tenantId);
  if (!selfTarget) return null;

  // First read may seed the row. Existing legacy pointers are repaired before
  // this state can reach a server render or an API response.
  await query(
    `INSERT INTO research_target_state (tenant_id, user_id, primary_target_id, secondary_target_id)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    [tenantId, resolvedOwnerId, selfTarget.id]
  );
  return transaction(async client => {
    const row = await readAuthorizedState(client, tenantId, resolvedOwnerId, selfTarget.id);
    return row ? rowToState(row) : null;
  });
}

/** Repair pre-CAS pointers under the state lock before any caller observes them. */
async function readAuthorizedState(client: PoolClient, tenantId: string, ownerId: string,
  selfTargetId: string): Promise<Record<string, unknown> | null> {
  const locked = await client.query<Record<string, unknown>>(
    `SELECT * FROM research_target_state
     WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
    [tenantId, ownerId]
  );
  const row = locked.rows[0];
  if (!row) return null;

  const secondaryId = (row.secondary_target_id as string | null) ?? null;
  const validSecondary = secondaryId ? await client.query<{ id: string }>(
    `SELECT id FROM research_targets WHERE id = $1 AND tenant_id = $2
     AND ((kind = 'contact' AND contact_id IS NOT NULL)
       OR (kind = 'company' AND company_id IS NOT NULL))`,
    [secondaryId, tenantId]
  ) : null;
  const primaryChanged = row.primary_target_id !== selfTargetId;
  const secondaryChanged = Boolean(secondaryId && !validSecondary?.rows[0]);
  if (!primaryChanged && !secondaryChanged) return row;

  const repaired = await client.query<Record<string, unknown>>(
    `UPDATE research_target_state SET primary_target_id = $3,
       secondary_target_id = $4, last_used_lens_id = NULL,
       revision = revision + 1, updated_at = NOW()
     WHERE tenant_id = $1 AND user_id = $2 RETURNING *`,
    [tenantId, ownerId, selfTargetId, secondaryChanged ? null : secondaryId]
  );
  return repaired.rows[0] ?? null;
}

/** Legacy direct mutation is closed; callers must use commandTargetState. */
export async function setSecondaryTarget(): Promise<never> {
  throw new Error('Use revisioned target state commands');
}

export type TargetStateAction =
  | { type: 'focus'; targetId: string | null }
  | { type: 'back' }
  | { type: 'activateLens'; targetId: string; lensId: string };

export interface TargetStateSnapshot extends ResearchTargetState {
  focusTargetId: string | null;
  primaryLabel: string | null;
  focusLabel: string | null;
  activeLensLabel: string | null;
  history: Array<TargetHistoryEntry & {
    targetLabel: string | null; lensLabel: string | null; lensUnavailable: boolean;
  }>;
  canGoBack: boolean;
  warning: string | null;
}

export class TargetStateCommandError extends Error {
  constructor(public readonly status: 400 | 409, message: string,
    public readonly current?: TargetStateSnapshot) { super(message); }
}

function validHistory(value: unknown): TargetHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return value.flatMap((entry): TargetHistoryEntry[] => {
    if (!entry || typeof entry !== 'object' ||
        typeof entry.targetId !== 'string' || !uuid.test(entry.targetId) ||
        typeof entry.openedAt !== 'string' ||
        (entry.lensId != null && (typeof entry.lensId !== 'string' || !uuid.test(entry.lensId)))) {
      return [];
    }
    return [{ targetId: entry.targetId, lensId: entry.lensId ?? null, openedAt: entry.openedAt }];
  }).slice(0, HISTORY_LIMIT);
}

async function snapshot(client: PoolClient, row: Record<string, unknown>,
  warning: string | null = null): Promise<TargetStateSnapshot> {
  const state = rowToState(row);
  const tenantId = state.tenantId;
  const history = validHistory(row.history);
  const targetIds = [state.primaryTargetId, state.secondaryTargetId, ...history.map(e => e.targetId)]
    .filter((id): id is string => Boolean(id));
  const lensIds = [state.activeLensId, ...history.map(e => e.lensId)]
    .filter((id): id is string => Boolean(id));
  const targets = await client.query<{ id: string; label: string }>(
    `SELECT id, label FROM research_targets
     WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       AND ((kind = 'self' AND owner_id = $3)
         OR (kind = 'contact' AND contact_id IS NOT NULL)
         OR (kind = 'company' AND company_id IS NOT NULL))`,
    [tenantId, targetIds, state.userId]);
  const lenses = await client.query<{ id: string; name: string; primary_target_id: string }>(
    `SELECT id, name, primary_target_id FROM research_lenses
     WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
       AND (user_id IS NULL OR user_id = $3)`,
    [tenantId, lensIds, state.userId]);
  const targetLabels = new Map(targets.rows.map(t => [t.id, t.label]));
  const lensById = new Map(lenses.rows.map(l => [l.id, l]));
  const lensLabel = (id: string | null, targetId: string | null) => {
    const lens = id ? lensById.get(id) : null;
    return targetId && targetLabels.has(targetId) && lens?.primary_target_id === targetId
      ? lens.name : null;
  };
  const visibleHistory = history.filter(e => targetLabels.has(e.targetId)).map(e => ({
    ...e, targetLabel: targetLabels.get(e.targetId) ?? null,
    lensLabel: lensLabel(e.lensId, e.targetId),
    lensUnavailable: Boolean(e.lensId && !lensLabel(e.lensId, e.targetId)),
  }));
  const currentTargetId = state.secondaryTargetId ?? state.primaryTargetId;
  const activeLensLabel = lensLabel(state.activeLensId, currentTargetId);
  const missingLens = Boolean(state.activeLensId && !activeLensLabel);
  return {
    ...state,
    activeLensId: missingLens ? null : state.activeLensId,
    focusTargetId: state.secondaryTargetId,
    primaryLabel: state.primaryTargetId ? targetLabels.get(state.primaryTargetId) ?? null : null,
    focusLabel: state.secondaryTargetId ? targetLabels.get(state.secondaryTargetId) ?? null : null,
    activeLensLabel,
    history: visibleHistory,
    canGoBack: visibleHistory.length > 0,
    warning: warning ?? (missingLens ? 'The active lens is unavailable.' : null),
  };
}

export async function getTargetStateSnapshot(ownerId: string): Promise<TargetStateSnapshot | null> {
  const state = await getResearchTargetState(ownerId);
  if (!state) return null;
  return transaction(async client => {
    const row = await readAuthorizedState(client, state.tenantId, ownerId, state.primaryTargetId!);
    return row ? snapshot(client, row) : null;
  });
}

export async function commandTargetState(ownerId: string, expectedRevision: string,
  action: TargetStateAction): Promise<TargetStateSnapshot> {
  const seeded = await getResearchTargetState(ownerId);
  if (!seeded) throw new TargetStateCommandError(400, 'No owner profile configured');
  return transaction(async client => {
    const row = await readAuthorizedState(client, seeded.tenantId, ownerId, seeded.primaryTargetId!);
    if (!row) throw new TargetStateCommandError(400, 'Target state unavailable');
    if (String(row.revision) !== expectedRevision) {
      throw new TargetStateCommandError(409, 'Target state changed', await snapshot(client, row));
    }
    let focus = (row.secondary_target_id as string | null) ?? null;
    let lens = (row.last_used_lens_id as string | null) ?? null;
    let history = validHistory(row.history);
    let warning: string | null = null;
    if (action.type === 'back') {
      let entry: TargetHistoryEntry | undefined;
      while (history.length > 0) {
        const candidate = history.shift()!;
        const target = await client.query<{ id: string }>(
          `SELECT id FROM research_targets WHERE id = $1 AND tenant_id = $2
           AND ((kind = 'self' AND owner_id = $3 AND id = $4)
             OR (kind = 'contact' AND contact_id IS NOT NULL)
             OR (kind = 'company' AND company_id IS NOT NULL))`,
          [candidate.targetId, seeded.tenantId, ownerId, row.primary_target_id]
        );
        if (target.rows[0]) {
          entry = candidate;
          break;
        }
        warning = 'A prior target is unavailable; it was skipped.';
      }
      if (entry) {
        focus = entry.targetId === row.primary_target_id ? null : entry.targetId;
        lens = entry.lensId;
      } else if (!warning) {
        throw new TargetStateCommandError(400, 'No prior target context');
      }
    } else {
      if (action.type === 'focus') {
        if (action.targetId) {
          const target = await client.query<{ id: string }>(
            `SELECT id FROM research_targets WHERE id = $1 AND tenant_id = $2
             AND kind IN ('contact', 'company')
             AND (contact_id IS NOT NULL OR company_id IS NOT NULL)`,
            [action.targetId, seeded.tenantId]
          );
          if (!target.rows[0]) throw new TargetStateCommandError(400, 'Invalid focus target');
        }
        if (focus !== action.targetId) lens = null;
        focus = action.targetId;
      } else {
        if (action.targetId !== (focus ?? row.primary_target_id)) {
          throw new TargetStateCommandError(400, 'Lens target is not current');
        }
        const selected = await client.query<{ id: string }>(
          `SELECT id FROM research_lenses WHERE id = $1 AND tenant_id = $2
           AND primary_target_id = $3 AND deleted_at IS NULL
           AND (user_id IS NULL OR user_id = $4) FOR UPDATE`,
          [action.lensId, seeded.tenantId, action.targetId, ownerId]
        );
        if (!selected.rows[0]) throw new TargetStateCommandError(400, 'Invalid lens');
        lens = action.lensId;
      }
      if (action.type === 'focus' && focus !== row.secondary_target_id) {
        const priorTargetId = (row.secondary_target_id as string | null) ??
          (row.primary_target_id as string);
        history = [{ targetId: priorTargetId,
          lensId: (row.last_used_lens_id as string | null) ?? null,
          openedAt: new Date().toISOString() }, ...history].slice(0, HISTORY_LIMIT);
      }
    }
    if (lens) {
      const available = await client.query<{ id: string }>(
        `SELECT id FROM research_lenses WHERE id = $1 AND tenant_id = $2
         AND primary_target_id = $3 AND deleted_at IS NULL
         AND (user_id IS NULL OR user_id = $4) FOR UPDATE`,
        [lens, seeded.tenantId, focus ?? row.primary_target_id, ownerId]
      );
      if (!available.rows[0]) {
        lens = null;
        warning = 'The saved lens was deleted or is unavailable; the target was restored without it.';
      }
    }
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE research_target_state SET secondary_target_id = $3,
       last_used_lens_id = $4, history = $5::jsonb, revision = revision + 1,
       updated_at = NOW() WHERE tenant_id = $1 AND user_id = $2 RETURNING *`,
      [seeded.tenantId, ownerId, focus, lens, JSON.stringify(history)]
    );
    return snapshot(client, updated.rows[0], warning);
  });
}

/**
 * Fetch a target by id. Null if missing.
 */
export async function getTargetById(id: string): Promise<ResearchTarget | null> {
  const res = await query<Record<string, unknown>>(
    `SELECT * FROM research_targets WHERE id = $1 LIMIT 1`,
    [id]
  );
  return res.rows[0] ? rowToTarget(res.rows[0]) : null;
}

/**
 * Create (or return the existing) target for a contact.
 */
export async function getOrCreateContactTarget(
  contactId: string,
  tenantId: string
): Promise<ResearchTarget> {
  const existing = await query<Record<string, unknown>>(
    `SELECT * FROM research_targets
     WHERE contact_id = $1 AND tenant_id = $2 AND kind = 'contact' LIMIT 1`,
    [contactId, tenantId]
  );
  if (existing.rows[0]) return rowToTarget(existing.rows[0]);

  const labelRes = await query<{ label: string | null }>(
    `SELECT COALESCE(full_name, 'Contact') AS label FROM contacts WHERE id = $1`,
    [contactId]
  );
  const label = labelRes.rows[0]?.label ?? 'Contact';

  const inserted = await query<Record<string, unknown>>(
    `INSERT INTO research_targets (tenant_id, kind, contact_id, label)
     VALUES ($1, 'contact', $2, $3)
     ON CONFLICT (tenant_id, contact_id) WHERE contact_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [tenantId, contactId, label]
  ).catch(async () => {
    // Conflict handling fallback (partial unique index may refuse the ON CONFLICT
    // target in older pg).
    return query<Record<string, unknown>>(
      `SELECT * FROM research_targets
       WHERE contact_id = $1 AND tenant_id = $2 LIMIT 1`,
      [contactId, tenantId]
    );
  });
  return rowToTarget(inserted.rows[0]);
}

/**
 * Create (or return the existing) target for a company.
 */
export async function getOrCreateCompanyTarget(
  companyId: string,
  tenantId: string
): Promise<ResearchTarget> {
  const existing = await query<Record<string, unknown>>(
    `SELECT * FROM research_targets
     WHERE company_id = $1 AND tenant_id = $2 AND kind = 'company' LIMIT 1`,
    [companyId, tenantId]
  );
  if (existing.rows[0]) return rowToTarget(existing.rows[0]);

  const labelRes = await query<{ label: string | null }>(
    `SELECT COALESCE(name, 'Company') AS label FROM companies WHERE id = $1`,
    [companyId]
  );
  const label = labelRes.rows[0]?.label ?? 'Company';

  const inserted = await query<Record<string, unknown>>(
    `INSERT INTO research_targets (tenant_id, kind, company_id, label)
     VALUES ($1, 'company', $2, $3)
     RETURNING *`,
    [tenantId, companyId, label]
  );
  return rowToTarget(inserted.rows[0]);
}

/**
 * Resolve a target row to the underlying entity id used by graph / scoring
 * queries. For 'self' targets this is the `owner_id`, for 'contact' it's
 * `contact_id`, for 'company' it's `company_id`.
 */
export function getTargetEntityId(target: ResearchTarget): string | null {
  if (target.kind === 'self') return target.ownerId;
  if (target.kind === 'contact') return target.contactId;
  if (target.kind === 'company') return target.companyId;
  return null;
}
