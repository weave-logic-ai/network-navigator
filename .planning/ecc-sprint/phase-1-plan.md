# ECC Sprint — Phase 1 Plan

**Date**: 2026-03-24
**Goal**: Database migrations + Taxonomy fix + all TypeScript types/services for ECC modules
**Duration**: Parallel execution across 5 worktrees

---

## Phase 1 Tasks (Parallelizable Workstreams)

### WS-1: Database Migrations (worktree: `ecc/migrations`)
**Owner**: migration-dev
**Branch**: `ecc/migrations`
**Files to create**:
- `data/db/init/024-taxonomy-hierarchy.sql`
- `data/db/init/025-ecc-causal-graph.sql`
- `data/db/init/026-ecc-exo-chain.sql`
- `data/db/init/027-ecc-impulses.sql`
- `data/db/init/028-ecc-cognitive-tick.sql`
- `data/db/init/029-ecc-cross-refs.sql`
- `data/db/init/030-ecc-rls.sql`

**Details**:
- 024: Create `verticals` table (name UNIQUE, slug UNIQUE), add `vertical_id` FK to `niche_profiles` (nullable), migrate existing `industry` text to verticals rows, add `niche_id` FK to `icp_profiles` (nullable), add unique constraints `(vertical_id, name)` on niche_profiles and `(niche_id, name)` on icp_profiles, drop `industry` column from niche_profiles after migration, create "General" fallback vertical for nulls
- 025: Create `causal_nodes` and `causal_edges` with tenant_id, indexes on entity_type/entity_id
- 026: Create `exo_chain_entries` with chain_id grouping, sequence, prev_hash/entry_hash BYTEA, UNIQUE(chain_id, sequence)
- 027: Create `impulses`, `impulse_handlers`, `impulse_acks` with tenant scoping
- 028: Create `research_sessions` and `session_messages`
- 029: Create `cross_refs` annotating existing `edges` table
- 030: Enable RLS on all 9 new tables with tenant_isolation + admin_bypass policies; session_messages uses session join; causal_edges uses source_node join

**Acceptance**:
- All SQL files parse without error
- Foreign key references use correct table names (verticals, niche_profiles, icp_profiles, edges, tenants)
- Indexes cover all query patterns from architecture doc
- RLS policies match pattern from existing 022-enable-rls.sql

---

### WS-2: Taxonomy Types + Service + DB Queries (worktree: `ecc/taxonomy`)
**Owner**: taxonomy-dev
**Branch**: `ecc/taxonomy`
**Files to create**:
- `app/src/lib/taxonomy/types.ts` — Vertical interface, updated NicheProfile (vertical_id), updated IcpProfile (niche_id)
- `app/src/lib/taxonomy/service.ts` — Vertical CRUD, hierarchy queries (getVerticalWithNiches, getNicheWithIcps), ICP→Niche→Vertical resolution chain
- `app/src/lib/taxonomy/discovery.ts` — Fixed ICP discovery: de-duplication by name within niche, criteria overlap detection (>80% role overlap = duplicate)

**Files to modify**:
- `app/src/lib/db/queries/niches.ts` — Replace `industry` with `vertical_id` in NicheRow, all queries, createNiche, updateNiche. Add `listNichesByVertical(verticalId)`, `findNicheByVerticalAndName(verticalId, name)`
- `app/src/lib/db/queries/icps.ts` — Add `niche_id` to IcpRow, createIcp, updateIcp. Add `listIcpsByNiche(nicheId)`, `findIcpByNicheAndName(nicheId, name)`
- `app/src/lib/scoring/types.ts` — Remove `industries` from `IcpCriteria`, add `nicheKeywords?: string[]`
- `app/src/lib/scoring/scorers/icp-fit.ts` — Industry match now uses vertical name passed via effective criteria (not from IcpCriteria.industries); add nicheKeywords signal matching
- `app/src/lib/scoring/pipeline.ts` — After loading ICP profile, resolve niche and vertical; build effectiveCriteria with `industries: [vertical.name]` and `nicheKeywords: niche.keywords`
- `app/src/app/api/niches/route.ts` — Accept `verticalId` on POST (required), pass to createNiche; GET supports `?verticalId=` filter
- `app/src/app/api/icp/profiles/route.ts` — Accept `nicheId` on POST (required), pass to createIcp; GET supports `?nicheId=` filter
- `app/src/app/api/icp/discover/route.ts` — GET returns discoveries only (NO auto-save); new POST endpoint saves with nicheId + dedup check
- `app/src/lib/graph/icp-discovery.ts` — Remove `createIcpFromDiscovery` auto-save behavior; `discoverIcps` returns results only; new `saveDiscoveredIcp(discovery, nicheId)` with dedup

**New API routes**:
- `app/src/app/api/verticals/route.ts` — GET (list), POST (create)
- `app/src/app/api/verticals/[id]/route.ts` — GET, PUT, DELETE

**Acceptance**:
- Vertical CRUD works (name UNIQUE, slug generated from name)
- Niche requires vertical_id; ICP requires niche_id
- ICP discovery GET no longer auto-saves
- ICP discovery POST with nicheId checks name uniqueness and criteria overlap
- Scoring pipeline resolves ICP→Niche→Vertical chain
- IcpFitScorer uses vertical.name for industry matching
- All existing API contracts preserved (additive changes only)

---

### WS-3: ECC Types + CausalGraph + ExoChain (worktree: `ecc/causal-exo`)
**Owner**: causal-exo-dev
**Branch**: `ecc/causal-exo`
**Files to create**:
- `app/src/lib/ecc/types.ts` — All shared ECC types: CausalNode, CausalEdge, CausalRelation, ExoChainEntry, ChainOperation, Impulse, ImpulseType, ImpulseHandler, ImpulseAck, ResearchSession, SessionMessage, CrossRef, CrossRefType, ECC_FLAGS config
- `app/src/lib/ecc/index.ts` — Public re-exports
- `app/src/lib/ecc/causal-graph/types.ts` — CausalNode, CausalEdge, CausalGraphTrace, CausalRelation enum
- `app/src/lib/ecc/causal-graph/service.ts` — createNode, createEdge, batchCreateNodes, getGraph(entityType, entityId), getTraceForScore(contactId)
- `app/src/lib/ecc/causal-graph/counterfactual.ts` — counterfactualScore(contactId, modifiedWeights), diffGraphs
- `app/src/lib/ecc/causal-graph/scoring-adapter.ts` — Wraps `scoreContact()`: creates root CausalNode, dimension nodes, weight nodes, edges; emits impulses on tier/persona change; returns score + causalGraph. Feature-flagged via ECC_CAUSAL_GRAPH
- `app/src/lib/ecc/exo-chain/types.ts` — ExoChainEntry, ChainOperation enum
- `app/src/lib/ecc/exo-chain/hash.ts` — BLAKE3 hashing using `@noble/hashes` (or SHA-256 fallback via Web Crypto)
- `app/src/lib/ecc/exo-chain/service.ts` — appendEntry, getChain(chainId), verifyChain(chainId) (recalculate hashes)
- `app/src/lib/ecc/exo-chain/enrichment-adapter.ts` — Wraps `enrichContact()`: creates chain entries for budget_check, field_check, provider_select, enrich_result, budget_debit, waterfall_complete. Feature-flagged via ECC_EXO_CHAIN

**Files to modify**:
- `app/src/app/api/scoring/run/route.ts` — Import scoring-adapter; when ECC_CAUSAL_GRAPH enabled, use adapter instead of direct pipeline call; add `_causal` field to response
- `app/src/app/api/enrichment/enrich/route.ts` — Import enrichment-adapter; when ECC_EXO_CHAIN enabled, wrap enrichment call; add `_chainId` field to response

**New API routes**:
- `app/src/app/api/scoring/trace/[contactId]/route.ts` — GET: retrieve CausalGraph for latest score
- `app/src/app/api/enrichment/chain/[chainId]/route.ts` — GET: retrieve ExoChain audit trail

**Acceptance**:
- Scoring with ECC_CAUSAL_GRAPH=true produces causal nodes and edges in DB
- Each of 9 dimensions has a CausalNode
- Weight application tracked as separate nodes
- Counterfactual API modifies weights, returns diff
- Enrichment with ECC_EXO_CHAIN=true produces hash-linked chain entries
- Hash chain is verifiable (BLAKE3 recalculation matches stored hashes)
- With flags OFF: zero overhead, passthrough behavior

---

### WS-4: Impulse System (worktree: `ecc/impulses`)
**Owner**: impulse-dev
**Branch**: `ecc/impulses`
**Files to create**:
- `app/src/lib/ecc/impulses/types.ts` — ImpulseType enum, Impulse, ImpulseHandler, ImpulseAck, HandlerType enum
- `app/src/lib/ecc/impulses/emitter.ts` — emitImpulse(tenantId, type, sourceType, sourceId, payload): sync DB insert + queue async dispatch
- `app/src/lib/ecc/impulses/dispatcher.ts` — dispatchImpulse(impulseId): load handlers by type, execute each with try/catch, record acks. Handler timeout 5s. Dead letter after 3 failures
- `app/src/lib/ecc/impulses/handlers/task-generator.ts` — Migrates logic from existing `task-triggers.ts`: tier_changed → create task, persona_assigned → create task. Uses same dedup pattern (task_type + contact_id + source)
- `app/src/lib/ecc/impulses/handlers/campaign-enroller.ts` — Stub handler: checks config for campaign_id, enrolls contact in outreach campaign
- `app/src/lib/ecc/impulses/handlers/notification.ts` — Stub handler: logs notification (future: email/websocket)
- `app/src/lib/ecc/impulses/scoring-adapter.ts` — Hooks into scoring pipeline post-score: emits score_computed, tier_changed (if tier differs), persona_assigned (if persona differs). Feature-flagged via ECC_IMPULSES

**Files to modify**:
- `app/src/lib/scoring/task-triggers.ts` — Add deprecation comment at top; when ECC_IMPULSES=true, skip inline task generation (impulse handler replaces it)

**Acceptance**:
- Score crossing tier boundary creates tier_changed impulse
- Default task_generator handler creates task within dispatch cycle
- Handler failure logged but doesn't block other handlers
- Old task-triggers still work when ECC_IMPULSES=false
- Impulse types: score_computed, tier_changed, persona_assigned, enrichment_complete, contact_created, edge_created

---

### WS-5: CognitiveTick + CrossRefs (worktree: `ecc/cognitive-crossrefs`)
**Owner**: cognitive-crossref-dev
**Branch**: `ecc/cognitive-crossrefs`
**Files to create**:
- `app/src/lib/ecc/cognitive-tick/types.ts` — ResearchSession, SessionMessage, SessionStatus enum, SessionIntent
- `app/src/lib/ecc/cognitive-tick/session-service.ts` — createSession, getSession, updateSessionContext, getSessionMessages(limit:10), pauseInactiveSessions(30min), resumeSession
- `app/src/lib/ecc/cognitive-tick/claude-adapter.ts` — analyzeWithSession(tenantId, userId, contactId, prompt, sessionId?): builds context from session history, calls existing claudeChat, records messages, detects intent shifts. Feature-flagged via ECC_COGNITIVE_TICK
- `app/src/lib/ecc/cross-refs/types.ts` — CrossRef, CrossRefType enum (co_worker, referrer, shared_company, mutual_connection, reported_to, invested_in, co_author, advisor, custom)
- `app/src/lib/ecc/cross-refs/service.ts` — createCrossRef, getCrossRefsForEdge, getCrossRefsForContact(contactId), queryCrossRefsByType(type), max 50 per enrichment event, UNIQUE(edge_id, relation_type, source)
- `app/src/lib/ecc/cross-refs/enrichment-adapter.ts` — extractCrossRefs from enrichment results: work history → co-worker, mutual connections → mutual_connection. Confidence from source reliability. Feature-flagged via ECC_CROSS_REFS

**Files to modify**:
- `app/src/app/api/claude/analyze/route.ts` — Accept optional `sessionId` in body; when ECC_COGNITIVE_TICK enabled, use claude-adapter instead of direct analyzeContact; return `_sessionId`

**New API routes**:
- `app/src/app/api/claude/session/route.ts` — POST: create/resume research session (body: {intent, userId} or {sessionId})
- `app/src/app/api/contacts/[id]/relationships/route.ts` — GET: query CrossRefs for contact, supports `?type=` filter

**Acceptance**:
- POST /api/claude/session creates session with intent
- Analyze with sessionId has context from prior messages
- Last 10 messages loaded for context window
- Intent shift detected and logged
- Enrichment with work history creates co-worker CrossRefs
- GET /api/contacts/:id/relationships returns typed relationships
- CrossRefs capped at 50 per enrichment event
- With flags OFF: passthrough, zero overhead

---

## Dependency Graph

```
WS-1 (migrations) ─── no code deps, can run first or parallel
WS-2 (taxonomy)   ─── needs migration SQL knowledge but not execution; independent code
WS-3 (causal+exo) ─── needs ECC types (creates them); independent of taxonomy changes
WS-4 (impulses)   ─── needs ECC types from WS-3; can stub import
WS-5 (cog+xrefs)  ─── needs ECC types from WS-3; can stub import
```

All 5 workstreams are parallelizable because:
1. Each operates on different files (no merge conflicts)
2. WS-3/4/5 share `ecc/types.ts` — WS-3 creates it, WS-4/5 create their own local types.ts and the orchestrator merges shared types at the end
3. SQL migrations are ordered by number, not by write time

---

## Phase 1 Definition of Done

- [ ] All 7 SQL migration files created and parseable
- [ ] `verticals` table with UNIQUE name/slug
- [ ] `niche_profiles.vertical_id` FK + unique constraint
- [ ] `icp_profiles.niche_id` FK + unique constraint
- [ ] Taxonomy service with full hierarchy CRUD
- [ ] ICP discovery de-duplication
- [ ] Scoring pipeline resolves ICP→Niche→Vertical
- [ ] All ECC types defined
- [ ] CausalGraph service + scoring adapter
- [ ] Counterfactual scoring
- [ ] ExoChain service + enrichment adapter + hash verification
- [ ] Impulse emitter + dispatcher + task-generator handler
- [ ] Research session service + claude adapter
- [ ] CrossRef service + enrichment adapter
- [ ] All new API routes created (7 routes)
- [ ] Feature flags (ECC_CAUSAL_GRAPH, ECC_EXO_CHAIN, ECC_IMPULSES, ECC_COGNITIVE_TICK, ECC_CROSS_REFS)
- [ ] All existing API contracts preserved
