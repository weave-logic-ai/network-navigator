import { query } from '../../db/client';
import type { Impulse, ImpulseType } from '../types';
import { dispatchImpulse } from './dispatcher';

/**
 * Emit an impulse: synchronous DB insert + asynchronous dispatch.
 * The emit itself is fast (<5ms); handler execution is async.
 */
export async function emitImpulse(
  tenantId: string,
  impulseType: ImpulseType,
  sourceEntityType: string,
  sourceEntityId: string,
  payload: Record<string, unknown>
): Promise<Impulse> {
  const result = await query<Record<string, unknown>>(
    `INSERT INTO impulses (tenant_id, impulse_type, source_entity_type, source_entity_id, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, impulseType, sourceEntityType, sourceEntityId, JSON.stringify(payload)]
  );

  const impulse = mapImpulse(result.rows[0]);

  // Async dispatch -- does not block the caller
  dispatchImpulse(impulse.id).catch((err) => {
    console.error(`[impulse] Failed to dispatch impulse ${impulse.id}:`, err);
  });

  return impulse;
}

/**
 * Emit multiple impulses in a single transaction.
 */
export async function emitImpulses(
  impulses: Array<{
    tenantId: string;
    impulseType: ImpulseType;
    sourceEntityType: string;
    sourceEntityId: string;
    payload: Record<string, unknown>;
  }>
): Promise<Impulse[]> {
  if (impulses.length === 0) return [];

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const imp of impulses) {
    placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    values.push(imp.tenantId, imp.impulseType, imp.sourceEntityType, imp.sourceEntityId, JSON.stringify(imp.payload));
  }

  const result = await query<Record<string, unknown>>(
    `INSERT INTO impulses (tenant_id, impulse_type, source_entity_type, source_entity_id, payload)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values
  );

  const emitted = result.rows.map(mapImpulse);

  // Async dispatch all
  for (const impulse of emitted) {
    dispatchImpulse(impulse.id).catch((err) => {
      console.error(`[impulse] Failed to dispatch impulse ${impulse.id}:`, err);
    });
  }

  return emitted;
}

function mapImpulse(row: Record<string, unknown>): Impulse {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    impulseType: String(row.impulse_type) as Impulse['impulseType'],
    sourceEntityType: String(row.source_entity_type),
    sourceEntityId: String(row.source_entity_id),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}
