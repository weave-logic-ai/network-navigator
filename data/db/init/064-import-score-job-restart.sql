-- A captured owner basis is immutable. If its owner disappears, end that job
-- and rescore its cohort in a new job with a fresh basis.
ALTER TABLE score_import_jobs
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS restarted_as_job_id UUID REFERENCES score_import_jobs(id);

DROP INDEX IF EXISTS idx_score_import_jobs_pending;
CREATE INDEX idx_score_import_jobs_pending
  ON score_import_jobs((COALESCE(last_attempt_at, created_at)), id)
  WHERE completed_at IS NULL AND failed_at IS NULL;
