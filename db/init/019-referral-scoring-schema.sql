-- 019-referral-scoring-schema.sql
-- Adds referral scoring fields to contact_scores + referral_dimensions table

-- Add referral scoring columns to contact_scores
ALTER TABLE contact_scores
  ADD COLUMN IF NOT EXISTS referral_likelihood REAL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS referral_tier TEXT CHECK (referral_tier IN ('gold-referral', 'silver-referral', 'bronze-referral', 'watch-referral', NULL)),
  ADD COLUMN IF NOT EXISTS referral_persona TEXT,
  ADD COLUMN IF NOT EXISTS behavioral_signals JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS referral_signals JSONB DEFAULT NULL;

-- Referral scoring dimension breakdown
CREATE TABLE IF NOT EXISTS referral_dimensions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_score_id UUID NOT NULL REFERENCES contact_scores(id) ON DELETE CASCADE,
  component TEXT NOT NULL,
  raw_value REAL NOT NULL DEFAULT 0,
  weighted_value REAL NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_score_id, component)
);

CREATE INDEX IF NOT EXISTS idx_referral_dimensions_score_id ON referral_dimensions(contact_score_id);
CREATE INDEX IF NOT EXISTS idx_contact_scores_referral_tier ON contact_scores(referral_tier);
CREATE INDEX IF NOT EXISTS idx_contact_scores_referral_likelihood ON contact_scores(referral_likelihood);

-- Scoring run log for tracking rescore-all operations
CREATE TABLE IF NOT EXISTS scoring_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_type TEXT NOT NULL CHECK (run_type IN ('single', 'batch', 'rescore-all')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_contacts INTEGER DEFAULT 0,
  scored_contacts INTEGER DEFAULT 0,
  failed_contacts INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now_utc(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now_utc()
);
