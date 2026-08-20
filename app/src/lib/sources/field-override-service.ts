// source_field_overrides CRUD helpers.
//
// Writes / clears the per-(tenant, entity, field) override that blocks
// automatic source-reconciliation. Invoked from
// `/api/targets/[id]/field-overrides` and — later — from the banner's
// [Change] modal in the UI.
//
// ADR-032 audit trail: every set and clear also writes a `causal_nodes`
// row (`operation='user_override'` / `'user_override_cleared'`, keyed on
// the target's entity so `getCausalGraph(tenantId, entityKind, entityId)`
// surfaces the full override history). This mirrors the ADR's "clearing
// an override is itself audited" claim — before this, neither set nor
// clear wrote any causal node at all, so the claim was aspirational, not
// implemented.

import { query } from '../db/client';
import { createCausalNode } from '../ecc/causal-graph/service';

export interface FieldOverrideRow {
  id: string;
  tenantId: string;
  entityKind: 'contact' | 'company';
  entityId: string;
  fieldName: string;
  value: string;
  setByUserId: string | null;
  setAt: string;
  clearedAt: string | null;
  note: string | null;
}

export interface SetOverrideInput {
  tenantId: string;
  entityKind: 'contact' | 'company';
  entityId: string;
  fieldName: string;
  value: string;
  setByUserId: string | null;
  note?: string | null;
}

function rowToOverride(row: Record<string, unknown>): FieldOverrideRow {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    entityKind: row.entity_kind as 'contact' | 'company',
    entityId: row.entity_id as string,
    fieldName: row.field_name as string,
    value: row.value as string,
    setByUserId: (row.set_by_user_id as string | null) ?? null,
    setAt: String(row.set_at),
    clearedAt: row.cleared_at ? String(row.cleared_at) : null,
    note: (row.note as string | null) ?? null,
  };
}

/**
 * Set (upsert) an active override. Any existing active row for the same
 * (tenant, entity, field) is cleared first so the unique partial index
 * accepts the new insert.
 */
export async function setFieldOverride(
  input: SetOverrideInput
): Promise<FieldOverrideRow> {
  await query(
    `UPDATE source_field_overrides
        SET cleared_at = NOW(),
            cleared_by_user_id = $5
      WHERE tenant_id = $1
        AND entity_kind = $2
        AND entity_id = $3
        AND field_name = $4
        AND cleared_at IS NULL`,
    [
      input.tenantId,
      input.entityKind,
      input.entityId,
      input.fieldName,
      input.setByUserId,
    ]
  );
  const res = await query<Record<string, unknown>>(
    `INSERT INTO source_field_overrides
        (tenant_id, entity_kind, entity_id, field_name, value,
         set_by_user_id, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
    [
      input.tenantId,
      input.entityKind,
      input.entityId,
      input.fieldName,
      input.value,
      input.setByUserId,
      input.note ?? null,
    ]
  );
  const row = rowToOverride(res.rows[0]);

  await createCausalNode(
    input.tenantId,
    input.entityKind,
    input.entityId,
    'user_override',
    { fieldName: input.fieldName },
    {
      overrideId: row.id,
      value: row.value,
      note: row.note,
      setByUserId: row.setByUserId,
    }
  );

  return row;
}

/**
 * Clear the active override for an (entity, field). Returns the row that
 * was cleared (or null if none was active).
 */
export async function clearFieldOverride(
  tenantId: string,
  entityKind: 'contact' | 'company',
  entityId: string,
  fieldName: string,
  clearedByUserId: string | null
): Promise<FieldOverrideRow | null> {
  const res = await query<Record<string, unknown>>(
    `UPDATE source_field_overrides
        SET cleared_at = NOW(),
            cleared_by_user_id = $5
      WHERE tenant_id = $1
        AND entity_kind = $2
        AND entity_id = $3
        AND field_name = $4
        AND cleared_at IS NULL
      RETURNING *`,
    [tenantId, entityKind, entityId, fieldName, clearedByUserId]
  );
  if (!res.rows[0]) return null;
  const row = rowToOverride(res.rows[0]);

  await createCausalNode(
    tenantId,
    entityKind,
    entityId,
    'user_override_cleared',
    { fieldName, overrideId: row.id, clearedValue: row.value },
    { clearedByUserId, originallySetByUserId: row.setByUserId }
  );

  return row;
}

/**
 * List active overrides for an entity. Used by the banner summarizer on
 * contact / company pages and by the ADR-032 "review sources" modal.
 */
export async function listActiveOverrides(
  tenantId: string,
  entityKind: 'contact' | 'company',
  entityId: string
): Promise<FieldOverrideRow[]> {
  const res = await query<Record<string, unknown>>(
    `SELECT *
       FROM source_field_overrides
      WHERE tenant_id = $1
        AND entity_kind = $2
        AND entity_id = $3
        AND cleared_at IS NULL
      ORDER BY set_at DESC`,
    [tenantId, entityKind, entityId]
  );
  return res.rows.map(rowToOverride);
}
