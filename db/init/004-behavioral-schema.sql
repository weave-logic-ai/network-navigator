-- 004-behavioral-schema.sql
-- Behavioral observation tables: behavioral_observations, content_profiles, activity_patterns

CREATE TABLE behavioral_observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  observation_type TEXT NOT NULL,
  content TEXT,
  url TEXT,
  observed_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'extension',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE content_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  topics TEXT[] DEFAULT '{}',
  tone TEXT,
  posting_frequency TEXT,
  avg_engagement REAL,
  content_type_distribution JSONB DEFAULT '{}',
  last_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
);

CREATE TABLE activity_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL,
  pattern_data JSONB NOT NULL DEFAULT '{}',
  confidence REAL,
  detected_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id, pattern_type)
);

-- Indexes
CREATE INDEX idx_behavioral_observations_contact_id ON behavioral_observations(contact_id);
CREATE INDEX idx_behavioral_observations_type ON behavioral_observations(observation_type);

-- updated_at trigger
CREATE TRIGGER trg_content_profiles_updated_at
  BEFORE UPDATE ON content_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
