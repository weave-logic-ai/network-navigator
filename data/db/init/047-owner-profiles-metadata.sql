-- Research Tools Sprint — ICP audit fixes (issue #19, #18 item 3).
--
-- Two schema-drift fixes bundled together because both were hidden behind
-- app-code workarounds discovered in the same audit pass:
--
-- 1. `owner_profiles.metadata` — the desired-ICP config (niche/ICP selection
--    the user picked to compare their profile against) was being persisted
--    via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` run on every request in
--    app/src/app/api/profile/desired-icp/route.ts and
--    app/src/app/api/profile/gap-analysis/route.ts. That hid the column from
--    this init-script source of truth, required the app's DB role to hold
--    DDL privileges in production, took a DDL lock on every hit, and made
--    the column's existence depend on one of those two routes having run at
--    least once. This migration makes the column part of the tracked
--    schema; the two ALTER TABLE calls in the route handlers are removed in
--    the same change.
--
-- 2. `icp_profiles.source` — the Natural ICP auto-detection
--    (app/src/lib/scoring/natural-icp.ts) upserts a single row and claims,
--    in its own comments, that it is identified by `source = 'natural'`.
--    No such column existed; the lookup actually matched on the literal
--    name string 'Natural ICP (auto-detected)', which is fragile (a rename
--    breaks the upsert-vs-insert check silently) and made the comments
--    describe behavior the code didn't have. This adds the real column and
--    the natural-ICP upsert now writes and matches on it. Existing rows
--    that were already using the name-match convention are back-filled so
--    the transition is lossless.

ALTER TABLE owner_profiles
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

ALTER TABLE icp_profiles
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE icp_profiles
SET source = 'natural'
WHERE name = 'Natural ICP (auto-detected)'
  AND source IS NULL;
