# ECC Sprint — Refinement

**Date**: 2026-03-24
**Focus**: Implementation order, risk mitigation, performance, testing strategy

---

## Implementation Order (Dependency-Driven)

### Week 1: Taxonomy Fix + CausalGraph

**Day 1: Taxonomy Hierarchy (PREREQUISITE — blocks all scoring work)**
- Write migration `024-taxonomy-hierarchy.sql` (verticals table, niche vertical_id FK, ICP niche_id FK)
- Write `app/src/lib/taxonomy/types.ts` (Vertical, updated NicheProfile, updated IcpProfile)
- Write `app/src/lib/taxonomy/service.ts` (CRUD for verticals, hierarchy queries, ICP resolution)
- Fix `app/src/lib/graph/icp-discovery.ts`: remove auto-save from GET, add de-duplication
- Fix `app/src/app/api/icp/discover/route.ts`: GET returns discoveries only; new POST saves with niche_id + dedup
- Fix `app/src/lib/scoring/scorers/icp-fit.ts`: inherit `industries` from vertical, add niche keywords
- Fix `app/src/lib/scoring/pipeline.ts`: resolve ICP → Niche → Vertical chain
- Update `app/src/lib/db/queries/icps.ts` and `niches.ts`: add vertical/niche FK queries
- Run migration in dev, verify hierarchy constraints
- Tests: vertical CRUD, niche uniqueness within vertical, ICP uniqueness within niche, discovery dedup

**Day 2: ECC Schema + Types**
- Write migrations 025-030 (all 6 ECC SQL files)
- Write `app/src/lib/ecc/types.ts` with all shared types
- Write `app/src/lib/ecc/index.ts` exports
- Run migrations in dev

**Day 3-4: CausalGraph Service**
- Implement `causal-graph/service.ts` — CRUD for nodes and edges
- Implement `causal-graph/scoring-adapter.ts` — wraps `scoring/pipeline.ts`
- Wire into `/api/scoring/run` route (additive, behind ECC_CAUSAL_GRAPH flag)

**Day 5: CausalGraph Tests + Counterfactual**
- Unit tests for causal node/edge creation
- Integration test: score a contact → verify causal graph produced
- Implement `counterfactual.ts` — re-score with modified weights, diff graphs

### Week 2: ExoChain + Impulses

**Day 1-2: ExoChain**
- Implement `exo-chain/hash.ts` (BLAKE3 via `@noble/hashes` — 5KB, zero-dep)
- Implement `exo-chain/service.ts` — append, get chain, verify integrity
- Implement `exo-chain/enrichment-adapter.ts` — wraps `enrichment/waterfall.ts`
- Wire into `/api/enrichment/enrich` route

**Day 3-4: Impulse System**
- Implement `impulses/emitter.ts` + `impulses/dispatcher.ts`
- Implement `impulses/handlers/task-generator.ts` (migrate logic from `scoring/task-triggers.ts`)
- Wire impulse emission into scoring adapter
- Default impulse handlers seeded per tenant

**Day 5: Integration Tests**
- End-to-end: enrich → verify chain → score → verify impulse → verify task created
- Verify hash chain integrity (tamper detection)

### Week 3: CognitiveTick + CrossRefs

**Day 1-2: Research Sessions**
- Implement `cognitive-tick/session-service.ts`
- Implement `cognitive-tick/claude-adapter.ts` — wraps existing `/api/claude/analyze`
- New route: `/api/claude/session` (create/resume session)
- Modified `/api/claude/analyze` accepts optional `sessionId`

**Day 3-4: CrossRefs**
- Implement `cross-refs/service.ts` — CRUD + query
- Implement `cross-refs/enrichment-adapter.ts` — extracts relations from enrichment results
- Wire into enrichment pipeline (after provider result)
- New route: `/api/contacts/[id]/relationships` (query CrossRefs for a contact)

**Day 5: Polish + Documentation**
- API documentation for new endpoints
- Feature flag verification (all modules independently toggleable)
- Performance benchmarks

### Week 4: Chrome Extension + Hardening

**Day 1-2: Extension Integration**
- Side panel: show CausalGraph trace when viewing scored contact
- Service worker: emit capture events as impulses
- New API: `/api/extension/causal-trace/[contactId]`

**Day 3-4: Production Hardening**
- Connection pooling for ECC queries (avoid N+1)
- Batch causal node creation (single INSERT with UNNEST)
- Impulse dispatch via pg_notify or setTimeout (evaluate both)
- Retention policy: prune causal_nodes older than 90 days

**Day 5: Final Integration Test + Deploy**
- Full flow: extension capture → enrich → score → causal trace → impulse → task
- Load test: 100 concurrent scores with causal tracking
- Deploy with all flags OFF, enable incrementally

---

## Risk Mitigation

### Risk 0: Taxonomy Migration on Existing Data

**Problem**: Adding `vertical_id` NOT NULL to niche_profiles and `niche_id` to icp_profiles may break existing rows that have no vertical/niche assigned.

**Mitigation**:
- Migration creates a "General" vertical as fallback
- Existing niches with NULL industry get assigned to "General" vertical
- `niche_id` on icp_profiles is nullable initially (allows gradual assignment)
- `vertical_id` on niche_profiles is nullable initially; constraint tightened after data migration
- Admin API endpoint to reassign orphaned ICPs to niches

### Risk 1: CausalGraph Write Amplification

**Problem**: Scoring one contact creates ~20 causal nodes + ~25 edges. At 1000 contacts = 20K nodes + 25K edges.

**Mitigation**:
- Batch INSERTs using `UNNEST` arrays (1 round-trip per scoring run, not 20)
- Causal nodes are append-only (no updates) — write-optimized
- 90-day retention with automatic cleanup job
- Feature flag: disable for batch re-score operations

### Risk 2: ExoChain Hash Computation Overhead

**Problem**: BLAKE3 hashing on every chain entry adds latency.

**Mitigation**:
- `@noble/hashes` BLAKE3 is <1ms per hash in Node.js
- Chain entries are small (operation string + JSONB)
- Hash computation is CPU-only (no I/O wait)
- Benchmarked: 7-provider waterfall adds ~7 entries × <1ms = <7ms total

### Risk 3: Impulse Handler Failure Cascading

**Problem**: A failing handler blocks the impulse dispatch queue.

**Mitigation**:
- Each handler wrapped in try/catch — failures recorded but don't block others
- Handler timeout: 5 seconds max
- Dead letter tracking: after 3 failures, handler auto-disabled with alert
- Impulse dispatch is async — never blocks the scoring response

### Risk 4: Research Session Context Growth

**Problem**: Long sessions accumulate unbounded context.

**Mitigation**:
- Last 10 messages loaded (sliding window)
- Context summary generated every 20 messages (compressed)
- Session auto-pauses after 30 minutes of inactivity
- Token budget: system prompt capped at 4K tokens

### Risk 5: CrossRef Explosion on Dense Networks

**Problem**: Enrichment revealing many co-worker relationships creates O(n²) CrossRefs.

**Mitigation**:
- Cap CrossRefs per enrichment event: max 50
- Deduplicate by (edge_id, relation_type, source) — UNIQUE constraint
- Confidence threshold: only create if confidence > 0.5

---

## Performance Targets

| Operation | Current Latency | Added ECC Overhead | Target Total |
|-----------|----------------|-------------------|--------------|
| Score 1 contact | ~200ms | +30ms (causal nodes batch insert) | <250ms |
| Enrich 1 contact | ~2-5s (provider dependent) | +10ms (chain entries) | <5.1s |
| Impulse emit | N/A (new) | 5ms (insert) | <10ms |
| Impulse dispatch | N/A (new) | 50ms (async, per handler) | <100ms total |
| Claude analyze | ~3-5s | +20ms (session lookup + message insert) | <5.1s |
| CrossRef query | N/A (new) | 15ms | <20ms |

---

## Testing Strategy

### Unit Tests (per module)

```
tests/taxonomy/
├── service.test.ts               # Vertical CRUD, hierarchy queries
├── discovery.test.ts             # De-duplication, criteria overlap detection
└── scoring-integration.test.ts   # ICP→Niche→Vertical chain in scoring pipeline

tests/ecc/
├── causal-graph/
│   ├── service.test.ts           # CRUD operations
│   ├── scoring-adapter.test.ts   # Wrapping logic (mock scoring pipeline)
│   └── counterfactual.test.ts    # Weight modification + diff
├── exo-chain/
│   ├── hash.test.ts              # BLAKE3 determinism, chain integrity
│   ├── service.test.ts           # Append, verify, tamper detection
│   └── enrichment-adapter.test.ts
├── impulses/
│   ├── emitter.test.ts           # Impulse creation
│   ├── dispatcher.test.ts        # Handler routing, failure handling
│   └── handlers/
│       └── task-generator.test.ts
├── cognitive-tick/
│   ├── session-service.test.ts
│   └── claude-adapter.test.ts    # Context building, intent detection
└── cross-refs/
    ├── service.test.ts
    └── enrichment-adapter.test.ts
```

### Integration Tests

```
tests/ecc/integration/
├── score-with-provenance.test.ts   # Full scoring → causal graph → impulse → task
├── enrich-with-chain.test.ts       # Full waterfall → chain → cross-refs
├── research-session.test.ts        # Multi-turn Claude session with context
└── feature-flags.test.ts           # Verify each flag independently disables its module
```

### Key Test Assertions

1. **Causal completeness**: Every dimension in CompositeScore has a corresponding CausalNode
2. **Chain integrity**: Recalculating hashes from entry 0 to N matches stored hashes
3. **Impulse delivery**: Tier change → handler executed → task exists in DB
4. **Session continuity**: Message N+1 sees context from message N
5. **CrossRef accuracy**: Co-worker relationship extracted matches enrichment work history
6. **Flag isolation**: With ECC_CAUSAL_GRAPH=false, zero rows in causal_nodes after scoring
7. **Tenant isolation**: Tenant A's causal data invisible to Tenant B's queries

---

## Migration Strategy

### Existing Code Changes

**Taxonomy fixes (Day 1 — higher touch):**

1. **`app/src/lib/graph/icp-discovery.ts`** — Remove auto-save; return discoveries only; add dedup helper
2. **`app/src/app/api/icp/discover/route.ts`** — GET returns discoveries; new POST saves with niche_id + dedup
3. **`app/src/lib/scoring/scorers/icp-fit.ts`** — Remove `industries` from criteria check; inherit from vertical
4. **`app/src/lib/scoring/pipeline.ts`** — Resolve ICP→Niche→Vertical chain; pass effective criteria
5. **`app/src/lib/scoring/types.ts`** — Remove `industries` from `IcpCriteria`; add `nicheKeywords`
6. **`app/src/lib/db/queries/icps.ts`** — Add niche_id to queries; add `findByNicheAndName()`
7. **`app/src/lib/db/queries/niches.ts`** — Add vertical_id to queries; replace industry field
8. **`app/src/app/api/niches/route.ts`** — Accept vertical_id on create; return vertical info
9. **`app/src/app/api/icp/profiles/route.ts`** — Accept niche_id on create

**ECC additions (Days 2-5 — adapter pattern, minimal touch):**

10. **`app/src/app/api/scoring/run/route.ts`** — Import scoring-adapter (5-10 lines)
11. **`app/src/app/api/enrichment/enrich/route.ts`** — Import enrichment-adapter (5-10 lines)
12. **`app/src/app/api/claude/analyze/route.ts`** — Accept optional sessionId (10-15 lines)
13. **`app/src/lib/scoring/task-triggers.ts`** — Deprecate (replaced by impulse handler)

Everything else is **new files** in `app/src/lib/ecc/` and `data/db/init/024-029*.sql`.

### Backward Compatibility

- All existing API responses unchanged
- New fields (causal trace, chain ID, session ID) returned only when ECC enabled
- New fields use underscore prefix convention: `_causal`, `_chainId`, `_sessionId`
- Existing tests pass without modification
