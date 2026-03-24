# ECC Sprint — Architecture

**Date**: 2026-03-24
**Pattern**: Incremental cognitive layer on existing PostgreSQL + Next.js

---

## Architectural Decision: PostgreSQL-Native ECC

Unlike mentra (Rust in-memory CMVG on ARM SoC) and clawstage (WASM with RVF binary containers), NetworkNav's ECC implementation is **PostgreSQL-native**. The rationale:

1. NetworkNav already has 25+ tables with RLS — adding cognitive tables is natural
2. No separate storage system to maintain, deploy, or sync
3. SQL queryability means CausalGraph is explorable via standard tools
4. Tenant isolation via RLS extends automatically to all ECC data
5. pgvector already available for future HNSW semantic search

**Trade-off accepted**: We lose mentra's <15ms tick latency and clawstage's offline-first CRDT/Merkle split. We gain operational simplicity, immediate queryability, and zero new infrastructure.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Existing NetworkNav                        │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  Next.js   │  │  PostgreSQL   │  │  Chrome Extension  │  │
│  │  90+ API   │  │  25+ tables   │  │  MV3 + sidepanel   │  │
│  │  routes    │  │  pgvector     │  │  capture queue      │  │
│  └─────┬──────┘  │  ruvector     │  └──────┬─────────────┘  │
│        │         └───────┬──────┘         │                  │
│  ══════╪═════════════════╪════════════════╪═══════════════   │
│        │    ECC Cognitive Layer (NEW)     │                  │
│  ┌─────┴─────────────────┴───────────────┴──────────────┐   │
│  │                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ CausalGraph │  │  ExoChain   │  │  Impulses   │  │   │
│  │  │ (scoring    │  │ (enrichment │  │ (event-     │  │   │
│  │  │  provenance)│  │  audit)     │  │  driven     │  │   │
│  │  │             │  │             │  │  automation) │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐                    │   │
│  │  │ Cognitive   │  │  CrossRefs  │                    │   │
│  │  │ Tick        │  │ (typed      │                    │   │
│  │  │ (research   │  │  entity     │                    │   │
│  │  │  sessions)  │  │  relations) │                    │   │
│  │  └─────────────┘  └─────────────┘                    │   │
│  │                                                       │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ New PostgreSQL Tables ──────────────────────────────┐   │
│  │ causal_nodes, causal_edges, exo_chain_entries,       │   │
│  │ impulses, impulse_handlers, impulse_acks,            │   │
│  │ research_sessions, session_messages, cross_refs       │   │
│  │ (all with tenant_id + RLS)                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Taxonomy Fix: Schema Migrations

### Migration: `024-taxonomy-hierarchy.sql` (MUST run before ECC migrations)

```sql
-- 1. Create verticals table (new top-level taxonomy)
CREATE TABLE verticals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TRIGGER trg_verticals_updated_at
  BEFORE UPDATE ON verticals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Add vertical_id to niche_profiles, replacing flat 'industry' text
ALTER TABLE niche_profiles ADD COLUMN vertical_id UUID REFERENCES verticals(id);

-- Migrate existing industry text → verticals rows
INSERT INTO verticals (name, slug, description)
SELECT DISTINCT industry, LOWER(REPLACE(industry, ' ', '-')), 'Migrated from niche_profiles.industry'
FROM niche_profiles
WHERE industry IS NOT NULL AND industry != ''
ON CONFLICT (name) DO NOTHING;

UPDATE niche_profiles np SET vertical_id = v.id
FROM verticals v WHERE LOWER(np.industry) = LOWER(v.name);

-- Add unique constraint: no duplicate niche names within a vertical
ALTER TABLE niche_profiles ADD CONSTRAINT uq_niche_vertical_name UNIQUE (vertical_id, name);

-- Drop the flat industry column (data migrated to vertical FK)
ALTER TABLE niche_profiles DROP COLUMN industry;

-- 3. Add niche_id to icp_profiles
ALTER TABLE icp_profiles ADD COLUMN niche_id UUID REFERENCES niche_profiles(id);

-- Add unique constraint: no duplicate ICP names within a niche
ALTER TABLE icp_profiles ADD CONSTRAINT uq_icp_niche_name UNIQUE (niche_id, name);

-- 4. Drop stale niche_offerings (offerings associate at ICP level via icp_offerings)
-- Keep icp_offerings as-is

-- 5. Indexes
CREATE INDEX idx_niche_profiles_vertical ON niche_profiles(vertical_id);
CREATE INDEX idx_icp_profiles_niche ON icp_profiles(niche_id);
CREATE INDEX idx_verticals_slug ON verticals(slug);
```

**Note on tenant migrations**: The original 021-023 tenant migrations referenced `icp_configs`, `niche_configs`, `offering_configs` — tables that don't exist (actual names are `icp_profiles`, `niche_profiles`, `offerings`). Those migrations have been archived to `docs/multitenant/archive/`. When multi-tenancy is re-introduced, the migrations must use the correct table names and include the new `verticals` table.

---

## Module Structure

```
app/src/lib/taxonomy/            # NEW — Vertical→Niche→ICP hierarchy
├── types.ts                     # Vertical, NicheProfile (with vertical_id), IcpProfile (with niche_id)
├── service.ts                   # CRUD for verticals, niche hierarchy queries, ICP resolution
└── discovery.ts                 # Fixed ICP discovery with de-duplication

app/src/lib/ecc/
├── index.ts                  # Public exports
├── types.ts                  # Shared ECC types (CausalNode, ExoChainEntry, Impulse, etc.)
├── causal-graph/
│   ├── types.ts              # CausalNode, CausalEdge, CausalRelation
│   ├── service.ts            # createNode, createEdge, getGraph, getTrace
│   ├── counterfactual.ts     # counterfactualScore, diffGraphs
│   └── scoring-adapter.ts    # Wraps existing scoring pipeline with causal tracking
├── exo-chain/
│   ├── types.ts              # ExoChainEntry, ChainOperation
│   ├── service.ts            # appendEntry, getChain, verifyChain
│   ├── hash.ts               # BLAKE3 hashing (via js-blake3 or Web Crypto fallback)
│   └── enrichment-adapter.ts # Wraps existing waterfall with chain tracking
├── impulses/
│   ├── types.ts              # Impulse, ImpulseHandler, ImpulseAck, ImpulseType enum
│   ├── emitter.ts            # emitImpulse (sync insert + async dispatch)
│   ├── dispatcher.ts         # dispatchImpulse, executeHandler
│   ├── handlers/
│   │   ├── task-generator.ts # Creates tasks from score impulses
│   │   ├── campaign-enroller.ts  # Enrolls contacts in campaigns
│   │   └── notification.ts   # Sends notifications
│   └── scoring-adapter.ts    # Hooks into scoring pipeline for impulse emission
├── cognitive-tick/
│   ├── types.ts              # ResearchSession, SessionMessage
│   ├── session-service.ts    # CRUD for sessions
│   └── claude-adapter.ts     # Wraps Claude API calls with session context
└── cross-refs/
    ├── types.ts              # CrossRef, CrossRefType enum
    ├── service.ts            # CRUD, query by edge/contact/type
    └── enrichment-adapter.ts # Extracts CrossRefs from enrichment results
```

---

## Database Schema (New Tables)

### Migration: `025-ecc-causal-graph.sql`

```sql
-- Causal provenance for scoring and enrichment decisions
CREATE TABLE causal_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL,          -- 'score', 'dimension', 'input', 'weight', 'enrichment'
  entity_id TEXT NOT NULL,            -- dimension name, contact_score.id, etc.
  operation TEXT NOT NULL,            -- 'compute_icp_fit', 'apply_weight', etc.
  inputs JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  session_id UUID,                    -- optional research session link
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE causal_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id UUID NOT NULL REFERENCES causal_nodes(id),
  target_node_id UUID NOT NULL REFERENCES causal_nodes(id),
  relation TEXT NOT NULL,             -- 'caused', 'enabled', 'weighted_by', 'derived_from', 'merged_into'
  weight REAL DEFAULT 1.0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_causal_nodes_tenant ON causal_nodes(tenant_id);
CREATE INDEX idx_causal_nodes_entity ON causal_nodes(tenant_id, entity_type, entity_id);
CREATE INDEX idx_causal_edges_source ON causal_edges(source_node_id);
CREATE INDEX idx_causal_edges_target ON causal_edges(target_node_id);
```

### Migration: `026-ecc-exo-chain.sql`

```sql
-- Hash-linked audit trail for enrichment and other decision chains
CREATE TABLE exo_chain_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  chain_id UUID NOT NULL,             -- groups entries for one operation
  sequence INT NOT NULL,
  prev_hash BYTEA,                    -- BLAKE3 of previous entry (null for genesis)
  entry_hash BYTEA NOT NULL,          -- BLAKE3(prev_hash || operation || data || timestamp)
  operation TEXT NOT NULL,
  data JSONB NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chain_id, sequence)
);

CREATE INDEX idx_exo_chain_tenant ON exo_chain_entries(tenant_id);
CREATE INDEX idx_exo_chain_chain ON exo_chain_entries(chain_id, sequence);
```

### Migration: `027-ecc-impulses.sql`

```sql
-- Event-driven automation: impulses + handlers + acknowledgments
CREATE TABLE impulses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  impulse_type TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE impulse_handlers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  impulse_type TEXT NOT NULL,
  handler_type TEXT NOT NULL,         -- 'task_generator', 'campaign_enroller', 'notification'
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE impulse_acks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impulse_id UUID NOT NULL REFERENCES impulses(id),
  handler_id UUID NOT NULL REFERENCES impulse_handlers(id),
  status TEXT NOT NULL,               -- 'success', 'failed', 'skipped'
  result JSONB DEFAULT '{}',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_impulses_tenant_type ON impulses(tenant_id, impulse_type);
CREATE INDEX idx_impulses_created ON impulses(tenant_id, created_at DESC);
CREATE INDEX idx_impulse_handlers_type ON impulse_handlers(tenant_id, impulse_type) WHERE enabled;
CREATE INDEX idx_impulse_acks_impulse ON impulse_acks(impulse_id);
```

### Migration: `028-ecc-cognitive-tick.sql`

```sql
-- Research session context for stateful Claude integration
CREATE TABLE research_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  intent JSONB NOT NULL DEFAULT '{}',
  context JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES research_sessions(id),
  role TEXT NOT NULL,                 -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  context_snapshot JSONB DEFAULT '{}',
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_tenant_user ON research_sessions(tenant_id, user_id);
CREATE INDEX idx_sessions_status ON research_sessions(tenant_id, status);
CREATE INDEX idx_session_messages_session ON session_messages(session_id, created_at);
```

### Migration: `029-ecc-cross-refs.sql`

```sql
-- Typed semantic annotations on entity relationships
CREATE TABLE cross_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  edge_id UUID NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL,               -- 'enrichment:pdl', 'user:manual', 'graph:inference'
  source_entity_id UUID,
  bidirectional BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cross_refs_edge ON cross_refs(edge_id);
CREATE INDEX idx_cross_refs_type ON cross_refs(tenant_id, relation_type);
CREATE INDEX idx_cross_refs_source ON cross_refs(tenant_id, source);
```

### Migration: `030-ecc-rls.sql`

```sql
-- RLS policies for all ECC tables (same pattern as 022-enable-rls.sql)
ALTER TABLE causal_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE causal_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE exo_chain_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE impulses ENABLE ROW LEVEL SECURITY;
ALTER TABLE impulse_handlers ENABLE ROW LEVEL SECURITY;
ALTER TABLE impulse_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cross_refs ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies (causal_nodes as example; repeat for all)
CREATE POLICY tenant_isolation ON causal_nodes
  FOR ALL USING (tenant_id = get_current_tenant_id());
CREATE POLICY admin_bypass ON causal_nodes
  FOR ALL USING (is_super_admin());

-- session_messages uses session join (no direct tenant_id)
CREATE POLICY tenant_isolation ON session_messages
  FOR ALL USING (session_id IN (
    SELECT id FROM research_sessions WHERE tenant_id = get_current_tenant_id()
  ));

-- causal_edges uses source node join
CREATE POLICY tenant_isolation ON causal_edges
  FOR ALL USING (source_node_id IN (
    SELECT id FROM causal_nodes WHERE tenant_id = get_current_tenant_id()
  ));
```

---

## Integration Pattern: Adapter Layer

The key architectural decision is the **adapter pattern** — each ECC module wraps an existing service without modifying its internals.

```
┌──────────────────────────────┐
│  API Route: /scoring/run     │
│  (unchanged contract)        │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  scoring-adapter.ts (NEW)    │  ← Wraps existing pipeline
│  - Creates CausalGraph nodes │
│  - Emits Impulses            │
│  - Returns score + trace     │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  scoring/pipeline.ts         │
│  (existing, unchanged)       │  ← Pure scoring logic stays pure
└──────────────────────────────┘
```

This means:
- Existing tests continue to pass (scoring/pipeline.ts unchanged)
- New tests cover the adapter layer
- ECC can be feature-flagged off (adapter becomes passthrough)
- Each ECC module is independently testable

---

## Data Flow: Score a Contact (Full ECC)

```
1. POST /api/scoring/run {contactId}
2. scoring-adapter.ts:
   a. Create root CausalNode (operation: 'score_contact')
   b. For each dimension:
      - Call existing scorer → get raw score
      - Create dimension CausalNode
      - Create CausalEdge (input → dimension → weighted → root)
   c. Call existing computeCompositeScore()
   d. Compare with previous score:
      - If tier changed → emitImpulse('tier_changed')
      - If persona changed → emitImpulse('persona_assigned')
   e. Return {score, causalGraph} to API route
3. API route returns existing score format + optional `_causal` field
4. Impulse dispatcher (async):
   a. Find matching handlers for 'tier_changed'
   b. Execute task-generator handler → creates task
   c. Record acknowledgments
```

---

## Feature Flag Strategy

```typescript
// app/src/lib/ecc/config.ts
export const ECC_FLAGS = {
  causalGraph: process.env.ECC_CAUSAL_GRAPH === 'true',
  exoChain: process.env.ECC_EXO_CHAIN === 'true',
  impulses: process.env.ECC_IMPULSES === 'true',
  cognitiveTick: process.env.ECC_COGNITIVE_TICK === 'true',
  crossRefs: process.env.ECC_CROSS_REFS === 'true',
};
```

Each adapter checks its flag and either:
- **Enabled**: Full ECC tracking + return enriched response
- **Disabled**: Passthrough to existing service, no overhead

---

## Adaptation from Reference Implementations

| ECC Concept | mentra Source | clawstage Source | NetworkNav Adaptation |
|-------------|-------------|-----------------|----------------------|
| CausalGraph | DEMOCRITUS sparse CSR matrix, incremental Laplacian | petgraph DAG with typed edges | PostgreSQL tables with typed edges, SQL-queryable |
| ExoChain | SHAKE-256 + Ed25519 append-only log | ScoredWitnessEntry with BLAKE3 chain | BLAKE3-hashed PostgreSQL rows, chain_id grouping |
| Impulses | VAD/button/sensor events via daemon | 12 HLC-ordered types across 5 engines | PostgreSQL + async dispatch, handler registry |
| CognitiveTick | 50ms cycle (8 phases on ARM) | 8-stage pipeline in WASM | Request-driven sessions in PostgreSQL |
| CrossRefs | Merkle node IDs + HNSW exact match | Bidirectional store with engine-tag filtering | PostgreSQL table annotating existing edges |
| Node Identity | BLAKE3(content + parent_hash) | UniversalNodeId with engine prefix | UUID primary keys (Merkle integrity deferred) |
| Wavefront | On-device boundary (CRDT/Merkle split) | CRDT above / Merkle below consensus | Not applicable (single-writer PostgreSQL) |
