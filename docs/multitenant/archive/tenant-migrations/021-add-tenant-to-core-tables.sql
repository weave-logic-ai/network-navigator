-- ============================================
-- 021-add-tenant-to-core-tables.sql
-- Add tenant_id to all tenant-scoped tables
-- ============================================

-- Core tables
ALTER TABLE contacts ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE companies ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE edges ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE clusters ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE cluster_memberships ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Enrichment tables
ALTER TABLE person_enrichments ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE company_enrichments ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Scoring tables
ALTER TABLE contact_scores ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE icp_configs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE niche_configs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE offering_configs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE referral_scores ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Outreach tables
ALTER TABLE outreach_states ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE message_templates ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE conversations ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE conversation_messages ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Extension tables
ALTER TABLE extension_tokens ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE page_cache ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE raw_captures ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE extension_settings ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE selector_configs ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Behavioral tables
ALTER TABLE engagement_scores ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE response_predictions ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE communication_patterns ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE behavioral_profiles ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Task/goal tables
ALTER TABLE tasks ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE goals ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE goal_contacts ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Graph tables
ALTER TABLE community_mappings ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE graph_sync_state ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Budget/import tables
ALTER TABLE enrichment_budgets ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE enrichment_spends ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE import_batches ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE import_records ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE enrichment_queue ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Cache tables
ALTER TABLE score_cache ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE vector_metadata_cache ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- System tables
ALTER TABLE owner_profiles ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Backfill tenant_id for existing data (single-tenant migration)
DO $$
DECLARE
  default_tenant_id UUID;
BEGIN
  SELECT id INTO default_tenant_id FROM tenants WHERE slug = 'default';
  
  IF default_tenant_id IS NOT NULL THEN
    -- Core tables
    UPDATE contacts SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE companies SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE edges SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE clusters SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE cluster_memberships SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Enrichment tables
    UPDATE person_enrichments SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE company_enrichments SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Scoring tables
    UPDATE contact_scores SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE icp_configs SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE niche_configs SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE offering_configs SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE referral_scores SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Outreach tables
    UPDATE outreach_states SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE message_templates SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE conversations SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE conversation_messages SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Extension tables
    UPDATE extension_tokens SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE page_cache SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE raw_captures SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE extension_settings SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE selector_configs SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Behavioral tables
    UPDATE engagement_scores SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE response_predictions SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE communication_patterns SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE behavioral_profiles SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Task/goal tables
    UPDATE tasks SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE goals SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE goal_contacts SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Graph tables
    UPDATE community_mappings SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE graph_sync_state SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Budget/import tables
    UPDATE enrichment_budgets SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE enrichment_spends SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE import_batches SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE import_records SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE enrichment_queue SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- Cache tables
    UPDATE score_cache SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    UPDATE vector_metadata_cache SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
    
    -- System tables
    UPDATE owner_profiles SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
END $$;

-- Add composite indexes for tenant-scoped queries
CREATE INDEX idx_contacts_tenant_id ON contacts(tenant_id);
CREATE INDEX idx_contacts_tenant_dedup ON contacts(tenant_id, dedup_hash);
CREATE INDEX idx_contacts_tenant_archived ON contacts(tenant_id, is_archived);

CREATE INDEX idx_companies_tenant_id ON companies(tenant_id);
CREATE INDEX idx_edges_tenant_id ON edges(tenant_id);
CREATE INDEX idx_edges_tenant_source ON edges(tenant_id, source_contact_id);

CREATE INDEX idx_contact_scores_tenant_id ON contact_scores(tenant_id);
CREATE INDEX idx_contact_scores_tenant_tier ON contact_scores(tenant_id, tier);

CREATE INDEX idx_icp_configs_tenant_id ON icp_configs(tenant_id);
CREATE INDEX idx_niche_configs_tenant_id ON niche_configs(tenant_id);
CREATE INDEX idx_offering_configs_tenant_id ON offering_configs(tenant_id);

CREATE INDEX idx_outreach_states_tenant_id ON outreach_states(tenant_id);
CREATE INDEX idx_outreach_states_tenant_state ON outreach_states(tenant_id, state);

CREATE INDEX idx_extension_tokens_tenant_id ON extension_tokens(tenant_id);
CREATE INDEX idx_raw_captures_tenant_id ON raw_captures(tenant_id);
CREATE INDEX idx_page_cache_tenant_id ON page_cache(tenant_id);

CREATE INDEX idx_tasks_tenant_id ON tasks(tenant_id);
CREATE INDEX idx_goals_tenant_id ON goals(tenant_id);
CREATE INDEX idx_import_batches_tenant_id ON import_batches(tenant_id);
