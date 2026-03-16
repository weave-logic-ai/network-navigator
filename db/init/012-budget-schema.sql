-- 012-budget-schema.sql
-- Budget/cost tracking: enrichment_providers, budget_periods, enrichment_transactions + seed data

CREATE TABLE enrichment_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  api_base_url TEXT,
  cost_per_lookup_cents INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_minute INTEGER,
  is_active BOOLEAN DEFAULT FALSE,
  capabilities TEXT[] DEFAULT '{}',
  priority INTEGER DEFAULT 50,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE budget_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_type TEXT NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('daily', 'weekly', 'monthly', 'yearly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  budget_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER DEFAULT 0,
  lookup_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(period_type, period_start)
);

CREATE TABLE enrichment_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES enrichment_providers(id),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  budget_period_id UUID REFERENCES budget_periods(id),
  cost_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'cached', 'rate_limited')),
  fields_returned TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

-- Indexes
CREATE INDEX idx_enrichment_transactions_provider_id ON enrichment_transactions(provider_id);
CREATE INDEX idx_enrichment_transactions_budget_period_id ON enrichment_transactions(budget_period_id);
CREATE INDEX idx_enrichment_transactions_contact_id ON enrichment_transactions(contact_id);

-- updated_at trigger
CREATE TRIGGER trg_enrichment_providers_updated_at
  BEFORE UPDATE ON enrichment_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed known providers (inactive by default)
INSERT INTO enrichment_providers (name, display_name, cost_per_lookup_cents, capabilities, priority) VALUES
  ('pdl', 'People Data Labs', 10, ARRAY['email', 'phone', 'social', 'employment', 'education'], 10),
  ('lusha', 'Lusha', 15, ARRAY['email', 'phone', 'company'], 20),
  ('theirstack', 'TheirStack', 5, ARRAY['technographics', 'company'], 30),
  ('apollo', 'Apollo.io', 8, ARRAY['email', 'phone', 'company', 'employment'], 40),
  ('crunchbase', 'Crunchbase', 20, ARRAY['company', 'funding', 'leadership'], 50),
  ('builtwith', 'BuiltWith', 12, ARRAY['technographics', 'website'], 60),
  ('linkedin', 'LinkedIn (Extension)', 0, ARRAY['profile', 'employment', 'education', 'skills', 'connections', 'activity'], 5);
