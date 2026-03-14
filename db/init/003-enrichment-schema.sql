-- 003-enrichment-schema.sql
-- Enrichment provenance tables: person_enrichments, work_history, education, company_enrichments

CREATE TABLE person_enrichments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT,
  raw_response JSONB,
  enriched_fields TEXT[] DEFAULT '{}',
  confidence REAL,
  cost_cents INTEGER DEFAULT 0,
  enriched_at TIMESTAMPTZ DEFAULT now_utc(),
  expires_at TIMESTAMPTZ,
  UNIQUE(contact_id, provider)
);

CREATE TABLE work_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  company_name TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT FALSE,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'csv',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE education (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  degree TEXT,
  field_of_study TEXT,
  start_date DATE,
  end_date DATE,
  source TEXT NOT NULL DEFAULT 'csv',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE company_enrichments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  raw_response JSONB,
  enriched_fields TEXT[] DEFAULT '{}',
  cost_cents INTEGER DEFAULT 0,
  enriched_at TIMESTAMPTZ DEFAULT now_utc(),
  expires_at TIMESTAMPTZ,
  UNIQUE(company_id, provider)
);

-- Indexes
CREATE INDEX idx_work_history_contact_id ON work_history(contact_id);
CREATE INDEX idx_work_history_company_id ON work_history(company_id);
CREATE INDEX idx_education_contact_id ON education(contact_id);
CREATE INDEX idx_person_enrichments_contact_id ON person_enrichments(contact_id);
CREATE INDEX idx_company_enrichments_company_id ON company_enrichments(company_id);
