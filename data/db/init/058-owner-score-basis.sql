-- Apply this file once to an existing volume with psql -X -v ON_ERROR_STOP=1 -f.
-- The transaction makes the basis guard, revision and impulse queue an atomic upgrade.
BEGIN;

-- Owner ICP membership is explicit. Both scoped and legacy unscoped target
-- associations may represent lens templates. Only truly unassociated or
-- natural profiles are auto-classified; review shared profiles before rollout.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'icp_profiles'
                   AND column_name = 'owner_baseline') THEN
    ALTER TABLE icp_profiles ADD COLUMN owner_baseline BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE icp_profiles ip SET owner_baseline = TRUE
    WHERE ip.is_active = TRUE AND (
      ip.source = 'natural' OR NOT EXISTS (
        SELECT 1 FROM research_target_icps rti
        WHERE rti.icp_profile_id = ip.id
      )
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_owner_scoring_icps
  ON icp_profiles(name, id) WHERE is_active = TRUE AND owner_baseline = TRUE;

-- D2 cutover: old contact_scores have no reliable owner/lens provenance.
-- New owner writes are marked, and the first replacement of an unverified row
-- saves its prior score and dimensions once for per-contact rollback.
ALTER TABLE contact_scores
  ADD COLUMN IF NOT EXISTS basis_kind TEXT NOT NULL DEFAULT 'legacy-unverified'
    CHECK (basis_kind IN ('legacy-unverified', 'owner')),
  ADD COLUMN IF NOT EXISTS basis_hash TEXT DEFAULT NULL
    CHECK ((basis_kind = 'legacy-unverified' AND basis_hash IS NULL) OR
           (basis_kind = 'owner' AND basis_hash ~ '^[0-9a-f]{64}$')),
  ADD COLUMN IF NOT EXISTS score_revision BIGINT NOT NULL DEFAULT 0
    CHECK (score_revision >= 0);

-- A scored impulse is stored in the score transaction. A drainer processes
-- pending rows by contact/revision/event order and can retry after a crash.
ALTER TABLE impulses
  ADD COLUMN IF NOT EXISTS score_revision BIGINT,
  ADD COLUMN IF NOT EXISTS score_event_order SMALLINT,
  ADD COLUMN IF NOT EXISTS score_dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS score_last_attempt_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_scoring_impulse_order
  ON impulses(source_entity_id, score_revision, score_event_order)
  WHERE source_entity_type = 'contact' AND score_revision IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scoring_impulses_pending
  ON impulses(source_entity_id, score_revision, score_event_order)
  WHERE source_entity_type = 'contact' AND score_revision IS NOT NULL
    AND score_dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scoring_impulses_recovery
  ON impulses((COALESCE(score_last_attempt_at, created_at)), id)
  WHERE source_entity_type = 'contact' AND score_revision IS NOT NULL
    AND score_dispatched_at IS NULL;

-- A scoring purge can remove contact_scores while keeping the contact and
-- its committed impulses. Revisions must never restart at one in that case.
CREATE TABLE IF NOT EXISTS score_contact_revisions (
  contact_id UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  last_revision BIGINT NOT NULL DEFAULT 0 CHECK (last_revision >= 0)
);
INSERT INTO score_contact_revisions(contact_id, last_revision)
SELECT contact_id, MAX(score_revision) FROM contact_scores GROUP BY contact_id
ON CONFLICT (contact_id) DO UPDATE SET last_revision =
  GREATEST(score_contact_revisions.last_revision, EXCLUDED.last_revision);
INSERT INTO score_contact_revisions(contact_id, last_revision)
SELECT source_entity_id, MAX(score_revision) FROM impulses
WHERE source_entity_type = 'contact' AND score_revision IS NOT NULL
  AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = source_entity_id)
GROUP BY source_entity_id
ON CONFLICT (contact_id) DO UPDATE SET last_revision =
  GREATEST(score_contact_revisions.last_revision, EXCLUDED.last_revision);

-- Existing success acknowledgments are the durable per-handler completion
-- ledger. This lookup index also covers upgrades with retained ack history.
CREATE INDEX IF NOT EXISTS idx_impulse_success_completions
  ON impulse_acks(impulse_id, handler_id) WHERE status = 'success';

CREATE TABLE IF NOT EXISTS score_context_legacy_backups (
  contact_id UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  score_row JSONB NOT NULL,
  dimensions JSONB NOT NULL,
  referral_dimensions JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Import source data and its remaining contacts commit together. The worker
-- saves one owner basis before the first score and marks each contact done in
-- the same transaction as that contact's score and side effects.
CREATE TABLE IF NOT EXISTS score_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source = 'legacy-graph'),
  basis_json JSONB,
  basis_hash TEXT CHECK (basis_hash IS NULL OR basis_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK ((basis_json IS NULL) = (basis_hash IS NULL))
);
CREATE TABLE IF NOT EXISTS score_import_job_contacts (
  job_id UUID NOT NULL REFERENCES score_import_jobs(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  scored_at TIMESTAMPTZ,
  skipped_at TIMESTAMPTZ,
  skip_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (job_id, contact_id),
  CHECK (scored_at IS NULL OR skipped_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_score_import_jobs_pending
  ON score_import_jobs((COALESCE(last_attempt_at, created_at)), id)
  WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_score_import_job_contacts_pending
  ON score_import_job_contacts(job_id, attempts, contact_id)
  WHERE scored_at IS NULL AND skipped_at IS NULL;

-- Final 056 limits uq_tasks_pending_auto_recommendation to SEND_MESSAGE,
-- RESEARCH and ENGAGE_CONTENT. Leave that identity-owned index untouched.
-- Notifications use an impulse-id ledger instead of contact/type uniqueness.
CREATE TABLE IF NOT EXISTS impulse_notification_tasks (
  impulse_id UUID PRIMARY KEY REFERENCES impulses(id) ON DELETE CASCADE,
  -- Retain a tombstone if the user deletes a notification task: retries of
  -- the same impulse must not recreate a deliberately removed task.
  task_id UUID UNIQUE REFERENCES tasks(id) ON DELETE SET NULL
);
INSERT INTO impulse_notification_tasks(impulse_id, task_id)
SELECT DISTINCT ON (i.id) i.id, t.id
FROM tasks t JOIN impulses i ON i.id::text = t.metadata->>'impulseId'
WHERE t.source = 'impulse' AND t.task_type = 'notification'
ORDER BY i.id, t.created_at, t.id
ON CONFLICT (impulse_id) DO NOTHING;

-- set_config(..., true) is transaction-local. Older app versions do not set
-- it. Old writers are rejected for both new and existing rows after cutover;
-- marking a corrupt write legacy would still leave its tier/persona visible.
-- Locking the contact on INSERT serializes even competing first-score writes.
CREATE OR REPLACE FUNCTION guard_contact_score_basis()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM contacts WHERE id = NEW.contact_id FOR UPDATE;
  END IF;
  IF current_setting('app.score_owner_restore', true) = 'true' THEN
    IF NEW.basis_kind <> 'legacy-unverified' OR NEW.basis_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy restore must invalidate owner basis';
    END IF;
  ELSIF current_setting('app.score_owner_write', true) = 'true' THEN
    IF NEW.basis_kind <> 'owner' OR NEW.basis_hash IS NULL THEN
      RAISE EXCEPTION 'Owner score write requires owner basis metadata';
    END IF;
  ELSE
    RAISE EXCEPTION 'Contact score write requires owner scoring writer'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_contact_score_basis ON contact_scores;
CREATE TRIGGER trg_guard_contact_score_basis
  BEFORE INSERT OR UPDATE ON contact_scores
  FOR EACH ROW EXECUTE FUNCTION guard_contact_score_basis();

-- Operator rollback for one contact. Run under a maintenance window after
-- stopping score writers; restore from a full DB backup for a fleet rollback.
-- This does not replay tasks or impulses.
CREATE OR REPLACE FUNCTION restore_legacy_contact_score(p_contact_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE saved score_context_legacy_backups%ROWTYPE;
BEGIN
  PERFORM 1 FROM contacts WHERE id = p_contact_id FOR UPDATE;
  SELECT * INTO saved FROM score_context_legacy_backups
  WHERE contact_id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  PERFORM set_config('app.score_owner_restore', 'true', true);

  UPDATE contact_scores SET
    composite_score = (saved.score_row->>'composite_score')::real,
    tier = saved.score_row->>'tier',
    persona = saved.score_row->>'persona',
    behavioral_persona = saved.score_row->>'behavioral_persona',
    scoring_version = (saved.score_row->>'scoring_version')::integer,
    scored_at = (saved.score_row->>'scored_at')::timestamptz,
    referral_likelihood = (saved.score_row->>'referral_likelihood')::real,
    referral_tier = saved.score_row->>'referral_tier',
    referral_persona = saved.score_row->>'referral_persona',
    behavioral_signals = NULLIF(saved.score_row->'behavioral_signals', 'null'::jsonb),
    referral_signals = NULLIF(saved.score_row->'referral_signals', 'null'::jsonb),
    basis_kind = 'legacy-unverified',
    basis_hash = NULL
  WHERE contact_id = p_contact_id AND id = (saved.score_row->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Score row for % changed; restore from full backup', p_contact_id; END IF;

  DELETE FROM score_dimensions WHERE contact_score_id = (saved.score_row->>'id')::uuid;
  INSERT INTO score_dimensions
    SELECT * FROM jsonb_populate_recordset(NULL::score_dimensions, saved.dimensions);
  DELETE FROM referral_dimensions WHERE contact_score_id = (saved.score_row->>'id')::uuid;
  INSERT INTO referral_dimensions
    SELECT * FROM jsonb_populate_recordset(NULL::referral_dimensions, saved.referral_dimensions);
  DELETE FROM impulses WHERE source_entity_type = 'contact'
    AND source_entity_id = p_contact_id AND score_revision IS NOT NULL
    AND score_dispatched_at IS NULL;
  RETURN TRUE;
END;
$$;

COMMIT;
