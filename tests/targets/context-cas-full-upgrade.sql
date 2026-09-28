-- Run only on a disposable database after the full 001-055 schema and 056.
-- CAS_SEED_ONLY seeds persisted pre-057 rows for a backup/restore probe;
-- CAS_VERIFY_ONLY then applies 057 and runs all assertions without reseeding.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'research_target_state' AND column_name = 'revision') THEN
    RAISE EXCEPTION '057 was already applied; use a fresh disposable database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'research_target_state'::regclass
                   AND confrelid = 'research_lenses'::regclass
                   AND contype = 'f') OR
     NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'research_target_icps'::regclass
                   AND confrelid = 'research_lenses'::regclass
                   AND contype = 'f') THEN
    RAISE EXCEPTION 'Full pre-057 lens FK schema is missing';
  END IF;
  IF to_regclass('public.uq_tasks_pending_identity_repair_contact') IS NULL OR
     to_regclass('public.uq_tasks_pending_auto_recommendation') IS NULL THEN
    RAISE EXCEPTION 'Migration 056 must precede 057 in this proof';
  END IF;
END $$;

\if :{?CAS_VERIFY_ONLY}
\else
INSERT INTO tenants (id, slug, name) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'cas-proof', 'CAS Proof');
INSERT INTO owner_profiles (id, is_current, first_name) VALUES
  ('a0000000-0000-4000-8000-000000000002', true, 'Proof');
INSERT INTO contacts (id, linkedin_url) VALUES
  ('a0000000-0000-4000-8000-000000000003', 'https://www.linkedin.com/in/cas-proof');
INSERT INTO icp_profiles (id, name) VALUES
  ('a0000000-0000-4000-8000-000000000004', 'CAS Proof ICP');
INSERT INTO research_targets (id, tenant_id, kind, owner_id, label) VALUES
  ('a0000000-0000-4000-8000-000000000005',
   'a0000000-0000-4000-8000-000000000001', 'self',
   'a0000000-0000-4000-8000-000000000002', 'Self');
INSERT INTO research_targets (id, tenant_id, kind, contact_id, label) VALUES
  ('a0000000-0000-4000-8000-000000000006',
   'a0000000-0000-4000-8000-000000000001', 'contact',
   'a0000000-0000-4000-8000-000000000003', 'Focus');
INSERT INTO research_lenses (id, tenant_id, user_id, name, primary_target_id, is_default) VALUES
  ('a0000000-0000-4000-8000-000000000007',
   'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'Saved',
   'a0000000-0000-4000-8000-000000000006', TRUE);
INSERT INTO research_lenses (id, tenant_id, user_id, name, primary_target_id, is_default) VALUES
  ('a0000000-0000-4000-8000-000000000008',
   'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'Duplicate default',
   'a0000000-0000-4000-8000-000000000006', TRUE);
INSERT INTO research_target_icps (target_id, icp_profile_id, lens_id) VALUES
  ('a0000000-0000-4000-8000-000000000006',
   'a0000000-0000-4000-8000-000000000004',
   'a0000000-0000-4000-8000-000000000007');
INSERT INTO research_target_state
  (tenant_id, user_id, primary_target_id, secondary_target_id, last_used_lens_id, history) VALUES
  ('a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000005',
   'a0000000-0000-4000-8000-000000000006',
   'a0000000-0000-4000-8000-000000000007',
   '[{"targetId":"a0000000-0000-4000-8000-000000000005","lensId":null,"openedAt":"2026-09-27T00:00:00Z"}]');
\endif

\if :{?CAS_SEED_ONLY}
SELECT 'full existing-schema CAS fixture seeded before 057' AS result;
\else
\ir ../../data/db/init/057-target-state-revision.sql
\ir ../../data/db/init/057-target-state-revision.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM research_target_state
    WHERE user_id = 'a0000000-0000-4000-8000-000000000002'
      AND revision = 0
      AND secondary_target_id = 'a0000000-0000-4000-8000-000000000006'
      AND last_used_lens_id = 'a0000000-0000-4000-8000-000000000007'
      AND jsonb_array_length(history) = 1) THEN
    RAISE EXCEPTION '057 did not preserve existing context';
  END IF;
  IF (SELECT count(*) FROM research_lenses
      WHERE primary_target_id = 'a0000000-0000-4000-8000-000000000006'
        AND is_default = TRUE AND deleted_at IS NULL) <> 1 OR
     to_regclass('public.uq_research_lenses_active_default_target') IS NULL THEN
    RAISE EXCEPTION '057 did not reconcile and constrain duplicate defaults';
  END IF;
END $$;

UPDATE research_target_state SET history = '[]'::jsonb
WHERE user_id = 'a0000000-0000-4000-8000-000000000002';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM research_target_state WHERE revision = 1
    AND user_id = 'a0000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'history change did not bump revision';
  END IF;
END $$;

DELETE FROM research_lenses WHERE id = 'a0000000-0000-4000-8000-000000000007';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM research_target_state WHERE revision = 2
    AND last_used_lens_id IS NULL
    AND user_id = 'a0000000-0000-4000-8000-000000000002') OR
    EXISTS (SELECT 1 FROM research_target_icps
      WHERE lens_id = 'a0000000-0000-4000-8000-000000000007') THEN
    RAISE EXCEPTION 'lens FK cleanup did not bump revision and remove scoped ICP';
  END IF;
END $$;

DELETE FROM contacts WHERE id = 'a0000000-0000-4000-8000-000000000003';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM research_targets
    WHERE id = 'a0000000-0000-4000-8000-000000000006') OR
     NOT EXISTS (SELECT 1 FROM research_target_state WHERE revision = 3
       AND secondary_target_id IS NULL
       AND user_id = 'a0000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'subject cascade did not clear focus and bump revision';
  END IF;
END $$;
SELECT 'full existing-schema CAS upgrade passed' AS result;
\endif
