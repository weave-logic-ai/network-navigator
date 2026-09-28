-- Run only against disposable schema_verify after init through 054 without 024z.
-- From the repository root: psql -X -v ON_ERROR_STOP=1 -f tests/schema/055-duplicate-niche-upgrade.sql
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'schema_verify'
     OR EXISTS (SELECT 1 FROM icp_profiles WHERE name = 'Health Tech Founders') THEN
    RAISE EXCEPTION 'This fixture requires a disposable, unseeded schema_verify database';
  END IF;
END $$;

INSERT INTO industries (name, slug) VALUES
  ('Healthcare & Life Sciences', 'healthcare'),
  ('Financial Services & Fintech', 'fintech');

-- Both seed names occur in both industries. Only the indicated UUID for each
-- industry may become the seeded ICP's niche_id.
INSERT INTO niche_profiles (id, name, industry_id) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Digital Health Startups',
   (SELECT id FROM industries WHERE slug = 'healthcare')),
  ('22222222-2222-4222-8222-222222222222', 'Digital Health Startups',
   (SELECT id FROM industries WHERE slug = 'fintech')),
  ('33333333-3333-4333-8333-333333333333', 'Embedded Finance & Payments',
   (SELECT id FROM industries WHERE slug = 'healthcare')),
  ('44444444-4444-4444-8444-444444444444', 'Embedded Finance & Payments',
   (SELECT id FROM industries WHERE slug = 'fintech'));

\ir ../../data/db/init/055-offerings-taxonomy-upgrade.sql

DO $$
BEGIN
  IF (SELECT niche_id FROM icp_profiles WHERE name = 'Health Tech Founders')
       IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid
     OR (SELECT niche_id FROM icp_profiles WHERE name = 'Fintech Founders')
       IS DISTINCT FROM '44444444-4444-4444-8444-444444444444'::uuid THEN
    RAISE EXCEPTION 'Seeded ICP linked to a niche in the wrong industry';
  END IF;
  IF (SELECT count(*) FROM niche_profiles WHERE name = 'Digital Health Startups') <> 2
     OR (SELECT count(*) FROM niche_profiles WHERE name = 'Embedded Finance & Payments') <> 2 THEN
    RAISE EXCEPTION 'Upgrade changed existing cross-industry niche rows';
  END IF;
END $$;

CREATE TEMP TABLE before_rerun AS
SELECT (SELECT count(*) FROM industries) AS industries,
       (SELECT count(*) FROM niche_profiles) AS niches,
       (SELECT count(*) FROM icp_profiles) AS icps,
       (SELECT count(*) FROM offerings) AS offerings;

\ir ../../data/db/init/055-offerings-taxonomy-upgrade.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM before_rerun b
    WHERE b.industries <> (SELECT count(*) FROM industries)
       OR b.niches <> (SELECT count(*) FROM niche_profiles)
       OR b.icps <> (SELECT count(*) FROM icp_profiles)
       OR b.offerings <> (SELECT count(*) FROM offerings)
  ) THEN
    RAISE EXCEPTION 'Upgrade rerun inserted duplicate taxonomy rows';
  END IF;
  IF (SELECT niche_id FROM icp_profiles WHERE name = 'Health Tech Founders')
       IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid
     OR (SELECT niche_id FROM icp_profiles WHERE name = 'Fintech Founders')
       IS DISTINCT FROM '44444444-4444-4444-8444-444444444444'::uuid THEN
    RAISE EXCEPTION 'Upgrade rerun changed seeded ICP associations';
  END IF;
END $$;
