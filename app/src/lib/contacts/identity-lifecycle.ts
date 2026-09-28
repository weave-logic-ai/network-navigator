import type { PoolClient } from 'pg';
import { query } from '../db/client';
import { CONTACT_RECOMMENDATION_ELIGIBLE_SQL, isExternalContact, isRecommendationEligible, type ContactIdentityRow } from './identity';

const OUTREACH_TYPES = `('SEND_MESSAGE', 'outreach', 'pitch_offering', 'referral_ask',
  'ENGAGE_CONTENT', 'engage_content', 'congratulate')`;

type DbQuery = { query(sql: string, params?: unknown[]): Promise<unknown> };

/** Cancel stale automatic suggestions before they are displayed or deduplicated. */
export async function reconcileSuggestedGoalIdentities(
  db: DbQuery = { query }, contactId?: string
): Promise<void> {
  await db.query(`
    UPDATE goals g SET status = 'cancelled',
      metadata = COALESCE(g.metadata, '{}'::jsonb) || jsonb_build_object(
        'u1_identity_guard', jsonb_build_object(
          'reason', 'stale_suggested_identity', 'prior_status', 'suggested',
          'at', clock_timestamp()))
    WHERE g.source = 'system' AND g.status = 'suggested'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(g.metadata->'suggestedTasks') = 'array'
            THEN g.metadata->'suggestedTasks' ELSE '[]'::jsonb END
        ) AS suggested(task)
        LEFT JOIN contacts c ON c.id::text = suggested.task->>'contactId'
        WHERE ($1::text IS NULL OR suggested.task->>'contactId' = $1::text)
          AND ((NULLIF(suggested.task->>'contactId', '') IS NOT NULL
            AND NOT COALESCE((${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}), FALSE))
            OR (NULLIF(suggested.task->>'contactId', '') IS NULL
              AND suggested.task->>'taskType' IN ${OUTREACH_TYPES}))
      )`, [contactId ?? null]);
}

/** Keep automatic task/goal state aligned with a contact identity edit. */
export async function reconcileContactIdentity(
  db: PoolClient, contactId: string, contact: ContactIdentityRow
): Promise<void> {
  // Contact edits already hold their contact row. Lock every related system
  // goal, ordered by id, before touching task rows. Two edits of different
  // contacts in the same goal otherwise acquire tasks in opposite orders.
  await db.query(`
    SELECT g.id FROM goals g
    WHERE g.source = 'system' AND g.status IN ('active', 'suggested')
      AND (EXISTS (SELECT 1 FROM tasks t WHERE t.goal_id = g.id AND t.contact_id = $1)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(g.metadata->'suggestedTasks') = 'array'
            THEN g.metadata->'suggestedTasks' ELSE '[]'::jsonb END
        ) AS suggested(task) WHERE suggested.task->>'contactId' = $1::text))
    ORDER BY g.id FOR UPDATE`, [contactId]);

  if (isRecommendationEligible(contact)) {
    await db.query(`
      UPDATE tasks SET status = 'skipped',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'u1_identity_guard', jsonb_build_object(
            'reason', 'identity_repaired', 'prior_status', status,
            'at', clock_timestamp()))
      WHERE contact_id = $1 AND status IN ('pending', 'in_progress')
        AND task_type = 'REPAIR_IDENTITY' AND source IN ('auto-score', 'impulse')`,
      [contactId]);
  } else {
    if (!isExternalContact(contact)) {
      await db.query(`
        UPDATE tasks SET status = 'skipped',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'u1_identity_guard', jsonb_build_object(
              'reason', 'self_or_archived_repair', 'prior_status', status,
              'at', clock_timestamp()))
        WHERE contact_id = $1 AND status IN ('pending', 'in_progress')
          AND task_type = 'REPAIR_IDENTITY' AND source IN ('auto-score', 'impulse')`,
        [contactId]);
    }
    await db.query(`
      UPDATE tasks SET status = 'skipped',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'u1_identity_guard', jsonb_build_object(
            'reason', 'invalid_outreach_identity', 'prior_status', status,
            'at', clock_timestamp()))
      WHERE contact_id = $1 AND status IN ('pending', 'in_progress')
        AND source IN ('system', 'auto-score', 'impulse')
        AND task_type IN ${OUTREACH_TYPES}`, [contactId]);

    const cancelled = await db.query<{ id: string }>(`
      UPDATE goals g SET status = 'cancelled',
        metadata = COALESCE(g.metadata, '{}'::jsonb) || jsonb_build_object(
          'u1_identity_guard', jsonb_build_object(
            'reason', 'stale_active_identity', 'prior_status', 'active',
            'at', clock_timestamp()))
      WHERE g.source = 'system' AND g.status = 'active'
        AND EXISTS (
          SELECT 1 FROM tasks t WHERE t.goal_id = g.id AND t.contact_id = $1
            AND t.metadata->'u1_identity_guard'->>'reason' = 'invalid_outreach_identity'
        ) RETURNING g.id`, [contactId]);

    if (cancelled.rows.length > 0) await db.query(`
      UPDATE tasks t SET status = 'skipped',
        metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
          'u1_identity_guard', jsonb_build_object(
            'reason', 'cancelled_stale_goal', 'prior_status', t.status,
            'at', clock_timestamp()))
      WHERE t.source = 'system' AND t.status IN ('pending', 'in_progress')
        AND t.goal_id = ANY($1::uuid[])`, [cancelled.rows.map((row) => row.id)]);
  }

  await reconcileSuggestedGoalIdentities(db, contactId);
}
