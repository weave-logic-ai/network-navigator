# ECC Sprint — Phase Orchestration Plan

**Date**: 2026-03-24
**Orchestrator**: PM Agent
**Strategy**: 5 parallel git worktrees → merge → integrate → test

---

## Execution Overview

```
Phase 1: Parallel Development (5 worktrees simultaneously)
├── WS-1: migrations     ─── 7 SQL files (024-030)
├── WS-2: taxonomy       ─── Types + service + 9 file modifications
├── WS-3: causal + exo   ─── ECC types + CausalGraph + ExoChain (14 files)
├── WS-4: impulses       ─── Emitter + dispatcher + 3 handlers (7 files)
└── WS-5: cognitive+xref ─── Sessions + CrossRefs + claude adapter (8 files)

Phase 2: Integration (sequential)
├── Merge all branches
├── Consolidate types
├── Build verification
├── Integration tests
└── Performance benchmarks
```

---

## Phase 1 Checklist

### WS-1: Database Migrations (`ecc/migrations`) — COMPLETE
- [x] `024-taxonomy-hierarchy.sql` — verticals table, niche vertical_id FK, ICP niche_id FK, General fallback, constraints, drop industry
- [x] `025-ecc-causal-graph.sql` — causal_nodes + causal_edges with indexes
- [x] `026-ecc-exo-chain.sql` — exo_chain_entries with chain_id grouping
- [x] `027-ecc-impulses.sql` — impulses + impulse_handlers + impulse_acks
- [x] `028-ecc-cognitive-tick.sql` — research_sessions + session_messages
- [x] `029-ecc-cross-refs.sql` — cross_refs annotating edges
- [x] `030-ecc-rls.sql` — RLS policies for all 9 new tables
- [x] PM notes written to `docs/development_notes/ecc/phase-1-migrations.md`

### WS-2: Taxonomy Fix (`ecc/taxonomy`) — COMPLETE
- [x] `app/src/lib/taxonomy/types.ts` — Vertical, NicheProfile, IcpProfile with FK fields
- [x] `app/src/lib/taxonomy/service.ts` — CRUD, hierarchy queries, resolution chain
- [x] `app/src/lib/taxonomy/discovery.ts` — De-dup ICP discovery with criteria overlap
- [x] `app/src/lib/db/queries/niches.ts` — vertical_id replaces industry
- [x] `app/src/lib/db/queries/icps.ts` — niche_id added
- [x] `app/src/lib/scoring/types.ts` — nicheKeywords added (industries kept for vertical-derived matching)
- [x] `app/src/lib/scoring/scorers/icp-fit.ts` — vertical-based industry match + niche keywords
- [x] `app/src/lib/scoring/pipeline.ts` — ICP→Niche→Vertical resolution
- [x] `app/src/app/api/niches/route.ts` — verticalId on create, filter on GET
- [x] `app/src/app/api/icp/profiles/route.ts` — nicheId on create, filter on GET
- [x] `app/src/app/api/icp/discover/route.ts` — GET read-only, POST with dedup
- [x] `app/src/lib/graph/icp-discovery.ts` — Removed createIcpFromDiscovery
- [x] `app/src/app/api/verticals/route.ts` — GET + POST
- [x] `app/src/app/api/verticals/[id]/route.ts` — GET + PUT + DELETE
- [x] PM notes written to `docs/development_notes/ecc/phase-1-taxonomy.md`

### WS-3: CausalGraph + ExoChain (`ecc/causal-exo`) — COMPLETE
- [x] `app/src/lib/ecc/types.ts` — All shared ECC types (canonical)
- [x] `app/src/lib/ecc/index.ts` — Public exports
- [x] `app/src/lib/ecc/causal-graph/types.ts`
- [x] `app/src/lib/ecc/causal-graph/service.ts` — Batch create, getCausalGraph (recursive CTE), getTrace
- [x] `app/src/lib/ecc/causal-graph/counterfactual.ts`
- [x] `app/src/lib/ecc/causal-graph/scoring-adapter.ts` — Wraps pipeline, creates nodes/edges
- [x] `app/src/lib/ecc/exo-chain/types.ts`
- [x] `app/src/lib/ecc/exo-chain/hash.ts` — SHA-256 (BLAKE3 swap when @noble/hashes added)
- [x] `app/src/lib/ecc/exo-chain/service.ts` — append, get, verify
- [x] `app/src/lib/ecc/exo-chain/enrichment-adapter.ts` — Wraps waterfall
- [x] `app/src/app/api/scoring/run/route.ts` — Adapter integration
- [x] `app/src/app/api/enrichment/enrich/route.ts` — Adapter integration
- [x] `app/src/app/api/scoring/trace/[contactId]/route.ts` — New route
- [x] `app/src/app/api/enrichment/chain/[chainId]/route.ts` — New route
- [x] PM notes written to `docs/development_notes/ecc/phase-1-causal-exo.md`

### WS-4: Impulse System (`ecc/impulses`) — COMPLETE
- [x] `app/src/lib/ecc/impulses/types.ts` — ImpulseType, Handler, Ack types
- [x] `app/src/lib/ecc/impulses/emitter.ts` — emitImpulse + emitImpulses (batch)
- [x] `app/src/lib/ecc/impulses/dispatcher.ts` — dispatchImpulse with try/catch, 5s timeout, dead letter
- [x] `app/src/lib/ecc/impulses/handlers/task-generator.ts` — Migrated task-triggers logic
- [x] `app/src/lib/ecc/impulses/handlers/campaign-enroller.ts` — Stub
- [x] `app/src/lib/ecc/impulses/handlers/notification.ts` — Stub (log channel)
- [x] `app/src/lib/ecc/impulses/scoring-adapter.ts` — Post-score impulse emission
- [x] `app/src/lib/scoring/task-triggers.ts` — ECC_IMPULSES_ENABLED guard added
- [x] PM notes written to `docs/development_notes/ecc/phase-1-impulses.md`

### WS-5: CognitiveTick + CrossRefs (`ecc/cognitive-crossrefs`) — COMPLETE
- [x] `app/src/lib/ecc/cognitive-tick/types.ts`
- [x] `app/src/lib/ecc/cognitive-tick/session-service.ts`
- [x] `app/src/lib/ecc/cognitive-tick/claude-adapter.ts`
- [x] `app/src/lib/ecc/cross-refs/types.ts`
- [x] `app/src/lib/ecc/cross-refs/service.ts` — Max 50 per event, upsert dedup
- [x] `app/src/lib/ecc/cross-refs/enrichment-adapter.ts`
- [x] `app/src/app/api/claude/analyze/route.ts` — sessionId support
- [x] `app/src/app/api/claude/session/route.ts` — New route
- [x] `app/src/app/api/contacts/[id]/relationships/route.ts` — New route
- [x] PM notes written to `docs/development_notes/ecc/phase-1-cognitive-crossrefs.md`

---

## Phase 2 Checklist

### Merge & Consolidation — COMPLETE
- [x] Merge `ecc/migrations` → main (7 new SQL files copied)
- [x] Merge `ecc/taxonomy` → main (5 new + 10 modified files copied)
- [x] Merge `ecc/causal-exo` → main (12 new + 2 modified files copied)
- [x] Merge `ecc/impulses` → main (7 new + 1 modified files copied)
- [x] Merge `ecc/cognitive-crossrefs` → main (8 new + 1 modified files copied)
- [x] Consolidate shared ECC types — WS-3 canonical types.ts already comprehensive, no dedup needed
- [x] Consolidate ecc/index.ts exports — already complete
- [x] PM notes written to `docs/development_notes/ecc/phase-1-*.md` (5 files)

### Build & Test — COMPLETE
- [ ] Install `@noble/hashes` dependency (deferred — using SHA-256 via Web Crypto for now)
- [x] `npm run build` succeeds (4 type fixes applied during merge)
- [x] All existing tests pass (19 suites, 145 tests, zero regressions)
- [ ] ECC-specific unit tests (Phase 2 task 2.5 — to be created)
- [ ] Integration tests (Phase 2 task 2.5 — to be created)
- [ ] Feature flag tests (Phase 2 task 2.6 — to be created)
- [ ] Performance benchmarks (Phase 2 task 2.7 — to be created)
- [x] PM notes written to `docs/development_notes/ecc/phase-2-merge.md`

---

## Orchestrator Context for Parallel Development

### File Ownership Map (Conflict Prevention)

| File / Directory | Owner | Notes |
|-----------------|-------|-------|
| `data/db/init/024-030*.sql` | WS-1 | Exclusive — no other WS touches migrations |
| `app/src/lib/taxonomy/` | WS-2 | New directory, exclusive |
| `app/src/lib/db/queries/niches.ts` | WS-2 | Exclusive modification |
| `app/src/lib/db/queries/icps.ts` | WS-2 | Exclusive modification |
| `app/src/lib/scoring/types.ts` | WS-2 | Exclusive modification |
| `app/src/lib/scoring/scorers/icp-fit.ts` | WS-2 | Exclusive modification |
| `app/src/lib/scoring/pipeline.ts` | WS-2 | Exclusive modification |
| `app/src/app/api/niches/route.ts` | WS-2 | Exclusive modification |
| `app/src/app/api/icp/*/route.ts` | WS-2 | Exclusive modification |
| `app/src/app/api/verticals/` | WS-2 | New routes, exclusive |
| `app/src/lib/ecc/types.ts` | WS-3 | Creates canonical version; WS-4/5 use local types |
| `app/src/lib/ecc/index.ts` | WS-3 | Creates; orchestrator adds WS-4/5 exports post-merge |
| `app/src/lib/ecc/causal-graph/` | WS-3 | Exclusive |
| `app/src/lib/ecc/exo-chain/` | WS-3 | Exclusive |
| `app/src/app/api/scoring/run/route.ts` | WS-3 | Modification — adapter import |
| `app/src/app/api/enrichment/enrich/route.ts` | WS-3 | Modification — adapter import |
| `app/src/app/api/scoring/trace/` | WS-3 | New route, exclusive |
| `app/src/app/api/enrichment/chain/` | WS-3 | New route, exclusive |
| `app/src/lib/ecc/impulses/` | WS-4 | Exclusive |
| `app/src/lib/scoring/task-triggers.ts` | WS-4 | Modification — deprecation guard |
| `app/src/lib/ecc/cognitive-tick/` | WS-5 | Exclusive |
| `app/src/lib/ecc/cross-refs/` | WS-5 | Exclusive |
| `app/src/app/api/claude/analyze/route.ts` | WS-5 | Modification — sessionId param |
| `app/src/app/api/claude/session/` | WS-5 | New route, exclusive |
| `app/src/app/api/contacts/[id]/relationships/` | WS-5 | New route, exclusive |

### Shared Type Strategy

WS-3 creates the canonical `app/src/lib/ecc/types.ts` with ALL ECC types. WS-4 and WS-5 each create their own module-local `types.ts` files. After merge, the orchestrator:
1. Moves any unique types from WS-4/5 local files into the shared `ecc/types.ts`
2. Updates imports in WS-4/5 to reference the shared file
3. Removes duplicate definitions

### Merge Order (Minimizes Conflicts)

1. **WS-1** first (new files only, zero conflict risk)
2. **WS-2** second (modifies existing scoring/db files, no ECC overlap)
3. **WS-3** third (creates ecc/ directory structure, modifies scoring/run route)
4. **WS-4** fourth (adds to ecc/impulses/, modifies task-triggers.ts)
5. **WS-5** last (adds to ecc/, modifies claude/analyze route)

### Key Existing Files Reference

For developer context, these are the exact files and their current state:

**Scoring Pipeline** (`app/src/lib/scoring/pipeline.ts`):
- `scoreContact(contactId, profileName?)` — loads contact, weights, ICP profiles; computes composite; referral scoring; task triggers
- `scoreBatch(contactIds?, profileName?)` — batch version
- `getAvailableDimensions(contact)` — determines which of 9 dimensions have data

**Task Triggers** (`app/src/lib/scoring/task-triggers.ts`):
- `checkAndGenerateTasks(contactId, oldScore, newScore)` — inline task generation for tier/persona changes
- Will be wrapped/replaced by impulse handler

**ICP Discovery** (`app/src/lib/graph/icp-discovery.ts`):
- `discoverIcps(minClusterSize)` — returns IcpDiscoveryResult[]
- `createIcpFromDiscovery(discovery)` — auto-saves (BROKEN — creates duplicates)

**Enrichment Waterfall** (`app/src/lib/enrichment/waterfall.ts`):
- `enrichContact(contact, options)` — provider waterfall with budget tracking
- No audit trail currently

**Claude Analyze** (`app/src/lib/claude/analyze.ts`):
- `analyzeContact(contact, scores?, graphMetrics?)` — stateless Claude call
- No session continuity

**DB Queries**:
- `app/src/lib/db/queries/niches.ts` — NicheRow has `industry: string | null` (flat text, to be replaced with vertical_id)
- `app/src/lib/db/queries/icps.ts` — IcpRow has no niche_id (to be added)

### Feature Flag Configuration

```env
# Add to .env.local (not committed)
ECC_CAUSAL_GRAPH=true
ECC_EXO_CHAIN=true
ECC_IMPULSES=true
ECC_COGNITIVE_TICK=true
ECC_CROSS_REFS=true
```

All flags default to `false`. Each module's adapter checks its flag and either:
- **true**: Full ECC tracking
- **false**: Passthrough to existing service

---

## PM Agent Notes Protocol

After each workstream completes, the PM agent writes a development note to:
`docs/development_notes/ecc/phase-1-{workstream}.md`

Each note includes:
1. **Files created** — list with line counts
2. **Files modified** — list with change summary
3. **Decisions made** — any deviations from plan and rationale
4. **Known issues** — anything deferred or requiring attention in Phase 2
5. **Acceptance status** — checklist items verified
