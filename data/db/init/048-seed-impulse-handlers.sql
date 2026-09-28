-- Seed impulse_handlers so ECC_IMPULSES=true actually generates tasks.
--
-- WHY THIS EXISTS
-- ---------------
-- 027-ecc-impulses.sql creates `impulse_handlers`, and dispatchImpulse()
-- routes an impulse ONLY to rows found in that table:
--
--   SELECT ... FROM impulse_handlers
--   WHERE tenant_id = $1 AND impulse_type = $2 AND enabled = true
--
-- Nothing in this repo ever inserted a row. The consequence was that
-- flipping ECC_IMPULSES=true emitted impulses correctly and dispatched
-- them to nobody: zero tasks, no error. Meanwhile task-triggers.ts
-- early-returns under that same flag on the assumption the impulse path
-- has taken over, so enabling it silently disabled task generation
-- outright.
--
-- WHAT IS SEEDED, AND WHAT IS DELIBERATELY NOT
-- --------------------------------------------
-- Only `task_generator`, and only for the three impulse types the scoring
-- pipeline actually emits. This is the minimum that restores parity with
-- the legacy inline path — it is a stability fix, not a feature.
--
--   emitScoringImpulses() (ecc/impulses/scoring-adapter.ts) emits exactly:
--     score_computed, tier_changed, persona_assigned
--   task-generator.ts has a case for exactly those same three.
--
-- The other three handler types are NOT seeded, on purpose:
--   * notification    — its `email` and `webhook` channels currently
--                       return { sent: false, reason: 'not_implemented' }.
--                       To be wired up separately when that work lands.
--   * campaign_enroller — enrolling contacts into campaigns is a real
--                       behaviour change, not parity restoration.
--   * webhook         — fires outbound HTTP to a configured URL; must be
--                       an explicit opt-in, never a default.
--
-- Seeding is scoped to the 'default' tenant only (the single-user local
-- tenant seeded by 020-tenant-schema.sql). New tenants do NOT inherit
-- these rows — registration for them stays an explicit act, which is the
-- model the table's tenant_id column implies.
--
-- Idempotent via NOT EXISTS rather than ON CONFLICT: impulse_handlers has
-- no unique constraint on (tenant_id, impulse_type, handler_type), so
-- ON CONFLICT has nothing to target and a re-run would duplicate rows.
-- Safe to re-run for that reason.
--
-- APPLYING THIS TO AN EXISTING DATABASE
-- --------------------------------------
-- Init scripts under data/db/init/ only run automatically the first time a
-- database is initialized (Docker Compose mounts this directory at
-- /docker-entrypoint-initdb.d). A database that already existed before this
-- file was added will NOT pick it up on its own — apply it by hand:
--
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < data/db/init/048-seed-impulse-handlers.sql
--
-- Verify with:
--   SELECT impulse_type, handler_type, enabled FROM impulse_handlers
--   WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'default');
-- Expect exactly 3 rows (tier_changed, persona_assigned, score_computed),
-- all handler_type = 'task_generator', all enabled = true.
--
-- Full runbook: docs/content/docs/operations/impulse-handlers-migration.mdx
--
-- If this hasn't been applied, dispatchImpulse() (ecc/impulses/dispatcher.ts)
-- logs "No enabled handler registered for impulse_type ..." for every
-- affected impulse — that log line means: come apply this migration.

INSERT INTO impulse_handlers (tenant_id, impulse_type, handler_type, config, enabled, priority)
SELECT t.id, v.impulse_type, 'task_generator', '{}'::jsonb, true, 0
FROM tenants t
CROSS JOIN (VALUES
  ('tier_changed'),
  ('persona_assigned'),
  ('score_computed')
) AS v(impulse_type)
WHERE t.slug = 'default'
  AND NOT EXISTS (
    SELECT 1 FROM impulse_handlers h
    WHERE h.tenant_id = t.id
      AND h.impulse_type = v.impulse_type
      AND h.handler_type = 'task_generator'
  );
