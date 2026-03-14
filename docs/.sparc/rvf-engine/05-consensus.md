# RVF Engine Integration -- Expert Review Consensus

**Date**: 2026-03-10
**Reviewers**: System Architect, Code Reviewer, Strategic Planner
**Status**: CONSENSUS REACHED -- Proceed with revised plan

---

## Key Decisions

### D-1: Use VectorDBWrapper API exclusively

**Decision**: Switch from rvf-wrapper functions to the `VectorDBWrapper` class.

**Rationale**: VectorDBWrapper provides a complete CRUD API including `get(id)` which is required for score upserts. The rvf-wrapper API lacks `get()`, making the scorer update pattern impossible without re-embedding. VectorDBWrapper is the intended high-level interface.

**Impact**: All pseudocode rewritten. `rvf-store.mjs` wraps VectorDBWrapper instead of raw rvf-wrapper functions.

**API mapping**:
| Operation | Old (rvf-wrapper) | New (VectorDBWrapper) |
|-----------|-------------------|----------------------|
| Create/Open | `createRvfStore()` / `openRvfStore()` | `new VectorDB({ storagePath })` |
| Ingest | `rvfIngest(store, entries)` | `db.insertBatch(entries)` |
| Query | `rvfQuery(store, vec, k)` -> `{ id, distance }` | `db.search(vec, k)` -> `{ id, score, metadata }` |
| Get by ID | N/A | `db.get(id)` -> `{ id, vector, metadata }` |
| Delete | `rvfDelete(store, id)` | `db.delete(id)` |
| Close | `rvfClose(store)` | (auto-managed by constructor) |

**Note on search results**: `VectorDBWrapper.search()` returns `score` (higher = more similar), not `distance` (lower = more similar). All display code uses `result.score` directly.

### D-2: ESM compatibility via createRequire

**Decision**: Use `createRequire(import.meta.url)` for the sync `isRvfAvailable()` check.

**Rationale**: Making `isRvfAvailable()` async would ripple through every call site. `createRequire` gives us a sync `require.resolve()` that works in `.mjs` files without changing the function signature.

**Pattern**:
```javascript
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

export function isRvfAvailable() {
  try { require.resolve('ruvector'); return true }
  catch { return false }
}
```

### D-3: isRvfAvailable() defined in rvf-store.mjs only

**Decision**: Single definition in `rvf-store.mjs`, NOT in `lib.mjs`.

**Rationale**: `rvf-store.mjs` is the module that owns all ruvector interaction. Putting the check there keeps it co-located with the dependency. `lib.mjs` exports `RVF_STORE_PATH` only.

**Impact**: All scripts import `isRvfAvailable` from `./rvf-store.mjs`, not from `./lib.mjs`.

### D-4: Shared utilities in rvf-store.mjs

**Decision**: `buildProfileText()`, `buildMetadata()`, `upsertMetadata()`, and `chunkArray()` all live in `rvf-store.mjs` as exports.

**Rationale**: `buildProfileText()` must be identical at vectorize-time and query-time to ensure embedding consistency. Centralizing in the shared module prevents divergence. `upsertMetadata()` encapsulates the get-existing-vector + re-insert pattern so each scorer doesn't re-implement it.

### D-5: CJS import pattern standardized

**Decision**: Cache the ruvector module at open time using `.default || module` pattern.

**Pattern**:
```javascript
let _mod = null
async function _loadRuvector() {
  if (_mod) return _mod
  const m = await import('ruvector')
  _mod = m.default || m
  return _mod
}
```

All ruvector access goes through `_loadRuvector()`. This handles CJS/ESM interop once, in one place.

### D-6: OnnxEmbedder API corrections

**Decision**: `getStats()` and `shutdown()` are module-level imports, not instance methods.

**Corrected usage**:
```javascript
const { OnnxEmbedder, getStats, shutdown } = await _loadRuvector()
const embedder = new OnnxEmbedder({ enableParallel: true })
await embedder.init()
const stats = getStats()  // module-level function
// ... work ...
await shutdown()           // module-level function
```

### D-7: embed() returns number[], not Float32Array

**Decision**: Remove unnecessary `new Float32Array()` wrapping. VectorDBWrapper accepts `number[]` directly.

### D-8: Similar mode uses stored vector, not re-embedding

**Decision**: For `analyzeSimilar()`, retrieve the target contact's vector from the store via `db.get(id)` instead of re-initializing OnnxEmbedder. Only `analyzeSemantic()` needs the embedder.

**Impact**: `similar` mode queries are milliseconds (store lookup + k-NN) instead of seconds (model init + embed + k-NN).

### D-9: Defer COW snapshots, --incremental, and report-generator

**Decision**: MVP scope excludes:
- COW branching in `delta.mjs` (continue with JSON snapshots)
- `--incremental` flag in `vectorize.mjs` (always full re-vectorize)
- `report-generator.mjs` RVF integration (continues reading graph.json)
- `graph-builder.mjs` modification (unnecessary, vectorize runs after scorers)
- `db.mjs export --format rvf` (JSON export only for now)

**Rationale**: These are optimizations that add complexity without blocking core functionality. The full re-vectorize of 1K contacts takes ~30 seconds, which is acceptable.

### D-10: Feature branch for commits

**Decision**: All work committed to `feat/rvf-engine` branch, not main.

**Rationale**: Project CLAUDE.md prohibits committing to master/main.

---

## Resolved Critical Issues

| ID | Issue | Resolution |
|----|-------|------------|
| C-1 | Spec says Float32Array, actual is number[] | Corrected in spec and pseudocode (D-7) |
| C-2 | getStats() called as instance method | Fixed to module-level import (D-6) |
| C-3 | shutdown() called as instance method | Fixed to module-level import (D-6) |
| C-4 | rvfQuery results lack metadata | Switched to VectorDBWrapper.search() which includes metadata (D-1) |
| C-5 | store.get() wrong API layer | Switched to VectorDBWrapper which has get() (D-1) |
| C-6 | require.resolve in ESM | Fixed with createRequire pattern (D-2) |
| C-7 | Mixed API surfaces | VectorDBWrapper exclusively (D-1) |

## Resolved Important Issues

| ID | Issue | Resolution |
|----|-------|------------|
| I-1 | rvfStatus not imported | Removed; not needed with VectorDBWrapper (use db.len()) |
| I-2 | rvfDerive return value dropped | COW snapshots deferred from MVP (D-9) |
| I-3 | CJS import pattern inconsistent | Standardized with _loadRuvector() (D-5) |
| I-4 | isRvfAvailable duplicated | Single definition in rvf-store.mjs (D-3) |
| I-5 | No lock contention handling | Added try/catch with specific error message in openStore() |
| I-6 | No corrupt store detection | Added corruption detection with rebuild instructions |
| I-7 | rvfClose not imported | Resolved by switching to VectorDBWrapper (no explicit close) |
| I-8 | Inconsistent score field access | Field mapping verified against actual scorer code |
| I-9 | chunkArray undefined | Defined in rvf-store.mjs as shared utility |
| I-10 | parseArgs kebab vs camelCase | Fixed to use kebab-case: `args['from-graph']` |
| I-11 | score vs distance semantics | Using VectorDBWrapper score (higher = more similar) |
| I-12 | No db.mjs search pseudocode | Added to pseudocode v2 |
| I-13 | graph-builder.mjs not specified | Explicitly out of scope (D-9) |
| I-14 | Commit to main | Changed to feature branch (D-10) |

## Architecture Review Concerns Addressed

| Concern | Resolution |
|---------|------------|
| Pipeline gating for vectorize | Added `vectorizeOk` flag; vectorize failure does not block analyzer |
| Timeout budget | First run skips timeout for model download; subsequent runs use 120s |
| Analyzer re-embedding for similar | Uses stored vector from db.get() instead (D-8) |
| Scorer re-ingest cost | VectorDBWrapper.insertBatch() handles upsert; test empirically |
| Missing metadata fields | Added profileUrl, title, mutualConnections, discoveredVia, createdAt, updatedAt |
| HNSW degradation | Accept for MVP; periodic full rebuild mitigates |
| OnnxEmbedder memory | Default workers to Math.min(os.cpus().length, 4) |

## Orchestration Changes

| # | Change |
|---|--------|
| 1 | 3 agents (merged docs into coding agents) |
| 2 | No Phase 1 study tasks for scorers/analysis |
| 3 | Rebalanced Phase 2: pipeline.mjs to rvf-core, db.mjs to rvf-scorers |
| 4 | Phase 3: two parallel validation tracks + sequential commit |
| 5 | Added scorer RVF upsert verification test |
| 6 | Explicitly noted deferred items |

---

## Documents Updated

- `01-pseudocode-v2.md` -- Complete rewrite addressing all critical/important issues
- `03-orchestration-v2.md` -- Restructured for 3 agents with revised phases
- `05-consensus.md` -- This document
