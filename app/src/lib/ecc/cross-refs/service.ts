import { query } from '../../db/client';
import type { CrossRef, CrossRefType } from '../types';
import type { CreateCrossRefParams } from './types';

const MAX_CROSSREFS_PER_EVENT = 50;

export async function createCrossRef(params: CreateCrossRefParams): Promise<CrossRef> {
  const result = await query<Record<string, unknown>>(
    `INSERT INTO cross_refs (tenant_id, edge_id, relation_type, context, confidence, source, source_entity_id, bidirectional)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (edge_id, relation_type, source) DO UPDATE
     SET context = EXCLUDED.context, confidence = EXCLUDED.confidence, updated_at = NOW()
     RETURNING *`,
    [
      params.tenantId,
      params.edgeId,
      params.relationType,
      JSON.stringify(params.context ?? {}),
      params.confidence ?? 0.5,
      params.source,
      params.sourceEntityId ?? null,
      params.bidirectional ?? true,
    ]
  );
  return mapCrossRef(result.rows[0]);
}

export async function batchCreateCrossRefs(
  refs: CreateCrossRefParams[]
): Promise<CrossRef[]> {
  // Enforce max per event
  const limited = refs.slice(0, MAX_CROSSREFS_PER_EVENT);
  const results: CrossRef[] = [];

  for (const ref of limited) {
    try {
      const crossRef = await createCrossRef(ref);
      results.push(crossRef);
    } catch {
      // Skip failures (e.g., edge doesn't exist)
    }
  }

  return results;
}

export async function getCrossRefsForEdge(edgeId: string): Promise<CrossRef[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM cross_refs WHERE edge_id = $1 ORDER BY confidence DESC`,
    [edgeId]
  );
  return result.rows.map(mapCrossRef);
}

export async function getCrossRefsForContact(
  tenantId: string,
  contactId: string,
  relationType?: CrossRefType
): Promise<Array<CrossRef & { sourceContactId: string; targetContactId: string }>> {
  let sql = `
    SELECT cr.*, e.source_id, e.target_id
    FROM cross_refs cr
    JOIN edges e ON e.id = cr.edge_id
    WHERE cr.tenant_id = $1
      AND (e.source_id = $2 OR e.target_id = $2)
  `;
  const params: unknown[] = [tenantId, contactId];

  if (relationType) {
    sql += ` AND cr.relation_type = $3`;
    params.push(relationType);
  }

  sql += ` ORDER BY cr.confidence DESC`;

  const result = await query<Record<string, unknown>>(sql, params);

  return result.rows.map(row => ({
    ...mapCrossRef(row),
    sourceContactId: String(row.source_id),
    targetContactId: String(row.target_id),
  }));
}

export async function queryCrossRefsByType(
  tenantId: string,
  relationType: CrossRefType,
  limit: number = 50
): Promise<CrossRef[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM cross_refs
     WHERE tenant_id = $1 AND relation_type = $2
     ORDER BY confidence DESC
     LIMIT $3`,
    [tenantId, relationType, limit]
  );
  return result.rows.map(mapCrossRef);
}

export async function deleteCrossRef(id: string): Promise<boolean> {
  const result = await query('DELETE FROM cross_refs WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

function mapCrossRef(row: Record<string, unknown>): CrossRef {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    edgeId: String(row.edge_id),
    relationType: String(row.relation_type) as CrossRef['relationType'],
    context: (row.context ?? {}) as Record<string, unknown>,
    confidence: Number(row.confidence ?? 0.5),
    source: String(row.source),
    sourceEntityId: row.source_entity_id as string | null,
    bidirectional: Boolean(row.bidirectional),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
