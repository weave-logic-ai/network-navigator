-- 014-system-schema.sql
-- schema_versions, enriched_contacts materialized view, refresh function

CREATE TABLE schema_versions (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  description TEXT,
  applied_at TIMESTAMPTZ DEFAULT now_utc()
);

-- Insert initial schema version
INSERT INTO schema_versions (version, description) VALUES ('1.0.0', 'Phase 1 Foundation schema');

-- Materialized view joining across all major tables
CREATE MATERIALIZED VIEW enriched_contacts AS
SELECT
  c.id,
  c.linkedin_url,
  c.first_name,
  c.last_name,
  c.full_name,
  c.headline,
  c.title,
  c.current_company,
  c.location,
  c.email,
  c.phone,
  c.degree,
  c.tags,
  c.created_at,
  c.updated_at,
  co.name AS company_name,
  co.industry AS company_industry,
  co.size_range AS company_size,
  cs.composite_score,
  cs.tier,
  cs.persona,
  cs.behavioral_persona,
  ms.total_messages,
  ms.last_message_at,
  os.state AS outreach_state,
  CASE WHEN pe.id IS NOT NULL THEN 'enriched' ELSE 'pending' END AS enrichment_status
FROM contacts c
LEFT JOIN companies co ON c.current_company_id = co.id
LEFT JOIN contact_scores cs ON cs.contact_id = c.id
LEFT JOIN message_stats ms ON ms.contact_id = c.id
LEFT JOIN outreach_states os ON os.contact_id = c.id
LEFT JOIN person_enrichments pe ON pe.contact_id = c.id
WITH DATA;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_enriched_contacts_id ON enriched_contacts(id);
CREATE INDEX idx_enriched_contacts_composite_score ON enriched_contacts(composite_score);

-- Function to refresh the materialized view concurrently
CREATE OR REPLACE FUNCTION refresh_enriched_contacts()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_contacts;
END;
$$ LANGUAGE plpgsql;
