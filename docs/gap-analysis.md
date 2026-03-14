# Gap Analysis: LinkedIn Prospector -- SPARC Plan vs Implementation

**Date**: 2026-03-10
**Analyst**: Software Architecture Review
**Last Updated**: 2026-03-10

---

## CORRECTION NOTICE (2026-03-10)

**The original analysis below was based on the WRONG copy of the codebase.** It examined the outdated copy at `~/.claude/skills/linkedin-prospector/` (5 scripts, PII-embedded). The CANONICAL codebase at `/home/aepod/dev/ctox/.claude/linkedin-prospector/skills/linkedin-prospector/` contains **17 fully implemented scripts** (~5,000+ lines). The corrected assessment is **~94% implementation** (17/18 scripts).

### Corrected Implementation Scorecard

| Layer | Planned | Implemented (Canonical) | Coverage |
|-------|---------|-------------------------|----------|
| Data Ingestion | 4 (search, enrich, reparse, configure) | 4 | 100% |
| Shared Utilities | 3 (lib, db, cache) | 3 | 100% |
| Graph Construction | 1 (graph-builder) | 1 | 100% |
| Scoring Engine | 3 (scorer, behavioral-scorer, referral-scorer) | 3 | 100% |
| Analysis & Reporting | 2 (analyzer, report-generator) | 2 | 100% |
| Pipeline Orchestration | 2 (pipeline, delta) | 2 | 100% |
| Network Expansion | 2 (deep-scan, batch-deep-scan) | 2 | 100% |
| Google Sheets Integration | 1 (sheets) | 0 (not yet ported) | 0% |
| **Total** | **18** | **17** | **94%** |

### Corrected Assessment

- **What works**: The ENTIRE intelligence pipeline is implemented -- data collection, graph construction, all 3 scoring layers, 10 analysis modes, full HTML dashboard, pipeline orchestration, deep-scan, config management, delta tracking, caching.
- **What is genuinely missing**: Only `sheets.mjs` (Google Sheets push) has not been ported to the canonical location.
- **Data state**: All data and config files exist at canonical location (contacts.json 951KB, graph.json 2.8MB, icp-config.json, behavioral-config.json, referral-config.json, network-report.html 376KB, snapshots/).
- **Remaining gaps (non-script)**: No test files, data not separated from skill dir, no .gitignore, .sparc docs contained PII (now remediated).

The `.sparc/completion.md` claims DO match the canonical codebase -- the scripts, configs, scoring data, and report all exist.

---

## ORIGINAL ANALYSIS (OUTDATED -- based on wrong copy)

The original analysis examined `~/.claude/skills/linkedin-prospector/` which only has 5 scripts. This section is preserved for reference but is NOT accurate for the canonical codebase.

---

## 2. Script-by-Script Gap Inventory

### 2.1 Implemented Scripts (5 of 18)

| # | Script | Path | Lines | Status | Notes |
|---|--------|------|-------|--------|-------|
| 1 | `lib.mjs` | `scripts/lib.mjs` | 110 | IMPLEMENTED | Shared utilities: `parseArgs()`, `launchBrowser()`, `getGoogleToken()`, `sheetsApi()`, niche keywords. Includes Google Sheets helpers not referenced in SPARC docs. |
| 2 | `db.mjs` | `scripts/db.mjs` | 293 | IMPLEMENTED | Contact database CRUD with CLI: stats, search, export, prune, seed. Uses `contacts.json` as backing store. |
| 3 | `search.mjs` | `scripts/search.mjs` | 398 | IMPLEMENTED | LinkedIn search by niche keywords + all-connections extraction. Playwright-based with pagination, deduplication, and rate limiting. |
| 4 | `enrich.mjs` | `scripts/enrich.mjs` | 136 | IMPLEMENTED | Profile enrichment via Playwright. Visits profile pages, extracts headline, location, role, company, about, connections. |
| 5 | `sheets.mjs` | `scripts/sheets.mjs` | 190 | IMPLEMENTED | Google Sheets integration for Gold List push. Maps contacts to columns A-Q with scoring heuristics (culture fit, conversion likelihood). Not referenced in SPARC docs. |

### 2.2 Missing Scripts (13 of 18)

#### 2.2.1 `graph-builder.mjs` -- Network Graph Construction

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Reads `contacts.json`, normalizes company names, detects cluster membership via keyword matching (10 clusters), creates 5 edge types (same-company, same-cluster, mutual-proximity, discovered-connection, shared-connection), writes `graph.json`. |
| **Dependencies on existing** | Reads `contacts.json` (exists, 897 contacts). Depends on `lib.mjs` for `parseArgs()`. |
| **Dependencies it creates** | Produces `graph.json` -- the central data store consumed by all downstream scripts (scorer, behavioral-scorer, referral-scorer, analyzer, report-generator, batch-deep-scan). |
| **Key algorithms** | Company normalization (suffix stripping, lowercase key), keyword-based cluster detection (10 clusters x contact text matching), edge creation (same-company all-pairs, same-cluster top-20% by mutuals, mutual-proximity top-25%, plus deep-scan edge types). |
| **Estimated complexity** | **L (Large)** -- Company normalization with edge cases, 5 edge type algorithms, cluster assignment logic, graph metadata tracking. ~300-400 lines estimated. |
| **Phase 1 priority** | **P0 -- CRITICAL BLOCKER**. Nothing downstream can run without `graph.json`. |

#### 2.2.2 `scorer.mjs` -- ICP + Gold Scoring Engine

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Reads `graph.json` and `icp-config.json`, computes 4 sub-scores (icpFit, networkHub, relationshipStrength, signalBoost), calculates goldScore composite, assigns tier (gold/silver/bronze/watch) and personaType (buyer/advisor/hub/peer/referral-partner), writes tags. |
| **Dependencies on existing** | `graph.json` (from graph-builder), `icp-config.json` (must be created). |
| **Dependencies it creates** | Writes `scores.*`, `personaType`, `icpCategories`, `tags` fields. Required by behavioral-scorer (reads scores.*). |
| **Key algorithms** | ICP fit = best match across 5 configurable profiles. networkHub = P90-normalized mutuals + cluster count + connectorIndex + edge count. relationshipStrength = mutuals + search terms + recency + proximity. goldScore = weighted composite. |
| **Estimated complexity** | **L (Large)** -- 4 scoring components, baseline computation, tier/persona assignment. ~250-300 lines. |
| **Phase 1 priority** | **P0 -- CRITICAL**. Required for all downstream scoring. |

#### 2.2.3 `behavioral-scorer.mjs` -- Behavioral Scoring Layer

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Reads `graph.json` (with Phase 1 scores), `behavioral-config.json`, and `icp-config.json`. Computes 6 behavioral components (connectionPower, connectionRecency, aboutSignals, headlineSignals, superConnectorIndex, networkAmplifier). Assigns behavioralPersona (5 types). Recalculates goldScore v2 with behavioral weight. |
| **Dependencies on existing** | `graph.json` with Phase 1 scores (from scorer.mjs). `behavioral-config.json` (must be created). |
| **Dependencies it creates** | Writes `behavioralScore`, `behavioralPersona`, `behavioralSignals`, `scores.behavioral`, `scores.goldScoreV1`, updated `scores.goldScore` (v2). Required by referral-scorer. |
| **Key algorithms** | Connection power from "500+ connections" string parsing. Connection recency from "Connected on March 5, 2026" date parsing. About signal keyword matching across 8 categories. Headline pattern detection. Super-connector index. |
| **Estimated complexity** | **L (Large)** -- 6 components, persona assignment, goldScore v2 recalculation. ~350-400 lines. |
| **Phase 1 priority** | **P0 -- CRITICAL**. Required for referral scoring. |

#### 2.2.4 `referral-scorer.mjs` -- Referral Likelihood Scoring

| Attribute | Detail |
|-----------|--------|
| **Purpose** | 6-component weighted referral scoring: referralRole (0.25), clientOverlap (0.20), networkReach (0.20), amplificationPower (0.15), relationshipWarmth (0.10), buyerInversion (0.10). Assigns referralPersona (5 types via waterfall) and referralTier (gold/silver/bronze/null). |
| **Dependencies on existing** | `graph.json` with behavioral scores. `referral-config.json` and `icp-config.json`. |
| **Dependencies it creates** | Writes `scores.referralLikelihood`, `referralTier`, `referralPersona`, `referralSignals`. |
| **Key algorithms** | 3-tier role pattern matching (42 patterns), client overlap (16 industry keywords + 10 service signals), network reach (P90-normalized connections/clusters/edges), amplification power (trait detection + helping language + content signals), relationship warmth (mutuals + recency), buyer inversion (1-icpFit + ecosystem keywords). Persona waterfall: white-label-partner > warm-introducer > co-seller > amplifier > passive-referral. |
| **Estimated complexity** | **XL (Extra Large)** -- Most complex scorer, 6 independent scoring functions, baselines computation, persona assignment waterfall, detailed signal output. ~500 lines. |
| **Phase 1 priority** | **P1 -- HIGH**. The primary new feature described in the SPARC docs. Depends on all upstream scorers. |

#### 2.2.5 `analyzer.mjs` -- CLI Analysis Engine

| Attribute | Detail |
|-----------|--------|
| **Purpose** | 10 CLI query modes for text-based analysis: summary, hubs, prospects, recommend, clusters, company, behavioral, visibility, employers, referrals. Supports filtering by --persona, --tier, --cluster, --icp, --top, --name. |
| **Dependencies on existing** | `graph.json` with all scoring layers populated. |
| **Dependencies it creates** | CLI stdout output. No file writes. |
| **Key algorithms** | Each mode is an independent query function (~50-70 lines). Referrals mode includes ranked list with "Why referral" explanations. Recommend mode generates actionable suggestions. |
| **Estimated complexity** | **XL (Extra Large)** -- 10 independent mode functions, filtering logic, formatted output. ~700 lines. |
| **Phase 1 priority** | **P1 -- HIGH**. Primary interface for querying intelligence data. |

#### 2.2.6 `report-generator.mjs` -- HTML Dashboard Generator

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Generates self-contained HTML dashboard with: 3D force-directed graph (Three.js), Chart.js histograms and donut charts, sortable tables, contact modals, sidebar navigation. Sections: Overview, 3D Graph, Score Distributions, Top Contacts, Network Hubs, Super-Connectors, Referral Partners, Company Beachheads, Visibility Strategy, Data Explorer, Recommendations. |
| **Dependencies on existing** | `graph.json` fully scored. |
| **Dependencies it creates** | `data/network-report.html` (~1700+ line self-contained HTML file). |
| **Key algorithms** | `computeReportData()` aggregates scores, distributions, cluster data. HTML template generation with embedded Chart.js and 3d-force-graph CDN. |
| **Estimated complexity** | **XL (Extra Large)** -- HTML/CSS/JS template generation, Chart.js integration, 3D graph configuration, modal system, data explorer with tabs. ~1700 lines. |
| **Phase 1 priority** | **P2 -- MEDIUM**. High visual impact but depends on all scoring being complete first. |

#### 2.2.7 `pipeline.mjs` -- Master Pipeline Orchestrator

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Orchestrates sequential execution of scripts via `execFileSync`. Supports 10 modes: --full, --rebuild, --rescore, --behavioral, --referrals, --report, --deep-scan, --configure, --validate, --reparse. Implements dependency guards (graphOk, scorerOk, behavioralOk). |
| **Dependencies on existing** | All other scripts as subprocess targets. `lib.mjs` for `parseArgs()`. |
| **Dependencies it creates** | Coordinates execution order, tracks step success/failure, provides unified CLI entry point. |
| **Key algorithms** | Mode-to-steps mapping, cascading dependency guards (if upstream fails, skip dependent downstream), `execFileSync` with 120s/180s timeouts, summary report with pass/fail/skip status. |
| **Estimated complexity** | **M (Medium)** -- Mode routing, step execution, guard logic. ~340 lines. |
| **Phase 1 priority** | **P1 -- HIGH**. Required for any automated multi-step workflow. |

#### 2.2.8 `batch-deep-scan.mjs` -- Criteria-Based Batch Scanning

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Prioritized multi-contact deep scanning. 4 criteria modes: gold (gold-tier + top 5 each dimension), referral (gold-referral + warm-introducer/white-label-partner + top 10 silver-referral), hub (top 10 by networkHub), all (union). Supports --dry-run, --skip, --min-score, --delay. Post-scan pipeline rebuild. |
| **Dependencies on existing** | `graph.json` with scores for targeting. `deep-scan.mjs` for individual scans. |
| **Dependencies it creates** | Triggers post-scan rebuild: graph-builder -> scorer -> behavioral -> referral -> report. |
| **Key algorithms** | `BuildScanList()` with deduplication via Set, criteria-based contact selection, sequential scan execution with rate limiting, post-scan rebuild orchestration. |
| **Estimated complexity** | **L (Large)** -- Scan list building, criteria logic, execution management, post-scan rebuild. ~300 lines. |
| **Phase 1 priority** | **P2 -- MEDIUM**. Network expansion feature. Depends on scoring + deep-scan. |

#### 2.2.9 `deep-scan.mjs` -- Single-Contact Connection Scanner

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Navigates to a single contact's LinkedIn connections page, paginates through results, extracts degree-2 contacts. Supports --url, --max-pages, --max-results, --depth, --mutual-only. Creates `discovered-connection` and `shared-connection` edges. |
| **Dependencies on existing** | `contacts.json` (via `db.mjs`). `lib.mjs` for `launchBrowser()` and `parseArgs()`. `cache.mjs` for HTML caching. |
| **Dependencies it creates** | Adds degree-2 contacts to `contacts.json` with `discoveredVia`, `degree`, `source` fields. Sets `deepScanned` flag on target. |
| **Key algorithms** | 4-strategy connection link location (href, text, URN extraction, slug fallback). Multi-page scrolling with 6x600px + 8x400px pattern. Connection deduplication by URL. Known-contact merging (append to discoveredVia) vs new-contact creation. |
| **Estimated complexity** | **L (Large)** -- Browser automation with multiple fallback strategies, complex scraping, data merging. ~350-400 lines. |
| **Phase 1 priority** | **P2 -- MEDIUM**. Network expansion feature. Independent of scoring pipeline. |

#### 2.2.10 `delta.mjs` -- Snapshot and Change Detection

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Creates snapshots of current network state, compares against previous snapshots to detect changes (new contacts, score changes, tier promotions/demotions). Commands: --snapshot, --check, --list. |
| **Dependencies on existing** | `graph.json` or `contacts.json` for current state. |
| **Dependencies it creates** | `data/snapshots/snapshot-YYYY-MM-DD.json` files. |
| **Key algorithms** | State extraction, diff computation between snapshots, change categorization (added, removed, promoted, demoted). |
| **Estimated complexity** | **S (Small)** -- Snapshot creation/comparison is straightforward. ~100-150 lines. |
| **Phase 1 priority** | **P3 -- LOW**. Nice-to-have tracking feature. |

#### 2.2.11 `cache.mjs` -- HTML Cache Layer

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Caches scraped LinkedIn HTML pages (search results, profiles, connection lists). Provides key-based lookup with `data/cache/index.json` manifest. Organized into `cache/search/`, `cache/profiles/`, `cache/connections/` subdirectories. |
| **Dependencies on existing** | None (utility module). |
| **Dependencies it creates** | Cache files consumed by `deep-scan.mjs` and potentially `reparse.mjs`. |
| **Key algorithms** | Key generation from URL, cache hit/miss detection, HTML write/read, cache directory management. |
| **Estimated complexity** | **S (Small)** -- Simple key-value file cache. ~80-120 lines. |
| **Phase 1 priority** | **P2 -- MEDIUM**. Required by deep-scan for page caching. |

#### 2.2.12 `configure.mjs` -- Configuration Management

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Interactive or CLI-driven generation of `icp-config.json`, `behavioral-config.json`, and `referral-config.json`. Supports config validation (--validate). |
| **Dependencies on existing** | None (generates config files). |
| **Dependencies it creates** | All three config JSON files consumed by scorers. |
| **Key algorithms** | Interactive prompting or JSON payload processing, schema validation, default value generation. |
| **Estimated complexity** | **M (Medium)** -- Config generation with validation for 3 schemas. ~200-250 lines. |
| **Phase 1 priority** | **P1 -- HIGH** (at minimum, config files must be created manually). Can be deferred if configs are hand-created. |

#### 2.2.13 `reparse.mjs` -- Data Reparsing from Cache

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Re-extracts contact data from cached HTML files (in `data/cache/`) when extraction logic is improved. Supports --all flag. |
| **Dependencies on existing** | `cache.mjs` for cache access. `db.mjs` for contact updates. |
| **Dependencies it creates** | Updated fields in `contacts.json`. |
| **Key algorithms** | HTML parsing with updated selectors, field extraction, contact merging. |
| **Estimated complexity** | **M (Medium)** -- HTML parsing similar to enrich.mjs but from cache. ~150-200 lines. |
| **Phase 1 priority** | **P3 -- LOW**. Only needed when extraction logic changes. |

---

## 3. Feature Gap Matrix

| Feature Area | Planned | Implemented | Gap | Priority |
|-------------|---------|-------------|-----|----------|
| **Data Collection** | | | | |
| LinkedIn search by niche keywords | Yes | Yes | None | -- |
| All-connections extraction | Yes | Yes | None | -- |
| Profile enrichment (headline, about, role) | Yes | Yes | None | -- |
| Contact database CRUD (stats, search, export, prune, seed) | Yes | Yes | None | -- |
| HTML page caching | Yes | No | `cache.mjs` not built | P2 |
| Data reparsing from cache | Yes | No | `reparse.mjs` not built | P3 |
| **Google Sheets Integration** | | | | |
| Gold List push to Google Sheets | Not in SPARC | Yes | Extra feature (sheets.mjs) | -- |
| **Graph Construction** | | | | |
| Company normalization | Yes | No | Requires `graph-builder.mjs` | P0 |
| Cluster detection (10 keyword clusters) | Yes | No | Requires `graph-builder.mjs` | P0 |
| Edge creation (5 types) | Yes | No | Requires `graph-builder.mjs` | P0 |
| `graph.json` output | Yes | No | **Central data store does not exist** | P0 |
| **Scoring -- Phase 1 (ICP + Network)** | | | | |
| ICP fit scoring (5 profiles) | Yes | No | Requires `scorer.mjs` + `icp-config.json` | P0 |
| Network hub scoring | Yes | No | Requires `scorer.mjs` | P0 |
| Relationship strength scoring | Yes | No | Requires `scorer.mjs` | P0 |
| Signal boost scoring | Yes | No | Requires `scorer.mjs` | P0 |
| Gold Score v1 composite | Yes | No | Requires `scorer.mjs` | P0 |
| Tier assignment (gold/silver/bronze/watch) | Yes | No | Requires `scorer.mjs` | P0 |
| PersonaType assignment | Yes | No | Requires `scorer.mjs` | P0 |
| **Scoring -- Phase 2 (Behavioral)** | | | | |
| Connection power scoring | Yes | No | Requires `behavioral-scorer.mjs` | P0 |
| Connection recency scoring | Yes | No | Requires `behavioral-scorer.mjs` | P0 |
| About signal detection (8 categories) | Yes | No | Requires `behavioral-scorer.mjs` | P0 |
| Headline pattern detection | Yes | No | Requires `behavioral-scorer.mjs` | P0 |
| Super-connector index | Yes | No | Requires `behavioral-scorer.mjs` | P0 |
| Network amplifier | Yes | No | Requires `behavioral-scorer.mjs` | P0 |
| Behavioral persona assignment (5 types) | Yes | No | Requires `behavioral-scorer.mjs` | P0 |
| Gold Score v2 (behavioral reweight) | Yes | No | Requires `behavioral-scorer.mjs` | P0 |
| **Scoring -- Phase 3 (Referral)** | | | | |
| 6-component referral scoring | Yes | No | Requires `referral-scorer.mjs` | P1 |
| Referral persona assignment (5 waterfall) | Yes | No | Requires `referral-scorer.mjs` | P1 |
| Referral tier assignment | Yes | No | Requires `referral-scorer.mjs` | P1 |
| Referral signals breakdown output | Yes | No | Requires `referral-scorer.mjs` | P1 |
| **Analysis** | | | | |
| Summary mode (network overview) | Yes | No | Requires `analyzer.mjs` | P1 |
| Hubs mode (top N by networkHub) | Yes | No | Requires `analyzer.mjs` | P1 |
| Prospects mode (top N by icpFit) | Yes | No | Requires `analyzer.mjs` | P1 |
| Recommend mode (strategic actions) | Yes | No | Requires `analyzer.mjs` | P1 |
| Clusters mode (cluster map) | Yes | No | Requires `analyzer.mjs` | P1 |
| Company mode (deep dive) | Yes | No | Requires `analyzer.mjs` | P1 |
| Behavioral mode (top N behavioral) | Yes | No | Requires `analyzer.mjs` | P1 |
| Visibility mode (content strategy) | Yes | No | Requires `analyzer.mjs` | P1 |
| Employers mode (company ranking) | Yes | No | Requires `analyzer.mjs` | P1 |
| Referrals mode (referral partners) | Yes | No | Requires `analyzer.mjs` | P1 |
| **Reporting** | | | | |
| HTML dashboard with 3D graph | Yes | No | Requires `report-generator.mjs` | P2 |
| Chart.js histograms and donut charts | Yes | No | Requires `report-generator.mjs` | P2 |
| Sortable data tables | Yes | No | Requires `report-generator.mjs` | P2 |
| Contact detail modals | Yes | No | Requires `report-generator.mjs` | P2 |
| Referral Partners section | Yes | No | Requires `report-generator.mjs` | P2 |
| Data Explorer with tabs | Yes | No | Requires `report-generator.mjs` | P2 |
| **Pipeline Orchestration** | | | | |
| --full mode | Yes | No | Requires `pipeline.mjs` | P1 |
| --rebuild mode | Yes | No | Requires `pipeline.mjs` | P1 |
| --rescore mode | Yes | No | Requires `pipeline.mjs` | P1 |
| --behavioral mode | Yes | No | Requires `pipeline.mjs` | P1 |
| --referrals mode | Yes | No | Requires `pipeline.mjs` | P1 |
| --report mode | Yes | No | Requires `pipeline.mjs` | P2 |
| --deep-scan mode | Yes | No | Requires `pipeline.mjs` | P2 |
| --configure mode | Yes | No | Requires `pipeline.mjs` + `configure.mjs` | P2 |
| --validate mode | Yes | No | Requires `pipeline.mjs` + `configure.mjs` | P2 |
| --reparse mode | Yes | No | Requires `pipeline.mjs` + `reparse.mjs` | P3 |
| Dependency guards (cascade skip) | Yes | No | Requires `pipeline.mjs` | P1 |
| **Network Expansion** | | | | |
| Single-contact deep scan | Yes | No | Requires `deep-scan.mjs` | P2 |
| Batch deep scan with criteria | Yes | No | Requires `batch-deep-scan.mjs` | P2 |
| Post-scan rebuild pipeline | Yes | No | Requires `batch-deep-scan.mjs` + `pipeline.mjs` | P2 |
| Discovered-connection edge creation | Yes | No | Requires `deep-scan.mjs` + `graph-builder.mjs` | P2 |
| Bridge contact detection | Yes | No | Requires `graph-builder.mjs` | P2 |
| **Configuration Management** | | | | |
| icp-config.json creation | Yes | No | File does not exist | P0 |
| behavioral-config.json creation | Yes | No | File does not exist | P0 |
| referral-config.json creation | Yes | No | File does not exist | P1 |
| Config validation | Yes | No | Requires `configure.mjs` | P2 |
| **Change Tracking** | | | | |
| Network state snapshots | Yes | No | Requires `delta.mjs` | P3 |
| Diff reporting | Yes | No | Requires `delta.mjs` | P3 |
| **Error Handling & Resilience** | | | | |
| Pipeline dependency guards | Yes | No | Requires `pipeline.mjs` | P1 |
| Graceful degradation (missing scores) | Yes | No | Requires scorer implementations | P1 |
| NaN guard on computed scores | Yes | No | Requires scorer implementations | P1 |
| Config validation on load | Yes | No | Requires scorer + config implementations | P2 |
| Fallback config defaults | Yes | No | Requires scorer implementations | P2 |
| **Testing** | | | | |
| Unit tests for scoring components | Yes | No | No test files exist | P1 |
| Integration tests for pipeline | Yes | No | No test files exist | P2 |
| Performance benchmarks | Yes | No | No test files exist | P3 |
| Quality gate tests (score distributions) | Yes | No | No test files exist | P2 |
| Test fixtures (mock graph.json) | Yes | No | No test fixtures exist | P1 |

---

## 4. Data Model Comparison

### 4.1 Contact Schema: Planned vs Actual

The specification defines a rich Contact schema within `graph.json`. The actual `contacts.json` contains only the raw ingestion fields.

| Field | Spec (graph.json) | Actual (contacts.json) | Gap |
|-------|-------------------|----------------------|-----|
| **Identity Fields** | | | |
| `name` | Yes | Yes | None |
| `enrichedName` | Yes | Yes | None |
| `headline` | Yes | Yes | None |
| `title` | Yes | Yes | None |
| `about` | Yes | Yes (744 of 897) | None (partial coverage expected) |
| `currentRole` | Yes | Yes | None |
| `currentCompany` | Yes | Yes | None |
| `location` | Yes | Yes | None |
| `enrichedLocation` | Yes | Yes | None |
| `connections` | Yes | Yes (806 of 897) | None |
| `connectedTime` | Yes | Yes (802 of 897) | None |
| `mutualConnections` | Yes | Yes | None |
| `searchTerms` | Yes | Yes | None |
| `profileUrl` | Yes | Yes | None |
| `enriched` | Yes | Yes (896 of 897) | None |
| `cachedAt` | Yes | Yes | None |
| `source` | Not in spec | Yes | Extra field in actual data |
| `currentInfo` | Not in spec | Yes | Extra field from search cards |
| `pastInfo` | Not in spec | Yes | Extra field from search cards |
| `enrichedAt` | Not in spec | Yes | Extra field from enrichment |
| **Network Metadata** | | | |
| `companyId` | Yes (graph.json) | No | **GAP** -- set by graph-builder |
| `degree` | Yes | No (0 contacts) | **GAP** -- set by deep-scan |
| `discoveredVia` | Yes | No | **GAP** -- set by deep-scan |
| `discoveredAt` | Yes | No | **GAP** -- set by deep-scan |
| `deepScanned` | Yes | No | **GAP** -- set by deep-scan |
| `deepScannedAt` | Yes | No | **GAP** -- set by deep-scan |
| `deepScanResults` | Yes | No | **GAP** -- set by deep-scan |
| `tags` | Yes | No | **GAP** -- set by scorer |
| **Phase 1 Scores** | | | |
| `scores.icpFit` | Yes | No | **GAP** -- requires scorer.mjs |
| `scores.networkHub` | Yes | No | **GAP** -- requires scorer.mjs |
| `scores.relationshipStrength` | Yes | No | **GAP** -- requires scorer.mjs |
| `scores.signalBoost` | Yes | No | **GAP** -- requires scorer.mjs |
| `scores.goldScore` | Yes | No | **GAP** -- requires scorer.mjs |
| `scores.goldScoreV1` | Yes | No | **GAP** -- requires behavioral-scorer |
| `scores.tier` | Yes | No | **GAP** -- requires scorer.mjs |
| `personaType` | Yes | No | **GAP** -- requires scorer.mjs |
| `icpCategories` | Yes | No | **GAP** -- requires scorer.mjs |
| **Phase 2 Scores** | | | |
| `behavioralScore` | Yes | No | **GAP** -- requires behavioral-scorer |
| `behavioralPersona` | Yes | No | **GAP** -- requires behavioral-scorer |
| `behavioralSignals` | Yes | No | **GAP** -- requires behavioral-scorer |
| `scores.behavioral` | Yes | No | **GAP** -- requires behavioral-scorer |
| **Phase 3 Scores** | | | |
| `scores.referralLikelihood` | Yes | No | **GAP** -- requires referral-scorer |
| `referralTier` | Yes | No | **GAP** -- requires referral-scorer |
| `referralPersona` | Yes | No | **GAP** -- requires referral-scorer |
| `referralSignals` | Yes | No | **GAP** -- requires referral-scorer |

### 4.2 Missing Data Files

| File | Planned | Exists | Purpose |
|------|---------|--------|---------|
| `contacts.json` | Yes | **Yes** (951 KB, 897 contacts) | Raw contact database |
| `graph.json` | Yes | **No** | Central scored network graph |
| `icp-config.json` | Yes | **No** | ICP profile definitions (5 profiles) |
| `behavioral-config.json` | Yes | **No** | Behavioral scoring weights/thresholds |
| `referral-config.json` | Yes | **No** | Referral scoring weights/personas/tiers |
| `network-report.html` | Yes | **No** | Generated HTML dashboard |
| `cache/index.json` | Yes | **No** | Cache manifest |
| `cache/search/*.html` | Yes | **No** | Cached search pages |
| `cache/profiles/*.html` | Yes | **No** | Cached profile pages |
| `cache/connections/*.html` | Yes | **No** | Cached connection pages |
| `snapshots/*.json` | Yes | **No** | Network state snapshots |

---

## 5. Pipeline Mode Coverage

The SPARC specification defines 10 pipeline modes. None are implemented.

| Mode | Planned Steps | Implemented | Gap |
|------|--------------|-------------|-----|
| `--full` | search -> enrich -> graph-builder -> scorer -> behavioral -> referral -> analyzer -> delta | **No** | Requires all scripts. search and enrich exist but pipeline.mjs does not. |
| `--rebuild` | graph-builder -> scorer -> behavioral -> referral -> analyzer -> delta | **No** | Requires 7 missing scripts. |
| `--rescore` | scorer -> behavioral -> referral -> analyzer | **No** | Requires 4 missing scripts. |
| `--behavioral` | behavioral -> analyzer(behavioral) -> analyzer(visibility) | **No** | Requires 2 missing scripts. |
| `--referrals` | referral-scorer -> analyzer(referrals) | **No** | Requires 2 missing scripts. |
| `--report` | report-generator | **No** | Requires 1 missing script. |
| `--deep-scan` | deep-scan -> graph-builder -> scorer -> behavioral -> referral -> report-gen | **No** | Requires 6 missing scripts. |
| `--configure` | configure.mjs interactive | **No** | Requires 1 missing script. |
| `--validate` | configure.mjs validate | **No** | Requires 1 missing script. |
| `--reparse` | reparse.mjs --all | **No** | Requires 1 missing script. |

**Current workaround**: Individual scripts (`search.mjs`, `enrich.mjs`, `db.mjs`, `sheets.mjs`) are run manually as standalone commands. There is no orchestrated pipeline.

---

## 6. Dependency Graph and Build Order

The following diagram shows the dependency chain and the recommended build order for the missing scripts. Numbers in brackets indicate the recommended implementation phase.

```
contacts.json (EXISTS - 897 contacts)
    |
    | [Phase 0: Config files must be created first]
    |
    v
icp-config.json [Phase 0] ----+
behavioral-config.json [Phase 0] --+
referral-config.json [Phase 0] ----+------+
    |                                      |
    v                                      |
graph-builder.mjs [Phase 1] ------------->|
    |                                      |
    | produces graph.json                  |
    v                                      |
scorer.mjs [Phase 1] ------------------->|
    |                                      |
    | adds scores.*, personaType, tags     |
    v                                      |
behavioral-scorer.mjs [Phase 1] -------->|
    |                                      |
    | adds behavioralScore, persona, v2    |
    v                                      |
referral-scorer.mjs [Phase 2] ---------->|
    |                                      |
    | adds referralLikelihood, tier, persona|
    v                                      v
+----------+    +---------+    +----------+    +---------+
|analyzer  |    |report-  |    |batch-deep|    |delta.mjs|
|.mjs      |    |generator|    |-scan.mjs |    |[Phase 3]|
|[Phase 2] |    |.mjs     |    |[Phase 3] |    |         |
|          |    |[Phase 2]|    |          |    |         |
+----------+    +---------+    +-----+----+    +---------+
                                     |
                                     v
                               deep-scan.mjs
                               [Phase 3]
                                     |
                                     v
                               cache.mjs
                               [Phase 3]

Standalone (no scoring dependencies):
  configure.mjs [Phase 0 or deferred]
  reparse.mjs [Phase 3]
  pipeline.mjs [Phase 2 - after scorers + analyzer exist]
```

### Recommended Build Phases

**Phase 0 -- Configuration Foundation (prerequisite)**
1. Create `icp-config.json` manually (5 ICP profiles, scoring weights, tier thresholds, niche definitions)
2. Create `behavioral-config.json` manually (6 component weights, persona definitions)
3. Create `referral-config.json` manually (6 component weights, role tiers, personas, industry targets)

**Phase 1 -- Core Scoring Pipeline (strict sequential)**
4. `graph-builder.mjs` -- builds graph.json from contacts.json
5. `scorer.mjs` -- Phase 1 ICP + network scoring
6. `behavioral-scorer.mjs` -- Phase 2 behavioral scoring

**Phase 2 -- Intelligence Layer (after Phase 1)**
7. `referral-scorer.mjs` -- Phase 3 referral scoring (can start during Phase 1 with mock data)
8. `analyzer.mjs` -- CLI analysis (10 modes)
9. `pipeline.mjs` -- pipeline orchestrator
10. `report-generator.mjs` -- HTML dashboard

**Phase 3 -- Network Expansion + Utilities (after Phase 2)**
11. `cache.mjs` -- HTML cache layer
12. `deep-scan.mjs` -- single-contact expansion
13. `batch-deep-scan.mjs` -- criteria-based batch scanning
14. `delta.mjs` -- snapshot and change tracking
15. `reparse.mjs` -- data reparsing from cache
16. `configure.mjs` -- config wizard (can defer if configs are manual)

---

## 7. Risk Assessment

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|------------|--------|------------|
| **Phase 1 blocking**: graph-builder must work correctly before any scoring can begin. A bug here blocks everything. | Critical | Medium | All downstream work blocked | Build graph-builder first, validate its output thoroughly before proceeding. Create a minimal viable version. |
| **Config file creation**: Three config files must exist before scoring can start. No wizard exists to create them. | High | High | Scoring scripts will crash without configs | Manually create config files with defaults from the SPARC docs. The spec has full schemas with example values. |
| **graph.json size**: 897 contacts will produce a multi-megabyte graph.json. JSON serialization could be slow. | Low | Low | Performance degradation | Current dataset (897 contacts) is well within the <5000 contact design limit. Not a concern at this scale. |
| **SPARC documentation drift**: The completion.md claims the system is "fully implemented" but it is not. Future developers may trust this claim. | Medium | High | Confusion, wasted effort investigating "broken" code | Update completion.md to reflect actual state, or clearly mark it as a design target document. |
| **Data model evolution**: contacts.json has extra fields (`source`, `currentInfo`, `pastInfo`, `enrichedAt`) not in the SPARC schema. graph-builder must handle these gracefully. | Low | Medium | Data loss or incorrect graph construction | graph-builder should pass through all existing fields plus add new ones (companyId, etc.). |
| **LinkedIn rate limiting**: Deep-scan features (Phase 3) risk account restrictions. | Medium | Medium | Account suspension, blocked scraping | Already mitigated in spec: configurable delays, max pages, dry-run mode. Implement these controls. |
| **Test infrastructure absence**: No tests exist. Building 13 scripts without tests risks fragile, untested code. | High | High | Bugs in scoring logic, incorrect tier assignments | Build test fixtures and unit tests for scoring functions in parallel with implementation (TDD approach from refinement.md). |
| **Scope creep**: The SPARC docs describe a very ambitious system. Attempting to build everything at once risks delivering nothing. | Medium | Medium | No usable output for weeks | Follow the phased build order. Each phase delivers usable functionality. Phase 1 alone provides scoring. |

---

## 8. Recommended Implementation Order

### Priority Matrix

| Phase | Scripts | Effort (hours) | Deliverable | Value |
|-------|---------|----------------|-------------|-------|
| **Phase 0** | 3 config files | 2-3h | Config foundation | Prerequisite |
| **Phase 1** | graph-builder, scorer, behavioral-scorer | 12-16h | Scored contacts in graph.json | **Core intelligence** -- contacts go from raw profiles to scored, tiered, persona-assigned entities |
| **Phase 2** | referral-scorer, analyzer, pipeline, report-generator | 18-24h | Full analysis + dashboard | **Full intelligence** -- referral scoring, 10 analysis modes, HTML dashboard, pipeline orchestration |
| **Phase 3** | cache, deep-scan, batch-deep-scan, delta, reparse, configure | 12-18h | Network expansion + utilities | **Growth loop** -- discover new contacts, track changes, automated scanning |
| **Testing** | Unit tests, integration tests, quality gates | 8-12h | Test suite | **Confidence** -- runs alongside all phases |
| **Total** | 13 scripts + 3 configs + tests | **52-73 hours** | Complete system | Full LinkedIn network intelligence platform |

### Recommended Sequence (Single Developer)

1. **Week 1**: Phase 0 (configs) + Phase 1 (graph-builder, scorer, behavioral-scorer) + basic tests
2. **Week 2**: Phase 2 (referral-scorer, analyzer, pipeline) + unit tests for scorers
3. **Week 3**: Phase 2 (report-generator) + Phase 3 (cache, deep-scan) + integration tests
4. **Week 4**: Phase 3 (batch-deep-scan, delta, reparse, configure) + quality gate tests

### Recommended Sequence (Multi-Agent / Parallel)

Following the SPARC orchestration plan with 5 parallel streams:

```
Stream A (Scoring):     graph-builder -> scorer -> behavioral -> referral  [Phase 1+2]
Stream B (Pipeline):    pipeline.mjs                                      [Phase 2, after A]
Stream C (Analysis):    analyzer.mjs + report-generator.mjs               [Phase 2, after A]
Stream D (Expansion):   cache + deep-scan + batch-deep-scan               [Phase 3, independent]
Stream E (Testing):     fixtures + unit tests + integration tests         [continuous]
```

Streams A, D, and E can begin immediately. Streams B and C begin after Stream A produces the scoring engine.

### Minimum Viable Product (MVP)

If time is constrained, the absolute minimum for a usable intelligence system is:

1. `icp-config.json` (manual creation, ~30 min)
2. `graph-builder.mjs` (~4h)
3. `scorer.mjs` (~4h)
4. `analyzer.mjs` with just `summary` and `prospects` modes (~3h)

This MVP would produce scored contacts with ICP fit, gold scores, tiers, and persona types, queryable via two analysis modes. Total effort: ~12 hours.

---

## Appendix A: File Location Reference

| Category | Path | Status |
|----------|------|--------|
| SPARC Documentation | `/home/aepod/dev/ctox/.sparc/specification.md` | Exists |
| SPARC Documentation | `/home/aepod/dev/ctox/.sparc/architecture.md` | Exists |
| SPARC Documentation | `/home/aepod/dev/ctox/.sparc/pseudocode.md` | Exists |
| SPARC Documentation | `/home/aepod/dev/ctox/.sparc/refinement.md` | Exists |
| SPARC Documentation | `/home/aepod/dev/ctox/.sparc/completion.md` | Exists |
| SPARC Documentation | `/home/aepod/dev/ctox/.sparc/orchestration.md` | Exists |
| Implemented Scripts | `/home/aepod/.claude/skills/linkedin-prospector/scripts/lib.mjs` | Exists (110 lines) |
| Implemented Scripts | `/home/aepod/.claude/skills/linkedin-prospector/scripts/db.mjs` | Exists (293 lines) |
| Implemented Scripts | `/home/aepod/.claude/skills/linkedin-prospector/scripts/search.mjs` | Exists (398 lines) |
| Implemented Scripts | `/home/aepod/.claude/skills/linkedin-prospector/scripts/enrich.mjs` | Exists (136 lines) |
| Implemented Scripts | `/home/aepod/.claude/skills/linkedin-prospector/scripts/sheets.mjs` | Exists (190 lines) |
| Contact Data | `/home/aepod/.claude/skills/linkedin-prospector/data/contacts.json` | Exists (951 KB, 897 contacts) |
| Missing Config | `/home/aepod/.claude/skills/linkedin-prospector/data/icp-config.json` | **MISSING** |
| Missing Config | `/home/aepod/.claude/skills/linkedin-prospector/data/behavioral-config.json` | **MISSING** |
| Missing Config | `/home/aepod/.claude/skills/linkedin-prospector/data/referral-config.json` | **MISSING** |
| Missing Data | `/home/aepod/.claude/skills/linkedin-prospector/data/graph.json` | **MISSING** |
| Missing Data | `/home/aepod/.claude/skills/linkedin-prospector/data/network-report.html` | **MISSING** |

## Appendix B: Discrepancy Between SPARC Completion Claims and Actual State

The `.sparc/completion.md` document contains several claims that are factually inaccurate relative to the actual codebase:

| Claim in completion.md | Actual State |
|------------------------|-------------|
| "referral-scorer.mjs (507 lines)" -- Status: PASS | File does not exist |
| "referral-config.json (105 lines)" -- Status: PASS | File does not exist |
| "pipeline.mjs -- Referral Integration (342 lines)" -- Status: PASS | File does not exist |
| "analyzer.mjs -- Referral Analysis Modes (697 lines)" -- Status: PASS | File does not exist |
| "report-generator.mjs -- Referral Dashboard Section (1762 lines)" -- Status: PASS | File does not exist |
| "batch-deep-scan.mjs -- Referral Criteria (301 lines)" -- Status: PASS | File does not exist |
| "897 contacts scored" | 0 contacts scored |
| "15 gold-referral, 203 silver-referral, 311 bronze-referral" | No referral tiers assigned |
| "109 white-label-partners, 149 amplifiers" | No personas assigned |
| "Pipeline --rescore: 4/4 steps passed" | Pipeline does not exist |

The SPARC documentation should be understood as a **design specification and implementation plan**, not a record of completed work. The completion.md appears to describe the intended output of a planned implementation session that either did not occur or whose output was not persisted to the file system.

## Appendix C: Structural Note on lib.mjs

The current `lib.mjs` includes Google Sheets API helpers (`getGoogleToken()`, `sheetsApi()`) and constants (`TOKEN_FILE`, `ADC_FILE`, `SPREADSHEET_ID`, `PROJECT`) that are not part of the SPARC specification. These exist because `sheets.mjs` (also not in the SPARC spec) uses them. The SPARC docs describe `lib.mjs` as containing only `parseArgs()` and `launchBrowser()` (68 lines). The actual file is 110 lines.

This is not a problem per se -- the Google Sheets integration is a valid feature -- but it represents a scope element that exists in implementation but not in the SPARC planning documents.
