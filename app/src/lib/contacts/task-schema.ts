import { query } from '../db/client';

/** Fail before generating tasks if an existing database has not run U1 migration 056. */
export async function requireIdentityTaskIndexes(): Promise<void> {
  const result = await query<{ repair_ready: boolean; recommendation_ready: boolean }>(
    `SELECT
       COALESCE(obj_description(to_regclass('uq_tasks_pending_identity_repair_contact'), 'pg_class'), '')
         = 'U1-056-auto-only-v3' AS repair_ready,
       COALESCE(obj_description(to_regclass('uq_tasks_pending_auto_recommendation'), 'pg_class'), '')
         = 'U1-056-auto-only-v3' AS recommendation_ready`
  );
  if (!result.rows[0]?.repair_ready || !result.rows[0]?.recommendation_ready) {
    throw new Error(
      'Identity task schema is not ready. Apply data/db/init/056-pending-identity-repair-unique.sql ' +
      'to the existing PostgreSQL volume before enabling automatic task generation.'
    );
  }
}
