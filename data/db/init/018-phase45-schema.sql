-- 018-phase45-schema.sql
-- Phase 4.5: offerings, action_log (time machine), niche scoring columns, offering associations

-- Offerings table
CREATE TABLE offerings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TRIGGER trg_offerings_updated_at
  BEFORE UPDATE ON offerings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed example offerings
INSERT INTO offerings (name, description, sort_order) VALUES
  ('Fractional CTO', 'Strategic technology leadership on a part-time basis', 1),
  ('Automation Assessment', 'Evaluate and identify automation opportunities', 2),
  ('Agentic Development Pipeline', 'AI-powered development workflow implementation', 3)
ON CONFLICT (name) DO NOTHING;

-- Action log (time machine)
CREATE TABLE action_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'user',
  target_type TEXT NOT NULL,
  target_id UUID,
  target_name TEXT,
  before_snapshot JSONB DEFAULT '{}',
  after_snapshot JSONB DEFAULT '{}',
  choices JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  reverted_at TIMESTAMPTZ,
  reverted_by UUID REFERENCES action_log(id),
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE INDEX idx_action_log_target ON action_log(target_type, target_id);
CREATE INDEX idx_action_log_type ON action_log(action_type);
CREATE INDEX idx_action_log_created ON action_log(created_at DESC);

-- Niche scoring columns
ALTER TABLE niche_profiles ADD COLUMN IF NOT EXISTS affordability INTEGER CHECK (affordability BETWEEN 1 AND 5);
ALTER TABLE niche_profiles ADD COLUMN IF NOT EXISTS fitability INTEGER CHECK (fitability BETWEEN 1 AND 5);
ALTER TABLE niche_profiles ADD COLUMN IF NOT EXISTS buildability INTEGER CHECK (buildability BETWEEN 1 AND 5);
ALTER TABLE niche_profiles ADD COLUMN IF NOT EXISTS niche_score REAL GENERATED ALWAYS AS (
  COALESCE(affordability, 0) + COALESCE(fitability, 0) + COALESCE(buildability, 0)
) STORED;

-- Offering associations
CREATE TABLE niche_offerings (
  niche_id UUID NOT NULL REFERENCES niche_profiles(id) ON DELETE CASCADE,
  offering_id UUID NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  PRIMARY KEY (niche_id, offering_id)
);

CREATE TABLE icp_offerings (
  icp_id UUID NOT NULL REFERENCES icp_profiles(id) ON DELETE CASCADE,
  offering_id UUID NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  PRIMARY KEY (icp_id, offering_id)
);
