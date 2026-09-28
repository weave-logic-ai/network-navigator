-- Repeat-safe on populated volumes. Conflicts are reported, never silently repaired.
-- Resolve a reported pair explicitly in a transaction by setting is_active=FALSE
-- on the superseded row; its dates, spend, transactions and ID remain intact.
-- ROLLBACK before commit, or set is_active=TRUE later if no period now overlaps.
DO $migration$
DECLARE conflict_pair record;
BEGIN
  SELECT a.id AS first_id, b.id AS second_id INTO conflict_pair
  FROM budget_periods a JOIN budget_periods b ON a.id < b.id
  WHERE a.is_active = TRUE AND b.is_active = TRUE
    AND daterange(a.period_start, a.period_end, '[]') &&
        daterange(b.period_start, b.period_end, '[]')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Overlapping active budget periods: % and %. Resolve explicitly, then rerun 063.',
      conflict_pair.first_id, conflict_pair.second_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_periods_active_no_overlap'
    AND conrelid = 'budget_periods'::regclass) THEN
    ALTER TABLE budget_periods
      ADD CONSTRAINT budget_periods_active_no_overlap
      EXCLUDE USING gist (daterange(period_start, period_end, '[]') WITH &&)
      WHERE (is_active = TRUE);
  END IF;
END $migration$;

-- 012's generated CHECK excludes the invoice-verified ledger state. Replace it
-- in one ALTER TABLE so the old and new definitions are never absent between statements.
ALTER TABLE enrichment_transactions
  DROP CONSTRAINT IF EXISTS enrichment_transactions_status_check,
  ADD CONSTRAINT enrichment_transactions_status_check
    CHECK (status IN ('success', 'failed', 'cached', 'rate_limited', 'reconciled'));

-- A redeemed quote cannot trigger paid providers a second time.
CREATE TABLE IF NOT EXISTS enrichment_quote_uses (
  quote_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pending JSONB,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  response JSONB,
  response_status INTEGER,
  reconciliation_required BOOLEAN NOT NULL DEFAULT false,
  reconciliation_reference TEXT,
  reconciled_cents INTEGER,
  reconciled_at TIMESTAMPTZ,
  execution_state TEXT NOT NULL DEFAULT 'running'
);
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS pending JSONB;
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS results JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS response JSONB;
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS response_status INTEGER;
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS reconciliation_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS reconciliation_reference TEXT;
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS reconciled_cents INTEGER;
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
ALTER TABLE enrichment_quote_uses ADD COLUMN IF NOT EXISTS execution_state TEXT NOT NULL DEFAULT 'running';
UPDATE enrichment_quote_uses SET execution_state=CASE WHEN response_status=207 THEN 'partial' ELSE 'completed' END
  WHERE response_status IS NOT NULL AND execution_state='running';
DO $state$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enrichment_quote_uses_execution_state_check'
    AND conrelid='enrichment_quote_uses'::regclass) THEN
    ALTER TABLE enrichment_quote_uses ADD CONSTRAINT enrichment_quote_uses_execution_state_check
      CHECK (execution_state IN ('running', 'partial', 'completed', 'no_charge'));
  END IF;
END $state$;
-- Serialize paid attempts for the same contact even when two quotes race.
CREATE UNIQUE INDEX IF NOT EXISTS enrichment_quote_pending_contact_unique
  ON enrichment_quote_uses ((pending->>'contactId')) WHERE pending IS NOT NULL;

-- Paid or uncertain lookups remain claimed across quotes; known zero-cost no-matches release on settlement.
CREATE TABLE IF NOT EXISTS enrichment_provider_claims (
  contact_id UUID NOT NULL,
  provider TEXT NOT NULL,
  quote_id UUID NOT NULL REFERENCES enrichment_quote_uses(quote_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, provider)
);

-- One reviewed apply per contact and quote; a replay returns this receipt without another write.
CREATE TABLE IF NOT EXISTS enrichment_apply_receipts (
  quote_id UUID NOT NULL REFERENCES enrichment_quote_uses(quote_id),
  contact_id UUID NOT NULL,
  fields JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quote_id, contact_id)
);
