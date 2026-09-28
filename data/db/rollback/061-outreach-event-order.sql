-- Roll back application code that reads event_order before running this file.
-- Remove the 061 column/index while preserving every assigned order, including
-- orders for events inserted before 061 is reapplied.
BEGIN;
-- Block inserts while copying order values and switching to the trigger.
LOCK TABLE outreach_events IN ACCESS EXCLUSIVE MODE;
CREATE SEQUENCE IF NOT EXISTS outreach_event_order_seq;
ALTER SEQUENCE outreach_event_order_seq OWNED BY NONE;
CREATE TABLE IF NOT EXISTS outreach_event_order_rollback (
  event_id UUID PRIMARY KEY REFERENCES outreach_events(id) ON DELETE CASCADE,
  event_order BIGINT NOT NULL UNIQUE
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'outreach_events' AND column_name = 'event_order') THEN
    EXECUTE 'INSERT INTO outreach_event_order_rollback (event_id, event_order)
      SELECT id, event_order FROM outreach_events
      ON CONFLICT (event_id) DO NOTHING';
  END IF;
END $$;

-- Explicitly assigned event orders may be ahead of the sequence. Keep the
-- rollback trigger above every saved value as well as any consumed gaps.
SELECT setval('outreach_event_order_seq',
  GREATEST(COALESCE((SELECT MAX(event_order) FROM outreach_event_order_rollback), 0),
    (SELECT last_value FROM outreach_event_order_seq), 1),
  EXISTS (SELECT 1 FROM outreach_event_order_rollback)
    OR (SELECT is_called FROM outreach_event_order_seq));

CREATE OR REPLACE FUNCTION capture_outreach_event_order_rollback()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO outreach_event_order_rollback (event_id, event_order)
  VALUES (NEW.id, nextval('outreach_event_order_seq'));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_outreach_event_order_rollback ON outreach_events;
CREATE TRIGGER trg_outreach_event_order_rollback
  AFTER INSERT ON outreach_events
  FOR EACH ROW EXECUTE FUNCTION capture_outreach_event_order_rollback();

DROP INDEX IF EXISTS idx_outreach_events_order;
ALTER TABLE outreach_events DROP COLUMN IF EXISTS event_order;
COMMIT;
