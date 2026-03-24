-- ECC Sprint: CrossRefs — typed semantic annotations on entity relationships

CREATE TABLE IF NOT EXISTS cross_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  edge_id UUID NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source TEXT NOT NULL,
  source_entity_id UUID,
  bidirectional BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate CrossRefs for same edge + relation_type + source
CREATE UNIQUE INDEX IF NOT EXISTS uq_cross_ref_edge_type_source
  ON cross_refs (edge_id, relation_type, source);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cross_refs_edge ON cross_refs(edge_id);
CREATE INDEX IF NOT EXISTS idx_cross_refs_type ON cross_refs(tenant_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_cross_refs_source ON cross_refs(tenant_id, source);
CREATE INDEX IF NOT EXISTS idx_cross_refs_confidence ON cross_refs(tenant_id, confidence DESC);

-- Updated_at trigger
CREATE TRIGGER trg_cross_refs_updated_at
  BEFORE UPDATE ON cross_refs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
