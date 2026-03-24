-- 032-knowledge-schema.sql
-- Knowledge graph snapshots: entity co-occurrence graphs computed from contact profiles

CREATE TABLE IF NOT EXISTS knowledge_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche_id UUID REFERENCES niche_profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'local',
  clusters JSONB NOT NULL DEFAULT '[]',
  bridges JSONB NOT NULL DEFAULT '[]',
  gaps JSONB NOT NULL DEFAULT '[]',
  entities JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',
  entity_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_niche ON knowledge_snapshots(niche_id, created_at DESC);
