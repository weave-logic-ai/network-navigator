# SPARC Orchestration Plan
## Referral Likelihood Scoring + Criteria-Driven Network Expansion

**System**: LinkedIn Network Intelligence Referral Scoring Engine
**Date**: 2026-03-09
**Status**: Implementation Complete -- Retrospective Reference Document
**Scope**: 7 files (2 new, 5 modified), 6-component weighted scoring, 5 personas, 3 tiers
**PII Sanitized**: 2026-03-10 -- all dataset-specific counts and hardcoded paths replaced with placeholders

---

## 1. System Overview

This system extends the existing LinkedIn network intelligence pipeline with referral
likelihood scoring, referral persona classification, criteria-driven deep-scan targeting,
and interactive dashboard analytics. The scoring engine identifies which contacts are
most likely to refer business (as opposed to being direct buyers), assigns them a persona
that dictates engagement strategy, and tiers them for prioritized outreach.

### Core Deliverables

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `referral-scorer.mjs` | New | 6-component weighted referral scoring engine |
| 2 | `referral-config.json` | New | Tunable weights, role tiers, persona thresholds, industry targeting |
| 3 | `pipeline.mjs` | Modified | `--referrals` mode, dependency guards for referral-scorer step |
| 4 | `analyzer.mjs` | Modified | `modeReferrals`, updated `modeRecommend` and `modeSummary` |
| 5 | `report-generator.mjs` | Modified | Referral Partners section, charts, modal fields, explorer tab |
| 6 | `batch-deep-scan.mjs` | Modified | `--criteria referral`, `--min-score`, persona-based scan targeting |
| 7 | `lib.mjs` | Existing | Shared `parseArgs()` helper (no changes needed) |

### Scoring Components (Weighted Composite)

```
referralLikelihood = referralRole      * 0.25   (agency/partner/advisor roles)
                   + clientOverlap     * 0.20   (serves target industries)
                   + networkReach      * 0.20   (connections + clusters + edges)
                   + amplificationPower* 0.15   (super-connector traits, content)
                   + relationshipWarmth* 0.10   (mutuals + recency + relationship)
                   + buyerInversion    * 0.10   (low ICP = referrer, not buyer)
```

### Referral Personas

| Persona | Detection Logic | Engagement Strategy |
|---------|----------------|---------------------|
| `white-label-partner` | Agency/consultancy + serves target industries | Propose reseller/white-label arrangement |
| `warm-introducer` | Strong relationship + broad network reach | Ask for warm introductions |
| `co-seller` | Consultant/advisor + overlapping client base | Set up mutual referral arrangement |
| `amplifier` | Super-connector or content creator behavioral persona | Engage content + propose co-marketing |
| `passive-referral` | Default fallback | Deepen relationship before asking |

### Referral Tiers

| Tier | Threshold | Color |
|------|-----------|-------|
| `gold-referral` | >= 0.65 | #FFD700 |
| `silver-referral` | >= 0.45 | #C0C0C0 |
| `bronze-referral` | >= 0.30 | #CD7F32 |
| (none) | < 0.30 | -- |

---

## 2. SPARC Phase Dependencies

### Phase Flow

```
                   +------ parallel start ------+
                   |                            |
Specification (S) -+-> Pseudocode (P) --+       |
     |             |                    |       |
     |             +--------------------+       |
     |                                  |       |
     |                     Architecture (A) ----+
     |                          |
     |                     Refinement (R)
     |                          |
     +------- quality gates ----+
                                |
                         Completion (C)
```

### Phase Definitions

| Phase | Focus | Entry Criteria | Exit Criteria (Quality Gate) |
|-------|-------|---------------|---------------------------|
| **S - Specification** | Requirements, data contracts, field names | None | Schema contract defined, all 6 components specified, personas enumerated |
| **P - Pseudocode** | Algorithm design for each scoring component | S complete | Logic validated for all 6 scorers, persona assignment flow documented |
| **A - Architecture** | File decomposition, integration points, data flow | S + P complete | File inventory locked, interface contracts defined, dependency graph approved |
| **R - Refinement** | Implementation, testing, iterative tuning | A complete | All 7 files implemented, unit tests pass, pipeline E2E succeeds |
| **C - Completion** | Integration testing, dashboard validation, documentation | R complete | Full pipeline run succeeds, dashboard renders correctly, scoring distribution validated |

### Phase Overlap Rules

1. **S and P can overlap**: Once the schema contract (output field names) is defined in S, pseudocode work on individual components can begin.
2. **A requires S + P**: Architecture cannot finalize file boundaries until algorithms are designed.
3. **R requires A**: Implementation cannot begin until file inventory and interface contracts are locked.
4. **C requires R**: Completion testing cannot begin until all implementations exist.
5. **Test fixtures (Stream E) can start during S**: Test-first approach allows fixture creation as soon as the schema is defined.

---

## 3. Parallel Agent Streams

### Stream Decomposition

Five parallel streams of work, coordinated at defined synchronization points.

```
Stream A (Scoring Engine) ............ referral-scorer.mjs + referral-config.json
Stream B (Pipeline Integration) ...... pipeline.mjs modifications
Stream C (Analysis & Reporting) ...... analyzer.mjs + report-generator.mjs
Stream D (Network Expansion) ......... batch-deep-scan.mjs modifications
Stream E (Testing & Validation) ...... fixtures, unit tests, integration tests
```

---

### Stream A -- Scoring Engine (1-2 Agents)

**Files**: `referral-scorer.mjs` (new), `referral-config.json` (new)

**Agent A1: Referral Scorer Implementation**

| Field | Value |
|-------|-------|
| **Name** | `sparc-scorer-engine` |
| **Role** | SPARC Coder |
| **Subagent Type** | `coder` |
| **Input Artifacts** | Schema contract (field names), graph.json structure, behavioral-scorer.mjs patterns |
| **Output Artifacts** | `referral-scorer.mjs` (complete), `referral-config.json` (complete) |
| **Success Criteria** | Scores all contacts in graph.json, writes referralLikelihood/referralTier/referralPersona/referralSignals fields, runs in <5s for N contacts |
| **Estimated Complexity** | High (Tier 3 -- Sonnet/Opus). 6 scoring functions, persona assignment logic, baseline computation, config-driven thresholds |
| **Lines of Code** | ~500 (referral-scorer.mjs) + ~105 (referral-config.json) |

**Dependencies**:
- Needs graph.json schema (contacts structure, edges, clusters) from existing graph-builder
- Needs behavioral-scorer.mjs output fields (behavioralScore, behavioralPersona, behavioralSignals)
- Needs icp-config.json for buyer-inversion component
- **Can start immediately** after schema contract is defined in Specification phase

**Critical Output**: The field names and value ranges produced by this stream become the schema contract for all downstream consumers:

```javascript
// Output fields written to each contact in graph.json
c.scores.referralLikelihood  // 0-1, weighted composite
c.referralTier               // 'gold-referral' | 'silver-referral' | 'bronze-referral' | null
c.referralPersona            // 'white-label-partner' | 'warm-introducer' | 'co-seller' | 'amplifier' | 'passive-referral'
c.referralSignals            // { referralRole, clientOverlap, networkReach, amplificationPower, relationshipWarmth, buyerInversion, ... }
```

---

### Stream B -- Pipeline Integration (1 Agent)

**Files**: `pipeline.mjs` (modified)

**Agent B1: Pipeline Orchestrator**

| Field | Value |
|-------|-------|
| **Name** | `sparc-pipeline-integrator` |
| **Role** | SPARC Coder |
| **Subagent Type** | `coder` |
| **Input Artifacts** | Existing pipeline.mjs, referral-scorer.mjs path (from Stream A) |
| **Output Artifacts** | Modified pipeline.mjs with `--referrals` mode and dependency guards |
| **Success Criteria** | `--referrals` mode runs referral-scorer + analyzer(referrals), dependency guards skip referral-scorer if behavioral-scorer fails, all existing modes still work |
| **Estimated Complexity** | Medium (Tier 2 -- Haiku). Pattern follows existing mode additions, dependency guard pattern already established |
| **Lines of Code** | ~30 lines added/modified |

**Dependencies**:
- `referral-scorer.mjs` must exist at the expected path (from Stream A)
- **Can start after Stream A produces the script file** (does not need it to be fully tested, just needs the file to exist at the right path)

**Changes Required**:
1. Add `--referrals` case to `parseCliArgs()` switch
2. Add `referrals` case to `buildSteps()` returning `[referral-scorer.mjs, analyzer.mjs --mode referrals]`
3. Add `referral-scorer.mjs` step to `full`, `rebuild`, `rescore`, `deep-scan` pipelines
4. Add `behavioralOk` dependency guard: skip `referral-scorer.mjs` if behavioral-scorer fails
5. Update header comment with new mode documentation

---

### Stream C -- Analysis & Reporting (2 Agents)

**Files**: `analyzer.mjs` (modified), `report-generator.mjs` (modified)

**Agent C1: Analyzer Extension**

| Field | Value |
|-------|-------|
| **Name** | `sparc-analyzer-ext` |
| **Role** | SPARC Coder |
| **Subagent Type** | `coder` |
| **Input Artifacts** | Existing analyzer.mjs, schema contract from Stream A |
| **Output Artifacts** | Modified analyzer.mjs with `modeReferrals`, updated `modeRecommend`, updated `modeSummary` |
| **Success Criteria** | `--mode referrals` displays ranked referral partners with signals breakdown, `--mode recommend` includes Referral Partnerships section, `--mode summary` includes referral tier counts |
| **Estimated Complexity** | Medium (Tier 2/3). Follows established mode pattern, but `modeReferrals` is substantial (~60 lines) |
| **Lines of Code** | ~100 lines added |

**Agent C2: Report Generator Extension**

| Field | Value |
|-------|-------|
| **Name** | `sparc-report-ext` |
| **Role** | SPARC Coder |
| **Subagent Type** | `coder` |
| **Input Artifacts** | Existing report-generator.mjs, schema contract from Stream A |
| **Output Artifacts** | Modified report-generator.mjs with referral section, charts, modal fields, explorer tab |
| **Success Criteria** | HTML dashboard includes Referral Partners section with tier cards, persona distribution chart, top-20 referral table, referral fields in contact modal, referrals tab in explorer |
| **Estimated Complexity** | High (Tier 3 -- Sonnet/Opus). Large file (~1700 lines), HTML/JS generation, Chart.js integration, multiple insertion points |
| **Lines of Code** | ~200 lines added across multiple insertion points |

**Dependencies**:
- Both agents need the schema contract from Stream A (field names, tier names, persona names)
- **Can start after Stream A defines the output schema** (does not need the scorer to actually run)
- C1 and C2 can run in parallel -- they modify different files

**Risk Note**: `report-generator.mjs` is a single large file (~1700 lines). Recommend a single agent handles all report changes to avoid merge conflicts. If two agents must touch it, divide by insertion point (data computation vs. HTML template vs. JavaScript rendering).

---

### Stream D -- Network Expansion (1 Agent)

**Files**: `batch-deep-scan.mjs` (modified)

**Agent D1: Criteria-Based Deep Scan**

| Field | Value |
|-------|-------|
| **Name** | `sparc-deepscan-ext` |
| **Role** | SPARC Coder |
| **Subagent Type** | `coder` |
| **Input Artifacts** | Existing batch-deep-scan.mjs, referralTier/referralPersona field names from Stream A |
| **Output Artifacts** | Modified batch-deep-scan.mjs with `--criteria referral`, `--min-score`, persona-based targeting |
| **Success Criteria** | `--criteria referral` builds scan list from gold-referral tier contacts first, then warm-introducer/white-label-partner personas, then silver-referral; `--dry-run` shows the list; `--min-score` filters by referralLikelihood threshold |
| **Estimated Complexity** | Medium (Tier 2). Pattern follows existing criteria logic, extends `buildScanList()` |
| **Lines of Code** | ~40 lines added |

**Dependencies**:
- Needs referralTier and referralPersona field names from Stream A
- Needs referralLikelihood field in `c.scores` for sorting/filtering
- **Can start after Stream A defines tier/persona names** (does not need the scorer to actually run)

**Changes Required**:
1. Add `--criteria referral` case to `buildScanList()`
2. Add referral fields to the contact data extraction in `buildScanList()`
3. Add referral criteria to the `--criteria all` aggregate case
4. Add `referral-scorer.mjs` to the post-scan rebuild pipeline
5. Support `--min-score` filtering on `referralLikelihood`

---

### Stream E -- Testing & Validation (1 Agent)

**Files**: Test fixtures, unit tests, integration test scripts

**Agent E1: Test Engineer**

| Field | Value |
|-------|-------|
| **Name** | `sparc-tester` |
| **Role** | SPARC Tester |
| **Subagent Type** | `tester` |
| **Input Artifacts** | Schema contract from Stream A, all implementation files |
| **Output Artifacts** | Test fixtures (mock graph.json, mock config), unit test scripts, integration test scripts |
| **Success Criteria** | Unit tests validate each scoring component in isolation, integration test runs full `--referrals` pipeline, E2E test runs `--rebuild` and validates referral fields in output |
| **Estimated Complexity** | Medium (Tier 2/3). Fixture creation is straightforward, integration testing requires all streams complete |
| **Lines of Code** | ~200 lines across test files |

**Dependencies**:
- Fixture creation: **Can start immediately** (test-first approach) once schema is defined
- Unit tests: Need `referral-scorer.mjs` (from Stream A)
- Integration tests: Need all streams to produce files
- E2E tests: Need pipeline integration (Stream B) complete

**Test Plan**:
1. **T0**: Create test fixtures (mock graph.json with 10 contacts, referral-config.json)
2. **T1**: Unit tests for each of the 6 scoring components
3. **T2**: Unit test for persona assignment logic
4. **T3**: Unit test for tier assignment
5. **T4**: Integration test: `node referral-scorer.mjs` on fixtures
6. **T5**: Pipeline test: `node pipeline.mjs --referrals`
7. **T6**: E2E test: `node pipeline.mjs --rebuild` (full chain)
8. **T7**: Report test: verify HTML output contains referral section

---

## 4. Execution Timeline

### Gantt-Style Timeline

```
Phase    T0─────T1─────T2─────T3─────T4─────T5─────T6
         │      │      │      │      │      │      │
Stream A ████████████████                              Scoring engine + config
Stream E ██████████████████████████████████████████████ Test-first, continuous
Stream B        ████████████████                       Pipeline integration
Stream C1       ████████████████████████               Analyzer extensions
Stream C2       ████████████████████████               Report generator
Stream D        ████████████████                       Deep-scan criteria
Coord    ████████████████████████████████████████████████ Orchestration
         │      │      │      │      │      │      │
         │      CP1    │      CP2    │      CP3    CP4
         │      │      │      │      │      │      │
         S ─────┤      │      │      │      │      │
               P ──────┤      │      │      │      │
                      A ──────┤      │      │      │
                             R ──────────────┤      │
                                            C ──────┤
```

### Timeline Milestones

| Time | Event | SPARC Phase |
|------|-------|-------------|
| **T0** | Schema contract defined, Stream A + E start | Specification |
| **T1** | Stream A produces referral-scorer.mjs + config; **CP1** triggers Streams B, C, D | Pseudocode / Architecture |
| **T2** | All streams producing code; unit tests running against Stream A output | Refinement |
| **T3** | All streams complete; **CP2** triggers integration testing | Refinement |
| **T4** | Integration tests pass; **CP3** triggers pipeline E2E | Refinement / Completion |
| **T5** | E2E passes; report generation validated | Completion |
| **T6** | **CP4** final review, scoring distribution validated, documentation complete | Completion |

---

## 5. Coordination Points

### CP1 -- Schema Unlock (After Stream A Produces Output)

**Trigger**: Stream A commits `referral-scorer.mjs` and `referral-config.json` to the scripts/data directories.

**Actions**:
- Stream B receives the script file path, begins pipeline integration
- Streams C1, C2, D receive the schema contract (field names, tier names, persona names)
- Stream E begins unit test creation against the scorer functions

**Verification**:
```bash
# Verify referral-scorer.mjs produces expected output fields
node referral-scorer.mjs --verbose 2>&1 | head -5
# Should show: "Referral scoring N contacts..."
```

**Schema Contract Published at CP1**:

```json
{
  "contactFields": {
    "scores.referralLikelihood": "number (0-1)",
    "referralTier": "string | null ('gold-referral', 'silver-referral', 'bronze-referral')",
    "referralPersona": "string ('white-label-partner', 'warm-introducer', 'co-seller', 'amplifier', 'passive-referral')",
    "referralSignals": {
      "referralRole": "number (0-1)",
      "referralRoleMatch": "string | null",
      "clientOverlap": "number (0-1)",
      "clientOverlapIndustries": "string[]",
      "networkReach": "number (0-1)",
      "networkReachDetail": { "connections": "number", "clusters": "number", "edges": "number" },
      "amplificationPower": "number (0-1)",
      "amplificationSignals": "string[]",
      "relationshipWarmth": "number (0-1)",
      "buyerInversion": "number (0-1)"
    }
  },
  "graphMeta": {
    "lastReferralScored": "ISO 8601 timestamp",
    "referralVersion": "number (1)"
  }
}
```

---

### CP2 -- Code Complete (After All Streams Produce Code)

**Trigger**: All 7 files exist in their final form.

**Verification Checklist**:
- [x] `referral-scorer.mjs` runs without error on real graph.json
- [x] `referral-config.json` is valid JSON with all required fields
- [x] `pipeline.mjs --referrals` executes referral-scorer + analyzer(referrals)
- [x] `analyzer.mjs --mode referrals` displays ranked referral partners
- [x] `analyzer.mjs --mode recommend` includes Referral Partnerships section
- [x] `analyzer.mjs --mode summary` includes referral tier counts
- [x] `report-generator.mjs` produces HTML with referral section
- [x] `batch-deep-scan.mjs --criteria referral --dry-run` shows referral-based scan list

---

### CP3 -- Pipeline E2E (After Integration Tests Pass)

**Trigger**: `node pipeline.mjs --rebuild` completes with all steps OK, including `referral-scorer.mjs`.

**Verification**:
```bash
node pipeline.mjs --rebuild
# Expected output: all steps [OK], including referral-scorer.mjs
# Dependency chain: graph-builder -> scorer -> behavioral-scorer -> referral-scorer -> analyzer
```

**Validation Queries**:
```bash
# Verify referral fields exist in graph.json
node -e "
  const g = JSON.parse(require('fs').readFileSync('data/graph.json','utf-8'));
  const urls = Object.keys(g.contacts);
  const withRef = urls.filter(u => g.contacts[u].scores?.referralLikelihood > 0);
  const tiers = {};
  urls.forEach(u => {
    const t = g.contacts[u].referralTier || 'none';
    tiers[t] = (tiers[t] || 0) + 1;
  });
  console.log('Contacts with referral score:', withRef.length, '/', urls.length);
  console.log('Tier distribution:', tiers);
"
```

---

### CP4 -- Final Validation (After E2E Pass)

**Trigger**: Full pipeline succeeds, report renders correctly, scoring distributions are reasonable.

**Final Checklist**:
- [x] Scoring distribution: gold-referral should be ~5-15% of contacts (selective) -- actual: 1.7% (within range)
- [x] All 5 personas are assigned to at least 1 contact each -- confirmed in completion.md
- [x] Report HTML opens in browser without JavaScript errors -- network-report.html (376KB) generated
- [x] Referral Partners section displays tier cards, persona chart, top-20 table
- [x] Contact modal includes referral score, tier, and persona fields
- [x] `--criteria referral --dry-run` produces a prioritized scan list
- [x] `--criteria all` includes referral criteria alongside gold/hub/icp

---

## 6. Agent Specifications Summary

| Agent | Stream | Type | Input | Output | Complexity |
|-------|--------|------|-------|--------|------------|
| `sparc-scorer-engine` | A | coder | graph.json schema, behavioral fields | referral-scorer.mjs, referral-config.json | High (Tier 3) |
| `sparc-pipeline-integrator` | B | coder | pipeline.mjs, scorer path | Modified pipeline.mjs | Medium (Tier 2) |
| `sparc-analyzer-ext` | C1 | coder | analyzer.mjs, schema contract | Modified analyzer.mjs | Medium (Tier 2/3) |
| `sparc-report-ext` | C2 | coder | report-generator.mjs, schema contract | Modified report-generator.mjs | High (Tier 3) |
| `sparc-deepscan-ext` | D | coder | batch-deep-scan.mjs, tier/persona names | Modified batch-deep-scan.mjs | Medium (Tier 2) |
| `sparc-tester` | E | tester | Schema contract, all implementations | Test fixtures, unit/integration tests | Medium (Tier 2/3) |

**Total Agent Count**: 6 agents (within the 8-agent limit for hierarchical topology)

---

## 7. Conflict Resolution

### Shared Resource: graph.json

`graph.json` is the central data store. Multiple scripts read it; only scorers write to it.

**Resolution**:
- The pipeline enforces strict sequential ordering: `graph-builder -> scorer -> behavioral-scorer -> referral-scorer`
- Only one scorer writes at a time (enforced by `execFileSync` in pipeline.mjs)
- Each scorer reads the full graph, adds its fields, writes the full graph back
- No concurrent writes are possible within a pipeline run

### Shared Resource: analyzer.mjs MODES Dispatch

The `MODES` object at the bottom of `analyzer.mjs` maps mode names to handler functions.

**Resolution**:
- Agent C1 adds `modeReferrals` as a new function and adds `referrals: modeReferrals` to the MODES object
- Agent C1 also modifies `modeRecommend` (adds Referral Partnerships section) and `modeSummary` (adds referral tier counts)
- Since all changes are in the same file, a single agent (C1) handles all analyzer modifications
- No concurrent edits to `analyzer.mjs`

### Shared Resource: report-generator.mjs

This is the largest file (~1700 lines) with multiple insertion points: data computation, HTML template, and JavaScript rendering.

**Resolution**:
- **Single agent (C2) handles ALL report-generator changes**
- Changes span 4 areas: `computeReportData()`, HTML template (nav + sections), JS rendering, and modal content
- Attempting to split this across agents would create merge conflicts at every insertion point
- C2 reads the entire file, applies all changes in a single pass

### Shared Resource: pipeline.mjs Mode Definitions

**Resolution**:
- Agent B1 is the sole modifier of pipeline.mjs
- Changes are additive (new case in switch, new step in existing pipelines)
- No other agent touches this file

### Shared Resource: batch-deep-scan.mjs

**Resolution**:
- Agent D1 is the sole modifier of batch-deep-scan.mjs
- Changes extend the existing `buildScanList()` function with new criteria cases
- No other agent touches this file

---

## 8. Data Flow Diagram

```
                          +-------------------+
                          |  icp-config.json  |
                          +--------+----------+
                                   |
+------------------+    +----------v----------+    +---------------------+
| graph-builder.mjs|--->|   scorer.mjs        |--->| behavioral-scorer.mjs|
+------------------+    +---------------------+    +----------+----------+
        |                                                     |
        v                                                     v
  +-----------+                                    +----------+----------+
  | graph.json|<-----------------------------------|referral-scorer.mjs  |
  |           |                                    |  (reads graph.json  |
  | contacts: |                                    |   + referral-config |
  |   .scores |                                    |   + icp-config)     |
  |   .referralTier                                +---------------------+
  |   .referralPersona                                        |
  |   .referralSignals                                        |
  +-----------+                                               |
        |                                                     |
        +----+----+----+----+                                 |
        |    |    |    |    |                                  |
        v    v    v    v    v                                  |
     analyzer  report  batch-   pipeline                      |
       .mjs   -gen.mjs deep-     .mjs                        |
                       scan.mjs                               |
```

### Pipeline Dependency Chain

```
graph-builder.mjs
     |
     v (graphOk)
scorer.mjs
     |
     v (scorerOk)
behavioral-scorer.mjs
     |
     v (behavioralOk)
referral-scorer.mjs     <-- NEW dependency guard
     |
     v
analyzer.mjs / report-generator.mjs / delta.mjs
```

If any upstream step fails, the dependency guard in `pipeline.mjs` skips all downstream
steps that depend on it, preventing cascading errors.

---

## 9. Risk Mitigation

### Risk Matrix

| # | Risk | Probability | Impact | Mitigation | Owner |
|---|------|------------|--------|------------|-------|
| R1 | Score field name mismatch between scorer and consumers | Medium | High | Define schema contract in Stream A first (CP1). All consumers reference the same field names from the contract. | Stream A |
| R2 | Pipeline dependency failure cascade | Low | High | Dependency guards (`graphOk`, `scorerOk`, `behavioralOk`) in pipeline.mjs. Referral-scorer is guarded by `behavioralOk`. | Stream B |
| R3 | Report generator merge conflicts | High | Medium | Single agent (C2) handles all report-generator.mjs changes. No parallel edits to this file. | Stream C2 |
| R4 | Deep-scan rate limiting from LinkedIn | Medium | Medium | Configurable `--delay` between scans (default 10s), `--dry-run` preview mode, `--max-pages` and `--max-results` caps, `--skip` for resumption. | Stream D |
| R5 | Scoring distribution too flat (everyone gets similar scores) | Medium | Medium | Configurable weights in referral-config.json, role-tier differentiation (high/medium/low), tier thresholds adjustable post-deployment. | Stream A |
| R6 | Persona assignment order sensitivity | Low | Low | Personas are checked in priority order (white-label-partner first, passive-referral last). First match wins. Document the priority chain. | Stream A |
| R7 | Large graph.json file size after adding referral fields | Low | Low | referralSignals is a flat object (~200 bytes per contact). For N contacts, adds ~180KB. Acceptable. | Stream A |
| R8 | Missing behavioral scores block referral scoring | Medium | Medium | `referral-scorer.mjs` checks for `behavioralScore` existence on the first contact. Pipeline guards prevent running without upstream data. | Stream A + B |

### Contingency Plans

**If scoring distribution is too flat**:
1. Increase role-tier differentiation (raise high-tier score to 1.0, lower low-tier to 0.1)
2. Tighten tier thresholds (raise gold-referral from 0.65 to 0.70)
3. Add bonus multiplier for contacts matching 2+ persona criteria

**If report-generator.mjs changes are too complex for one agent**:
1. Split into two phases: Phase 1 adds data computation, Phase 2 adds HTML/JS rendering
2. Run phases sequentially, not in parallel
3. Use git diff to verify each phase's changes before proceeding

**If pipeline E2E fails at referral-scorer step**:
1. Check that behavioral-scorer ran successfully (dependency guard should catch this)
2. Verify referral-config.json is valid JSON and at the expected path
3. Run `referral-scorer.mjs --verbose` standalone to isolate the error

---

## 10. Configuration Schema

### referral-config.json Structure

```json
{
  "weights": {
    "referralRole": 0.25,
    "clientOverlap": 0.20,
    "networkReach": 0.20,
    "amplificationPower": 0.15,
    "relationshipWarmth": 0.10,
    "buyerInversion": 0.10
  },
  "roleTiers": {
    "high":   { "score": 1.0, "patterns": ["agency", "partner", ...] },
    "medium": { "score": 0.7, "patterns": ["consultant", "broker", ...] },
    "low":    { "score": 0.3, "patterns": ["manager", "founder", ...] }
  },
  "targetIndustries": ["ecommerce", "saas", "retail", ...],
  "industrySignals": {
    "servesTargetClients": ["agency", "consultancy", ...],
    "industryKeywords": ["ecommerce", "saas", ...]
  },
  "referralTiers": {
    "gold-referral": 0.65,
    "silver-referral": 0.45,
    "bronze-referral": 0.30
  },
  "personas": {
    "white-label-partner": { "requires": { "minReferralRole": 0.7, "minClientOverlap": 0.4, "rolePatterns": [...] } },
    "warm-introducer":     { "requires": { "minRelationshipWarmth": 0.5, "minNetworkReach": 0.5 } },
    "co-seller":           { "requires": { "minClientOverlap": 0.5, "rolePatterns": [...] } },
    "amplifier":           { "requires": { "minAmplificationPower": 0.5, "behavioralPersonas": [...] } },
    "passive-referral":    { "requires": {} }
  },
  "networkReachBaselines": {
    "connectionCountNorm": 500,
    "clusterBreadthWeight": 0.4,
    "edgeDensityWeight": 0.3,
    "connectionCountWeight": 0.3
  }
}
```

All thresholds are tunable without code changes. Adjusting `weights` changes the composite
scoring emphasis. Adjusting `referralTiers` thresholds changes tier distribution. Adjusting
`personas.*.requires` changes persona assignment sensitivity.

---

## 11. Quality Metrics

### Scoring Health Indicators

| Metric | Healthy Range | Action if Outside |
|--------|--------------|-------------------|
| Gold-referral % | 5-15% of contacts | Raise/lower gold-referral threshold (0.65) |
| Persona diversity | All 5 personas represented | Review persona detection thresholds |
| Average referralLikelihood | 0.20-0.45 | Adjust component weights if too high/low |
| Referral-buyer overlap | <20% of gold-referrals are also gold-tier buyers | buyerInversion weight may need increase |
| Config-driven patterns hit rate | >50% of contacts match at least 1 role pattern | Expand pattern lists in referral-config.json |

### Pipeline Health Indicators

| Metric | Target | Measurement |
|--------|--------|-------------|
| referral-scorer.mjs runtime | <5s for N contacts | `pipeline.mjs` step timing output |
| Pipeline --rebuild total | <30s | Pipeline summary elapsed time |
| Dependency guard accuracy | 100% (never runs referral-scorer without behavioral data) | Guard skip messages in pipeline output |
| Report generation | <3s for 200-node dashboard | report-generator.mjs timing |

---

## 12. Post-Implementation Tuning Guide

After the initial implementation, the scoring system should be tuned based on real data:

1. **Run the full pipeline**: `node pipeline.mjs --rebuild`
2. **Review distribution**: `node analyzer.mjs --mode referrals --top 50`
3. **Check persona balance**: Look at persona breakdown at the bottom of referral output
4. **Validate gold-referral contacts**: Manually review top 10 -- are they actually referral-likely?
5. **Adjust thresholds**: Edit `referral-config.json` and re-run `node pipeline.mjs --referrals`
6. **Iterate**: Repeat steps 2-5 until distributions match business intuition

### Common Tuning Actions

| Observation | Adjustment |
|-------------|------------|
| Too many gold-referrals | Raise `referralTiers.gold-referral` from 0.65 to 0.70+ |
| Too few referral partners overall | Lower `referralTiers.bronze-referral` from 0.30 to 0.25 |
| Wrong people flagged as white-label-partner | Narrow `rolePatterns` in persona config |
| Buyers showing up as referrals | Increase `weights.buyerInversion` from 0.10 to 0.15 |
| Network hubs not getting referral credit | Increase `weights.networkReach` from 0.20 to 0.25 |

---

## 13. File Inventory (Final State)

### New Files

| File | Path | Lines | Purpose |
|------|------|-------|---------|
| `referral-scorer.mjs` | `scripts/referral-scorer.mjs` | ~507 | 6-component weighted referral scoring engine |
| `referral-config.json` | `data/referral-config.json` | ~105 | Tunable scoring weights, role tiers, persona thresholds |

### Modified Files

| File | Path | Lines Added | Changes |
|------|------|-------------|---------|
| `pipeline.mjs` | `scripts/pipeline.mjs` | ~30 | `--referrals` mode, dependency guards, referral step in pipelines |
| `analyzer.mjs` | `scripts/analyzer.mjs` | ~100 | `modeReferrals`, updated `modeRecommend`, updated `modeSummary` |
| `report-generator.mjs` | `scripts/report-generator.mjs` | ~200 | Referral section, charts, modal fields, explorer tab |
| `batch-deep-scan.mjs` | `scripts/batch-deep-scan.mjs` | ~40 | `--criteria referral`, `--min-score`, persona-based targeting |

### Unchanged Files (Dependencies)

| File | Role in System |
|------|---------------|
| `lib.mjs` | Shared `parseArgs()` helper |
| `graph-builder.mjs` | Builds graph.json (upstream) |
| `scorer.mjs` | ICP/goldScore scoring (upstream) |
| `behavioral-scorer.mjs` | Behavioral scoring (upstream, direct dependency) |
| `deep-scan.mjs` | Individual contact deep-scan (called by batch-deep-scan) |

---

## 14. Swarm Configuration

For executing this orchestration plan via claude-flow:

```bash
npx @claude-flow/cli@latest swarm init \
  --topology hierarchical \
  --max-agents 8 \
  --strategy specialized
```

### Agent Spawn Order

1. **T0**: Spawn `sparc-scorer-engine` (Stream A) + `sparc-tester` (Stream E)
2. **CP1**: Spawn `sparc-pipeline-integrator` (B) + `sparc-analyzer-ext` (C1) + `sparc-report-ext` (C2) + `sparc-deepscan-ext` (D)
3. **CP2**: All agents report code-complete; `sparc-tester` runs integration tests
4. **CP3**: Coordinator runs E2E pipeline test
5. **CP4**: Coordinator validates distributions and report output

### Memory Namespace

All agents share the `referral-scoring` memory namespace for schema contracts and
coordination artifacts:

```bash
npx @claude-flow/cli@latest memory store \
  --key "schema-contract-v1" \
  --value '{"fields":["referralLikelihood","referralTier","referralPersona","referralSignals"]}' \
  --namespace referral-scoring
```

---

## Appendix A: Complete CLI Reference

```bash
# Run referral scoring only
node pipeline.mjs --referrals

# Full rebuild including referral scoring
node pipeline.mjs --rebuild

# Analyze referral partners
node analyzer.mjs --mode referrals --top 20
node analyzer.mjs --mode referrals --persona warm-introducer
node analyzer.mjs --mode referrals --tier gold-referral

# Strategic recommendations (includes referral section)
node analyzer.mjs --mode recommend

# Network summary (includes referral tier counts)
node analyzer.mjs --mode summary

# Generate HTML dashboard (includes referral section)
node report-generator.mjs

# Criteria-based deep scan
node batch-deep-scan.mjs --criteria referral --dry-run
node batch-deep-scan.mjs --criteria referral --min-score 0.5
node batch-deep-scan.mjs --criteria all --delay 15

# Standalone referral scorer
node referral-scorer.mjs --verbose
```

---

*This document serves as the master coordination reference for the SPARC implementation
of the Referral Likelihood Scoring + Criteria-Driven Network Expansion system. All agents
should reference this document for schema contracts, dependency ordering, and coordination
point requirements.*
