# RVF Engine Integration -- Architecture Review

**Reviewer**: System Architecture Designer
**Date**: 2025-03-10
**Documents Reviewed**: 00-specification.md, 01-pseudocode.md, 02-architecture.md, 03-orchestration.md, 04-refinement.md
**Codebase Inspected**: lib.mjs, analyzer.mjs, scorer.mjs, pipeline.mjs, delta.mjs, db.mjs

---

## 1. Architecture Fitness

### 1.1 Integration with the Existing 5-Phase Pipeline

**Verdict: APPROVE**

The plan places `vectorize.mjs` after all three scorers and before `analyzer.mjs` in the pipeline sequence. This is the correct insertion point. The rationale documented in the refinement doc (section 7) is sound: embedding after scoring means metadata is complete in a single pass, avoiding multiple RVF update round-trips.

The existing `pipeline.mjs` uses `execFileSync` for sequential step execution with per-step error handling, dependency gating (graph-builder failure skips scorer, scorer failure skips behavioral-scorer, etc.), and a summary report. The vectorize step fits cleanly into this model because it is a terminal producer (it reads graph.json, writes network.rvf) with no downstream hard dependency. If vectorize fails, the analyzer and delta steps can still run against graph.json.

### 1.2 New Module Boundaries

**Verdict: APPROVE**

The separation of `rvf-store.mjs` (shared store lifecycle) from `vectorize.mjs` (embedding pipeline) is the right call. It creates a clean seam: every script that needs RVF access imports from `rvf-store.mjs` and never touches ruvector directly. This aligns with the existing pattern where `lib.mjs` provides shared utilities and `db.mjs` provides shared data access.

One structural strength: the singleton pattern in `rvf-store.mjs` (module-level `_store` variable) matches how `db.mjs` handles `contacts.json` -- load once, operate, save. The pipeline's `execFileSync` model means each script runs in its own process, so the singleton is effectively per-invocation, which is safe.

### 1.3 Fallback Architecture (3-Tier Degradation)

**Verdict: APPROVE**

The three-tier degradation model (Full RVF > RVF without ONNX > JSON only) is well-designed. Every entry point checks `isRvfAvailable()` and falls through to existing behavior. This is critical for a skill that needs to work out-of-the-box without npm install.

---

## 2. Dependency Management

### 2.1 optionalDependency Strategy

**Verdict: APPROVE with CONCERN**

Making ruvector an `optionalDependency` is the correct pattern for a feature that enhances but does not gate core functionality. However, there are two concerns:

**Concern A: No package.json exists yet.** The glob search confirms there is currently no `package.json` in the skill directory. The plan creates one with `playwright` as a hard dependency and `ruvector` as optional. This is a structural change: currently, playwright is expected to be available in the Claude Code environment without a local package.json. Adding a package.json with playwright as a dependency implies users should run `npm install` in the skill directory, which changes the setup story. The plan should clarify whether this package.json is purely declarative (for documentation) or actually used for `npm install`. If the latter, the install step needs explicit documentation because the skill currently operates without one.

**Concern B: Version pinning at ^0.2.x.** The refinement doc notes ruvector has 113 published versions and is rapidly iterating. Pinning to `^0.2.12` allows 0.2.x patches but blocks 0.3.x. This is prudent. However, the plan should add a comment in `rvf-store.mjs` documenting the minimum required ruvector API surface (createRvfStore, openRvfStore, rvfIngest, rvfQuery, rvfClose, rvfDerive, OnnxEmbedder) so that future API breakage is immediately identifiable.

### 2.2 Dynamic Import Pattern (CJS to ESM Interop)

**Verdict: CONCERN**

The pseudocode shows two import patterns that are not consistent:

**Pattern 1** (rvf-store.mjs):
```javascript
const { createRvfStore, openRvfStore } = await import('ruvector')
```

**Pattern 2** (refinement doc, CJS interop):
```javascript
const ruvector = await import('ruvector');
const { OnnxEmbedder } = ruvector.default || ruvector;
```

These cannot both be correct. When Node.js dynamically imports a CJS module, the module is wrapped in a default export. Named exports may or may not be available depending on how the CJS module sets `module.exports`. The plan needs to:

1. **Test the actual import behavior** of the installed ruvector version. Run `node -e "import('ruvector').then(m => console.log(Object.keys(m)))"` to see what exports are available.
2. **Standardize on one pattern** in `rvf-store.mjs` and document it. The `ruvector.default || ruvector` approach is safer as a universal fallback.
3. **Add a runtime validation** in `rvf-store.mjs:openStore()` that verifies the expected functions exist on the imported module before proceeding, with a clear error message if they do not.

### 2.3 isRvfAvailable() Using require.resolve in ESM

**Verdict: CONCERN**

Both `lib.mjs` and `rvf-store.mjs` define `isRvfAvailable()` using `require.resolve('ruvector')`. But the project is `type: "module"` and all files use `.mjs` extensions. `require` is not available in ESM modules. The pseudocode in `lib.mjs` shows bare `require.resolve()` which will throw a `ReferenceError` in ESM context.

The fix is straightforward -- use `createRequire`:
```javascript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
export function isRvfAvailable() {
  try { require.resolve('ruvector'); return true; }
  catch { return false; }
}
```

Or alternatively, use dynamic import as the check:
```javascript
export async function isRvfAvailable() {
  try { await import('ruvector'); return true; }
  catch { return false; }
}
```

The second approach changes the function to async, which ripples into every call site. The `createRequire` approach is cleaner. This must be resolved before implementation.

**Also note**: `isRvfAvailable()` is defined in both `lib.mjs` and `rvf-store.mjs` in the pseudocode. It should be defined in exactly one place (`lib.mjs` or `rvf-store.mjs`) and imported elsewhere. Duplication will lead to drift.

---

## 3. Data Model

### 3.1 Metadata Schema Completeness

**Verdict: APPROVE with CONCERN**

The metadata schema in section 6 of the specification covers all three scoring layers, profile identity fields, enrichment state, and graph clustering. This maps well to what scorer.mjs, behavioral-scorer.mjs, and referral-scorer.mjs actually write to graph.json contacts.

**Missing fields identified**:

- **`profileUrl`**: Listed in the specification's metadata schema but absent from `buildMetadata()` in the pseudocode. The contact's URL is used as the entry ID, but it should also be in metadata for query results that return metadata without ID. Without it, a query result's metadata alone cannot identify the contact.
- **`enrichedName`**: The specification lists `enrichedName` but `buildMetadata()` maps it to just `name` (using `enrichedName || name`). This loses the distinction between raw and enriched names. If any downstream logic needs to know whether a contact was enriched by name, this field should be preserved separately.
- **`title`**: Listed in specification but missing from `buildMetadata()`. The `headline` field uses `headline || title` as a fallback, but `title` is a distinct LinkedIn field (job title vs. profile headline). Losing `title` means search queries for job titles would miss contacts who have a title but no headline.
- **`connections`**: Stored as string but never validated. LinkedIn displays connections as "500+" or "3,456". The metadata stores this string as-is, which is fine for display but unusable for numeric filtering. Consider storing a parsed integer alongside the raw string.
- **`discoveredVia`**: Listed as `string[]` in the specification schema but absent from `buildMetadata()`.
- **`createdAt` / `updatedAt`**: Listed in specification but absent from `buildMetadata()`. Only `embeddedAt` is set.
- **`mutualConnections`**: Used extensively in scorer.mjs baselines but not stored in RVF metadata. This means metadata-only queries cannot filter or sort by mutual connection count, which is a primary scoring input.

**Recommendation**: Add `profileUrl`, `title`, `mutualConnections`, `discoveredVia`, `createdAt`, and `updatedAt` to `buildMetadata()`. The cost is approximately 200 bytes per contact, negligible against the 1-2 KB per contact already budgeted.

### 3.2 Metadata Size and Storage Efficiency

**Verdict: APPROVE**

The 300-character cap on `about` is reasonable. The per-contact metadata budget of 1-2 KB translates to 10-20 MB for 10K contacts, which is within the NFR-2 target of 50 MB total. The `searchTerms` field is `string[]` which could be unbounded, but in practice these come from the ICP config and are limited to a handful of terms per contact.

### 3.3 ID Normalization

**Verdict: APPROVE**

Using `url.replace(/\/$/, '').split('?')[0]` for ID normalization is correct and matches the existing pattern in `db.mjs`. The refinement doc explicitly addresses this edge case.

---

## 4. Performance

### 4.1 Batch Size and Parallel Workers

**Verdict: APPROVE**

Batch size of 50 for embedding is reasonable. The ONNX WASM runtime processes one text at a time under the hood, so batching here is about reducing the overhead of multiple ingest calls, not about GPU parallelism. The `parallelThreshold: 4` for OnnxEmbedder's web workers is sensible for a Node.js environment (likely 4-8 logical cores on the WSL2 host).

For 1,000 contacts at 100ms per embedding, the base time is 100 seconds. With 3.8x parallel speedup, that is approximately 26 seconds. Add ingest overhead and the target of "under 2 minutes" is easily met.

### 4.2 Scorer RVF Update Pattern (Re-ingesting with Existing Vectors)

**Verdict: CONCERN**

The pseudocode for `updateRvfScores()` in section 4 of the pseudocode doc shows:

```
existingEntry = await store.get(url)  // if API supports get-by-id
entries.push({ id: url, vector: existingEntry.vector, metadata: buildMetadata(contact) })
result = await ingestContacts(entries)
```

This pattern fetches each contact individually by ID, then re-ingests with the same vector and updated metadata. For N scored contacts, this is N individual get-by-ID calls plus one batch ingest. The get-by-ID calls are O(1) each (HNSW supports direct ID lookup), but the re-ingest may trigger HNSW index rebuilding for each batch.

**Bottleneck risk**: If ruvector's ingest treats "same ID, same vector" as a full vector update (removing old, inserting new into HNSW), this is expensive. If it treats it as a metadata-only update (detecting vector equality), it is cheap. The plan does not document which behavior ruvector implements. This should be tested before committing to this pattern.

**Alternative**: If ruvector supports a metadata-only update API (e.g., `rvfUpdateMetadata(store, id, metadata)`) that does not touch the vector index, that would be significantly more efficient for score updates. The architecture doc's `rvf-store.mjs` API should expose a `updateMetadata()` function if available.

### 4.3 Cold Start and Store Open Latency

**Verdict: APPROVE**

The NFR target of 500ms for cold start is generous. Opening a 5-50 MB memory-mapped file and loading the HNSW index into memory is typically sub-100ms. The real cold start cost is the OnnxEmbedder initialization (model loading), which is a one-time cost per script invocation.

### 4.4 Analyzer Re-embedding for Similarity Queries

**Verdict: CONCERN**

In the `analyzeSimilar()` pseudocode, when finding contacts similar to a target contact, the code re-embeds the target's profile text rather than retrieving the existing vector from the RVF store:

```
embedder = new OnnxEmbedder()
await embedder.init()
profileText = buildProfileText(targetContact)
targetVector = await embedder.embed(profileText)
```

This means every "similar to X" query pays the OnnxEmbedder initialization cost (model load, WASM compile) plus the embedding cost, even though the target's vector is already stored in the RVF. The correct approach is:

1. Try `getContact(targetUrl)` from the RVF store to retrieve the existing vector.
2. If found, use it directly for k-NN search (no embedder needed).
3. Only fall back to re-embedding if the contact is not in the store.

This would reduce "similar to" query latency from seconds (model init + embed) to milliseconds (RVF lookup + k-NN search). The `semantic` mode still needs the embedder (it embeds free text), but `similar` mode should not.

---

## 5. Orchestration

### 5.1 Agent Decomposition

**Verdict: APPROVE**

The 4-agent roster (rvf-core, rvf-scorers, rvf-analysis, rvf-docs) with clear scope boundaries is well-structured. The dependency gates between Phase 1 and Phase 2 are correctly placed: rvf-scorers and rvf-analysis both depend on rvf-core's deliverables (rvf-store.mjs, lib.mjs exports).

### 5.2 Pipeline Dependency Gating for Vectorize Step

**Verdict: CONCERN**

The plan adds vectorize to the `rebuild` and `full` pipeline modes, but the existing `pipeline.mjs` has specific dependency gating logic (if graph-builder fails, skip scorer; if scorer fails, skip behavioral; etc.). The plan does not specify the gating behavior for the vectorize step.

The correct gating should be:
- If **any scorer fails**, skip vectorize (because metadata would be incomplete).
- If **vectorize fails**, do NOT skip analyzer or delta (they still work from graph.json).

The plan should explicitly document this, and the implementation should add a `vectorizeOk` tracking variable alongside `graphOk`, `scorerOk`, and `behavioralOk` in `pipeline.mjs`.

### 5.3 Timeout Budget

**Verdict: CONCERN**

The pipeline uses `timeout: 120_000` (2 minutes) per step. For vectorizing 1,000+ contacts, the embedding phase alone could take 26-100 seconds depending on parallel worker availability. Add ONNX model download on first run (~30 MB from HuggingFace), and the 2-minute timeout may be too tight for the vectorize step on first execution.

**Recommendation**: Either increase the timeout for the vectorize step specifically, or have vectorize.mjs handle the model download as a separate pre-step before the timer-sensitive batch embedding begins. Alternatively, document that the first run may need `--batch-size 25` to stay within the timeout window.

---

## 6. Risk Assessment

### Top 3 Risks NOT Already Identified in Refinement Doc

**Risk 1: HNSW Index Rebuild on Partial Re-ingest (Severity: HIGH)**

The refinement doc covers corruption, API drift, and concurrent access, but does not address what happens when scorers call `ingestContacts()` with existing IDs and identical vectors but updated metadata. If ruvector treats this as a full vector upsert (delete old node from HNSW graph, insert new node), the HNSW connectivity could degrade over many re-ingests. HNSW graphs are built with specific neighbor selection heuristics during construction; repeated delete-and-reinsert of the same vector can create suboptimal graph topology, degrading search recall.

**Mitigation**: Test empirically with 1,000 contacts, re-ingest 100 times, measure recall@20 before and after. If degradation is observed, implement periodic full rebuilds (`vectorize.mjs --from-graph` without `--incremental`).

**Risk 2: OnnxEmbedder Memory Pressure in Pipeline Context (Severity: MEDIUM)**

Each pipeline step runs via `execFileSync`, which spawns a new Node.js process. The vectorize step loads the ONNX model (~30 MB) plus WASM runtime into memory, creates parallel workers, and processes batches. If the host machine has limited memory (common in WSL2 environments with default memory limits), the vectorize step could OOM or cause significant swap pressure, especially if it runs immediately after the scorer steps which also hold the full graph.json in memory.

The pipeline runs steps sequentially so process memory is freed between steps, but the ONNX model cache and parallel worker spawning could still push memory usage above comfortable limits on constrained systems.

**Mitigation**: Add a `--max-memory` or `--workers` flag to vectorize.mjs. Default parallel workers to `Math.min(os.cpus().length, 4)` rather than letting OnnxEmbedder auto-detect. Document minimum memory requirements (512 MB free recommended).

**Risk 3: Semantic Drift Between Profile Text and Stored Embedding (Severity: MEDIUM)**

When a contact is enriched (e.g., via `deep-scan.mjs` or `enrich.mjs`), their profile fields change (new headline, updated about section, corrected role). However, the embedding in the RVF store still reflects the pre-enrichment profile text. The plan's incremental mode skips contacts that already have an entry, so enriched contacts would keep their stale embeddings until a full re-vectorize is run.

The refinement doc mentions "when enriched later, re-vectorize updates the embedding" but does not specify how the system detects that a contact has been enriched since its last embedding. There is no `enrichedAt` vs `embeddedAt` comparison in the pseudocode.

**Mitigation**: In `--incremental` mode, compare `contact.enrichedAt` (or `updatedAt`) against `existingEntry.metadata.embeddedAt`. If the contact was updated after embedding, re-embed it. This is a simple timestamp comparison that preserves the efficiency of incremental mode while catching stale embeddings.

---

## 7. Additional Observations

### 7.1 Duplicate Code: buildProfileText and contactText

The existing `scorer.mjs` has a `contactText()` function that concatenates profile fields for text matching. The new `vectorize.mjs` introduces `buildProfileText()` with similar but different logic. These should be reconciled or documented as intentionally different (scoring text vs. embedding text may have different optimal constructions).

### 7.2 Report Generator Integration Deferred Correctly

The decision to keep report-generator.mjs reading from graph.json for MVP is correct. The report pipeline is complex (HTML generation, chart data, 3D graph) and coupling it to RVF in the first iteration would increase scope without proportional benefit.

### 7.3 Task 3.5: Git Commit on Main Branch

The orchestration doc (Task 3.5) states "Commit on main branch with descriptive message." Per the project rules, commits to master/main are prohibited. This task should specify creating a feature branch (e.g., `feat/rvf-engine`).

### 7.4 Missing .gitignore Update in Phase 1

The .gitignore update for `network.rvf` and snapshot `.rvf` files is assigned to the rvf-docs agent in Phase 2 (Task 2.9). This should be moved to Phase 1 to prevent accidental commits of PII-containing RVF files during development.

---

## 8. Summary Scorecard

| Area | Verdict | Key Issue |
|------|---------|-----------|
| Pipeline Integration Point | APPROVE | Vectorize after scorers, before analyzer -- correct |
| Module Boundaries | APPROVE | rvf-store.mjs as shared abstraction -- clean |
| Fallback Architecture | APPROVE | 3-tier degradation -- well-designed |
| optionalDependency | APPROVE | Correct pattern for enhancive feature |
| CJS/ESM Import Pattern | CONCERN | Inconsistent patterns; needs testing and standardization |
| require.resolve in ESM | CONCERN | Will throw ReferenceError; must use createRequire |
| isRvfAvailable Duplication | CONCERN | Defined in two files; must be single source |
| Metadata Schema | CONCERN | 6 fields from spec missing in buildMetadata |
| Scorer RVF Update Pattern | CONCERN | Unknown cost of re-ingest with same vector |
| Analyzer Re-embedding | CONCERN | Unnecessary embedder init for "similar" queries |
| Pipeline Gating for Vectorize | CONCERN | Gating behavior undocumented |
| Pipeline Timeout Budget | CONCERN | 2 min may be tight on first run with model download |
| HNSW Degradation on Re-ingest | CONCERN | Untested; could degrade search recall |
| OnnxEmbedder Memory Pressure | CONCERN | WSL2 memory limits not addressed |
| Semantic Drift After Enrichment | CONCERN | No staleness detection in incremental mode |
| Git Commit Target | CONCERN | Task 3.5 says main; project rules prohibit this |

---

## 9. Overall Verdict

**APPROVE WITH CONDITIONS**

The RVF engine integration is architecturally sound. The core design -- optional vector store behind a shared abstraction layer, additive to the existing JSON pipeline, with clean 3-tier degradation -- is well-reasoned and fits the existing codebase without structural conflicts.

However, implementation should not proceed until the following **blocking conditions** are resolved:

1. **Fix `isRvfAvailable()` for ESM context.** The `require.resolve` call will fail at runtime in `.mjs` files. Use `createRequire(import.meta.url)` and define it in exactly one module.
2. **Standardize the dynamic import pattern.** Test `await import('ruvector')` on the actual package and commit to one pattern (named exports vs. default fallback) across all files.
3. **Add missing metadata fields to `buildMetadata()`.** At minimum: `profileUrl`, `mutualConnections`, `title`. The others (`discoveredVia`, `createdAt`, `updatedAt`) are lower priority but should be included for completeness.

The remaining concerns (performance of re-ingest, timeout budget, memory pressure, semantic drift) are implementation-time risks that can be addressed with testing and tuning during Phase 2/3 without changing the architecture.
