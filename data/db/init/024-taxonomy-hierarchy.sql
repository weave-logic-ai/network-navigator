-- ECC Sprint: Vertical→Niche→ICP taxonomy hierarchy
-- Creates verticals table, adds vertical_id FK to niche_profiles, adds niche_id FK to icp_profiles

-- 1. Create verticals table (new top-level taxonomy)
CREATE TABLE IF NOT EXISTS verticals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraints
ALTER TABLE verticals ADD CONSTRAINT uq_verticals_name UNIQUE (name);
ALTER TABLE verticals ADD CONSTRAINT uq_verticals_slug UNIQUE (slug);

-- Updated_at trigger
CREATE TRIGGER trg_verticals_updated_at
  BEFORE UPDATE ON verticals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Create "General" fallback vertical for migration
INSERT INTO verticals (name, slug, description)
VALUES ('General', 'general', 'Default vertical for unmapped niches')
ON CONFLICT (name) DO NOTHING;

-- 3. Add vertical_id to niche_profiles (nullable initially for migration)
ALTER TABLE niche_profiles ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id);

-- 4. Migrate existing industry text → verticals rows
INSERT INTO verticals (name, slug, description)
SELECT DISTINCT
  industry,
  LOWER(REGEXP_REPLACE(REPLACE(industry, ' ', '-'), '[^a-z0-9-]', '', 'g')),
  'Migrated from niche_profiles.industry'
FROM niche_profiles
WHERE industry IS NOT NULL AND industry != '' AND industry != 'General'
ON CONFLICT (name) DO NOTHING;

-- 5. Link existing niches to their vertical
UPDATE niche_profiles np
SET vertical_id = v.id
FROM verticals v
WHERE LOWER(TRIM(np.industry)) = LOWER(TRIM(v.name))
  AND np.vertical_id IS NULL;

-- 6. Assign orphan niches (null or empty industry) to General
UPDATE niche_profiles
SET vertical_id = (SELECT id FROM verticals WHERE slug = 'general')
WHERE vertical_id IS NULL;

-- 7. Unique constraint: no duplicate niche names within a vertical
ALTER TABLE niche_profiles ADD CONSTRAINT uq_niche_vertical_name UNIQUE (vertical_id, name);

-- 8. Drop the flat industry column (data migrated to vertical FK)
ALTER TABLE niche_profiles DROP COLUMN IF EXISTS industry;

-- 9. Add niche_id to icp_profiles (nullable — allows gradual assignment)
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS niche_id UUID REFERENCES niche_profiles(id);

-- 10. Unique constraint: no duplicate ICP names within a niche
-- Only enforced when niche_id is set (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_icp_niche_name
  ON icp_profiles (niche_id, name) WHERE niche_id IS NOT NULL;

-- 11. Indexes
CREATE INDEX IF NOT EXISTS idx_niche_profiles_vertical ON niche_profiles(vertical_id);
CREATE INDEX IF NOT EXISTS idx_icp_profiles_niche ON icp_profiles(niche_id);
CREATE INDEX IF NOT EXISTS idx_verticals_slug ON verticals(slug);
