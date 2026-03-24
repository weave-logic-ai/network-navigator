-- ECC Sprint: CognitiveTick — research session context for stateful Claude integration

CREATE TABLE IF NOT EXISTS research_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  intent JSONB NOT NULL DEFAULT '{}',
  context JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  context_snapshot JSONB DEFAULT '{}',
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_user ON research_sessions(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON research_sessions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON research_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_messages_role ON session_messages(session_id, role);

-- Updated_at trigger
CREATE TRIGGER trg_research_sessions_updated_at
  BEFORE UPDATE ON research_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
