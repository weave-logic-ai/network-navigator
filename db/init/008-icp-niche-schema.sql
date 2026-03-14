-- 008-icp-niche-schema.sql
-- ICP/niche profile tables: niche_profiles, icp_profiles, contact_icp_fits, wedge_metrics

CREATE TABLE niche_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  industry TEXT,
  keywords TEXT[] DEFAULT '{}',
  company_size_range TEXT,
  geo_focus TEXT[] DEFAULT '{}',
  member_count INTEGER DEFAULT 0,
  centroid RUVECTOR(384),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE icp_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  criteria JSONB NOT NULL DEFAULT '{}',
  weight_overrides JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE contact_icp_fits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  icp_profile_id UUID NOT NULL REFERENCES icp_profiles(id) ON DELETE CASCADE,
  fit_score REAL NOT NULL DEFAULT 0,
  fit_breakdown JSONB DEFAULT '{}',
  computed_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id, icp_profile_id)
);

CREATE TABLE wedge_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche_id UUID NOT NULL REFERENCES niche_profiles(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,
  metric_value REAL NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT now_utc(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(niche_id, metric_type)
);

-- Indexes
CREATE INDEX idx_contact_icp_fits_contact_id ON contact_icp_fits(contact_id);
CREATE INDEX idx_contact_icp_fits_icp_profile_id ON contact_icp_fits(icp_profile_id);
CREATE INDEX idx_wedge_metrics_niche_id ON wedge_metrics(niche_id);

-- updated_at triggers
CREATE TRIGGER trg_niche_profiles_updated_at
  BEFORE UPDATE ON niche_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_icp_profiles_updated_at
  BEFORE UPDATE ON icp_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
