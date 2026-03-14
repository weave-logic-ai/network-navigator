-- 007-scoring-schema.sql
-- Scoring tables: contact_scores, score_dimensions, scoring_weight_profiles, tier_thresholds + seed data

CREATE TABLE contact_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  composite_score REAL NOT NULL DEFAULT 0,
  tier TEXT CHECK (tier IN ('gold', 'silver', 'bronze', 'watch', 'unscored')),
  persona TEXT,
  behavioral_persona TEXT,
  scored_at TIMESTAMPTZ DEFAULT now_utc(),
  scoring_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
);

CREATE TABLE score_dimensions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_score_id UUID NOT NULL REFERENCES contact_scores(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  raw_value REAL NOT NULL DEFAULT 0,
  weighted_value REAL NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_score_id, dimension)
);

CREATE TABLE scoring_weight_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  weights JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE tier_thresholds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES scoring_weight_profiles(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  min_score REAL NOT NULL,
  max_score REAL,
  degree INTEGER,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(profile_id, tier, degree)
);

-- Indexes
CREATE INDEX idx_contact_scores_tier ON contact_scores(tier);
CREATE INDEX idx_contact_scores_composite ON contact_scores(composite_score);
CREATE INDEX idx_score_dimensions_score_id ON score_dimensions(contact_score_id);

-- updated_at trigger
CREATE TRIGGER trg_contact_scores_updated_at
  BEFORE UPDATE ON contact_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_scoring_weight_profiles_updated_at
  BEFORE UPDATE ON scoring_weight_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed default scoring weight profile
INSERT INTO scoring_weight_profiles (name, description, weights, is_default) VALUES (
  'default',
  'Default scoring weight profile for Phase 1',
  '{
    "icp_fit": 0.20,
    "network_hub": 0.10,
    "relationship_strength": 0.15,
    "signal_boost": 0.10,
    "skills_relevance": 0.10,
    "network_proximity": 0.05,
    "behavioral": 0.10,
    "content_relevance": 0.10,
    "graph_centrality": 0.10
  }'::jsonb,
  TRUE
);

-- Seed default tier thresholds (degree-aware: 1st-degree)
INSERT INTO tier_thresholds (profile_id, tier, min_score, max_score, degree)
SELECT id, 'gold', 80.0, 100.0, 1 FROM scoring_weight_profiles WHERE name = 'default'
UNION ALL
SELECT id, 'silver', 60.0, 79.99, 1 FROM scoring_weight_profiles WHERE name = 'default'
UNION ALL
SELECT id, 'bronze', 40.0, 59.99, 1 FROM scoring_weight_profiles WHERE name = 'default'
UNION ALL
SELECT id, 'watch', 20.0, 39.99, 1 FROM scoring_weight_profiles WHERE name = 'default'
UNION ALL
SELECT id, 'unscored', 0.0, 19.99, 1 FROM scoring_weight_profiles WHERE name = 'default';

-- Seed default tier thresholds (degree-aware: 2nd-degree, higher bar)
INSERT INTO tier_thresholds (profile_id, tier, min_score, max_score, degree)
SELECT id, 'gold', 90.0, 100.0, 2 FROM scoring_weight_profiles WHERE name = 'default'
UNION ALL
SELECT id, 'silver', 70.0, 89.99, 2 FROM scoring_weight_profiles WHERE name = 'default'
UNION ALL
SELECT id, 'bronze', 50.0, 69.99, 2 FROM scoring_weight_profiles WHERE name = 'default'
UNION ALL
SELECT id, 'watch', 30.0, 49.99, 2 FROM scoring_weight_profiles WHERE name = 'default'
UNION ALL
SELECT id, 'unscored', 0.0, 29.99, 2 FROM scoring_weight_profiles WHERE name = 'default';
