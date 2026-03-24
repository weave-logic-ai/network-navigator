-- ECC Sprint: CausalGraph — scoring provenance tracking
-- Tracks dimension contributions through composite scoring as a DAG

CREATE TABLE IF NOT EXISTS causal_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  inputs JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS causal_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id UUID NOT NULL REFERENCES causal_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES causal_nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_causal_nodes_tenant ON causal_nodes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_causal_nodes_entity ON causal_nodes(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_causal_nodes_session ON causal_nodes(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_causal_nodes_created ON causal_nodes(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_causal_edges_source ON causal_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_causal_edges_target ON causal_edges(target_node_id);
