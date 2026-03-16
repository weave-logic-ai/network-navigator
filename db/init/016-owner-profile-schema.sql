-- 016-owner-profile-schema.sql
-- Owner/self profile deep dive: stores the full LinkedIn data export for ICP/niche context
-- Versioned: each import creates a new version so the profile can evolve over time

CREATE TABLE IF NOT EXISTS owner_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'linkedin_export',
  -- Core identity
  first_name TEXT,
  last_name TEXT,
  headline TEXT,
  summary TEXT,
  industry TEXT,
  location TEXT,
  geo_location TEXT,
  zip_code TEXT,
  birth_date TEXT,
  email TEXT,
  phone TEXT,
  twitter_handles TEXT[] DEFAULT '{}',
  websites TEXT[] DEFAULT '{}',
  registered_at TIMESTAMPTZ,
  -- Ad targeting / LinkedIn's view of the user (rich signal data)
  ad_targeting JSONB DEFAULT '{}',
  -- Aggregated profile signals
  skills TEXT[] DEFAULT '{}',
  certifications JSONB DEFAULT '[]',
  honors JSONB DEFAULT '[]',
  organizations JSONB DEFAULT '[]',
  volunteering JSONB DEFAULT '[]',
  projects JSONB DEFAULT '[]',
  courses JSONB DEFAULT '[]',
  events JSONB DEFAULT '[]',
  -- Work history (self positions)
  positions JSONB DEFAULT '[]',
  education JSONB DEFAULT '[]',
  -- Learning activity
  learning_courses JSONB DEFAULT '[]',
  -- Engagement signals
  company_follows TEXT[] DEFAULT '{}',
  saved_job_alerts JSONB DEFAULT '[]',
  -- Endorsements given/received
  endorsements_given JSONB DEFAULT '[]',
  endorsements_received JSONB DEFAULT '[]',
  endorsements_given_count INTEGER DEFAULT 0,
  endorsements_received_count INTEGER DEFAULT 0,
  -- Recommendations given/received
  recommendations_given JSONB DEFAULT '[]',
  recommendations_received JSONB DEFAULT '[]',
  recommendations_given_count INTEGER DEFAULT 0,
  recommendations_received_count INTEGER DEFAULT 0,
  -- Message stats (self)
  total_messages_sent INTEGER DEFAULT 0,
  total_messages_received INTEGER DEFAULT 0,
  total_conversations INTEGER DEFAULT 0,
  -- Invitations stats
  invitations_sent INTEGER DEFAULT 0,
  invitations_received INTEGER DEFAULT 0,
  -- Rich media
  rich_media JSONB DEFAULT '[]',
  -- Receipts (LinkedIn premium history)
  receipts JSONB DEFAULT '[]',
  -- Agent advisement: ICP/niche recommendations based on profile analysis
  agent_advisements JSONB DEFAULT '[]',
  -- Raw file manifest
  imported_files TEXT[] DEFAULT '{}',
  -- Change log from previous version
  change_summary TEXT,
  -- Timestamps
  imported_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE INDEX IF NOT EXISTS idx_owner_profiles_is_current ON owner_profiles(is_current) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_owner_profiles_version ON owner_profiles(version DESC);

CREATE TRIGGER trg_owner_profiles_updated_at
  BEFORE UPDATE ON owner_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
