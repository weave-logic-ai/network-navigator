# RVF Engine Integration -- Orchestration Plan v2 (Revised)

Changes from v1: Merged docs agent into coding agents, eliminated Phase 1 study tasks,
rebalanced Phase 2 workload, added parallel validation tracks, fixed commit target.
See `05-consensus.md` for decision rationale.

---

## Agent Roster (3 Agents)

| Agent | Type | Role | Scope |
|-------|------|------|-------|
| **rvf-core** | coder | Core infrastructure + pipeline | rvf-store.mjs, vectorize.mjs, lib.mjs, package.json, pipeline.mjs, .gitignore |
| **rvf-scorers** | coder | Scoring + db integration | scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs, db.mjs |
| **rvf-analysis** | coder | Search modes + docs | analyzer.mjs, command docs |

---

## Phase 1: Foundation (25 min, rvf-core only)

Only rvf-core has Phase 1 work. The other agents are idle until the Phase 1 gate passes.

### Agent: rvf-core

**Task 1.1: Create package.json**
- Location: `skills/linkedin-prospector/package.json` (new file)
- Content per pseudocode-v2 Section 8
- `type: "module"`, playwright as dependency, ruvector `^0.2.12` as optionalDependency

**Task 1.2: Create rvf-store.mjs**
- Location: `scripts/rvf-store.mjs` (new file)
- Full implementation per pseudocode-v2 Section 1
- Key exports: isRvfAvailable, openStore, closeStore, queryStore, ingestContacts, getContact, deleteContact, storeLength, upsertMetadata, buildProfileText, buildMetadata, chunkArray
- Uses VectorDBWrapper API exclusively (Decision D-1)
- CJS/ESM interop via createRequire + cached dynamic import (D-2, D-5)
- Error handling for lock contention and corrupt store

**Task 1.3: Update lib.mjs**
- Add `RVF_STORE_PATH` export only
- Do NOT add `isRvfAvailable()` here (lives in rvf-store.mjs per D-3)
- Do NOT add ruvector as a top-level import

**Task 1.4: Create vectorize.mjs**
- Location: `scripts/vectorize.mjs` (new file)
- Full implementation per pseudocode-v2 Section 2
- Uses imports from rvf-store.mjs (buildProfileText, buildMetadata, chunkArray, etc.)
- OnnxEmbedder: getStats() and shutdown() as module-level functions (D-6)
- embed/embedBatch returns number[] (no Float32Array wrapping, D-7)
- Batch fallback: if batch fails, retry individually per entry
- CLI flags: `--from-graph`, `--batch-size N`, `--verbose`
- No `--incremental` flag (deferred, D-9)

**Task 1.5: Update .gitignore**
- Add RVF store patterns, ONNX cache, node_modules per pseudocode-v2 Section 9
- Must happen in Phase 1 to prevent accidental PII commits during development

**Deliverables:**
- `package.json`
- `scripts/rvf-store.mjs` (all shared exports functional)
- `scripts/vectorize.mjs` (runs standalone)
- Updated `scripts/lib.mjs`
- Updated `.gitignore`

---

## Phase 1 Gate

All conditions must pass before Phase 2 begins:

- [ ] `rvf-store.mjs` exports: isRvfAvailable, openStore, closeStore, queryStore, ingestContacts, getContact, upsertMetadata, buildProfileText, buildMetadata, chunkArray
- [ ] `vectorize.mjs` runs standalone with `--from-graph` flag
- [ ] `lib.mjs` exports `RVF_STORE_PATH`
- [ ] `package.json` declares ruvector as optionalDependency
- [ ] `.gitignore` covers `*.rvf` files and `node_modules/`

---

## Phase 2: Integration (40 min, 3 agents parallel)

All three agents work in parallel. No cross-agent file conflicts.

### Agent: rvf-core

**Task 2.1: Test vectorize.mjs end-to-end**
- Verify embedding generation works with ruvector installed
- Verify batch fallback works (simulate batch failure)
- Verify graceful error when ruvector not installed
- Verify `--from-graph` reads graph.json correctly
- Verify `--batch-size` flag works

**Task 2.2: Modify pipeline.mjs**
- Add `vectorize` to `rebuild` and `full` pipeline modes (pseudocode-v2 Section 5)
- Add `--vectorize` standalone mode
- Add `vectorizeOk` tracking variable
- Failure cascade: if any scorer fails, skip vectorize; if vectorize fails, continue to analyzer/delta
- Add inline JSDoc for the new step

### Agent: rvf-scorers

**Task 2.3: Modify all three scorers**
Single task, three files following identical pattern (pseudocode-v2 Section 4):
- **scorer.mjs**: Add `updateRvfScores()` writing icpFit, networkHub, relationshipStrength, signalBoost, goldScore, tier, persona
- **behavioral-scorer.mjs**: Add `updateRvfScores()` writing behavioralScore, behavioralPersona
- **referral-scorer.mjs**: Add `updateRvfScores()` writing referralLikelihood, referralTier, referralPersona
- All use `upsertMetadata()` from rvf-store.mjs (not raw re-ingest)
- All wrapped in try/catch -- failure does not stop the scorer
- Call at end of each scorer's main() after graph.json write

**Task 2.4: Modify db.mjs search**
- Add semantic search via `findSemantic()` (pseudocode-v2 Section 6)
- When RVF available and search term provided: embed term, k-NN search, display results
- Falls back to current substring search if RVF unavailable or query fails
- No `--semantic` flag needed -- vector search is tried first, substring is fallback

### Agent: rvf-analysis

**Task 2.5a: Add `similar` mode to analyzer.mjs**
- Implementation per pseudocode-v2 Section 3a
- Uses stored vector from db.get() -- no embedder initialization (D-8)
- Falls back to re-embedding only if contact not in store
- Arguments: `--mode similar --url <profile-url> --top N`
- Display: ranked list with similarity scores and tier badges

**Task 2.5b: Add `semantic` mode to analyzer.mjs**
- Implementation per pseudocode-v2 Section 3b
- Uses OnnxEmbedder to embed free-text query
- Arguments: `--mode semantic --query "text" --top N`
- Display: ranked list with relevance scores

**Task 2.6: Update command documentation**
- Update `commands/network-intel.md` with `similar` and `semantic` examples
- Update `commands/linkedin-prospector.md` with `vectorize` examples
- Add brief RVF section to README.md (installation, usage)
- Inline JSDoc in analyzer.mjs for new modes

---

## Phase 2 Gate

All conditions must pass before Phase 3 begins:

- [ ] `pipeline.mjs --rebuild` includes vectorize step
- [ ] `pipeline.mjs --vectorize` runs standalone
- [ ] All 3 scorers update RVF metadata without crashing
- [ ] All 3 scorers still work without ruvector installed
- [ ] `analyzer.mjs --mode similar` returns ranked results
- [ ] `analyzer.mjs --mode semantic` returns ranked results
- [ ] `db.mjs search` tries vector search, falls back to substring
- [ ] Command docs updated

---

## Phase 3: Validation (25 min, 2 parallel tracks then sequential)

### Track A: Positive Path (rvf-core + rvf-analysis)

**Task 3.1: Full pipeline test**
- Run `node scripts/pipeline.mjs --rebuild` with ruvector installed
- Verify all steps complete including vectorize
- Verify `network.rvf` is created
- Verify entry count matches contact count in graph.json

**Task 3.2a: Semantic search test**
- Run `node scripts/analyzer.mjs --mode similar --url <known-gold-contact>`
- Verify results are semantically relevant (similar industry/role)
- Run `node scripts/analyzer.mjs --mode semantic --query "AI transformation"`
- Verify results contain contacts with AI/transformation in profiles

**Task 3.2b: Scorer RVF upsert verification**
- After `--rebuild`, query RVF store for a known contact
- Verify metadata fields (goldScore, tier, behavioralScore, referralTier) match graph.json values
- Verify all three scorer layers are reflected in the metadata

### Track B: Negative/Migration Path (rvf-scorers)

**Task 3.3: Fallback test**
- Move/rename `node_modules/ruvector` temporarily (or uninstall)
- Run full pipeline -- verify JSON-only mode works
- Verify no crashes, only warning messages about ruvector
- Verify all analysis modes except similar/semantic work
- Restore ruvector

**Task 3.4: Backward compatibility test**
- Start with existing `contacts.json` + `graph.json` (delete `network.rvf` if present)
- Run `node scripts/vectorize.mjs --from-graph`
- Verify RVF store is created from existing data
- Run analyzer modes against the migrated data
- Verify scores in RVF metadata match graph.json

### Sequential: Finalization

**Task 3.5: Final review and commit**
- Review all changed files for consistency
- Verify no ruvector imports outside rvf-store.mjs and vectorize.mjs
- Verify no `require.resolve` outside rvf-store.mjs
- Create feature branch: `git checkout -b feat/rvf-engine`
- Stage all new and modified files (exclude runtime data, node_modules)
- Commit with descriptive message

---

## Dependency Matrix

```
              Phase 1              Phase 2                    Phase 3
Task:    1.1 1.2 1.3 1.4 1.5   2.1 2.2  2.3 2.4  2.5a 2.5b 2.6   3.A   3.B   3.5
──────────────────────────────────────────────────────────────────────────────────────
rvf-core [x] [x] [x] [x] [x]  [x] [x]                             [x]
rvf-scor                                     [x] [x]                      [x]
rvf-anal                                               [x]  [x]  [x] [x]
──────────────────────────────────────────────────────────────────────────────────────
Gate:                        ▲                              ▲              ▲
                       Phase 1                        Phase 2         Phase 3
```

---

## File Change Summary

| File | Action | Agent | Phase |
|------|--------|-------|-------|
| `package.json` | CREATE | rvf-core | 1 |
| `scripts/rvf-store.mjs` | CREATE | rvf-core | 1 |
| `scripts/vectorize.mjs` | CREATE | rvf-core | 1 |
| `scripts/lib.mjs` | MODIFY | rvf-core | 1 |
| `.gitignore` | MODIFY | rvf-core | 1 |
| `scripts/pipeline.mjs` | MODIFY | rvf-core | 2 |
| `scripts/scorer.mjs` | MODIFY | rvf-scorers | 2 |
| `scripts/behavioral-scorer.mjs` | MODIFY | rvf-scorers | 2 |
| `scripts/referral-scorer.mjs` | MODIFY | rvf-scorers | 2 |
| `scripts/db.mjs` | MODIFY | rvf-scorers | 2 |
| `scripts/analyzer.mjs` | MODIFY | rvf-analysis | 2 |
| `commands/network-intel.md` | MODIFY | rvf-analysis | 2 |
| `commands/linkedin-prospector.md` | MODIFY | rvf-analysis | 2 |
| `README.md` | MODIFY | rvf-analysis | 2 |

### Files Explicitly NOT Modified (Deferred)

| File | Reason |
|------|--------|
| `scripts/graph-builder.mjs` | Vectorize runs after scorers, no need for graph-builder to write RVF |
| `scripts/report-generator.mjs` | Continues reading graph.json (deferred per refinement Section 8) |
| `scripts/delta.mjs` | COW snapshots deferred; continues using JSON snapshots |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| VectorDBWrapper storagePath doesn't persist | Test empirically in Task 2.1; fall back to rvf-wrapper if needed |
| ruvector CJS import pattern fails | Standardized in rvf-store.mjs with .default fallback (D-5) |
| ONNX model download fails in CI | Hash embedding fallback is automatic in OnnxEmbedder |
| HNSW degradation on repeated upserts | Monitor recall; periodic full re-vectorize mitigates |
| OnnxEmbedder memory pressure on WSL2 | Cap parallel workers at min(cpus, 4) |
| Pipeline timeout on first run | Model download has progress warning; timeout is per-step |
| Corrupt .rvf file | Clear error message with rebuild instructions |

---

## Estimated Effort

| Phase | Duration | Agents Active | Notes |
|-------|----------|---------------|-------|
| Phase 1 | 25 min | 1 (rvf-core) | Foundation only |
| Phase 2 | 40 min | 3 parallel | Rebalanced workload |
| Phase 3 | 25 min | 2 parallel tracks + sequential | Realistic validation |
| **Total** | **~90 min** | | Same total, better utilization |
