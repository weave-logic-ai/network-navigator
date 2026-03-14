# RVF Engine Integration -- Orchestration Plan

## Overview

This plan coordinates 4 specialist agents working in parallel to implement the RVF engine integration. The work is organized into 3 phases with clear dependency gates.

## Agent Roster

| Agent | Type | Role | Scope |
|-------|------|------|-------|
| **rvf-core** | coder | Core RVF infrastructure | rvf-store.mjs, vectorize.mjs, lib.mjs, package.json |
| **rvf-scorers** | coder | Scorer integration | scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs |
| **rvf-analysis** | coder | Analysis & search modes | analyzer.mjs, pipeline.mjs, delta.mjs, db.mjs |
| **rvf-docs** | coder | Documentation & commands | README.md, commands/*.md, SKILL.md |

## Phase 1: Foundation (Parallel)

All agents start simultaneously. No cross-dependencies in this phase.

### Agent: rvf-core

**Task 1.1: Create package.json**
- Location: `skills/linkedin-prospector/package.json` (new file)
- Content: name, version, type=module, playwright as dependency, ruvector as optionalDependency
- engines: node >= 18

**Task 1.2: Create rvf-store.mjs**
- Location: `scripts/rvf-store.mjs` (new file)
- Implements: openStore, closeStore, queryStore, ingestContacts, deriveSnapshot, getContact, isRvfAvailable
- All ruvector imports are dynamic (`await import('ruvector')`) -- never top-level
- Exports RVF_PATH constant using DATA_DIR from lib.mjs
- Full error handling with clear messages when ruvector not installed

**Task 1.3: Update lib.mjs**
- Add `RVF_STORE_PATH` export (resolve(DATA_DIR, 'network.rvf'))
- Add `isRvfAvailable()` export (dynamic require.resolve check)
- Do NOT add ruvector as a top-level import

**Task 1.4: Create vectorize.mjs**
- Location: `scripts/vectorize.mjs` (new file)
- Implements full vectorization pipeline:
  - `buildProfileText(contact)` -- concatenate profile fields
  - `buildMetadata(contact)` -- extract scores/metadata for RVF storage
  - Loads from graph.json (--from-graph) or contacts.json
  - Initializes OnnxEmbedder with parallel workers
  - Batch embeds in chunks of 50
  - Ingests into RVF store
  - Reports progress and statistics
- CLI flags: --from-graph, --incremental, --batch-size N, --verbose
- Handles missing ruvector gracefully

**Deliverables:**
- `package.json`
- `scripts/rvf-store.mjs`
- `scripts/vectorize.mjs`
- Updated `scripts/lib.mjs`

### Agent: rvf-scorers

**Task 1.5: Study existing scorer output format**
- Read scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs
- Document exactly which fields each scorer writes to graph.json contacts
- Map these fields to the RVF metadata schema from 00-specification.md

**Task 1.6: Plan scorer modifications**
- Design `updateRvfScores()` function shared across all three scorers
- Determine upsert strategy (re-ingest with same ID and existing vector)
- Handle case where RVF store doesn't exist yet (scorer runs before vectorize)

**Deliverables:**
- Field mapping document
- Shared updateRvfScores design (ready for Phase 2 implementation)

### Agent: rvf-analysis

**Task 1.7: Study existing analyzer modes**
- Read analyzer.mjs to understand all 10 existing modes
- Identify which modes would benefit from vector similarity
- Map `--mode similar` and `--mode semantic` arguments

**Task 1.8: Study pipeline and delta**
- Read pipeline.mjs buildSteps() for each mode
- Identify where `vectorize.mjs` fits in each pipeline mode
- Read delta.mjs to understand current snapshot format

**Deliverables:**
- Analysis of analyzer modes + integration points
- Pipeline modification plan
- Delta snapshot migration plan

### Agent: rvf-docs

**Task 1.9: Draft documentation updates**
- Update README.md with RVF/semantic search section
- Update commands/linkedin-prospector.md with vectorize examples
- Update commands/network-intel.md with similar/semantic examples
- Update SKILL.md with new scripts and capabilities
- Draft installation section (npm install with optional ruvector)

**Deliverables:**
- Draft README.md changes
- Draft command file changes
- Draft SKILL.md changes

---

## Phase 2: Integration (Parallel, depends on Phase 1 gate)

### Gate: Phase 1 Complete
- rvf-store.mjs exists and exports all functions
- vectorize.mjs exists and can be run standalone
- lib.mjs exports isRvfAvailable() and RVF_STORE_PATH
- package.json exists

### Agent: rvf-core

**Task 2.1: Test vectorize.mjs**
- Verify embedding generation works with ruvector installed
- Verify graceful fallback when ruvector not installed
- Verify --incremental mode
- Verify --from-graph reads graph.json correctly

### Agent: rvf-scorers

**Task 2.2: Modify scorer.mjs**
- Add `import { isRvfAvailable } from './lib.mjs'`
- After scoring loop, call updateRvfScores() if RVF available
- updateRvfScores():
  - Dynamic import of rvf-store.mjs
  - Open store, get existing entries by ID
  - Re-ingest with same vector, updated metadata
  - Close store
- All wrapped in try/catch with JSON fallback

**Task 2.3: Modify behavioral-scorer.mjs**
- Same pattern as scorer.mjs
- Update behavioralScore and behavioralPersona in RVF metadata

**Task 2.4: Modify referral-scorer.mjs**
- Same pattern as scorer.mjs
- Update referralLikelihood, referralTier, referralPersona in RVF metadata

### Agent: rvf-analysis

**Task 2.5: Add analyzer modes**
- Add `similar` mode to analyzer.mjs:
  - Accept --url <profile-url>
  - Embed target contact's profile text
  - k-NN query against RVF store
  - Display ranked results with similarity scores
- Add `semantic` mode to analyzer.mjs:
  - Accept --query "free text"
  - Embed query text
  - k-NN query against RVF store
  - Display ranked results with relevance scores
- Both modes fall back to "ruvector not installed" message

**Task 2.6: Modify pipeline.mjs**
- Add `--vectorize` mode (runs vectorize.mjs standalone)
- Add vectorize.mjs to `rebuild` pipeline (after referral-scorer, before analyzer)
- Add vectorize.mjs to `full` pipeline (after referral-scorer, before analyzer)
- Add dependency guard: if vectorize fails, continue (it's not blocking)

**Task 2.7: Modify delta.mjs**
- Add COW branching when RVF store exists:
  - `--snapshot` calls deriveSnapshot() from rvf-store.mjs
  - Snapshot path: `DATA_DIR/snapshots/network-{timestamp}.rvf`
  - Falls back to JSON snapshot if RVF not available
- `--check` compares current store with latest RVF snapshot

**Task 2.8: Modify db.mjs search**
- When RVF available and search term provided:
  - Embed search term
  - k-NN search in RVF store
  - Display results with similarity scores
- Falls back to current substring search

### Agent: rvf-docs

**Task 2.9: Finalize documentation**
- Incorporate actual API patterns from implemented code
- Add troubleshooting section for RVF-specific issues
- Update .gitignore with network.rvf pattern
- Review all changes for accuracy

---

## Phase 3: Validation (Sequential)

### Gate: Phase 2 Complete
- All modified scripts work with and without ruvector
- Analyzer similar and semantic modes return results
- Pipeline --rebuild includes vectorize step
- Documentation is updated

### All Agents: Review

**Task 3.1: Full pipeline test**
- Run `node scripts/pipeline.mjs --rebuild` with ruvector installed
- Verify all steps complete including vectorize
- Verify network.rvf is created with correct entry count

**Task 3.2: Semantic search test**
- Run `node scripts/analyzer.mjs --mode similar --url <gold-contact>`
- Verify results are semantically relevant (not random)
- Run `node scripts/analyzer.mjs --mode semantic --query "AI transformation"`
- Verify results contain contacts with AI/transformation in profiles

**Task 3.3: Fallback test**
- Temporarily uninstall ruvector
- Run full pipeline -- verify JSON-only mode works
- Verify no crashes, clear warning messages
- Reinstall ruvector

**Task 3.4: Backward compatibility test**
- Start with existing contacts.json + graph.json (no network.rvf)
- Run `node scripts/vectorize.mjs --from-graph`
- Verify migration produces valid RVF store
- Run analyzer modes against migrated data

**Task 3.5: Git commit**
- Stage all new and modified files
- Exclude network.rvf, contacts.json, graph.json (in .gitignore)
- Commit on main branch with descriptive message

---

## Dependency Matrix

```
                Phase 1                    Phase 2
Task:     1.1  1.2  1.3  1.4  1.5-8  1.9   2.1  2.2-4  2.5-8  2.9   3.x
──────────────────────────────────────────────────────────────────────────
rvf-core  [x]  [x]  [x]  [x]               [x]
rvf-scor                        [x]                [x]
rvf-anal                              [x]                 [x]
rvf-docs                                    [x]                  [x]
──────────────────────────────────────────────────────────────────────────
Gate:                           ▲ Phase 1 gate      ▲ Phase 2 gate
```

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| ruvector ONNX model download fails in CI | Hash embedding fallback is automatic |
| Native bindings unavailable on platform | WASM fallback is automatic |
| RVF store corruption | Rebuild from graph.json (`--from-graph`) |
| Performance regression on large datasets | Batch size tuning, --incremental mode |
| Breaking change in ruvector API | Pin to `^0.2.12`, wrap all calls in rvf-store.mjs |
| CJS/ESM compatibility issues | All ruvector imports via dynamic `await import()` |

## Estimated Effort

| Phase | Duration | Agents Active |
|-------|----------|---------------|
| Phase 1 | ~30 min | 4 parallel |
| Phase 2 | ~45 min | 4 parallel |
| Phase 3 | ~15 min | 1 sequential |
| **Total** | **~90 min** | |

## File Change Summary

| File | Action | Agent |
|------|--------|-------|
| `package.json` | CREATE | rvf-core |
| `scripts/rvf-store.mjs` | CREATE | rvf-core |
| `scripts/vectorize.mjs` | CREATE | rvf-core |
| `scripts/lib.mjs` | MODIFY | rvf-core |
| `scripts/scorer.mjs` | MODIFY | rvf-scorers |
| `scripts/behavioral-scorer.mjs` | MODIFY | rvf-scorers |
| `scripts/referral-scorer.mjs` | MODIFY | rvf-scorers |
| `scripts/analyzer.mjs` | MODIFY | rvf-analysis |
| `scripts/pipeline.mjs` | MODIFY | rvf-analysis |
| `scripts/delta.mjs` | MODIFY | rvf-analysis |
| `scripts/db.mjs` | MODIFY | rvf-analysis |
| `README.md` | MODIFY | rvf-docs |
| `commands/linkedin-prospector.md` | MODIFY | rvf-docs |
| `commands/network-intel.md` | MODIFY | rvf-docs |
| `skills/.../SKILL.md` | MODIFY | rvf-docs |
| `.gitignore` | MODIFY | rvf-docs |
