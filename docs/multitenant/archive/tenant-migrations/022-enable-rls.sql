-- ============================================
-- 022-enable-rls.sql
-- Row-Level Security policies for multi-tenancy
-- ============================================

-- Helper functions for setting context
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', tenant_id::TEXT, false);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_admin_context(is_admin BOOLEAN)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', is_admin::TEXT, false);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN current_setting('app.current_tenant_id', true)::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('app.is_super_admin', true)::BOOLEAN, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- Enable RLS on all tenant-scoped tables
-- ============================================

-- Core tables
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_memberships ENABLE ROW LEVEL SECURITY;

-- Enrichment tables
ALTER TABLE person_enrichments ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_enrichments ENABLE ROW LEVEL SECURITY;

-- Scoring tables
ALTER TABLE contact_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE icp_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE niche_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE offering_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_scores ENABLE ROW LEVEL SECURITY;

-- Outreach tables
ALTER TABLE outreach_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

-- Extension tables
ALTER TABLE extension_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE selector_configs ENABLE ROW LEVEL SECURITY;

-- Behavioral tables
ALTER TABLE engagement_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavioral_profiles ENABLE ROW LEVEL SECURITY;

-- Task/goal tables
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_contacts ENABLE ROW LEVEL SECURITY;

-- Graph tables
ALTER TABLE community_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_sync_state ENABLE ROW LEVEL SECURITY;

-- Budget/import tables
ALTER TABLE enrichment_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_spends ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_queue ENABLE ROW LEVEL SECURITY;

-- Cache tables
ALTER TABLE score_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE vector_metadata_cache ENABLE ROW LEVEL SECURITY;

-- System tables
ALTER TABLE owner_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Tenant isolation policies
-- ============================================

-- Contacts
CREATE POLICY tenant_isolation_contacts ON contacts
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

CREATE POLICY tenant_insert_contacts ON contacts
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Companies
CREATE POLICY tenant_isolation_companies ON companies
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Edges
CREATE POLICY tenant_isolation_edges ON edges
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Clusters
CREATE POLICY tenant_isolation_clusters ON clusters
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Cluster memberships
CREATE POLICY tenant_isolation_cluster_memberships ON cluster_memberships
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Person enrichments
CREATE POLICY tenant_isolation_person_enrichments ON person_enrichments
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Company enrichments
CREATE POLICY tenant_isolation_company_enrichments ON company_enrichments
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Contact scores
CREATE POLICY tenant_isolation_contact_scores ON contact_scores
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- ICP configs
CREATE POLICY tenant_isolation_icp_configs ON icp_configs
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Niche configs
CREATE POLICY tenant_isolation_niche_configs ON niche_configs
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Offering configs
CREATE POLICY tenant_isolation_offering_configs ON offering_configs
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Referral scores
CREATE POLICY tenant_isolation_referral_scores ON referral_scores
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Outreach states
CREATE POLICY tenant_isolation_outreach_states ON outreach_states
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Message templates
CREATE POLICY tenant_isolation_message_templates ON message_templates
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Conversations
CREATE POLICY tenant_isolation_conversations ON conversations
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Conversation messages
CREATE POLICY tenant_isolation_conversation_messages ON conversation_messages
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Extension tokens
CREATE POLICY tenant_isolation_extension_tokens ON extension_tokens
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Page cache
CREATE POLICY tenant_isolation_page_cache ON page_cache
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Raw captures
CREATE POLICY tenant_isolation_raw_captures ON raw_captures
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Extension settings
CREATE POLICY tenant_isolation_extension_settings ON extension_settings
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Selector configs
CREATE POLICY tenant_isolation_selector_configs ON selector_configs
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Engagement scores
CREATE POLICY tenant_isolation_engagement_scores ON engagement_scores
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Response predictions
CREATE POLICY tenant_isolation_response_predictions ON response_predictions
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Communication patterns
CREATE POLICY tenant_isolation_communication_patterns ON communication_patterns
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Behavioral profiles
CREATE POLICY tenant_isolation_behavioral_profiles ON behavioral_profiles
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Tasks
CREATE POLICY tenant_isolation_tasks ON tasks
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Goals
CREATE POLICY tenant_isolation_goals ON goals
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Goal contacts
CREATE POLICY tenant_isolation_goal_contacts ON goal_contacts
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Community mappings
CREATE POLICY tenant_isolation_community_mappings ON community_mappings
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Graph sync state
CREATE POLICY tenant_isolation_graph_sync_state ON graph_sync_state
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Enrichment budgets
CREATE POLICY tenant_isolation_enrichment_budgets ON enrichment_budgets
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Enrichment spends
CREATE POLICY tenant_isolation_enrichment_spends ON enrichment_spends
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Import batches
CREATE POLICY tenant_isolation_import_batches ON import_batches
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Import records
CREATE POLICY tenant_isolation_import_records ON import_records
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Enrichment queue
CREATE POLICY tenant_isolation_enrichment_queue ON enrichment_queue
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Score cache
CREATE POLICY tenant_isolation_score_cache ON score_cache
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Vector metadata cache
CREATE POLICY tenant_isolation_vector_metadata_cache ON vector_metadata_cache
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Owner profiles
CREATE POLICY tenant_isolation_owner_profiles ON owner_profiles
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- ============================================
-- Tenant users and API keys policies
-- Users can see their own memberships and API keys for their tenant
-- ============================================

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;

-- Tenant users: users can see their own memberships
CREATE POLICY tenant_isolation_tenant_users ON tenant_users
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- API keys: only visible within tenant
CREATE POLICY tenant_isolation_tenant_api_keys ON tenant_api_keys
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Audit logs: only visible within tenant
CREATE POLICY tenant_isolation_tenant_audit_logs ON tenant_audit_logs
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- Usage: only visible within tenant
CREATE POLICY tenant_isolation_tenant_usage ON tenant_usage
  FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin());

-- ============================================
-- Super admin bypass policies
-- These allow super admins to access all data
-- ============================================

-- Already included in each policy above with OR is_super_admin()
-- The tenants table itself is accessible to super admins

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_super_admin ON tenants
  FOR ALL USING (is_super_admin());

-- Tenants can be viewed by their members
CREATE POLICY tenants_member_view ON tenants
  FOR SELECT USING (
    id IN (
      SELECT tenant_id FROM tenant_users 
      WHERE user_id = current_setting('app.current_user_id', true)
    )
    OR is_super_admin()
  );
