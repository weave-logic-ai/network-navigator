-- 031-goal-engine-schema.sql
-- Goal engine: feedback tracking, status expansion

-- 1. Expand goals status to include 'suggested' and 'rejected'
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_status_check;
ALTER TABLE goals ADD CONSTRAINT goals_status_check
  CHECK (status IN ('active', 'completed', 'paused', 'cancelled', 'suggested', 'rejected'));

-- 2. Goal check feedback — tracks accept/reject per check type + context
-- Engine requires 3 rejections of the same check+context within 30 days to suppress
CREATE TABLE IF NOT EXISTS goal_check_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_type TEXT NOT NULL,
  goal_type TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gcf_lookup
  ON goal_check_feedback (check_type, context_hash, created_at DESC);

-- 3. Index for goal dedup (find active/suggested goals by type)
CREATE INDEX IF NOT EXISTS idx_goals_type_status
  ON goals (goal_type, status);
CREATE INDEX IF NOT EXISTS idx_goals_source
  ON goals (source);
