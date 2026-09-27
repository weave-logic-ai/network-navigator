-- Apply to existing volumes before deploying U1 generators. Keep an audit on
-- each suppressed task rather than deleting historical user-visible work.
BEGIN;
LOCK TABLE tasks IN SHARE ROW EXCLUSIVE MODE;

-- Preflight is informational; duplicates are resolved deterministically below.
DO $$
DECLARE duplicate_count integer;
BEGIN
  SELECT COALESCE(SUM(n - 1), 0) INTO duplicate_count
  FROM (
    SELECT count(*) AS n FROM tasks
    WHERE task_type = 'REPAIR_IDENTITY' AND status = 'pending' AND contact_id IS NOT NULL
      AND source IN ('auto-score', 'impulse')
    GROUP BY contact_id HAVING count(*) > 1
  ) duplicates;
  RAISE NOTICE 'U1 preflight: % duplicate pending identity repairs will be skipped', duplicate_count;
END $$;

-- A self record (or deleted contact) never needs an identity repair task.
UPDATE tasks t SET status = 'skipped',
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'u1_identity_migration', jsonb_build_object(
      'migration', '056', 'reason', 'self_or_missing_repair',
      'prior_status', t.status, 'at', clock_timestamp()))
WHERE t.status IN ('pending', 'in_progress') AND t.task_type = 'REPAIR_IDENTITY'
  AND t.source IN ('auto-score', 'impulse')
  AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = t.contact_id
      AND c.is_archived = FALSE AND c.degree > 0
      AND COALESCE(c.linkedin_url !~* '^self:', TRUE)
  );

-- Existing automatic repairs become obsolete when the contact was corrected
-- before this migration. Never close a user-created repair task.
UPDATE tasks t SET status = 'skipped',
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'u1_identity_migration', jsonb_build_object(
      'migration', '056', 'reason', 'identity_already_repaired',
      'prior_status', t.status, 'at', clock_timestamp()))
WHERE t.status IN ('pending', 'in_progress') AND t.task_type = 'REPAIR_IDENTITY'
  AND t.source IN ('auto-score', 'impulse')
  AND EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = t.contact_id
      AND c.is_archived = FALSE AND c.degree > 0
      AND c.linkedin_url ~* '^https://([a-z0-9-]+[.])*linkedin[.]com/(in|pub)/[a-z0-9._~-]+/?([?#].*)?$'
      AND c.linkedin_url !~* '/(in|pub)/(unknown([_-](contact|person|profile))?|n-a)(/|[?#]|$)'
      AND (
        (NULLIF(BTRIM(c.full_name, E' \t\n\r\f\v'), '') IS NOT NULL
         AND LOWER(REGEXP_REPLACE(BTRIM(c.full_name, E' \t\n\r\f\v'),
           E'[ \t\n\r\f\v]+', ' ', 'g'))
           NOT IN ('unknown', 'unknown contact', 'unknown person', 'unknown profile',
                   'na', 'n/a', 'not available', 'null', 'undefined'))
        OR
        (NULLIF(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name), E' \t\n\r\f\v'), '') IS NOT NULL
         AND LOWER(REGEXP_REPLACE(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name),
           E' \t\n\r\f\v'), E'[ \t\n\r\f\v]+', ' ', 'g'))
           NOT IN ('unknown', 'unknown contact', 'unknown person', 'unknown profile',
                   'na', 'n/a', 'not available', 'null', 'undefined'))
      )
  );

-- Keep the oldest pending repair across both generators. The skipped rows
-- retain their source, title, contact and the id of the retained task.
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY contact_id ORDER BY created_at, id) AS retained_id,
         row_number() OVER (PARTITION BY contact_id ORDER BY created_at, id) AS rn
  FROM tasks
  WHERE task_type = 'REPAIR_IDENTITY' AND status = 'pending' AND contact_id IS NOT NULL
    AND source IN ('auto-score', 'impulse')
)
UPDATE tasks t SET status = 'skipped',
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'u1_identity_migration', jsonb_build_object(
      'migration', '056', 'reason', 'duplicate_repair',
      'prior_status', 'pending', 'retained_task_id', ranked.retained_id,
      'at', clock_timestamp()))
FROM ranked WHERE t.id = ranked.id AND ranked.rn > 1;

-- The legacy and ECC paths previously used SELECT then INSERT for normal
-- tasks. Resolve old duplicates before adding their atomic conflict target.
WITH ranked AS (
  SELECT id, first_value(id) OVER (
           PARTITION BY contact_id, source, task_type ORDER BY created_at, id
         ) AS retained_id,
         row_number() OVER (
           PARTITION BY contact_id, source, task_type ORDER BY created_at, id
         ) AS rn
  FROM tasks
  WHERE status = 'pending' AND contact_id IS NOT NULL
    AND source IN ('auto-score', 'impulse')
    AND task_type IN ('SEND_MESSAGE', 'RESEARCH', 'ENGAGE_CONTENT')
)
UPDATE tasks t SET status = 'skipped',
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'u1_identity_migration', jsonb_build_object(
      'migration', '056', 'reason', 'duplicate_auto_task',
      'prior_status', 'pending', 'retained_task_id', ranked.retained_id,
      'at', clock_timestamp()))
FROM ranked WHERE t.id = ranked.id AND ranked.rn > 1;

-- Suppress automatic pending or in-progress outreach for contacts that cannot
-- be verified. User-created tasks and completed work are untouched.
UPDATE tasks t SET status = 'skipped',
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'u1_identity_migration', jsonb_build_object(
      'migration', '056', 'reason', 'invalid_outreach_identity',
      'prior_status', t.status, 'at', clock_timestamp()))
WHERE t.status IN ('pending', 'in_progress')
  AND t.source IN ('system', 'auto-score', 'impulse')
  AND t.task_type IN ('SEND_MESSAGE', 'outreach', 'pitch_offering', 'referral_ask',
                      'ENGAGE_CONTENT', 'engage_content', 'congratulate')
  AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = t.contact_id
      AND c.is_archived = FALSE AND c.degree > 0
      AND c.linkedin_url ~* '^https://([a-z0-9-]+[.])*linkedin[.]com/(in|pub)/[a-z0-9._~-]+/?([?#].*)?$'
      AND c.linkedin_url !~* '/(in|pub)/(unknown([_-](contact|person|profile))?|n-a)(/|[?#]|$)'
      AND (
        (NULLIF(BTRIM(c.full_name, E' \t\n\r\f\v'), '') IS NOT NULL
         AND LOWER(REGEXP_REPLACE(BTRIM(c.full_name, E' \t\n\r\f\v'),
           E'[ \t\n\r\f\v]+', ' ', 'g'))
           NOT IN ('unknown', 'unknown contact', 'unknown person', 'unknown profile',
                   'na', 'n/a', 'not available', 'null', 'undefined'))
        OR
        (NULLIF(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name), E' \t\n\r\f\v'), '') IS NOT NULL
         AND LOWER(REGEXP_REPLACE(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name),
           E' \t\n\r\f\v'), E'[ \t\n\r\f\v]+', ' ', 'g'))
           NOT IN ('unknown', 'unknown contact', 'unknown person', 'unknown profile',
                   'na', 'n/a', 'not available', 'null', 'undefined'))
      )
  );

-- A mixed goal is stale too: its title, target and count still describe all
-- original tasks. Cancel the whole system goal if any outreach was suppressed.
UPDATE goals g SET status = 'cancelled',
  metadata = COALESCE(g.metadata, '{}'::jsonb) || jsonb_build_object(
    'u1_identity_migration', jsonb_build_object(
      'migration', '056', 'reason', 'stale_active_identity',
      'prior_status', 'active', 'at', clock_timestamp()))
WHERE g.status = 'active' AND g.source = 'system'
  AND EXISTS (
    SELECT 1 FROM tasks t WHERE t.goal_id = g.id
      AND t.metadata->'u1_identity_migration'->>'reason' = 'invalid_outreach_identity'
  );

-- Remaining system tasks belong to a cancelled recommendation. Keep user
-- tasks intact and audit every suppressed pending or in-progress system task.
UPDATE tasks t SET status = 'skipped',
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'u1_identity_migration', jsonb_build_object(
      'migration', '056', 'reason', 'cancelled_stale_goal',
      'prior_status', t.status, 'at', clock_timestamp()))
WHERE t.status IN ('pending', 'in_progress') AND t.source = 'system'
  AND EXISTS (
    SELECT 1 FROM goals g WHERE g.id = t.goal_id AND g.status = 'cancelled'
      AND g.source = 'system'
      AND g.metadata->'u1_identity_migration'->>'reason' = 'stale_active_identity'
  );

-- Existing suggested system goals can be stale before anyone accepts them.
-- Cancel them during upgrade; read-time reconciliation handles later edits.
UPDATE goals g SET status = 'cancelled',
  metadata = COALESCE(g.metadata, '{}'::jsonb) || jsonb_build_object(
    'u1_identity_migration', jsonb_build_object(
      'migration', '056', 'reason', 'stale_suggested_identity',
      'prior_status', 'suggested', 'at', clock_timestamp()))
WHERE g.status = 'suggested' AND g.source = 'system'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(g.metadata->'suggestedTasks') = 'array'
        THEN g.metadata->'suggestedTasks' ELSE '[]'::jsonb END
    ) AS suggested(task)
    LEFT JOIN contacts c ON c.id::text = suggested.task->>'contactId'
    WHERE (NULLIF(suggested.task->>'contactId', '') IS NOT NULL
      AND NOT COALESCE((
        c.is_archived = FALSE AND c.degree > 0
        AND c.linkedin_url ~* '^https://([a-z0-9-]+[.])*linkedin[.]com/(in|pub)/[a-z0-9._~-]+/?([?#].*)?$'
        AND c.linkedin_url !~* '/(in|pub)/(unknown([_-](contact|person|profile))?|n-a)(/|[?#]|$)'
        AND (
          (NULLIF(BTRIM(c.full_name, E' \t\n\r\f\v'), '') IS NOT NULL
           AND LOWER(REGEXP_REPLACE(BTRIM(c.full_name, E' \t\n\r\f\v'),
             E'[ \t\n\r\f\v]+', ' ', 'g'))
             NOT IN ('unknown', 'unknown contact', 'unknown person', 'unknown profile',
                     'na', 'n/a', 'not available', 'null', 'undefined'))
          OR
          (NULLIF(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name), E' \t\n\r\f\v'), '') IS NOT NULL
           AND LOWER(REGEXP_REPLACE(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name),
             E' \t\n\r\f\v'), E'[ \t\n\r\f\v]+', ' ', 'g'))
             NOT IN ('unknown', 'unknown contact', 'unknown person', 'unknown profile',
                     'na', 'n/a', 'not available', 'null', 'undefined'))
        )
      ), FALSE))
      OR (NULLIF(suggested.task->>'contactId', '') IS NULL
        AND suggested.task->>'taskType' IN ('SEND_MESSAGE', 'outreach', 'pitch_offering',
          'referral_ask', 'ENGAGE_CONTENT', 'engage_content', 'congratulate'))
  );

-- DROP/CREATE deliberately replaces the earlier broad draft index if it was
-- applied to an existing volume; that index also constrained user tasks.
DROP INDEX IF EXISTS uq_tasks_pending_identity_repair_contact;
CREATE UNIQUE INDEX uq_tasks_pending_identity_repair_contact
  ON tasks (contact_id)
  WHERE task_type = 'REPAIR_IDENTITY' AND status = 'pending'
    AND source IN ('auto-score', 'impulse');
COMMENT ON INDEX uq_tasks_pending_identity_repair_contact IS 'U1-056-auto-only-v3';

DROP INDEX IF EXISTS uq_tasks_pending_auto_recommendation;
CREATE UNIQUE INDEX uq_tasks_pending_auto_recommendation
  ON tasks (contact_id, source, task_type)
  WHERE status = 'pending' AND source IN ('auto-score', 'impulse')
    AND task_type IN ('SEND_MESSAGE', 'RESEARCH', 'ENGAGE_CONTENT');
COMMENT ON INDEX uq_tasks_pending_auto_recommendation IS 'U1-056-auto-only-v3';

COMMIT;
