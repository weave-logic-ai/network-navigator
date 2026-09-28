-- The original (target_id, icp_profile_id) key cannot represent one ICP in
-- two lenses on the same target. Before changing it, restore the original
-- target-only rows: migration 046 assigned all of them to a default lens,
-- without evidence that they were scoped to that lens. The old primary key
-- identifies an upgrade that has not yet run this correction.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'research_target_icps'::regclass
      AND conname = 'research_target_icps_pkey'
  ) THEN
    UPDATE research_target_icps SET lens_id = NULL WHERE lens_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE research_target_icps
  DROP CONSTRAINT IF EXISTS research_target_icps_pkey;

-- A physical lens delete must remove its scoped associations. SET NULL could
-- collide with an existing legacy row for the same target and ICP.
ALTER TABLE research_target_icps
  DROP CONSTRAINT IF EXISTS research_target_icps_lens_id_fkey;
ALTER TABLE research_target_icps
  ADD CONSTRAINT research_target_icps_lens_id_fkey
  FOREIGN KEY (lens_id) REFERENCES research_lenses(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_research_target_icps_unscoped
  ON research_target_icps(target_id, icp_profile_id)
  WHERE lens_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_research_target_icps_scoped
  ON research_target_icps(target_id, lens_id, icp_profile_id)
  WHERE lens_id IS NOT NULL;

-- Copy only explicit, existing lens/ICP links from the old JSON config.
-- The ICP join ignores stale or malformed IDs without fabricating profiles.
INSERT INTO research_target_icps (target_id, icp_profile_id, lens_id)
SELECT DISTINCT rl.primary_target_id, ip.id, rl.id
FROM research_lenses rl
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(rl.config->'icpProfileIds') = 'array'
       THEN rl.config->'icpProfileIds' ELSE '[]'::jsonb END
) AS listed(icp_id)
JOIN icp_profiles ip ON ip.id::text = lower(listed.icp_id)
WHERE rl.primary_target_id IS NOT NULL
ON CONFLICT DO NOTHING;
