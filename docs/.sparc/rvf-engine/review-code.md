# RVF Engine Integration -- Code Review

Reviewer: Code Review Agent
Date: 2025-03-10
Documents Reviewed: 00-specification through 04-refinement
Source Files Reviewed: lib.mjs, db.mjs, graph-builder.mjs (partial), scorer.mjs (partial)
API Types Verified: rvf-wrapper.d.ts, onnx-embedder.d.ts, embedding-service.d.ts, index.d.ts

---

## 1. API Accuracy Issues

### CRITICAL-1: OnnxEmbedder.embed() returns `number[]`, not `Float32Array`

The pseudocode in 01-pseudocode.md (Section 2, vectorize.mjs) does:

```javascript
vectors = await embedder.embedBatch(texts)
rvfEntries = batch.map((entry, i) => ({
  id: entry.id,
  vector: new Float32Array(vectors[i]),  // <-- unnecessary conversion
  metadata: buildMetadata(entry.contact),
}))
```

Per `onnx-embedder.d.ts`, `OnnxEmbedder.embed()` returns `Promise<number[]>` and `embedBatch()` returns `Promise<number[][]>`. The `RvfEntry` interface in `rvf-wrapper.d.ts` accepts `Float32Array | number[]`. The `new Float32Array()` wrapping is not harmful but is unnecessary overhead for potentially thousands of vectors. More importantly, the pseudocode treats the return value as a raw array (`vectors[i]`) when `embedBatch` returns `number[][]` -- this is actually correct, but the plan text in 00-specification.md (line 90) says `OnnxEmbedder.embed(text) -> Float32Array(384)` which is wrong. The actual return type is `Promise<number[]>`. This inconsistency between the spec and the actual types could lead to confusion during implementation.

**Action**: Remove the `new Float32Array()` wrapping. Correct the spec to say `number[]` not `Float32Array(384)`. Ensure the implementation team knows `embed()` returns `Promise<number[]>` and `embedBatch()` returns `Promise<number[][]>`.

### CRITICAL-2: OnnxEmbedder has no `getStats()` method on instances

In 01-pseudocode.md, Section 2 (vectorize.mjs, line 90):

```javascript
console.log(`Embedder ready: ${embedder.dimension}d, SIMD=${getStats().simd}`)
```

`getStats()` is a module-level function export, not a method on the `OnnxEmbedder` class. The class has a `dimension` getter and a `ready` getter, but no `getStats()` method. The bare `getStats()` call would fail at runtime because it is not imported.

**Action**: Either import `getStats` from `ruvector` as a named export, or remove the SIMD reporting. The correct form would be:

```javascript
const { OnnxEmbedder, getStats } = await import('ruvector')
// ... after init ...
const stats = getStats()
console.log(`Embedder ready: ${stats.dimension}d, SIMD=${stats.simd}`)
```

### CRITICAL-3: `OnnxEmbedder.shutdown()` is a module-level function, not a class method

In 01-pseudocode.md, Sections 2 and 3:

```javascript
await embedder.shutdown()
```

Looking at `onnx-embedder.d.ts`, the `OnnxEmbedder` class does not expose a `shutdown()` method. Instead, `shutdown()` is a standalone module-level export: `export declare function shutdown(): Promise<void>`. The class only has `init()`, `embed()`, `embedBatch()`, `similarity()`, and the `dimension`/`ready` getters.

**Action**: Import and call `shutdown` as a module-level function:

```javascript
const { OnnxEmbedder, shutdown } = await import('ruvector')
// ... at cleanup ...
await shutdown()
```

### CRITICAL-4: `rvfQuery` returns `RvfResult[]` which has no `metadata` field

The pseudocode in analyzer.mjs additions (Section 3) accesses `result.distance` on query results, which is correct per `RvfResult { id: string; distance: number }`. However, the architecture document (02-architecture.md, line 273) implies query results include metadata: `[{id, distance, metadata}, ...]`. They do not.

If the implementation needs metadata after a query, it must do a separate `store.get(result.id)` call using the `VectorDBWrapper.get()` method (from index.d.ts), or look up the contact in the loaded graph.json. The pseudocode in analyzer.mjs actually does fall back to `graph.contacts[result.id]`, which is correct in practice, but the architecture document is misleading.

**Action**: Correct 02-architecture.md to show query results as `[{id, distance}, ...]` without metadata. Ensure implementation knows that after `rvfQuery`, metadata must come from either a `get()` call or from the in-memory graph. Alternatively, the `VectorDBWrapper.search()` method (from index.d.ts) does return metadata -- but that is a different API surface than the `rvfQuery` function from `rvf-wrapper`.

### CRITICAL-5: `store.get(url)` in scorer pseudocode uses wrong API layer

In 01-pseudocode.md, Section 4 (Scorer Modifications):

```javascript
existingEntry = await store.get(url)  // if API supports get-by-id
```

The variable `store` comes from `openStore()` in `rvf-store.mjs`, which returns whatever `createRvfStore`/`openRvfStore` return -- an `RvfStore` (typed as `any`). The `rvf-wrapper.d.ts` API does not expose a `get()` method. However, the `VectorDBWrapper` class from `index.d.ts` does have `get(id: string)`.

The plan is mixing two different API surfaces:
- **rvf-wrapper functions**: `createRvfStore`, `openRvfStore`, `rvfIngest`, `rvfQuery`, `rvfClose` -- these are the ones used in `rvf-store.mjs`
- **VectorDBWrapper class**: `insert`, `insertBatch`, `search`, `get`, `delete` -- this is a higher-level ORM-like wrapper

The scorer pseudocode tries to call `.get()` on the RvfStore, which is the wrong API. Either:
1. The `rvf-store.mjs` wrapper needs to expose a `getContact(id)` function that uses the right underlying API, or
2. The scorer needs to skip the "re-use existing vector" pattern entirely

**Action**: This is the most significant API mismatch. The plan needs to decide which API layer to use consistently. Options:

(a) Use `rvf-wrapper` functions throughout (current plan) and accept that there is no `get-by-id` function in that API. For score updates, always re-embed (or store vectors in a sidecar).

(b) Use `VectorDBWrapper` throughout instead of `rvf-wrapper` functions. This class has `get()`, `insert()`, `insertBatch()`, `search()`, and `delete()`. The constructor takes `{ dimensions, storagePath, distanceMetric, hnswConfig }`. This might be a cleaner fit.

(c) Hybrid: Use `rvf-wrapper` for store lifecycle (create/open/close) and `VectorDBWrapper` for data operations where `get()` is needed.

Recommendation: Option (b) -- switch to `VectorDBWrapper`. It provides a complete CRUD API and is the intended high-level interface. The `rvf-wrapper` functions are lower-level plumbing.

### IMPORTANT-1: `rvfStatus` called but never imported in vectorize.mjs

In 01-pseudocode.md, Section 2 (incremental mode):

```javascript
status = await rvfStatus(store)
```

`rvfStatus` is not imported in the pseudocode. It is exported from `rvf-wrapper.d.ts` but is not re-exported through `rvf-store.mjs`. The `rvf-store.mjs` pseudocode does not wrap `rvfStatus`.

**Action**: Either add a `storeStatus()` wrapper to `rvf-store.mjs` or import `rvfStatus` directly in `vectorize.mjs`. Given the revised decision in 04-refinement.md to skip `--incremental` for MVP, this may be moot, but the pseudocode still references it.

### IMPORTANT-2: `rvfDerive` returns `RvfStore`, not void

In 01-pseudocode.md, Section 6 (Delta Snapshots):

```javascript
await deriveSnapshot(snapshotPath)
```

Per `rvf-wrapper.d.ts`, `rvfDerive` returns `Promise<RvfStore>` -- a child store handle. The pseudocode ignores this return value. If the derived store needs to be closed to flush data, the implementation must capture and close it:

```javascript
const childStore = await rvfDerive(store, snapshotPath)
await rvfClose(childStore)
```

**Action**: Update `deriveSnapshot()` in `rvf-store.mjs` to close the returned child store, or document that the child store handle is intentionally discarded (if the underlying implementation auto-flushes).

---

## 2. ESM/CJS Interop Issues

### CRITICAL-6: `require.resolve('ruvector')` will fail in ESM .mjs files

Both `lib.mjs` (Section 7) and `rvf-store.mjs` (Section 1) use:

```javascript
export function isRvfAvailable() {
  try {
    require.resolve('ruvector')
    return true
  } catch {
    return false
  }
}
```

There is no `require` in ESM modules. All source files use `.mjs` extensions and the project uses `"type": "module"`. This will throw `ReferenceError: require is not defined` at runtime.

The refinement doc (04-refinement.md, Section 2) acknowledges CJS/ESM issues but proposes the `createRequire` pattern only as a fallback for importing ruvector, not for the availability check.

**Action**: Replace with an ESM-compatible check. Options:

```javascript
// Option A: Dynamic import probe
export async function isRvfAvailable() {
  try {
    await import('ruvector')
    return true
  } catch {
    return false
  }
}
```

Note: This changes the function from sync to async, which affects every call site (`if not isRvfAvailable()` becomes `if (!(await isRvfAvailable()))`). This is a significant ripple through the codebase.

```javascript
// Option B: createRequire for the sync check only
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

export function isRvfAvailable() {
  try {
    require.resolve('ruvector')
    return true
  } catch {
    return false
  }
}
```

Option B preserves the sync signature and is less invasive. This is the recommended approach. It only uses `require.resolve` (resolution, not loading), so there are no CJS/ESM module system conflicts.

### IMPORTANT-3: CJS default export destructuring may fail

In 01-pseudocode.md, the plan imports named exports directly:

```javascript
const { createRvfStore, openRvfStore } = await import('ruvector')
const { OnnxEmbedder } = await import('ruvector')
```

The ruvector package publishes CJS (`dist/index.js` with `module.exports`). When Node.js ESM dynamically imports a CJS module, the entire `module.exports` object becomes the `default` export. Named exports may or may not be statically analyzed by Node's CJS named export detection.

The refinement doc (04-refinement.md, Section 2) correctly identifies this and proposes:

```javascript
const ruvector = await import('ruvector')
const { OnnxEmbedder } = ruvector.default || ruvector
```

However, this pattern is not reflected in the actual pseudocode in 01-pseudocode.md. The pseudocode still uses direct destructuring which may not work.

**Action**: All `await import('ruvector')` calls throughout the pseudocode must use the `.default || module` pattern. This needs to be handled once in `rvf-store.mjs` and once in `vectorize.mjs` (and anywhere else ruvector is imported). Alternatively, centralize all ruvector access through `rvf-store.mjs` so only one file deals with the import interop.

### IMPORTANT-4: `isRvfAvailable()` duplicated in two files

The function appears in both `lib.mjs` (Section 7) and `rvf-store.mjs` (Section 1). Having two copies is a maintenance hazard. If one is fixed for ESM compatibility and the other is not, the system will behave inconsistently.

**Action**: Define `isRvfAvailable()` in exactly one place. Since `rvf-store.mjs` already imports from `lib.mjs`, put it in `lib.mjs` and have `rvf-store.mjs` re-export it.

---

## 3. Error Handling Issues

### IMPORTANT-5: No handling for store lock contention

The `openStore()` function in `rvf-store.mjs` does not handle the case where the `.rvf` file is already locked by another process. Per the refinement doc (Section 5), the pipeline runs scripts sequentially via `execFileSync`, so this should not happen in normal operation. But if a user runs `vectorize.mjs` manually while a pipeline is running, or if a previous run crashed without releasing the lock, `openRvfStore` will likely throw.

**Action**: Wrap `openRvfStore` in a try/catch with a specific error message:

```javascript
try {
  _store = await openRvfStore(RVF_PATH)
} catch (err) {
  if (err.message.includes('lock') || err.code === 'EBUSY') {
    console.error(`RVF store is locked. Another process may be using it.`)
    console.error(`If no other process is running, delete ${RVF_PATH}.lock and retry.`)
    return null
  }
  throw err
}
```

### IMPORTANT-6: No handling for corrupt RVF store

The spec (00-specification.md, NFR-4) says "Corrupt .rvf file detected with clear error message and rebuild instructions." The pseudocode does not implement this. If `openRvfStore` throws due to corruption, the generic catch in `safeRvfOp` (02-architecture.md, Section 5) would catch it, but the user would get a vague "falling back to JSON" message rather than actionable rebuild instructions.

**Action**: Add corruption detection in `openStore()`:

```javascript
try {
  _store = await openRvfStore(RVF_PATH)
} catch (err) {
  console.error(`Failed to open RVF store: ${err.message}`)
  console.error(`The store may be corrupt. Rebuild with:`)
  console.error(`  node scripts/vectorize.mjs --from-graph`)
  return null
}
```

### IMPORTANT-7: `closeStore()` uses bare `rvfClose` without import

In 01-pseudocode.md, Section 1 (`rvf-store.mjs`):

```javascript
async function closeStore():
  if _store:
    await rvfClose(_store)
    _store = null
```

`rvfClose` is called directly but is never shown being imported. It comes from ruvector (`rvf-wrapper.d.ts`), so it needs to be imported the same way `createRvfStore` and `openRvfStore` are. Since `closeStore` is called after `openStore`, the module may have cached the import -- but this is not explicit in the pseudocode.

**Action**: Cache the ruvector module reference at `openStore()` time so `closeStore()` can use it:

```javascript
let _rvf = null  // cached ruvector module

async function openStore() {
  if (_store) return _store
  if (!isRvfAvailable()) return null

  _rvf = await import('ruvector')
  const mod = _rvf.default || _rvf
  // ... use mod.createRvfStore / mod.openRvfStore
}

async function closeStore() {
  if (_store && _rvf) {
    const mod = _rvf.default || _rvf
    await mod.rvfClose(_store)
    _store = null
  }
}
```

### NICE-TO-HAVE-1: No timeout on embedder initialization

`OnnxEmbedder.init()` downloads a ~30 MB model on first use. This could hang indefinitely on a slow or broken connection. The pseudocode does not set a timeout.

**Action**: Consider wrapping init with a timeout:

```javascript
const initTimeout = setTimeout(() => {
  console.warn('Model download taking longer than expected...')
}, 30000)
const ready = await embedder.init()
clearTimeout(initTimeout)
if (!ready) {
  console.warn('ONNX embedder failed to initialize. Using hash fallback.')
}
```

### NICE-TO-HAVE-2: Batch errors swallow individual failure details

In 01-pseudocode.md, Section 2:

```javascript
catch err:
  console.error(`  Batch error: ${err.message}`)
  errors += batch.length
```

If a batch of 50 fails, all 50 are counted as errors but there is no retry or per-item fallback. For a large dataset, a single bad batch could silently drop 50 contacts.

**Action**: Consider adding a single-item fallback when batch embedding fails:

```javascript
catch (batchErr) {
  console.warn(`  Batch embed failed, trying individually: ${batchErr.message}`)
  for (const entry of batch) {
    try {
      const vec = await embedder.embed(entry.text)
      // ingest individually
    } catch { errors++ }
  }
}
```

---

## 4. Code Quality Issues

### IMPORTANT-8: Inconsistent score field access patterns

In 01-pseudocode.md, `buildMetadata()` (Section 2) accesses scores inconsistently:

```javascript
icpFit: contact.scores?.icpFit || 0,           // nested under .scores
behavioralScore: contact.behavioralScore || 0,   // top-level
referralLikelihood: contact.scores?.referralLikelihood || 0,  // nested
referralTier: contact.referralTier || '',         // top-level
```

Looking at `scorer.mjs`, it writes scores into `graph.contacts[url].scores = { ... }`, so ICP/gold scores are under `.scores`. But behavioral scores appear to be written differently. This inconsistency suggests the metadata builder was written from memory rather than from the actual scorer output format.

**Action**: Read the actual output format of all three scorers and verify every field path. Build a field-mapping table showing exactly where each scorer writes its output and how `buildMetadata()` should read it. This was supposed to be Task 1.5 in the orchestration plan but it needs to happen before any code is written.

### IMPORTANT-9: `chunkArray` utility referenced but never defined

In 01-pseudocode.md, Section 2:

```javascript
for batch of chunkArray(entries, batchSize):
```

`chunkArray` is not defined anywhere in the pseudocode or the existing codebase. This is a trivial utility, but it needs to exist.

**Action**: Add `chunkArray` to `rvf-store.mjs` or `vectorize.mjs`:

```javascript
function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
```

### IMPORTANT-10: parseArgs camelCase mismatch

The existing `parseArgs()` in `lib.mjs` returns kebab-case keys from `--from-graph` as `args['from-graph']`. But the pseudocode accesses `args.fromGraph` (camelCase):

```javascript
if args.fromGraph and existsSync(...)
```

These are different keys and the check will always be false.

**Action**: Either access `args['from-graph']` consistently (matching the existing parseArgs implementation), or add camelCase conversion to parseArgs. The simpler fix is to use the kebab-case access pattern throughout:

```javascript
if (args['from-graph'] && existsSync(...))
if (args['batch-size'] || 50)
```

### NICE-TO-HAVE-3: `parseArgs` does not handle numeric values

`parseArgs` in `lib.mjs` returns string values for `--batch-size 50`. The pseudocode uses `args.batchSize || 50` which would give `"50"` (a truthy string), not the number `50`. This works for the batch size case (string coercion in the for loop), but is fragile.

**Action**: Parse numeric args explicitly:

```javascript
const batchSize = parseInt(args['batch-size'], 10) || 50
```

### NICE-TO-HAVE-4: `buildProfileText()` should be a shared utility

`buildProfileText()` is defined in `vectorize.mjs` and also used in `analyzer.mjs` (Sections 2 and 3). If the function diverges between the two files, embeddings generated during vectorization would not match embeddings generated during query time, degrading search quality.

**Action**: Define `buildProfileText()` once in `rvf-store.mjs` (or a dedicated `rvf-utils.mjs`) and import it in both `vectorize.mjs` and `analyzer.mjs`.

---

## 5. Missing Implementation Details

### CRITICAL-7: No decision on which API surface to use

This is the most impactful gap. The plan references two distinct API surfaces from ruvector:

1. **rvf-wrapper functions** (`createRvfStore`, `openRvfStore`, `rvfIngest`, `rvfQuery`, `rvfClose`, `rvfDerive`, `rvfStatus`, `rvfDelete`, `rvfCompact`) -- lower-level, no `get()` by ID, returns `RvfResult` without metadata on queries.

2. **VectorDBWrapper class** (`new VectorDB({ dimensions, storagePath })`, `.insert()`, `.insertBatch()`, `.search()`, `.get()`, `.delete()`, `.len()`) -- higher-level, has `get()` by ID, returns metadata on search results.

The pseudocode uses API surface 1 for store lifecycle and ingest, then tries to use API surface 2 features (`.get()`) in the scorer. This will not work. The implementation must pick one.

**Recommendation**: Use `VectorDBWrapper` exclusively. It provides everything needed:
- `new VectorDB({ dimensions: 384, storagePath: RVF_PATH, distanceMetric: 'cosine', hnswConfig: { m: 16, efConstruction: 200 } })` for creation
- `.insertBatch()` for ingest (accepts same `{ id, vector, metadata }` shape)
- `.search()` for k-NN (returns `{ id, score, metadata }` -- note: `score` not `distance`)
- `.get(id)` for retrieving existing entries in scorers
- No explicit open/close lifecycle (constructor handles it)

If `VectorDBWrapper` does not support the file-based open/close pattern (i.e., it uses an in-memory store by default), then the plan needs a hybrid approach or needs to verify that `storagePath` in the constructor triggers RVF-backed persistence.

### IMPORTANT-11: VectorDBWrapper.search returns `score`, not `distance`

If switching to `VectorDBWrapper`, note that `.search()` returns `{ id: string; score: number; metadata }` where `score` is similarity (higher = more similar), whereas `rvfQuery` returns `{ id: string; distance: number }` where `distance` is lower = more similar.

The analyzer pseudocode computes similarity as `1 - result.distance`. If using `VectorDBWrapper`, this would need to change to just `result.score`.

**Action**: Document the semantic difference clearly and ensure the implementation uses the correct interpretation for whichever API is chosen.

### IMPORTANT-12: No concrete plan for RVF store in `db.mjs` search command

The architecture document (Section 2) says `db.mjs search` will use vector similarity when RVF is available. The orchestration doc assigns this as Task 2.8. But there is no pseudocode for this integration. The existing `find()` function in `db.mjs` uses substring matching -- replacing it with vector search changes the semantics entirely (fuzzy semantic vs exact substring).

**Action**: Write pseudocode for the `db.mjs search` integration. Consider:
- Should vector search replace substring search, or augment it?
- What happens when the user passes `--keywords` (which implies substring matching)?
- Should there be a `--semantic` flag to opt in to vector search?

### IMPORTANT-13: graph-builder.mjs modifications not specified

The specification (00-specification.md, Section 7) says `graph-builder.mjs` is MODIFIED to "optionally write to RVF alongside graph.json." But there is no pseudocode for this in 01-pseudocode.md, and the orchestration plan does not assign this work to any agent.

**Action**: Either add pseudocode for graph-builder.mjs RVF integration, or explicitly scope it out of MVP. Given that the plan puts vectorize.mjs after all scorers in the pipeline, having graph-builder also write to RVF would create redundancy. Recommend removing this from scope.

### NICE-TO-HAVE-5: No plan for vector deletion / contact removal

The spec does not address what happens when a contact is pruned via `db.mjs prune`. The contact would be removed from `contacts.json` but its vector would remain in the RVF store. Over time, the RVF store would contain stale entries.

**Action**: When `db.mjs prune` removes contacts, also call `rvfDelete` (or `VectorDB.delete`) for those IDs. Add this to the integration plan.

### NICE-TO-HAVE-6: `--from-graph` vs `--from-contacts` flag not in parseArgs

The `--from-graph` flag is used throughout but `parseArgs` returns it as `args['from-graph']`. The pseudocode never defines `--from-contacts` as an alternative, but the refinement doc (Section 3) mentions it as an option. This should be clarified so the implementation knows what flags to support.

---

## 6. Orchestration and Process Issues

### IMPORTANT-14: Task 3.5 says "Commit on main branch"

The orchestration plan (03-orchestration.md, Task 3.5) says to commit on the main branch. Per the project rules in CLAUDE.md: "Do not EVER commit to master, unless this rule is removed." This should use a feature branch.

**Action**: Change Task 3.5 to create a feature branch (e.g., `feat/rvf-engine`) and commit there. Create a PR for review before merging to main.

### NICE-TO-HAVE-7: Orchestration plan has 4 agents but refinement doc revised scope

The refinement doc (04-refinement.md) makes several scope reductions (e.g., skip `--incremental` for MVP, report generator stays on graph.json). The orchestration plan (03-orchestration.md) was written before these refinements and does not reflect them. Tasks 2.7 (delta.mjs COW) and 2.8 (db.mjs search) may be deprioritized per the refinement decisions but are still listed as Phase 2 work.

**Action**: Update the orchestration plan to reflect the refined scope, marking deferred items clearly.

---

## Summary of Issues by Severity

### CRITICAL (must fix before implementation)

| ID | Issue | Affected File |
|----|-------|---------------|
| C-1 | Spec says `Float32Array`, actual return is `number[]` | 00-specification.md |
| C-2 | `getStats()` is module-level, not on OnnxEmbedder instance | vectorize.mjs pseudocode |
| C-3 | `shutdown()` is module-level, not on OnnxEmbedder instance | vectorize.mjs, analyzer.mjs pseudocode |
| C-4 | `rvfQuery` results have no metadata field | 02-architecture.md |
| C-5 | `store.get()` does not exist on RvfStore (rvf-wrapper API) | scorer.mjs pseudocode |
| C-6 | `require.resolve` will crash in ESM .mjs files | lib.mjs, rvf-store.mjs pseudocode |
| C-7 | No consistent decision on rvf-wrapper vs VectorDBWrapper API | All pseudocode |

### IMPORTANT (should fix)

| ID | Issue | Affected File |
|----|-------|---------------|
| I-1 | `rvfStatus` not imported in vectorize.mjs | vectorize.mjs pseudocode |
| I-2 | `rvfDerive` return value (child store) silently dropped | rvf-store.mjs pseudocode |
| I-3 | CJS default export destructuring pattern not in pseudocode | All import sites |
| I-4 | `isRvfAvailable()` duplicated across two files | lib.mjs, rvf-store.mjs |
| I-5 | No lock contention handling on openStore | rvf-store.mjs |
| I-6 | No corrupt store detection/messaging | rvf-store.mjs |
| I-7 | `rvfClose` used but never imported in closeStore | rvf-store.mjs pseudocode |
| I-8 | Inconsistent score field access (.scores.X vs top-level) | vectorize.mjs buildMetadata |
| I-9 | `chunkArray` referenced but undefined | vectorize.mjs pseudocode |
| I-10 | parseArgs returns kebab-case, pseudocode reads camelCase | vectorize.mjs pseudocode |
| I-11 | VectorDBWrapper.search returns `score`, rvfQuery returns `distance` | analyzer.mjs pseudocode |
| I-12 | No pseudocode for db.mjs search integration | db.mjs |
| I-13 | graph-builder.mjs modification listed but not specified | graph-builder.mjs |
| I-14 | Orchestration says commit to main; rules forbid it | 03-orchestration.md |

### NICE-TO-HAVE (improvements)

| ID | Issue | Affected File |
|----|-------|---------------|
| N-1 | No timeout on embedder model download | vectorize.mjs |
| N-2 | Batch errors drop all items with no retry | vectorize.mjs |
| N-3 | parseArgs does not handle numeric values | vectorize.mjs |
| N-4 | buildProfileText should be shared, not duplicated | vectorize.mjs, analyzer.mjs |
| N-5 | No plan for vector deletion on contact prune | db.mjs |
| N-6 | --from-contacts flag mentioned but not defined | vectorize.mjs |
| N-7 | Orchestration plan not updated after refinement | 03-orchestration.md |

---

## Implementation Readiness Assessment

**Status: NOT READY for implementation.**

The plan has strong architectural thinking and a reasonable phased approach, but there are 7 critical issues that would cause runtime failures if implemented as-is. The most fundamental problem is **CRITICAL-7**: the plan has not committed to a single ruvector API surface and mixes two incompatible ones. This decision cascades through every file.

### Required before implementation begins:

1. **Decide on API surface** (CRITICAL-7): Choose VectorDBWrapper or rvf-wrapper functions. Update all pseudocode accordingly. This is the single most important decision.

2. **Fix ESM compatibility** (CRITICAL-6): Replace `require.resolve` with `createRequire` pattern. This is a simple fix but touches the core availability check used everywhere.

3. **Fix OnnxEmbedder API calls** (CRITICAL-2, CRITICAL-3): Correct `getStats()` and `shutdown()` to be module-level imports. Straightforward.

4. **Write one corrected rvf-store.mjs** that actually compiles: Incorporate all the import fixes, error handling, and API decisions into a single reference implementation that the coding agents can follow.

### Recommended next step:

Produce a single revised `01-pseudocode-v2.md` that incorporates all critical and important fixes from this review. This should take roughly 30 minutes and will save significant debugging time during implementation. The coding agents should not start until this revised pseudocode is approved.

### What the plan does well:

- The graceful degradation tiers (full RVF / RVF without ONNX / JSON-only) are well thought out
- The decision to put vectorize after all scorers in the pipeline is correct
- The metadata schema is comprehensive and well-mapped to existing contact fields
- The batch embedding approach with chunking is appropriate
- The single-wrapper-module pattern (rvf-store.mjs) for all ruvector access is sound architecture
- The refinement document shows good engineering judgment on scope (deferring --incremental, keeping report on JSON)
- Optional dependency in package.json is the right approach
