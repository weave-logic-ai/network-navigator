# ECC Sprint — Phase 2 Plan

**Date**: 2026-03-24
**Goal**: Integration testing, merge resolution, and production hardening
**Prerequisite**: All Phase 1 workstreams completed and merged

---

## Phase 2 Tasks

### Task 2.1: Merge All Worktree Branches
**Owner**: orchestrator
**Steps**:
1. Merge `ecc/migrations` → main (no conflicts expected — all new files in data/db/init/)
2. Merge `ecc/taxonomy` → main (modifies existing files in scoring, db/queries, api routes)
3. Merge `ecc/causal-exo` → main (new files in lib/ecc/, modifies scoring/run and enrichment/enrich routes)
4. Merge `ecc/impulses` → main (new files in lib/ecc/impulses/, modifies task-triggers.ts)
5. Merge `ecc/cognitive-crossrefs` → main (new files in lib/ecc/, modifies claude/analyze route)

**Conflict zones to watch**:
- `app/src/lib/ecc/types.ts` — WS-3 creates it; WS-4 and WS-5 may duplicate type defs → orchestrator merges
- `app/src/lib/ecc/index.ts` — WS-3 creates it; WS-4/5 may add exports → orchestrator merges
- `app/src/app/api/scoring/run/route.ts` — WS-2 (taxonomy pipeline changes) + WS-3 (causal adapter) both modify → manual merge
- Scoring pipeline.ts — WS-2 modifies for taxonomy; WS-3's adapter wraps it (different file, but imports change)

### Task 2.2: Consolidate Shared ECC Types
**Owner**: consolidation-dev
**After**: Task 2.1
- Merge any duplicate type definitions from WS-3/4/5 into single `app/src/lib/ecc/types.ts`
- Ensure `app/src/lib/ecc/index.ts` re-exports all modules
- Verify all import paths resolve

### Task 2.3: Install Dependencies
**Owner**: orchestrator
**After**: Task 2.2
- Add `@noble/hashes` to app/package.json (for BLAKE3 in ExoChain)
- Verify bundle size < 50KB gzipped (it's ~5KB)
- Run `npm install` from app/

### Task 2.4: Build Verification
**Owner**: build-dev
**After**: Task 2.3
- Run `cd app && npm run build`
- Fix any TypeScript compilation errors
- Fix any import resolution issues
- Verify no circular dependencies in ecc/ modules

### Task 2.5: Integration Tests
**Owner**: test-dev
**After**: Task 2.4

**Test files to create**:
- `tests/taxonomy/service.test.ts` — Vertical CRUD, hierarchy queries
- `tests/taxonomy/discovery.test.ts` — De-duplication, criteria overlap
- `tests/taxonomy/scoring-integration.test.ts` — ICP→Niche→Vertical in scoring
- `tests/ecc/causal-graph/service.test.ts` — CRUD operations
- `tests/ecc/causal-graph/scoring-adapter.test.ts` — Mock pipeline, verify nodes
- `tests/ecc/causal-graph/counterfactual.test.ts` — Weight mod + diff
- `tests/ecc/exo-chain/hash.test.ts` — BLAKE3 determinism
- `tests/ecc/exo-chain/service.test.ts` — Append, verify, tamper detection
- `tests/ecc/exo-chain/enrichment-adapter.test.ts` — Chain entries per waterfall step
- `tests/ecc/impulses/emitter.test.ts` — Impulse creation
- `tests/ecc/impulses/dispatcher.test.ts` — Handler routing, failure handling
- `tests/ecc/impulses/task-generator.test.ts` — Task creation from impulse
- `tests/ecc/cognitive-tick/session-service.test.ts` — Session CRUD
- `tests/ecc/cognitive-tick/claude-adapter.test.ts` — Context building, intent detection
- `tests/ecc/cross-refs/service.test.ts` — CRUD + query
- `tests/ecc/cross-refs/enrichment-adapter.test.ts` — Extraction from enrichment
- `tests/ecc/integration/score-with-provenance.test.ts` — Full scoring→causal→impulse→task
- `tests/ecc/integration/enrich-with-chain.test.ts` — Full waterfall→chain→cross-refs
- `tests/ecc/integration/feature-flags.test.ts` — Each flag independently disables module

### Task 2.6: Feature Flag Verification
**Owner**: test-dev
**After**: Task 2.5
- All ECC flags OFF: zero new DB writes, existing tests pass, no performance impact
- Each flag ON independently: only that module activates
- All flags ON: full ECC behavior
- No cross-module dependencies in v1

### Task 2.7: Performance Benchmarks
**Owner**: test-dev
**After**: Task 2.5
- Score 1 contact with causal tracking < 250ms
- Enrichment + chain tracking adds < 10ms
- Impulse emit < 10ms
- CrossRef query < 20ms

---

## Phase 2 Definition of Done

- [ ] All 5 worktree branches merged to main without conflicts
- [ ] Shared ECC types consolidated
- [ ] @noble/hashes dependency installed
- [ ] `npm run build` succeeds
- [ ] All 19+ test files created and passing
- [ ] Feature flags verified (each independently toggleable)
- [ ] Performance targets met
- [ ] Zero breaking changes to existing API contracts
- [ ] All acceptance criteria from 04-completion.md satisfied
