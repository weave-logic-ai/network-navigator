# ECC Sprint — Completion

**Date**: 2026-03-24
**Deliverables checklist, acceptance criteria, and launch plan**

---

## Deliverables

### Database Migrations (7 files, ~500 lines SQL)

| File | Tables / Changes | Status |
|------|-----------------|--------|
| `024-taxonomy-hierarchy.sql` | verticals (NEW), niche_profiles.vertical_id (FK), icp_profiles.niche_id (FK), uniqueness constraints, drop niche_profiles.industry | TODO |
| `025-ecc-causal-graph.sql` | causal_nodes, causal_edges | TODO |
| `026-ecc-exo-chain.sql` | exo_chain_entries | TODO |
| `027-ecc-impulses.sql` | impulses, impulse_handlers, impulse_acks | TODO |
| `028-ecc-cognitive-tick.sql` | research_sessions, session_messages | TODO |
| `029-ecc-cross-refs.sql` | cross_refs | TODO |
| `030-ecc-rls.sql` | RLS policies for all above | TODO |

### TypeScript Modules (18 files, ~2300 lines estimated)

| Module | Files | Purpose |
|--------|-------|---------|
| `taxonomy/types.ts` | 1 | Vertical, updated NicheProfile (vertical_id), updated IcpProfile (niche_id) |
| `taxonomy/service.ts` | 1 | Vertical CRUD, hierarchy queries, ICP→Niche→Vertical resolution |
| `taxonomy/discovery.ts` | 1 | Fixed ICP discovery with de-duplication + criteria overlap detection |
| `ecc/types.ts` | 1 | Shared types for all ECC primitives |
| `ecc/index.ts` | 1 | Public exports + feature flags |
| `ecc/causal-graph/` | 4 | CausalGraph service, scoring adapter, counterfactual |
| `ecc/exo-chain/` | 4 | ExoChain service, hash utility, enrichment adapter |
| `ecc/impulses/` | 5 | Emitter, dispatcher, 3 handler implementations |
| `ecc/cognitive-tick/` | 3 | Session service, Claude adapter |
| `ecc/cross-refs/` | 3 | CrossRef service, enrichment adapter |

### Modified Existing Files (13 files)

**Taxonomy fixes (9 files):**

| File | Change |
|------|--------|
| `app/src/lib/graph/icp-discovery.ts` | Remove auto-save; return discoveries only; add dedup |
| `app/src/app/api/icp/discover/route.ts` | GET = discover; POST = save with niche_id + dedup |
| `app/src/lib/scoring/scorers/icp-fit.ts` | Industries inherited from vertical, not criteria |
| `app/src/lib/scoring/pipeline.ts` | Resolve ICP→Niche→Vertical chain |
| `app/src/lib/scoring/types.ts` | Remove industries from IcpCriteria; add nicheKeywords |
| `app/src/lib/db/queries/icps.ts` | Add niche_id queries; findByNicheAndName() |
| `app/src/lib/db/queries/niches.ts` | Replace industry with vertical_id queries |
| `app/src/app/api/niches/route.ts` | Accept vertical_id on create |
| `app/src/app/api/icp/profiles/route.ts` | Accept niche_id on create |

**ECC adapter wiring (4 files, ~40 lines):**

| File | Change |
|------|--------|
| `app/src/app/api/scoring/run/route.ts` | Use scoring-adapter when flag on |
| `app/src/app/api/enrichment/enrich/route.ts` | Use enrichment-adapter when flag on |
| `app/src/app/api/claude/analyze/route.ts` | Accept sessionId, use claude-adapter |
| `app/src/lib/scoring/task-triggers.ts` | Deprecation comment; impulse system replaces |

### New API Endpoints (7 routes)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/verticals` | GET, POST | List/create verticals |
| `/api/verticals/[id]` | GET, PUT, DELETE | Vertical CRUD with niche counts |
| `/api/icp/discover` | POST | Save discovered ICP with niche_id + dedup (GET unchanged) |
| `/api/scoring/trace/[contactId]` | GET | Retrieve CausalGraph for latest score |
| `/api/enrichment/chain/[chainId]` | GET | Retrieve ExoChain audit trail |
| `/api/claude/session` | POST | Create/resume research session |
| `/api/contacts/[id]/relationships` | GET | Query CrossRefs for a contact |

### Tests (~28 test files)

| Category | Count | Coverage Target |
|----------|-------|----------------|
| Taxonomy tests | 3 | Hierarchy CRUD, discovery dedup, scoring chain |
| Unit tests (per ECC service) | 15 | All CRUD + edge cases |
| Adapter tests | 5 | Wrapping + flag behavior |
| Integration tests | 4 | End-to-end flows |
| Performance tests | 1 | Latency verification |

---

## Acceptance Criteria

### AC-0: Vertical→Niche→ICP→Offering Taxonomy
- [ ] `verticals` table exists with name UNIQUE + slug UNIQUE constraints
- [ ] `niche_profiles` has `vertical_id` FK (nullable for migration); `industry` column dropped
- [ ] `icp_profiles` has `niche_id` FK (nullable for migration)
- [ ] `UNIQUE(vertical_id, name)` on niche_profiles prevents duplicate niches per vertical
- [ ] `UNIQUE(niche_id, name)` on icp_profiles prevents duplicate ICPs per niche
- [ ] Existing niches migrated: industry text → matching vertical row
- [ ] `GET /api/icp/discover` returns discoveries without auto-saving
- [ ] `POST /api/icp/discover` saves with niche_id; rejects if name or criteria >80% overlap
- [ ] Scoring pipeline resolves ICP→Niche→Vertical chain; industries inherited from vertical
- [ ] Creating a niche requires `vertical_id`; creating an ICP requires `niche_id`
- [ ] API: `GET /api/verticals` lists verticals with niche counts
- [ ] API: `GET /api/niches?verticalId=X` filters by vertical
- [ ] API: `GET /api/icp/profiles?nicheId=X` filters by niche

### AC-1: CausalGraph Scoring Provenance
- [ ] Score a contact → response includes `_causal` field with node tree
- [ ] Each of the 9 dimensions has a CausalNode with `inputs` and `output`
- [ ] Weight application tracked as separate nodes
- [ ] Counterfactual API: modify one weight → get diff of composite score
- [ ] CausalGraph queryable via SQL: `SELECT * FROM causal_nodes WHERE entity_id = 'icp_fit'`
- [ ] Latency: scoring + causal tracking < 250ms

### AC-2: ExoChain Enrichment Audit Trail
- [ ] Enrich a contact → `_chainId` returned in response
- [ ] Chain contains entries for: budget_check, field_check, provider_select (per provider), enrich_result, budget_debit, waterfall_complete
- [ ] Hash chain verifiable: re-computing BLAKE3 from entry 0 to N matches stored hashes
- [ ] Tampering detected: modifying any entry's data breaks chain verification
- [ ] Latency: enrichment + chain tracking adds < 10ms

### AC-3: Impulse-Driven Automation
- [ ] Score crosses tier boundary → `tier_changed` impulse created
- [ ] Default `task_generator` handler creates task within 1 second
- [ ] Handler failure: logged, doesn't block other handlers
- [ ] New impulse types: `score_computed`, `tier_changed`, `persona_assigned`, `enrichment_complete`, `contact_created`, `edge_created`
- [ ] Admin can enable/disable handlers per tenant
- [ ] Old inline task-triggers still work when ECC_IMPULSES=false

### AC-4: Research Session Context
- [ ] `POST /api/claude/session` creates new session with intent
- [ ] `POST /api/claude/analyze` with `sessionId` has context from prior messages
- [ ] Session loads last 10 messages for context window
- [ ] Intent shift detected (e.g., vertical change logged in session context)
- [ ] Sessions auto-pause after 30 minutes inactive

### AC-5: CrossRef Typed Relationships
- [ ] Enrichment with work history → co-worker CrossRefs created on matching edges
- [ ] `GET /api/contacts/:id/relationships` returns typed relationships with context
- [ ] CrossRefs queryable: "find all referrer relationships for this contact"
- [ ] Confidence scores reflect source reliability (enrichment > inference)
- [ ] Max 50 CrossRefs per enrichment event

### AC-6: Tenant Isolation (All Modules)
- [ ] All 9 new tables have RLS policies
- [ ] Tenant A's causal data invisible to Tenant B
- [ ] Super admin can query across tenants
- [ ] Feature flags respect tenant-level overrides (future)

### AC-7: Feature Flags
- [ ] Each module independently toggleable via environment variable
- [ ] With all flags OFF: zero performance impact, zero new DB writes
- [ ] With all flags ON: all acceptance criteria above pass
- [ ] Mixed: any combination of flags works (no cross-module dependencies in v1)

---

## Launch Plan

### Phase 1: Internal Testing (Day 1-2 after dev complete)
- Deploy with all flags OFF
- Run migrations on staging database
- Enable flags one at a time, verify each module independently
- Run full integration test suite

### Phase 2: Shadow Mode (Day 3-5)
- Enable CausalGraph + ExoChain (write-only, not returned in API responses)
- Monitor: DB write volume, query latency, storage growth
- Verify: no impact on existing scoring/enrichment latency

### Phase 3: Soft Launch (Week 2)
- Enable full API responses (_causal, _chainId fields)
- Enable Impulse system (replaces task-triggers)
- Enable CognitiveTick for Claude routes
- Enable CrossRefs during enrichment
- Monitor: user feedback, error rates, latency p95

### Phase 4: Full Launch (Week 3)
- Remove feature flag checks (code cleanup)
- Deprecate old task-triggers.ts
- Documentation published
- Extension updated with causal trace display

---

## Future Sprints (Out of Scope, Informed by This Work)

### Sprint 2: Semantic Layer
- HNSW-based ICP matching using pgvector embeddings
- Semantic similarity search for contacts
- Topic clustering from enrichment data
- DSTE-inspired intent tracking (beyond simple keyword detection)

### Sprint 3: EMOT + SCEN Engines
- VAD-inspired relationship warmth scoring
- Outreach lifecycle as SCEN dramatic arc (setup → rising → climax → resolution)
- Behavioral persona enrichment from activity patterns

### Sprint 4: Real-Time Collaboration
- WebSocket presence for team workspaces
- Shared research sessions (multiple users in one CognitiveTick session)
- ClawStage-inspired conversation branching for collaborative research

### Sprint 5: Agent Team
- Specialized agents (research, scoring, outreach, engagement, relationship)
- Agent-as-actor model (each agent has its own branch in research sessions)
- ClawStage-inspired floor manager for agent coordination

---

## Reference Architecture Lineage

This sprint adapts core ECC concepts to a web-first, PostgreSQL-native context:

| Concept | mentra Origin | clawstage Origin | NetworkNav Sprint 1 |
|---------|-------------|-----------------|---------------------|
| CausalGraph | DEMOCRITUS (sparse CSR, <15ms) | petgraph DAG + typed CausalEdge | PostgreSQL tables, SQL-queryable |
| ExoChain | SHAKE-256 + Ed25519 append-only | ScoredWitnessEntry chain | BLAKE3 hash chain in PostgreSQL |
| Impulses | Hardware sensor events | 12 HLC-ordered cross-engine types | 6 domain types + handler registry |
| CognitiveTick | 50ms ARM cycle (8 phases) | 50ms WASM pipeline (8 stages) | Request-driven sessions |
| CrossRefs | HNSW exact match by Merkle ID | Bidirectional engine-tagged store | Edge annotations with source/confidence |
| 5 Engines | DCTE/DSTE/RSTE/EMOT/SCEN | Full polyglot ensemble | CausalGraph ≈ DCTE, Sessions ≈ DSTE, Impulses ≈ event backbone (RSTE/EMOT/SCEN deferred) |

The key adaptation insight: mentra and clawstage optimize for **real-time conversation on edge devices** (50ms tick, <2MB WASM, offline-first). NetworkNav optimizes for **web-scale prospecting intelligence** (request-driven, PostgreSQL-native, team-collaborative). Same cognitive primitives, different performance/deployment constraints.
