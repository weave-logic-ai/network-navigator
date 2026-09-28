-- Stable insertion order for manual stage changes. Legacy events without an
-- order are numbered by timestamp; equal legacy timestamps have no recoverable
-- order. A rollback stores assigned values in outreach_event_order_rollback.
-- Reserved upgrade order: 057 target state, 058 score, 059/060 graph, then 061.
BEGIN;
-- The backfill and index build hold this lock until COMMIT; schedule on a
-- bounded event table or during a write pause.
LOCK TABLE outreach_events IN ACCESS EXCLUSIVE MODE;
ALTER TABLE outreach_events ADD COLUMN IF NOT EXISTS event_order BIGINT;

CREATE SEQUENCE IF NOT EXISTS outreach_event_order_seq;
ALTER SEQUENCE outreach_event_order_seq OWNED BY outreach_events.event_order;

-- A rolled-back installation keeps ordering in a companion table. The table
-- and its insert trigger are removed in this same transaction after recovery.
DO $$
BEGIN
  IF to_regclass('outreach_event_order_rollback') IS NOT NULL THEN
    EXECUTE 'UPDATE outreach_events oe SET event_order = saved.event_order
      FROM outreach_event_order_rollback saved
      WHERE oe.id = saved.event_id AND oe.event_order IS NULL';
    DROP TRIGGER IF EXISTS trg_outreach_event_order_rollback ON outreach_events;
    DROP FUNCTION IF EXISTS capture_outreach_event_order_rollback();
    DROP TABLE outreach_event_order_rollback;
  END IF;
END $$;

WITH ordered AS (
  SELECT id,
    (SELECT COALESCE(MAX(event_order), 0) FROM outreach_events)
      + ROW_NUMBER() OVER (ORDER BY created_at, id) AS ordinal
  FROM outreach_events WHERE event_order IS NULL
)
UPDATE outreach_events oe SET event_order = ordered.ordinal
FROM ordered WHERE oe.id = ordered.id;

SELECT setval('outreach_event_order_seq',
  GREATEST(COALESCE((SELECT MAX(event_order) FROM outreach_events), 0),
    (SELECT last_value FROM outreach_event_order_seq), 1),
  EXISTS (SELECT 1 FROM outreach_events)
    OR (SELECT is_called FROM outreach_event_order_seq));

ALTER TABLE outreach_events
  ALTER COLUMN event_order SET DEFAULT nextval('outreach_event_order_seq'),
  ALTER COLUMN event_order SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_events_order ON outreach_events(event_order);
COMMIT;
