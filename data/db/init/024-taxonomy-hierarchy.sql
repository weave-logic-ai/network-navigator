-- 024-taxonomy-hierarchy.sql
-- Industry → Niche → ICP → Offering taxonomy hierarchy
-- Data-preserving migration: verticals → industries (keeps IDs + relationships)

-- ============================================================
-- 1. Create industries table (if it doesn't already exist)
-- ============================================================
CREATE TABLE IF NOT EXISTS industries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Constraints (safe to run repeatedly thanks to IF NOT EXISTS / DO NOTHING pattern)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_industries_name') THEN
    ALTER TABLE industries ADD CONSTRAINT uq_industries_name UNIQUE (name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_industries_slug') THEN
    ALTER TABLE industries ADD CONSTRAINT uq_industries_slug UNIQUE (slug);
  END IF;
END $$;

-- Trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_industries_updated_at') THEN
    CREATE TRIGGER trg_industries_updated_at
      BEFORE UPDATE ON industries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ============================================================
-- 2. Migrate data from verticals → industries (preserving UUIDs)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'verticals') THEN
    -- Copy all verticals into industries, keeping same IDs
    INSERT INTO industries (id, name, slug, description, metadata, created_at, updated_at)
    SELECT id, name, slug, description, metadata, created_at, updated_at
    FROM verticals
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Seed "General" fallback (for fresh DBs or if verticals had none)
INSERT INTO industries (name, slug, description)
VALUES ('General', 'general', 'Default industry for unmapped niches')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 3. Migrate niche_profiles: vertical_id → industry_id
-- ============================================================

-- Add industry_id column if missing
ALTER TABLE niche_profiles ADD COLUMN IF NOT EXISTS industry_id UUID REFERENCES industries(id);

-- Copy vertical_id values into industry_id (same UUIDs, so FK is valid)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'niche_profiles' AND column_name = 'vertical_id'
  ) THEN
    UPDATE niche_profiles
    SET industry_id = vertical_id
    WHERE industry_id IS NULL AND vertical_id IS NOT NULL;
  END IF;
END $$;

-- Also handle legacy flat industry text column (from 008 schema, pre-verticals)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'niche_profiles' AND column_name = 'industry'
  ) THEN
    -- Create industry rows from the text values
    INSERT INTO industries (name, slug, description)
    SELECT DISTINCT
      industry,
      LOWER(REGEXP_REPLACE(REPLACE(industry, ' ', '-'), '[^a-z0-9-]', '', 'g')),
      'Migrated from niche_profiles.industry'
    FROM niche_profiles
    WHERE industry IS NOT NULL AND industry != '' AND industry != 'General'
    ON CONFLICT (name) DO NOTHING;

    -- Link niches to the industry rows
    UPDATE niche_profiles np
    SET industry_id = i.id
    FROM industries i
    WHERE LOWER(TRIM(np.industry)) = LOWER(TRIM(i.name))
      AND np.industry_id IS NULL;

    -- Drop the flat text column (data is now in industries FK)
    ALTER TABLE niche_profiles DROP COLUMN IF EXISTS industry;
  END IF;
END $$;

-- Assign orphan niches to General
UPDATE niche_profiles
SET industry_id = (SELECT id FROM industries WHERE slug = 'general')
WHERE industry_id IS NULL;

-- ============================================================
-- 4. Clean up old vertical_id column and verticals table
-- ============================================================
ALTER TABLE niche_profiles DROP CONSTRAINT IF EXISTS uq_niche_vertical_name;
ALTER TABLE niche_profiles DROP COLUMN IF EXISTS vertical_id;
DROP INDEX IF EXISTS idx_niche_profiles_vertical;
DROP INDEX IF EXISTS idx_verticals_slug;
DROP TABLE IF EXISTS verticals;

-- ============================================================
-- 5. Add industry constraint + index on niche_profiles
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_niche_industry_name') THEN
    ALTER TABLE niche_profiles ADD CONSTRAINT uq_niche_industry_name UNIQUE (industry_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_niche_profiles_industry ON niche_profiles(industry_id);

-- ============================================================
-- 6. Link icp_profiles → niche_profiles via niche_id FK
-- ============================================================
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS niche_id UUID REFERENCES niche_profiles(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_icp_niche_name
  ON icp_profiles (niche_id, name) WHERE niche_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_icp_profiles_niche ON icp_profiles(niche_id);

-- ============================================================
-- 7. Industries index
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_industries_slug ON industries(slug);
