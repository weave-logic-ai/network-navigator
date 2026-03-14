# RVF Engine Orchestration -- Review

**Reviewer**: Strategic Planning Agent
**Date**: 2026-03-10
**Documents reviewed**: 00-specification.md, 01-pseudocode.md, 02-architecture.md, 03-orchestration.md, 04-refinement.md
**Existing code examined**: lib.mjs, pipeline.mjs, scorer.mjs, analyzer.mjs, delta.mjs

---

## 1. Agent Decomposition

### KEEP: 4-agent split

The four agents (rvf-core, rvf-scorers, rvf-analysis, rvf-docs) are well scoped. Each agent owns a distinct file set with no overlapping writes. The boundaries follow domain logic: infrastructure, scoring integration, search/analysis integration, and documentation.

### CHANGE: Merge rvf-docs into the other three agents

The rvf-docs agent is underloaded. In Phase 1 it drafts documentation from the specification (no code context needed), and in Phase 2 it finalizes docs by reading code that other agents wrote. This creates two problems:

1. **Wasted Phase 1 slot** -- Drafting docs before code exists produces speculative text that will need heavy revision in Phase 2. The docs agent is essentially blocked on the other three agents for accurate content.
2. **Artificial Phase 2 dependency** -- Task 2.9 (finalize documentation) cannot start until all code is committed, making docs the last task in the critical path despite being the lowest-risk deliverable.

**Recommendation**: Each of the three coding agents adds inline JSDoc and a brief section to the relevant command doc as part of their Phase 2 tasks. A single docs-finalization pass runs as the first step of Phase 3 (by any agent or the coordinator) to unify voice and fill in the README. This eliminates one agent, reducing coordination overhead and freeing a concurrency slot.

If the docs agent is retained for organizational reasons, move all its Phase 1 work to Phase 2 (it can start Phase 2 in parallel with others since it only reads, never writes, code files during that phase).

### CHANGE: Rename rvf-scorers scope to include the shared `updateRvfScores` utility

The orchestration assigns `updateRvfScores()` design to rvf-scorers (Task 1.6), but the pseudocode (Section 4) shows this function living in or importing from `rvf-store.mjs`, which is owned by rvf-core. Clarify: rvf-scorers should implement `updateRvfScores()` as a local helper within each scorer file (not a shared module), or rvf-core should export a generic `upsertMetadata()` from rvf-store.mjs that the scorers call. The current plan is ambiguous about where this function lives.

**Recommendation**: rvf-core adds a `upsertMetadata(id, metadataPartial)` export to rvf-store.mjs in Task 1.2. rvf-scorers consumes it in Phase 2. This is cleaner than having each scorer re-implement the open/get/re-ingest/close pattern.

---

## 2. Phase Dependencies

### KEEP: Phase 1 parallelism for rvf-core

Tasks 1.1-1.4 are correctly independent of all other agents. No issues.

### KEEP: Phase 2 gate on rvf-store.mjs and lib.mjs exports

The gate condition (rvf-store.mjs exports exist, lib.mjs exports `isRvfAvailable`) is correct. All Phase 2 agents depend on these.

### CHANGE: rvf-scorers Phase 1 work can be eliminated

Tasks 1.5 and 1.6 are "study existing code and design the integration." This is planning work, not implementation. The scorer files are under 200 lines each; any competent agent can read and modify them in Phase 2 without a dedicated Phase 1 study step. Forcing rvf-scorers to produce a "field mapping document" and "shared design" as Phase 1 deliverables creates busy-work and a review bottleneck. The field mapping is already documented in the specification (Section 6, "RVF Entry Per Contact").

**Recommendation**: rvf-scorers has no Phase 1 tasks. It starts at Phase 2, reading the existing scorers and rvf-store.mjs exports, then implementing the modifications directly. This means the Phase 1 gate only needs to verify rvf-core's deliverables.

### CHANGE: rvf-analysis Phase 1 can be reduced similarly

Tasks 1.7 and 1.8 are "study existing code." The analyzer is ~400 lines, pipeline is ~340 lines, delta is ~200 lines. These are readable in seconds by an agent. The "analysis of analyzer modes + integration points" deliverable is documentation of things already documented in the specification. Eliminate these study tasks; rvf-analysis starts directly in Phase 2.

**Recommendation**: rvf-analysis has no Phase 1 tasks. Its Phase 2 work begins as soon as rvf-core's Phase 1 gate passes.

### ADD: Hidden dependency -- `buildProfileText()` and `buildMetadata()` are shared

The pseudocode shows `buildProfileText()` defined in vectorize.mjs (rvf-core) but also called in the analyzer `similar` mode (rvf-analysis). If rvf-analysis implements `analyzeSimilar()` by importing `buildProfileText` from vectorize.mjs, that is a cross-agent dependency not captured in the orchestration. Similarly, `buildMetadata()` is needed by both vectorize.mjs and the scorer update logic.

**Recommendation**: rvf-core exports `buildProfileText()` and `buildMetadata()` from rvf-store.mjs (or a new shared helpers file) rather than vectorize.mjs. This makes the dependency explicit and avoids rvf-analysis importing from rvf-core's "main script."

### ADD: Hidden dependency -- pipeline.mjs error handling for vectorize

The existing pipeline.mjs has explicit failure cascade logic (if graph-builder fails, skip scorer; if scorer fails, skip behavioral-scorer). Task 2.6 adds vectorize.mjs to the pipeline but does not specify how its failure should be handled in this cascade. The orchestration says "if vectorize fails, continue (it's not blocking)" but does not specify what the actual code change to pipeline.mjs looks like.

**Recommendation**: Task 2.6 should explicitly state: add a `vectorizeOk` flag, and if vectorize.mjs fails, log a warning but continue to the analyzer step. This matches the existing pattern in pipeline.mjs lines 282-318.

---

## 3. Task Granularity

### KEEP: Task 1.2 (rvf-store.mjs) and Task 1.4 (vectorize.mjs) as separate tasks

These are the two largest new files. Separating them makes the work trackable.

### CHANGE: Split Task 2.5 into two tasks

Task 2.5 adds both `similar` and `semantic` modes to analyzer.mjs. These are independent features (different entry points, different argument parsing, different display logic) that happen to live in the same file. Splitting them allows the agent to deliver and test one before the other, reducing the blast radius if one mode has issues.

- Task 2.5a: Add `similar` mode (k-NN from contact embedding)
- Task 2.5b: Add `semantic` mode (free-text query embedding)

### CHANGE: Merge Tasks 2.2, 2.3, and 2.4

The three scorer modifications (scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs) follow an identical pattern. The orchestration even says "same pattern as scorer.mjs" for 2.3 and 2.4. Making these three separate tasks implies they could be parallelized, but they are all assigned to the same agent (rvf-scorers), so they will execute sequentially anyway. One task with three subtasks is more accurate.

### ADD: Missing task -- `getContact()` implementation in rvf-store.mjs

The pseudocode's `updateRvfScores()` (Section 4) calls `store.get(url)` to retrieve the existing vector before re-ingesting with updated metadata. But `getContact()` is listed as an export of rvf-store.mjs (Task 1.2) without any detail on its implementation. The ruvector API may or may not support get-by-id natively. This needs to be verified and documented as part of Task 1.2, or the upsert strategy needs to change (re-embed instead of preserving the existing vector).

---

## 4. Critical Path

### Current Critical Path

```
Phase 1: rvf-core (Tasks 1.1-1.4, ~30 min)
    |
    v [Phase 1 gate]
    |
Phase 2: rvf-analysis (Tasks 2.5-2.8, ~45 min)  <-- bottleneck
    |
    v [Phase 2 gate]
    |
Phase 3: Validation (Tasks 3.1-3.5, ~15 min)
```

**rvf-analysis is the bottleneck.** It has 4 tasks in Phase 2 touching 4 different files (analyzer.mjs, pipeline.mjs, delta.mjs, db.mjs). By contrast, rvf-scorers has 3 tasks on 3 files with near-identical changes, and rvf-core has only 1 task (testing). rvf-analysis will take the longest in Phase 2.

### CHANGE: Rebalance Phase 2 work

Move Task 2.6 (pipeline.mjs modification) to rvf-core. The pipeline change is minimal (add a case, insert a step into two arrays) and rvf-core is underutilized in Phase 2 with only testing work. rvf-core already understands vectorize.mjs intimately since it created it.

Move Task 2.8 (db.mjs search) to rvf-scorers. The db.mjs search modification follows a similar pattern to the scorer work: check isRvfAvailable(), dynamically import rvf-store, query, fall back. rvf-scorers finishes its three scorer modifications quickly and has capacity.

Revised Phase 2 assignment:

| Agent | Tasks | Files |
|-------|-------|-------|
| rvf-core | 2.1 (test vectorize), 2.6 (pipeline.mjs) | vectorize.mjs, pipeline.mjs |
| rvf-scorers | 2.2-2.4 (scorers), 2.8 (db.mjs search) | scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs, db.mjs |
| rvf-analysis | 2.5a (similar mode), 2.5b (semantic mode), 2.7 (delta.mjs) | analyzer.mjs, delta.mjs |

This brings all three agents to roughly equal Phase 2 workloads.

---

## 5. File Conflicts

### KEEP: No direct file conflicts in the current plan

Each file is assigned to exactly one agent. No merge conflicts will occur under the current assignment.

### ADD: Potential conflict on `lib.mjs`

Task 1.3 (rvf-core) modifies lib.mjs to add exports. If any other agent also needs to modify lib.mjs (e.g., adding a shared constant), there is a conflict. Currently no other agent touches lib.mjs, but the review should flag that `isRvfAvailable()` is defined in lib.mjs (Task 1.3) and also shown as an export of rvf-store.mjs in the pseudocode (Section 1). The same function exists in two places.

**Recommendation**: Define `isRvfAvailable()` only in rvf-store.mjs. lib.mjs should re-export it or not define it at all. Having the function in two places creates a maintenance burden and risks divergence. Since rvf-store.mjs is the module that actually uses ruvector, it is the natural home.

### ADD: Potential conflict on `.gitignore`

Task 2.9 assigns .gitignore modification to rvf-docs. But if rvf-core creates `package.json` and runs `npm install`, a `node_modules/` entry or `package-lock.json` may also need gitignore updates. Both agents might touch .gitignore.

**Recommendation**: Assign all .gitignore updates to rvf-core since it creates the package.json that triggers the need.

---

## 6. Testing Strategy

### KEEP: Tasks 3.1 through 3.4 cover the major scenarios

Full pipeline, semantic search, fallback mode, and backward compatibility are the right categories.

### CHANGE: Phase 3 should not be "1 sequential" agent

The orchestration assigns Phase 3 to "All Agents: Review" but estimates "1 sequential" agent for 15 minutes. Five validation tasks in 15 minutes is aggressive. Task 3.3 alone (uninstall ruvector, run full pipeline, verify, reinstall) requires at least two full pipeline runs.

**Recommendation**: Phase 3 should be 20-30 minutes with two parallel tracks:
- Track A: Tasks 3.1 + 3.2 (positive path -- pipeline and semantic search)
- Track B: Tasks 3.3 + 3.4 (negative/migration path -- fallback and backward compat)
- Task 3.5 (git commit) runs after both tracks pass.

### ADD: Missing test -- scorer RVF upsert verification

No Phase 3 task verifies that running scorer.mjs, behavioral-scorer.mjs, or referral-scorer.mjs actually updates RVF metadata. The tests verify the pipeline end-to-end and semantic search results, but there is no specific assertion that a contact's `goldScore` in the RVF store matches what scorer.mjs computed.

**Recommendation**: Add Task 3.2b: After running `--rescore`, query the RVF store for a known contact and verify that metadata fields (goldScore, tier, behavioralScore, referralTier) match the values in graph.json.

### ADD: Missing test -- incremental vectorize

Task 3.4 tests migration from existing data, but no task tests the `--incremental` flag specifically. The refinement document (Section 6) even acknowledges that incremental mode is underspecified and suggests defaulting to full re-vectorize. If `--incremental` is being implemented (Task 1.4 includes it as a CLI flag), it needs a test.

**Recommendation**: Either add a test for `--incremental` or explicitly defer it from scope and remove the `--incremental` flag from Task 1.4.

### ADD: Missing test -- concurrent store access

The refinement document (Section 5) discusses concurrent access to network.rvf and states that pipeline runs scripts sequentially via `execFileSync`, so it is safe. But if a user runs `analyzer.mjs --mode similar` while a scorer is running in another terminal, both would call `openStore()`. This scenario is not tested.

**Recommendation**: This is a low-priority test but should be documented as a known limitation. Add a note in Task 2.9 (docs) about not running multiple RVF-writing operations concurrently.

### CHANGE: Task 3.5 should NOT commit to main

The orchestration says "Commit on main branch with descriptive message." The project CLAUDE.md has a hard rule: "Do not EVER commit to master, unless this rule is removed." While this says "master" not "main," the intent is clear -- work should go to a feature branch.

**Recommendation**: Task 3.5 should create a feature branch (e.g., `feat/rvf-engine`) and commit there. The commit to the default branch happens via PR review.

---

## 7. Gaps Between Specification and Orchestration

### ADD: Missing file -- `graph-builder.mjs` modification

The specification (Section 7, File Layout) lists `graph-builder.mjs` as MODIFIED: "optionally write to RVF alongside graph.json." The orchestration does not assign this modification to any agent. The architecture (Section 2) confirms this expectation.

The refinement (Section 7) resolves this by placing vectorize after all scorers in the pipeline, which means graph-builder does not need to write to RVF directly. But this design decision is not captured in the orchestration. Either:
- Explicitly add graph-builder.mjs modification as a task (assigned to rvf-analysis or rvf-core), or
- Explicitly state that graph-builder.mjs is OUT OF SCOPE for this phase, with a rationale pointing to the refinement Section 7 decision.

**Recommendation**: Add a note to the orchestration stating graph-builder.mjs is intentionally unmodified per the refinement decision. Vectorize runs after all scorers, making graph-builder RVF writes unnecessary.

### ADD: Missing file -- `report-generator.mjs` modification

The specification (FR-6) and architecture (Section 2) list report-generator.mjs as MODIFIED. The refinement (Section 8) explicitly defers this: "Report generator continues reading graph.json." The orchestration does not mention this deferral.

**Recommendation**: Add report-generator.mjs to the orchestration's file table as "DEFERRED" with a note referencing refinement Section 8.

### ADD: Missing file -- `db.mjs export --format rvf`

The refinement (Section 9) describes an enhancement to `db.mjs export` to support `--format rvf`. The orchestration's Task 2.8 only covers search. The export enhancement is not assigned.

**Recommendation**: Either add export format support to Task 2.8, or explicitly defer it as a follow-up.

---

## 8. Risk Additions

### ADD: Risk -- `isRvfAvailable()` uses `require.resolve` in ESM context

The pseudocode (Section 7) and lib.mjs show `isRvfAvailable()` using `require.resolve('ruvector')`. But the project uses ESM (`type: "module"` in package.json, `.mjs` extensions). In ESM, `require` is not available without explicitly creating it via `createRequire`. The current lib.mjs has no `require` reference.

This will throw a ReferenceError at runtime.

**Recommendation**: Change `isRvfAvailable()` to use a dynamic import attempt:

```javascript
export async function isRvfAvailable() {
  try {
    await import('ruvector');
    return true;
  } catch {
    return false;
  }
}
```

Note: this makes it async, which changes the call sites. Every `if (isRvfAvailable())` becomes `if (await isRvfAvailable())`. This ripples through all consumers. Flag this as a design decision for rvf-core to resolve in Task 1.3.

### ADD: Risk -- `parseArgs` name collision

lib.mjs exports a `parseArgs()` function. Node.js 18.3+ also has `util.parseArgs()`. vectorize.mjs imports `parseArgs` from lib.mjs but also uses `process.argv` directly. No collision today, but worth noting if someone refactors to use the built-in.

---

## 9. Estimated Effort Revision

The original estimate is 90 minutes total. With the recommended changes:

| Phase | Duration | Agents Active | Notes |
|-------|----------|---------------|-------|
| Phase 1 | 25 min | 1 (rvf-core only) | Scorers and analysis agents eliminated from Phase 1 |
| Phase 2 | 40 min | 3 parallel (rebalanced) | Docs folded into each agent |
| Phase 3 | 25 min | 2 parallel tracks + commit | Realistic validation time |
| **Total** | **~90 min** | | Same total, better utilization |

The total remains ~90 minutes, but agent utilization is more even and Phase 1 finishes faster (only one agent needs to complete the gate).

---

## 10. Revised Agent Assignment

If all recommendations are adopted:

### Agent Roster (3 agents)

| Agent | Role | Phase 1 Files | Phase 2 Files |
|-------|------|---------------|---------------|
| **rvf-core** | Infrastructure + pipeline | rvf-store.mjs, vectorize.mjs, lib.mjs, package.json | pipeline.mjs, .gitignore, README section |
| **rvf-scorers** | Scoring + db integration | (none) | scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs, db.mjs |
| **rvf-analysis** | Search modes + snapshots | (none) | analyzer.mjs, delta.mjs, command docs |

### Revised Phase Structure

```
Phase 1 (25 min):
  rvf-core: Tasks 1.1-1.4 (package.json, rvf-store.mjs, lib.mjs, vectorize.mjs)

Phase 1 Gate:
  - rvf-store.mjs exports all functions including upsertMetadata()
  - vectorize.mjs runs standalone
  - lib.mjs exports RVF_STORE_PATH
  - buildProfileText() and buildMetadata() exported from rvf-store.mjs

Phase 2 (40 min, 3 agents parallel):
  rvf-core:     Test vectorize.mjs, modify pipeline.mjs, update .gitignore
  rvf-scorers:  Modify all 3 scorers + db.mjs search
  rvf-analysis: Add similar mode, add semantic mode, modify delta.mjs

Phase 2 Gate:
  - All scripts work with and without ruvector
  - Analyzer similar/semantic modes return results
  - Pipeline --rebuild includes vectorize step
  - Scorers update RVF metadata

Phase 3 (25 min, 2 parallel tracks then sequential):
  Track A: Full pipeline test + semantic search test
  Track B: Fallback test + backward compatibility test + scorer RVF upsert test
  Sequential: Docs finalization, then commit to feature branch
```

### Revised Dependency Matrix

```
              Phase 1          Phase 2                    Phase 3
Task:    1.1 1.2 1.3 1.4   2.1 2.5 2.6   2.2 2.7 2.8   3.A  3.B  3.docs  3.commit
────────────────────────────────────────────────────────────────────────────────────
rvf-core [x] [x] [x] [x]  [x]     [x]
rvf-scor                               [x]     [x]
rvf-anal                       [x]         [x]
all                                                    [x] [x]  [x]     [x]
────────────────────────────────────────────────────────────────────────────────────
Gate:                    ▲                         ▲                    ▲
```

---

## Summary of Recommendations

| # | Label | Recommendation |
|---|-------|---------------|
| 1 | CHANGE | Merge rvf-docs agent into the three coding agents |
| 2 | CHANGE | Move `isRvfAvailable()` to rvf-store.mjs only, not lib.mjs |
| 3 | CHANGE | Add `upsertMetadata()` export to rvf-store.mjs for scorer consumption |
| 4 | CHANGE | Export `buildProfileText()` and `buildMetadata()` from rvf-store.mjs, not vectorize.mjs |
| 5 | CHANGE | Eliminate Phase 1 study tasks for rvf-scorers and rvf-analysis |
| 6 | CHANGE | Rebalance Phase 2: pipeline.mjs to rvf-core, db.mjs to rvf-scorers |
| 7 | CHANGE | Split Task 2.5 into similar and semantic subtasks |
| 8 | CHANGE | Merge Tasks 2.2-2.4 into a single task with subtasks |
| 9 | CHANGE | Phase 3 duration to 25 min with two parallel validation tracks |
| 10 | CHANGE | Task 3.5 commits to feature branch, not main |
| 11 | ADD | Task to verify scorer RVF upsert correctness (Phase 3) |
| 12 | ADD | Explicitly note graph-builder.mjs and report-generator.mjs as deferred |
| 13 | ADD | Fix `isRvfAvailable()` for ESM context (async dynamic import) |
| 14 | ADD | Document pipeline.mjs failure cascade for vectorize step |
| 15 | ADD | Test or defer `--incremental` flag explicitly |
| 16 | KEEP | 4-way file ownership with no write conflicts |
| 17 | KEEP | Phase gates as dependency checkpoints |
| 18 | KEEP | Graceful fallback as a first-class design requirement |
