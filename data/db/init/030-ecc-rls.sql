-- ECC Sprint: Row Level Security for all ECC tables
-- Follows same pattern as existing 022-enable-rls.sql

-- Enable RLS on all new tables
ALTER TABLE causal_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE causal_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE exo_chain_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE impulses ENABLE ROW LEVEL SECURITY;
ALTER TABLE impulse_handlers ENABLE ROW LEVEL SECURITY;
ALTER TABLE impulse_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cross_refs ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
-- Tables with direct tenant_id
CREATE POLICY tenant_isolation_causal_nodes ON causal_nodes
  FOR ALL USING (tenant_id = get_current_tenant_id());
CREATE POLICY admin_bypass_causal_nodes ON causal_nodes
  FOR ALL USING (is_super_admin());

CREATE POLICY tenant_isolation_exo_chain ON exo_chain_entries
  FOR ALL USING (tenant_id = get_current_tenant_id());
CREATE POLICY admin_bypass_exo_chain ON exo_chain_entries
  FOR ALL USING (is_super_admin());

CREATE POLICY tenant_isolation_impulses ON impulses
  FOR ALL USING (tenant_id = get_current_tenant_id());
CREATE POLICY admin_bypass_impulses ON impulses
  FOR ALL USING (is_super_admin());

CREATE POLICY tenant_isolation_impulse_handlers ON impulse_handlers
  FOR ALL USING (tenant_id = get_current_tenant_id());
CREATE POLICY admin_bypass_impulse_handlers ON impulse_handlers
  FOR ALL USING (is_super_admin());

CREATE POLICY tenant_isolation_research_sessions ON research_sessions
  FOR ALL USING (tenant_id = get_current_tenant_id());
CREATE POLICY admin_bypass_research_sessions ON research_sessions
  FOR ALL USING (is_super_admin());

CREATE POLICY tenant_isolation_cross_refs ON cross_refs
  FOR ALL USING (tenant_id = get_current_tenant_id());
CREATE POLICY admin_bypass_cross_refs ON cross_refs
  FOR ALL USING (is_super_admin());

-- Tables without direct tenant_id — use join-based policies

-- causal_edges: tenant isolation via source_node join
CREATE POLICY tenant_isolation_causal_edges ON causal_edges
  FOR ALL USING (source_node_id IN (
    SELECT id FROM causal_nodes WHERE tenant_id = get_current_tenant_id()
  ));
CREATE POLICY admin_bypass_causal_edges ON causal_edges
  FOR ALL USING (is_super_admin());

-- impulse_acks: tenant isolation via impulse join
CREATE POLICY tenant_isolation_impulse_acks ON impulse_acks
  FOR ALL USING (impulse_id IN (
    SELECT id FROM impulses WHERE tenant_id = get_current_tenant_id()
  ));
CREATE POLICY admin_bypass_impulse_acks ON impulse_acks
  FOR ALL USING (is_super_admin());

-- session_messages: tenant isolation via session join
CREATE POLICY tenant_isolation_session_messages ON session_messages
  FOR ALL USING (session_id IN (
    SELECT id FROM research_sessions WHERE tenant_id = get_current_tenant_id()
  ));
CREATE POLICY admin_bypass_session_messages ON session_messages
  FOR ALL USING (is_super_admin());
