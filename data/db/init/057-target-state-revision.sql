-- State commands compare this monotonic token while holding the state row lock.
ALTER TABLE research_target_state
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

-- FK SET NULL updates (target/lens deletion) must invalidate stale clients too.
CREATE OR REPLACE FUNCTION bump_target_state_revision_on_context_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.primary_target_id, NEW.secondary_target_id, NEW.last_used_lens_id, NEW.history)
     IS DISTINCT FROM
     (OLD.primary_target_id, OLD.secondary_target_id, OLD.last_used_lens_id, OLD.history)
     AND NEW.revision <= OLD.revision THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_target_state_revision_context ON research_target_state;
CREATE TRIGGER trg_target_state_revision_context
BEFORE UPDATE ON research_target_state
FOR EACH ROW EXECUTE FUNCTION bump_target_state_revision_on_context_change();

-- Migration 035 used SET NULL for target subjects while CHECK constraints
-- require exactly one subject. A subject deletion would fail that CHECK.
-- Cascade the target instead; its state FK then sets focus null, and the
-- revision trigger above invalidates stale clients in the same transaction.
ALTER TABLE research_targets DROP CONSTRAINT IF EXISTS research_targets_owner_id_fkey;
ALTER TABLE research_targets ADD CONSTRAINT research_targets_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES owner_profiles(id) ON DELETE CASCADE;

ALTER TABLE research_targets DROP CONSTRAINT IF EXISTS research_targets_contact_id_fkey;
ALTER TABLE research_targets ADD CONSTRAINT research_targets_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

ALTER TABLE research_targets DROP CONSTRAINT IF EXISTS research_targets_company_id_fkey;
ALTER TABLE research_targets ADD CONSTRAINT research_targets_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

-- Keep the oldest active default when an upgraded volume already has more
-- than one. A soft-deleted default cannot reserve the slot.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY primary_target_id ORDER BY created_at, id
  ) AS position
  FROM research_lenses
  WHERE is_default = TRUE AND deleted_at IS NULL AND primary_target_id IS NOT NULL
)
UPDATE research_lenses lens SET is_default = FALSE
FROM ranked WHERE lens.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_research_lenses_active_default_target
  ON research_lenses(primary_target_id)
  WHERE is_default = TRUE AND deleted_at IS NULL AND primary_target_id IS NOT NULL;
