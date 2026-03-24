-- ECC Sprint: ExoChain — hash-linked audit trail for enrichment decisions
-- Append-only chain with BLAKE3 hash integrity verification

CREATE TABLE IF NOT EXISTS exo_chain_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  chain_id UUID NOT NULL,
  sequence INT NOT NULL,
  prev_hash BYTEA,
  entry_hash BYTEA NOT NULL,
  operation TEXT NOT NULL,
  data JSONB NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_chain_sequence UNIQUE (chain_id, sequence)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exo_chain_tenant ON exo_chain_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exo_chain_chain ON exo_chain_entries(chain_id, sequence);
CREATE INDEX IF NOT EXISTS idx_exo_chain_operation ON exo_chain_entries(tenant_id, operation);
CREATE INDEX IF NOT EXISTS idx_exo_chain_created ON exo_chain_entries(tenant_id, created_at DESC);
