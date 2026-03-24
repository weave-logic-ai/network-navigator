-- ECC Sprint: Impulse System — event-driven automation
-- Decoupled scoring/enrichment events → handlers (task generation, campaign enrollment, notifications)

CREATE TABLE IF NOT EXISTS impulses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  impulse_type TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS impulse_handlers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  impulse_type TEXT NOT NULL,
  handler_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS impulse_acks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impulse_id UUID NOT NULL REFERENCES impulses(id) ON DELETE CASCADE,
  handler_id UUID NOT NULL REFERENCES impulse_handlers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  result JSONB DEFAULT '{}',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_impulses_tenant_type ON impulses(tenant_id, impulse_type);
CREATE INDEX IF NOT EXISTS idx_impulses_created ON impulses(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_impulses_source ON impulses(source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_impulse_handlers_type ON impulse_handlers(tenant_id, impulse_type) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_impulse_handlers_tenant ON impulse_handlers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_impulse_acks_impulse ON impulse_acks(impulse_id);
CREATE INDEX IF NOT EXISTS idx_impulse_acks_handler ON impulse_acks(handler_id);

-- Updated_at trigger for handlers
CREATE TRIGGER trg_impulse_handlers_updated_at
  BEFORE UPDATE ON impulse_handlers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
