# SPARC Specification: Referral Likelihood Scoring + Criteria-Driven Network Expansion

**System**: LinkedIn Network Intelligence Platform
**Phase**: S (Specification)
**Version**: 1.0
**Date**: 2026-03-09
**Status**: Approved for Implementation

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Functional Requirements](#2-functional-requirements)
3. [Non-Functional Requirements](#3-non-functional-requirements)
4. [Constraints](#4-constraints)
5. [Data Model](#5-data-model)
6. [Acceptance Criteria](#6-acceptance-criteria)
7. [Edge Cases](#7-edge-cases)
8. [Dependencies](#8-dependencies)
9. [Parallel Development Streams](#9-parallel-development-streams)
10. [Success Metrics](#10-success-metrics)

---

## 1. Introduction

### 1.1 Purpose

This specification defines the Referral Likelihood Scoring and Criteria-Driven Network Expansion system, an extension to an existing LinkedIn network intelligence platform. The system identifies which contacts in an N-contact, M-edge, K-cluster network graph are best positioned to **refer business** rather than buy directly. The key insight driving this system: agency owners, consultants, and ecosystem partners score low on ICP fit (they are not direct buyers) but represent the highest-value partnership channel for white-label deals, warm introductions, and mutual referral arrangements.

### 1.2 Scope

The system encompasses:

- A 6-component weighted referral likelihood scoring engine
- Configurable referral personas and tier classification
- Criteria-based deep-scan targeting for network expansion
- Integration into the existing pipeline orchestrator (full, rebuild, rescore, deep-scan modes)
- Analysis output for referral partner ranking with component breakdowns
- HTML report generation with referral-specific charts, stat cards, and tables
- Command routing for referral and expansion intents

### 1.3 Definitions

| Term | Definition |
|------|-----------|
| **Contact** | A LinkedIn profile stored in `contacts.json` and indexed in `graph.json` |
| **ICP Fit** | Ideal Customer Profile fit score (0-1) measuring how closely a contact matches the target buyer persona |
| **Gold Score** | Composite score (v2) blending ICP fit, network hub value, relationship strength, behavioral signals, and signal boost |
| **Referral Likelihood** | Composite score (0-1) measuring how likely a contact is to generate referral business |
| **Referral Persona** | Categorical classification of how a contact generates referrals: white-label-partner, warm-introducer, co-seller, amplifier, passive-referral |
| **Referral Tier** | Thresholded classification: gold-referral (>=0.65), silver-referral (>=0.45), bronze-referral (>=0.30), or none |
| **Buyer Inversion** | The principle that low ICP fit + high ecosystem presence indicates a referral partner rather than a direct buyer |
| **Deep Scan** | Browser automation that visits a contact's LinkedIn connections page to discover 2nd-degree contacts |
| **Bridge Contact** | A 2nd-degree contact discovered via multiple 1st-degree scans, indicating high-value hidden connections |
| **Degree** | Network distance: degree-1 = direct connection, degree-2 = discovered via deep-scan |
| **Pipeline Mode** | One of: full, rebuild, rescore, behavioral, referrals, report, deep-scan |

### 1.4 System Context

The referral scoring system sits in the scoring pipeline between `behavioral-scorer.mjs` and `analyzer.mjs`:

```
contacts.json
    |
    v
graph-builder.mjs  -->  graph.json (contacts, companies, clusters, edges)
    |
    v
scorer.mjs         -->  graph.json + { scores: { icpFit, networkHub, relationshipStrength, signalBoost, goldScore, tier }, personaType, tags }
    |
    v
behavioral-scorer.mjs --> graph.json + { behavioralScore, behavioralPersona, behavioralSignals }
    |
    v
referral-scorer.mjs --> graph.json + { scores.referralLikelihood, referralTier, referralPersona, referralSignals }
    |
    v
analyzer.mjs / report-generator.mjs / batch-deep-scan.mjs
```

---

## 2. Functional Requirements

### 2.1 Referral Scoring Engine (`referral-scorer.mjs`)

#### FR-2.1.1: Six-Component Weighted Scoring

The system SHALL compute a referral likelihood score as a weighted sum of six independent components:

| Component | Weight | Range | Description |
|-----------|--------|-------|-------------|
| `referralRole` | 0.25 | 0-1 | Agency/partner/consultant/advisor role detection via pattern matching against headline, currentRole, title, about fields. Three tiers: high (1.0), medium (0.7), low (0.3). |
| `clientOverlap` | 0.20 | 0-1 | Whether the contact serves the same target industries (ecommerce, DTC, SaaS, Shopify, etc.). Combined: industry keyword match (60%) + service provider signals (40%). |
| `networkReach` | 0.20 | 0-1 | Connection count normalized to 500, cluster breadth, and edge density. Sub-weights: connectionCount (0.3), clusterBreadth (0.4), edgeDensity (0.3). |
| `amplificationPower` | 0.15 | 0-1 | Super-connector traits, helping/connecting language in profile, content creation signals (speaker, author, podcast, keynote). |
| `relationshipWarmth` | 0.10 | 0-1 | Mutual connections (normalized by P90), existing relationship strength from scorer.mjs, and recency of connection. Sub-weights: mutuals (0.35), relStrength (0.35), recency (0.30). |
| `buyerInversion` | 0.10 | 0-1 | Low ICP fit inverted (1-icpFit) combined with ecosystem keyword presence. 50/50 split. High score means "ecosystem partner, not a buyer." |

The composite referral likelihood score SHALL be:

```
referralLikelihood = sum(component_score_i * weight_i) for i in [1..6]
```

All component scores and the composite score SHALL be capped at [0, 1] and rounded to 3 decimal places.

#### FR-2.1.2: Baselines Computation

The scorer SHALL compute P90-normalized baselines from the full contact set before scoring:

- **P90 mutuals**: 90th percentile of non-zero mutual connection counts, minimum 1
- **P90 edges**: 90th percentile of non-zero edge counts per contact, minimum 1
- **Edge counts**: Bidirectional count of graph edges per contact URL
- **Contact clusters**: Mapping of each contact URL to the cluster IDs it belongs to
- **Active clusters**: Count of clusters with at least one contact

#### FR-2.1.3: Referral Tier Assignment

The system SHALL assign a referral tier based on configurable thresholds:

| Tier | Threshold |
|------|-----------|
| `gold-referral` | referralLikelihood >= 0.65 |
| `silver-referral` | referralLikelihood >= 0.45 |
| `bronze-referral` | referralLikelihood >= 0.30 |
| `null` (no tier) | referralLikelihood < 0.30 |

Thresholds SHALL be configurable via `referral-config.json` at `referralTiers`.

#### FR-2.1.4: Referral Persona Assignment

The system SHALL assign exactly one referral persona per contact using a prioritized rule chain:

1. **white-label-partner**: Contact headline/about/role matches agency/consultancy/partner patterns AND referralRole score >= 0.7 AND clientOverlap score >= 0.4
2. **warm-introducer**: relationshipWarmth score >= 0.5 AND networkReach score >= 0.5
3. **co-seller**: Contact headline/about/role matches consultant/advisor/freelance/fractional patterns AND clientOverlap score >= 0.5
4. **amplifier**: amplificationPower score >= 0.5 OR behavioralPersona is super-connector or content-creator
5. **passive-referral**: Default fallback for all other contacts

The first matching persona wins; evaluation stops at the first match.

All persona thresholds and pattern lists SHALL be configurable via `referral-config.json` at `personas`.

#### FR-2.1.5: Output Storage

For each contact, the scorer SHALL write the following fields to `graph.json`:

- `contact.scores.referralLikelihood` (number, 0-1)
- `contact.referralTier` (string or null)
- `contact.referralPersona` (string)
- `contact.referralSignals` (object with per-component scores and match details)

The `referralSignals` object SHALL contain:

```
{
  referralRole: number,
  referralRoleMatch: string|null,     // matched pattern
  clientOverlap: number,
  clientOverlapIndustries: string[],  // matched industry keywords
  networkReach: number,
  networkReachDetail: {
    connections: number,
    clusters: number,
    edges: number
  },
  amplificationPower: number,
  amplificationSignals: string[],     // e.g. ["super-connector-traits", "helping-language"]
  relationshipWarmth: number,
  buyerInversion: number
}
```

#### FR-2.1.6: Graph Metadata Update

On completion, the scorer SHALL update `graph.meta.lastReferralScored` with an ISO 8601 timestamp and set `graph.meta.referralVersion` to 1.

#### FR-2.1.7: Summary Output

The scorer SHALL print to stdout:
- Total contacts scored
- Average referral likelihood
- Referral tier distribution (count and percentage with bar chart)
- Referral persona distribution (count and percentage, sorted descending)
- Top 10 referral partners (name, score, persona, tier, role score, overlap score)

### 2.2 Referral Configuration (`referral-config.json`)

#### FR-2.2.1: Configuration Schema

The configuration file SHALL contain the following top-level keys:

| Key | Type | Description |
|-----|------|-------------|
| `weights` | object | 6 numeric weights summing to 1.0 |
| `roleTiers` | object | Three tiers (high/medium/low) each with score and patterns array |
| `targetIndustries` | string[] | Industry keywords for client overlap detection |
| `industrySignals` | object | `servesTargetClients` (service provider signals) and `industryKeywords` |
| `referralTiers` | object | Three tier thresholds: gold-referral, silver-referral, bronze-referral |
| `personas` | object | Five persona definitions with requires constraints |
| `networkReachBaselines` | object | Normalization constants for network reach sub-components |

#### FR-2.2.2: Weight Validation

All six weights in `weights` SHALL sum to exactly 1.0 (within floating-point tolerance of 0.001). The scorer SHALL NOT validate weights at runtime but configuration tooling SHOULD enforce this.

### 2.3 Pipeline Integration (`pipeline.mjs`)

#### FR-2.3.1: Referral Scorer in Pipeline Modes

The referral-scorer step SHALL execute in these pipeline modes:

| Mode | Step Position | Preceded By | Followed By |
|------|--------------|-------------|-------------|
| `--full` | Step 6 of 8 | behavioral-scorer | analyzer (summary) |
| `--rebuild` | Step 4 of 6 | behavioral-scorer | analyzer (summary) |
| `--rescore` | Step 3 of 4 | behavioral-scorer | analyzer (summary) |
| `--referrals` | Step 1 of 2 | (standalone) | analyzer (referrals) |
| `--deep-scan` | Step 5 of 6 | behavioral-scorer | report-generator |

#### FR-2.3.2: Dependency Guard

The pipeline SHALL skip `referral-scorer.mjs` if `behavioral-scorer.mjs` fails, logging a SKIP message with the reason. The `behavioralOk` flag SHALL gate referral-scorer execution.

#### FR-2.3.3: Referrals-Only Mode

The pipeline SHALL support `--referrals` mode that runs only:
1. `referral-scorer.mjs`
2. `analyzer.mjs --mode referrals`

This mode assumes behavioral scores already exist on contacts.

### 2.4 Criteria-Driven Network Expansion (`batch-deep-scan.mjs`)

#### FR-2.4.1: Targeting Criteria

The batch deep-scan SHALL support four targeting criteria via `--criteria`:

| Criteria | Contacts Selected | Sort Order |
|----------|------------------|------------|
| `gold` (default) | All gold-tier contacts + top 5 ICP + top 5 hubs + top 5 behavioral + top 5 relationship | goldScore desc |
| `referral` | Gold-referral tier + warm-introducer/white-label-partner personas + top 10 silver-referral | referralLikelihood desc |
| `hub` | Top 10 by networkHub score | networkHub desc |
| `all` | Union of all criteria above | varies by category |

#### FR-2.4.2: Minimum Score Filter

The `--min-score` option SHALL filter contacts below the specified threshold (0-1) within the selected criteria. This applies to `referralLikelihood` for referral criteria, `networkHub` for hub criteria.

#### FR-2.4.3: Skip Already-Scanned

Contacts with `deepScanned: true` SHALL be excluded from all scan lists regardless of criteria.

#### FR-2.4.4: Deduplication

A single contact SHALL appear at most once in the scan list, tracked by URL. The first criteria match wins (e.g., a gold-referral contact also qualifying as a hub appears only under gold-referral).

#### FR-2.4.5: Post-Scan Rebuild

After all scans complete (at least 1 success), the system SHALL run:
1. `graph-builder.mjs`
2. `scorer.mjs`
3. `behavioral-scorer.mjs`
4. `referral-scorer.mjs`
5. `report-generator.mjs`

#### FR-2.4.6: Dry Run

The `--dry-run` flag SHALL print the prioritized scan list without executing any scans.

#### FR-2.4.7: Resumability

The `--skip N` flag SHALL skip the first N contacts in the scan list, enabling resumption after interruption.

### 2.5 Analysis Mode (`analyzer.mjs --mode referrals`)

#### FR-2.5.1: Referral Rankings

The referrals analysis mode SHALL display:
- Top N contacts sorted by referralLikelihood descending (default N=20, configurable via `--top`)
- Per-contact: name, score, tier, persona, ICP tier, all 6 component scores
- Per-contact "Why referral" explanation listing components above significance thresholds
- Support for `--persona` filter (e.g., `--persona white-label-partner`)
- Support for `--tier` filter (e.g., `--tier gold-referral`)

#### FR-2.5.2: Distribution Summaries

After the ranked list, the mode SHALL print:
- Referral tier breakdown (count per tier)
- Referral persona breakdown (count per persona, sorted descending)

### 2.6 Report Generation (`report-generator.mjs`)

#### FR-2.6.1: Referral Section in HTML Dashboard

The report SHALL include a "Referral Partners" section containing:
- Stat cards: gold-referral count, silver-referral count, bronze-referral count
- Referral score distribution histogram (10 buckets, 0-1 range)
- Referral persona donut chart
- Top 20 referral partners table with columns: Name, Referral Score, Ref Tier, Persona, Role, Overlap, Reach, Amp, Warmth, ICP Tier
- Clickable rows opening the contact modal with referral-specific fields

#### FR-2.6.2: Data Explorer Referrals Tab

The Data Explorer section SHALL include a "Referrals" tab showing all referral-scored contacts in a sortable table.

#### FR-2.6.3: Recommendations Section

The Recommended Actions section SHALL include a "Referral Partnerships" category with:
- Top 5 gold/silver referral partners
- Persona-specific action recommendations:
  - white-label-partner: "Propose white-label/reseller arrangement"
  - warm-introducer: "Ask for warm introductions to their network"
  - co-seller: "Set up mutual referral arrangement"
  - amplifier: "Engage their content + propose co-marketing"
  - passive-referral: "Deepen relationship before asking for referrals"

#### FR-2.6.4: Contact Modal Referral Fields

The contact detail modal SHALL display:
- Referral Score (0-1, 3 decimal places)
- Referral Tier (badge styled with tier color)
- Referral Persona

#### FR-2.6.5: Summary Mode Referral Data

The `analyzer.mjs --mode summary` output SHALL include referral tier counts and the top referral partner name/score when referral data exists.

### 2.7 Recommend Mode Integration (`analyzer.mjs --mode recommend`)

#### FR-2.7.1: Referral Partnerships Section

The recommend mode SHALL include a "Referral Partnerships" section showing top 5 gold/silver referral partners with persona-specific action suggestions.

### 2.8 Network Expansion Loop

#### FR-2.8.1: Iterative Discovery Workflow

The system SHALL support the following iterative expansion loop:

```
1. Score contacts (including referral scoring)
2. Identify high-value referral partners and network hubs
3. Deep-scan their LinkedIn connections (discovering 2nd-degree contacts)
4. Rebuild graph (new contacts added, discovered-connection edges created)
5. Rescore all contacts (including new degree-2 contacts)
6. Identify bridge contacts (discovered via multiple scans)
7. Repeat from step 2 with expanded network
```

Each iteration SHALL produce new `discovered-connection` edges (weight 0.9) and `shared-connection` edges (weight 0.7) between contacts whose connections lists overlap.

---

## 3. Non-Functional Requirements

### 3.1 Performance

| ID | Requirement | Measurement |
|----|------------|-------------|
| NFR-3.1.1 | Referral scoring SHALL complete within 5 seconds for 1,000 contacts | Wall-clock time from script start to JSON write |
| NFR-3.1.2 | Graph builder SHALL complete within 10 seconds for 2,000 contacts and 5,000 edges | Wall-clock time |
| NFR-3.1.3 | Report generation SHALL complete within 15 seconds for 2,000 contacts | Wall-clock time |
| NFR-3.1.4 | Full pipeline (rebuild mode) SHALL complete within 30 seconds excluding browser automation | Sum of step wall-clock times |
| NFR-3.1.5 | Individual pipeline steps SHALL timeout at 120 seconds | `execFileSync` timeout parameter |
| NFR-3.1.6 | Deep-scan steps SHALL timeout at 180 seconds | `execFileSync` timeout parameter |

### 3.2 Scalability

| ID | Requirement | Measurement |
|----|------------|-------------|
| NFR-3.2.1 | The system SHALL handle up to 5,000 contacts without degradation | Manual test with synthetic data |
| NFR-3.2.2 | The graph.json file SHALL remain under 100MB for 5,000 contacts | File size check |
| NFR-3.2.3 | Report HTML SHALL remain under 20MB for 2,000 graph nodes | File size check |
| NFR-3.2.4 | Baselines computation SHALL be O(n) for contacts and O(e) for edges | Code review |

### 3.3 Reliability

| ID | Requirement | Measurement |
|----|------------|-------------|
| NFR-3.3.1 | Pipeline dependency guards SHALL prevent cascading failures | Downstream steps skipped when upstream fails |
| NFR-3.3.2 | Batch deep-scan SHALL continue after individual scan failures | Success count vs failure count in summary |
| NFR-3.3.3 | Missing optional fields SHALL default to 0, null, or empty array without errors | No unhandled exceptions on sparse data |
| NFR-3.3.4 | The scorer SHALL validate that behavioral scores exist before running | Process exit with error message if missing |

### 3.4 Maintainability

| ID | Requirement | Measurement |
|----|------------|-------------|
| NFR-3.4.1 | All scoring weights and thresholds SHALL be configurable via JSON, not hardcoded | Code review of referral-config.json usage |
| NFR-3.4.2 | Each scoring component SHALL be an independent function | One function per component, no shared mutable state |
| NFR-3.4.3 | No script SHALL exceed 500 lines | `wc -l` check |
| NFR-3.4.4 | All scripts SHALL use ESM import/export syntax | No `require()` calls |

### 3.5 Observability

| ID | Requirement | Measurement |
|----|------------|-------------|
| NFR-3.5.1 | `--verbose` flag SHALL log per-contact scoring details | Visual inspection of verbose output |
| NFR-3.5.2 | Pipeline summary SHALL show pass/fail/skip status for each step | Pipeline stdout output |
| NFR-3.5.3 | Batch deep-scan SHALL log per-scan results and running totals | Scan output format |

---

## 4. Constraints

### 4.1 Technical Constraints

| ID | Constraint | Rationale |
|----|-----------|-----------|
| TC-001 | ESM modules only (`.mjs` extension, `import`/`export` syntax) | Project standard; no CommonJS `require()` |
| TC-002 | Node.js 18+ runtime | Minimum version for stable ESM support, `??=` operator, structuredClone |
| TC-003 | No external database | All data stored as JSON files in `data/` directory |
| TC-004 | Single-threaded execution | Node.js main thread; no worker threads or child process parallelism for scoring |
| TC-005 | JSON file I/O via `fs.readFileSync` / `writeFileSync` | Synchronous reads for simplicity; atomic writes |
| TC-006 | Playwright Chromium for browser automation | LinkedIn scraping requires real browser with persistent session |
| TC-007 | All paths relative to `__dirname` via `fileURLToPath(import.meta.url)` | ESM does not support `__dirname` natively |
| TC-008 | Data directory at `../data/` relative to scripts | Fixed directory structure: `scripts/` and `data/` are siblings |

### 4.2 Business Constraints

| ID | Constraint | Rationale |
|----|-----------|-----------|
| BC-001 | LinkedIn rate limiting requires delays between deep-scans (default 10s) | Avoid account restrictions |
| BC-002 | Deep-scan pages limited to 3 per contact by default | Balances coverage vs rate limit risk |
| BC-003 | Maximum 50 connections discovered per deep-scan by default | Prevents runaway scraping |
| BC-004 | LinkedIn session must be manually established via browser login | No automated login; OAuth not available for scraping |
| BC-005 | No PII export; all data stays in local JSON files | Privacy compliance |

### 4.3 Dependency Constraints

| ID | Constraint | Rationale |
|----|-----------|-----------|
| DC-001 | `referral-scorer.mjs` requires `graph.json` with behavioral scores | Depends on behavioral-scorer.mjs output |
| DC-002 | `referral-scorer.mjs` requires `referral-config.json` and `icp-config.json` | Configuration files must exist |
| DC-003 | `batch-deep-scan.mjs` requires scored `graph.json` with referral data for `--criteria referral` | Referral fields must exist for referral targeting |
| DC-004 | Report generator requires graph.json with all scoring layers | Renders referral data if present, gracefully omits if absent |

---

## 5. Data Model

### 5.1 Contact Schema (within `graph.json`)

Each contact is keyed by LinkedIn profile URL in `graph.contacts`:

```yaml
Contact:
  # Identity (set by search/enrich)
  name: string                    # Raw name from LinkedIn
  enrichedName: string|undefined  # Name after enrichment
  headline: string|undefined      # LinkedIn headline
  title: string|undefined         # Parsed title
  about: string|undefined         # About section text
  currentRole: string|undefined   # Current job title
  currentCompany: string|undefined # Current employer
  companyId: string|null          # Normalized company key
  enrichedLocation: string|undefined
  location: string|undefined
  connections: string|undefined   # Raw "500+ connections" string
  connectedTime: string|undefined # "Connected on March 5, 2026"
  mutualConnections: number       # Parsed mutual connection count
  searchTerms: string[]           # Keywords that surfaced this contact
  tags: string[]                  # Derived tags (decision-maker, ecommerce, etc.)
  enriched: boolean               # Whether profile was visited for enrichment
  cachedAt: string|undefined      # ISO timestamp of last cache

  # Network metadata (set by deep-scan/graph-builder)
  degree: number                  # 1 = direct, 2 = discovered via deep-scan
  discoveredVia: string[]         # URLs of contacts whose scans found this contact
  discoveredAt: string|undefined  # ISO timestamp of discovery
  source: string|undefined        # e.g. "deep-scan:https://linkedin.com/in/someone"
  deepScanned: boolean            # Whether this contact's connections were scanned
  deepScannedAt: string|undefined
  deepScanResults: number|undefined

  # Phase 1 scores (set by scorer.mjs)
  scores:
    icpFit: number                # 0-1, ICP profile match
    networkHub: number            # 0-1, network centrality
    relationshipStrength: number  # 0-1, connection warmth
    signalBoost: number           # 0-1, trending keyword match
    goldScore: number             # 0-1, composite (v2 after behavioral)
    goldScoreV1: number           # 0-1, original v1 before behavioral reweight
    tier: string                  # gold | silver | bronze | watch
    behavioral: number            # 0-1, copy of behavioralScore (set by behavioral-scorer)
    referralLikelihood: number    # 0-1, referral composite (set by referral-scorer)

  personaType: string             # buyer | advisor | hub | peer | referral-partner
  icpCategories: string[]         # ICP profile keys with fit >= 0.4

  # Behavioral layer (set by behavioral-scorer.mjs)
  behavioralScore: number         # 0-1, composite behavioral score
  behavioralPersona: string       # super-connector | content-creator | silent-influencer | rising-connector | passive-network
  behavioralSignals:
    connectionCount: number
    connectionPower: number
    connectionRecency: number
    connectedDaysAgo: number|null
    aboutSignals: string[]
    headlineSignals: string[]
    superConnectorTraits: string[]
    traitCount: number
    amplification: number

  # Referral layer (set by referral-scorer.mjs)
  referralTier: string|null       # gold-referral | silver-referral | bronze-referral | null
  referralPersona: string         # white-label-partner | warm-introducer | co-seller | amplifier | passive-referral
  referralSignals:
    referralRole: number
    referralRoleMatch: string|null
    clientOverlap: number
    clientOverlapIndustries: string[]
    networkReach: number
    networkReachDetail:
      connections: number
      clusters: number
      edges: number
    amplificationPower: number
    amplificationSignals: string[]
    relationshipWarmth: number
    buyerInversion: number
```

### 5.2 Graph Structure (`graph.json`)

```yaml
Graph:
  contacts: object                # { [url: string]: Contact }
  companies: object               # { [companyKey: string]: { name: string, contacts: string[] } }
  clusters: object                # { [clusterId: string]: { label, keywords, contacts: string[], hubContacts: string[] } }
  edges: Edge[]                   # Array of all graph edges
  meta:
    totalContacts: number
    lastBuilt: string             # ISO timestamp
    lastScored: string            # ISO timestamp
    scoringVersion: number
    lastBehavioralScored: string  # ISO timestamp
    behavioralVersion: number
    lastReferralScored: string    # ISO timestamp
    referralVersion: number
    version: number

Edge:
  source: string                  # Contact URL
  target: string                  # Contact URL
  type: string                    # same-company | same-cluster | mutual-proximity | discovered-connection | shared-connection
  weight: number                  # 0-1 (same-company=0.8, same-cluster=0.3, mutual-proximity=0.5, discovered-connection=0.9, shared-connection=0.7)
```

### 5.3 Referral Configuration (`referral-config.json`)

```yaml
ReferralConfig:
  weights:
    referralRole: 0.25
    clientOverlap: 0.20
    networkReach: 0.20
    amplificationPower: 0.15
    relationshipWarmth: 0.10
    buyerInversion: 0.10

  roleTiers:
    high:
      score: 1.0
      patterns: string[]          # ["agency", "digital agency", "consultancy", ...]
    medium:
      score: 0.7
      patterns: string[]          # ["consultant", "freelance", "broker", ...]
    low:
      score: 0.3
      patterns: string[]          # ["manager", "director", "founder", ...]

  targetIndustries: string[]      # ["ecommerce", "retail", "dtc", "saas", ...]

  industrySignals:
    servesTargetClients: string[] # ["agency", "consultancy", "solutions provider", ...]
    industryKeywords: string[]    # ["ecommerce", "retail", "ai", ...]

  referralTiers:
    gold-referral: 0.65
    silver-referral: 0.45
    bronze-referral: 0.30

  personas:
    white-label-partner:
      description: string
      requires:
        minReferralRole: number
        minClientOverlap: number
        rolePatterns: string[]
    warm-introducer:
      description: string
      requires:
        minRelationshipWarmth: number
        minNetworkReach: number
    co-seller:
      description: string
      requires:
        minClientOverlap: number
        rolePatterns: string[]
    amplifier:
      description: string
      requires:
        minAmplificationPower: number
        behavioralPersonas: string[]
    passive-referral:
      description: string
      requires: {}

  networkReachBaselines:
    connectionCountNorm: 500
    clusterBreadthWeight: 0.4
    edgeDensityWeight: 0.3
    connectionCountWeight: 0.3
```

### 5.4 Cluster Definitions

10 predefined clusters with keyword-based membership:

| Cluster ID | Keywords |
|-----------|----------|
| dtc | dtc, direct to consumer, d2c |
| ecommerce | ecommerce, e-commerce, digital commerce, online retail, commerce |
| saas | saas, software as a service, platform |
| adobe-commerce | adobe commerce, magento |
| shopify | shopify |
| agency | agency, studio, consultancy |
| php | php, zend, laravel, symfony, laminas |
| retail | retail, omnichannel |
| consulting | consultant, consulting, advisor, advisory |
| technology | technology, tech, engineering, developer, software |

Contacts MAY belong to multiple clusters simultaneously.

---

## 6. Acceptance Criteria

### 6.1 Referral Scorer

```gherkin
Feature: Referral Likelihood Scoring

  Scenario: Score all contacts with referral likelihood
    Given graph.json contains N contacts with behavioral scores
    And referral-config.json exists with valid weights summing to 1.0
    And icp-config.json exists
    When I run "node referral-scorer.mjs"
    Then all N contacts SHALL have scores.referralLikelihood between 0 and 1
    And all contacts SHALL have a referralPersona assigned
    And contacts with referralLikelihood >= 0.65 SHALL have referralTier "gold-referral"
    And contacts with referralLikelihood >= 0.45 and < 0.65 SHALL have referralTier "silver-referral"
    And contacts with referralLikelihood >= 0.30 and < 0.45 SHALL have referralTier "bronze-referral"
    And contacts with referralLikelihood < 0.30 SHALL have referralTier null
    And graph.meta.lastReferralScored SHALL be a valid ISO timestamp

  Scenario: Agency owner scores high on referral, low on ICP
    Given a contact with headline "Agency Owner | Digital Marketing Consultancy"
    And the contact has icpFit of 0.15
    And the contact serves ecommerce and retail industries
    When the referral scorer runs
    Then the contact SHALL have referralRole score >= 0.7
    And the contact SHALL have clientOverlap score >= 0.4
    And the contact SHALL have buyerInversion score >= 0.4
    And the contact SHALL have referralLikelihood >= 0.45
    And the contact SHALL have referralPersona "white-label-partner"

  Scenario: Super-connector with broad network scores as amplifier
    Given a contact with behavioralPersona "super-connector"
    And the contact has traitCount >= 3
    And the contact has 500+ connections
    And the contact has amplificationPower score >= 0.5
    When the referral scorer runs
    Then the contact SHALL have referralPersona "amplifier"

  Scenario: Warm relationship with broad reach
    Given a contact with relationshipWarmth score >= 0.5
    And the contact has networkReach score >= 0.5
    And the contact does NOT match agency/consultancy patterns
    When the referral scorer runs
    Then the contact SHALL have referralPersona "warm-introducer"

  Scenario: Missing behavioral scores
    Given graph.json exists but contacts lack behavioralScore
    When I run "node referral-scorer.mjs"
    Then the process SHALL exit with code 1
    And stderr SHALL contain "Behavioral scores not found"

  Scenario: Verbose mode shows per-contact details
    Given graph.json with scored contacts
    When I run "node referral-scorer.mjs --verbose"
    Then stdout SHALL contain per-contact log lines with ref=, persona=, tier=, role=, overlap= values
```

### 6.2 Referral Configuration

```gherkin
Feature: Referral Configuration

  Scenario: Weights sum to 1.0
    Given referral-config.json with weights {referralRole:0.25, clientOverlap:0.20, networkReach:0.20, amplificationPower:0.15, relationshipWarmth:0.10, buyerInversion:0.10}
    Then the sum of all weights SHALL equal 1.0

  Scenario: Role tiers cover expected patterns
    Given referral-config.json roleTiers
    Then high tier SHALL contain "agency" and "partner" and "advisor"
    And medium tier SHALL contain "consultant" and "freelance" and "ecosystem"
    And low tier SHALL contain "manager" and "director" and "founder"

  Scenario: Tier thresholds are ordered
    Given referral-config.json referralTiers
    Then gold-referral threshold SHALL be > silver-referral threshold
    And silver-referral threshold SHALL be > bronze-referral threshold
    And bronze-referral threshold SHALL be > 0
```

### 6.3 Pipeline Integration

```gherkin
Feature: Pipeline Referral Integration

  Scenario: Rebuild mode includes referral scoring
    When I run "node pipeline.mjs --rebuild"
    Then the pipeline SHALL execute referral-scorer.mjs as step 4
    And the pipeline summary SHALL show referral-scorer.mjs as OK

  Scenario: Referral scorer skipped when behavioral fails
    Given behavioral-scorer.mjs will fail (e.g., missing config)
    When I run "node pipeline.mjs --rebuild"
    Then referral-scorer.mjs SHALL be SKIPPED
    And the pipeline summary SHALL show referral-scorer.mjs as SKIPPED with reason "behavioral-scorer failed"

  Scenario: Referrals-only mode
    Given graph.json with existing behavioral scores
    When I run "node pipeline.mjs --referrals"
    Then only referral-scorer.mjs and analyzer.mjs (referrals) SHALL execute
    And the pipeline SHALL complete with 2 steps passed

  Scenario: Deep-scan mode includes referral scoring in rebuild
    When I run "node pipeline.mjs --deep-scan --url https://linkedin.com/in/someone"
    Then the post-scan rebuild SHALL include referral-scorer.mjs
```

### 6.4 Batch Deep-Scan Criteria

```gherkin
Feature: Criteria-Driven Deep Scan Targeting

  Scenario: Referral criteria targeting
    Given graph.json with referral-scored contacts
    When I run "node batch-deep-scan.mjs --criteria referral --dry-run"
    Then the scan list SHALL include gold-referral tier contacts
    And the scan list SHALL include warm-introducer personas
    And the scan list SHALL include white-label-partner personas
    And the scan list SHALL NOT include deepScanned contacts
    And each contact SHALL appear at most once

  Scenario: Minimum score filter
    Given graph.json with referral-scored contacts
    When I run "node batch-deep-scan.mjs --criteria referral --min-score 0.5 --dry-run"
    Then all listed contacts SHALL have referralLikelihood >= 0.5

  Scenario: Hub criteria targeting
    When I run "node batch-deep-scan.mjs --criteria hub --dry-run"
    Then the scan list SHALL contain up to 10 contacts sorted by networkHub descending

  Scenario: All criteria union
    When I run "node batch-deep-scan.mjs --criteria all --dry-run"
    Then the scan list SHALL include contacts from gold, referral, and hub criteria
    And each contact SHALL appear only once

  Scenario: Skip already scanned
    Given a gold-referral contact with deepScanned: true
    When I run "node batch-deep-scan.mjs --criteria referral --dry-run"
    Then that contact SHALL NOT appear in the scan list
```

### 6.5 Analysis and Reporting

```gherkin
Feature: Referral Analysis Output

  Scenario: Referrals analysis mode
    When I run "node analyzer.mjs --mode referrals"
    Then stdout SHALL list top 20 referral partners by score
    And each entry SHALL show: name, referralLikelihood, tier, persona, 6 component scores
    And each entry SHALL show "Why referral" explanation
    And stdout SHALL show referral tier breakdown counts
    And stdout SHALL show referral persona breakdown counts

  Scenario: Persona filter
    When I run "node analyzer.mjs --mode referrals --persona white-label-partner"
    Then all listed contacts SHALL have referralPersona "white-label-partner"

  Scenario: Summary includes referral data
    Given graph.json with referral scores
    When I run "node analyzer.mjs --mode summary"
    Then stdout SHALL include "Referral Partners: Gold: N | Silver: N | Bronze: N"
    And stdout SHALL include the top referral partner name and score

Feature: Report Referral Section

  Scenario: HTML report contains referral section
    Given graph.json with referral scores
    When I run "node report-generator.mjs"
    Then the output HTML SHALL contain element with id "referral-partners"
    And the HTML SHALL contain element with id "referral-stat-cards"
    And the HTML SHALL contain element with id "chart-ref-score"
    And the HTML SHALL contain element with id "chart-ref-persona"
    And the HTML SHALL contain element with id "referral-table"

  Scenario: Report data includes referral fields
    Given graph.json with referral scores
    When I run "node report-generator.mjs"
    Then the embedded DATA object SHALL contain referralTierCounts
    And DATA SHALL contain referralPersonaCounts
    And DATA SHALL contain refScoreDist with labels and counts
    And DATA SHALL contain topReferrals array with up to 20 entries
```

---

## 7. Edge Cases

### 7.1 Missing or Sparse Data

| ID | Edge Case | Expected Behavior |
|----|-----------|-------------------|
| EC-001 | Contact has no headline, title, about, or currentRole | All text-matching components score 0; referralPersona defaults to "passive-referral" |
| EC-002 | Contact has no behavioral signals (behavioralSignals undefined) | referral-scorer.mjs SHALL exit with error before scoring (dependency guard) |
| EC-003 | Contact has mutualConnections of 0 | relationshipWarmth mutualScore = 0; networkReach edgeCount may still contribute |
| EC-004 | Contact has no connections string | amplificationPower traitCount uses 0; connectionCount = 0 |
| EC-005 | Contact belongs to zero clusters | networkReach clusterScore = 0; overall networkReach reduced |
| EC-006 | Contact has no graph edges | networkReach edgeScore = 0 |
| EC-007 | Contact has scores.icpFit undefined | buyerInversion uses 0, producing invertedIcp of 1.0 (maximum inversion). This is acceptable as truly unknown contacts should lean toward "not a buyer" |
| EC-008 | Contact has no connectedTime | relationshipWarmth recencyScore defaults to 0.1 |
| EC-009 | Contact has no discoveredVia array | Treated as degree-1 contact; no bridge detection |

### 7.2 Configuration Edge Cases

| ID | Edge Case | Expected Behavior |
|----|-----------|-------------------|
| EC-010 | referral-config.json does not exist | referral-scorer.mjs exits with error and message |
| EC-011 | referral-config.json weights do not sum to 1.0 | Scoring proceeds with given weights (no runtime validation); results may be skewed |
| EC-012 | roleTiers.high.patterns is empty | No contact matches high tier; medium and low tiers still evaluated |
| EC-013 | All persona thresholds set very high (e.g., 0.99) | Most contacts get "passive-referral" persona |
| EC-014 | targetIndustries is empty | clientOverlap industryScore = 0 for all contacts; serviceScore may still contribute |

### 7.3 Graph Edge Cases

| ID | Edge Case | Expected Behavior |
|----|-----------|-------------------|
| EC-015 | graph.json has zero contacts | referral-scorer.mjs exits with error "No contacts in graph.json" |
| EC-016 | graph.json has contacts but zero edges | P90 edges = 1 (minimum floor); networkReach edgeScore = 0 for all contacts |
| EC-017 | graph.json has contacts but zero clusters | activeClusters = 0; networkReach clusterScore uses floor of 1 in divisor |
| EC-018 | All contacts have identical scores | Tier distribution depends solely on threshold values |
| EC-019 | graph.json is malformed JSON | readFileSync + JSON.parse throws; process crashes with stack trace |

### 7.4 Pipeline Edge Cases

| ID | Edge Case | Expected Behavior |
|----|-----------|-------------------|
| EC-020 | referral-scorer.mjs exceeds 120s timeout | Pipeline reports FAILED status for step; subsequent steps may still run if not dependent |
| EC-021 | Running --referrals mode without prior behavioral scoring | referral-scorer.mjs detects missing behavioralScore on first contact and exits with error |
| EC-022 | Batch deep-scan with all contacts already deep-scanned | Scan list is empty; message "No contacts to scan" printed; no post-scan rebuild |
| EC-023 | Batch deep-scan with 0 successful scans | Post-scan rebuild is skipped (requires successCount > 0) |
| EC-024 | Deep-scan target URL not in contacts.json | Warning printed but scan proceeds; contact not marked as deepScanned |

### 7.5 Scoring Boundary Cases

| ID | Edge Case | Expected Behavior |
|----|-----------|-------------------|
| EC-025 | Contact matches all high-tier role patterns | referralRole.score = 1.0 (first match wins; only first matched pattern stored) |
| EC-026 | Contact matches 10+ industry keywords | clientOverlap industryScore capped at 1.0 (cap at 3 matches); combined score capped at 1.0 |
| EC-027 | Contact has P90-level mutual connections | relationshipWarmth mutualScore = 1.0 (capped) |
| EC-028 | Contact qualifies for both white-label-partner and warm-introducer | white-label-partner wins (evaluated first in priority chain) |
| EC-029 | referralLikelihood exactly equals tier threshold (e.g., 0.65) | Contact IS assigned to that tier (>= comparison) |

---

## 8. Dependencies

### 8.1 Script Dependency Graph

```
contacts.json (raw data)
    |
    v
graph-builder.mjs
    |
    v
scorer.mjs -----> requires: graph.json, icp-config.json
    |
    v
behavioral-scorer.mjs -----> requires: graph.json (with scores), behavioral-config.json, icp-config.json
    |
    v
referral-scorer.mjs -----> requires: graph.json (with behavioralScore), referral-config.json, icp-config.json
    |
    +-----> analyzer.mjs -----> requires: graph.json (with any scoring layer present)
    |
    +-----> report-generator.mjs -----> requires: graph.json (with any scoring layer present)
    |
    +-----> batch-deep-scan.mjs -----> requires: graph.json (with scores; referral fields needed for --criteria referral)
                |
                +-----> deep-scan.mjs -----> requires: Playwright, LinkedIn session, contacts.json
                |
                +-----> post-scan rebuild: graph-builder -> scorer -> behavioral -> referral -> report
```

### 8.2 File Dependencies

| File | Required By | Produced By |
|------|------------|-------------|
| `contacts.json` | graph-builder.mjs, deep-scan.mjs, db.mjs | search.mjs, enrich.mjs, deep-scan.mjs |
| `graph.json` | scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs, analyzer.mjs, report-generator.mjs, batch-deep-scan.mjs | graph-builder.mjs (then mutated by scorer, behavioral-scorer, referral-scorer) |
| `icp-config.json` | scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs, lib.mjs | configure.mjs (wizard/init) |
| `behavioral-config.json` | behavioral-scorer.mjs | Manual creation or configure.mjs |
| `referral-config.json` | referral-scorer.mjs | Manual creation |
| `network-report.html` | (end-user browser) | report-generator.mjs |

### 8.3 Runtime Dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| Node.js | >= 18.0 | ESM support, fs, child_process, path, url modules |
| Playwright | >= 1.40 | Browser automation for search, enrich, deep-scan |
| Chromium | (via Playwright) | LinkedIn page rendering |

### 8.4 Implicit Data Dependencies

The referral scorer reads the following fields set by upstream scorers:

| Field | Set By | Used In Component |
|-------|--------|------------------|
| `contact.behavioralScore` | behavioral-scorer.mjs | Dependency guard (must exist) |
| `contact.behavioralSignals.traitCount` | behavioral-scorer.mjs | amplificationPower |
| `contact.behavioralSignals.connectionCount` | behavioral-scorer.mjs | networkReach |
| `contact.behavioralSignals.connectedDaysAgo` | behavioral-scorer.mjs | relationshipWarmth |
| `contact.behavioralPersona` | behavioral-scorer.mjs | Persona assignment (amplifier) |
| `contact.scores.icpFit` | scorer.mjs | buyerInversion |
| `contact.scores.relationshipStrength` | scorer.mjs | relationshipWarmth |
| `contact.mutualConnections` | graph-builder.mjs (from contacts.json) | relationshipWarmth, baselines |
| `graph.edges` | graph-builder.mjs | baselines (edge counts) |
| `graph.clusters` | graph-builder.mjs | baselines (cluster membership) |

---

## 9. Parallel Development Streams

The following five streams can be developed concurrently after this specification is approved. Interface contracts between streams are defined by the data model (Section 5) and file I/O boundaries.

### Stream A: Scoring Engine

**Scope**: `referral-scorer.mjs` + `referral-config.json`

**Tasks**:
1. Create `referral-config.json` with all weights, role tiers, personas, thresholds
2. Implement `loadFiles()` with existence checks and error messages
3. Implement `computeBaselines()` for P90 mutuals, P90 edges, edge counts, cluster membership, active cluster count
4. Implement 6 scoring functions: `scoreReferralRole`, `scoreClientOverlap`, `scoreNetworkReach`, `scoreAmplificationPower`, `scoreRelationshipWarmth`, `scoreBuyerInversion`
5. Implement `assignReferralPersona()` with priority chain evaluation
6. Implement main `score()` function: load, compute baselines, iterate contacts, compute composite, assign tier/persona, write graph.json
7. Implement summary output with tier distribution, persona distribution, top 10 list

**Interface Contract**:
- **Input**: `graph.json` (with `behavioralScore` on contacts), `referral-config.json`, `icp-config.json`
- **Output**: `graph.json` mutated with `scores.referralLikelihood`, `referralTier`, `referralPersona`, `referralSignals` on each contact; `meta.lastReferralScored` and `meta.referralVersion` updated

**Dependencies**: None (can be developed against mock graph.json data)

**Estimated Effort**: 3-4 hours

### Stream B: Pipeline Integration

**Scope**: Modifications to `pipeline.mjs`

**Tasks**:
1. Add `referral-scorer.mjs` step to `full`, `rebuild`, `rescore`, and `deep-scan` mode step lists
2. Add `behavioralOk` dependency guard for referral-scorer step
3. Add `--referrals` mode with 2-step pipeline: referral-scorer + analyzer(referrals)
4. Add referral-scorer to batch-deep-scan post-scan rebuild step list
5. Verify pipeline summary correctly reports referral-scorer status

**Interface Contract**:
- **Input**: Pipeline CLI args (`--full`, `--rebuild`, `--rescore`, `--referrals`, `--deep-scan`)
- **Output**: Sequential execution of scripts via `execFileSync` with dependency guards; summary report

**Dependencies**: Stream A must define the script name and CLI interface (already specified: `referral-scorer.mjs [--verbose]`)

**Estimated Effort**: 1-2 hours

### Stream C: Analysis and Reporting

**Scope**: Modifications to `analyzer.mjs` and `report-generator.mjs`

**Tasks (Analyzer)**:
1. Implement `modeReferrals()` function with ranked list, component breakdowns, "Why referral" explanations
2. Add `--persona` and `--tier` filter support to referrals mode
3. Add referral tier and persona summary sections
4. Integrate referral partnerships into `modeRecommend()` with persona-specific action suggestions
5. Add referral tier counts and top referral to `modeSummary()`
6. Register `referrals` in MODES dispatch table

**Tasks (Report Generator)**:
1. Compute `referralTierCounts`, `referralPersonaCounts`, `refScoreDist`, `topReferrals` in `computeReportData()`
2. Add referral fields to `nodes` and `tableContacts` arrays
3. Generate "Referral Partners" HTML section with stat cards, histograms, persona donut, top-20 table
4. Add referrals tab to Data Explorer
5. Add referral fields to contact modal
6. Add Referral Partnerships category to recommendations
7. Add sidebar navigation link to referral section

**Interface Contract**:
- **Input**: `graph.json` with `scores.referralLikelihood`, `referralTier`, `referralPersona`, `referralSignals` on contacts
- **Output**: Formatted stdout (analyzer) or HTML file (report-generator)

**Dependencies**: Depends on Stream A's output schema (defined in Section 5.1). Can be developed against mock data matching the schema.

**Estimated Effort**: 4-6 hours

### Stream D: Network Expansion

**Scope**: Modifications to `batch-deep-scan.mjs`

**Tasks**:
1. Add `--criteria referral` support to `buildScanList()`: gold-referral tier, warm-introducer/white-label-partner personas, silver-referral top 10
2. Add `--criteria hub` support: top 10 by networkHub
3. Add `--criteria all` union support
4. Add `--min-score` filter parameter
5. Read `referralLikelihood`, `referralTier`, `referralPersona` from graph.json contacts
6. Add referral-scorer.mjs to post-scan rebuild step list
7. Ensure `--dry-run` displays referral criteria reason labels correctly

**Interface Contract**:
- **Input**: `graph.json` with referral scores (for `--criteria referral`), CLI args
- **Output**: Sequential deep-scans followed by full rebuild pipeline

**Dependencies**: Depends on Stream A's output being present in graph.json for referral criteria mode. Gold and hub criteria work without referral data.

**Estimated Effort**: 2-3 hours

### Stream E: Testing and Validation

**Scope**: Test data generation, integration tests, validation scripts

**Tasks**:
1. Create synthetic graph.json with known scoring inputs for deterministic output verification
2. Write unit tests for each of the 6 scoring component functions
3. Write unit tests for persona assignment priority chain
4. Write unit tests for tier assignment boundary conditions
5. Write integration test: pipeline --referrals produces expected output
6. Write integration test: batch-deep-scan --criteria referral --dry-run produces correct scan list
7. Write validation script to verify referral-config.json weight sum, tier ordering, and persona completeness
8. Test edge cases from Section 7 (sparse data, missing fields, empty clusters, zero scores)
9. Measure performance with 1000-contact synthetic dataset

**Interface Contract**:
- **Input**: Test fixtures (mock graph.json, referral-config.json, icp-config.json)
- **Output**: Pass/fail assertions with descriptive messages

**Dependencies**: Stream A must be complete for integration testing. Unit tests for scoring functions can start immediately using extracted function signatures.

**Estimated Effort**: 3-4 hours

### Stream Integration Order

```
        Stream A (Scoring Engine)
       /           |             \
      /            |              \
Stream B       Stream C        Stream D
(Pipeline)   (Analysis/Report) (Expansion)
      \            |              /
       \           |             /
        Stream E (Testing & Validation)
```

Streams B, C, and D can develop in parallel once Stream A's interface contract is established (the contract is fully defined in this specification). Stream E spans the entire development but can begin unit tests immediately.

---

## 10. Success Metrics

### 10.1 Functional Success

| Metric | Target | Measurement |
|--------|--------|-------------|
| All N contacts scored | 100% | Count of contacts with referralLikelihood != undefined |
| Persona coverage | 5 distinct personas assigned | Count of unique referralPersona values |
| Tier distribution spread | At least 3 tiers populated | Count of non-zero tier buckets |
| Agency owners identified | >= 10 contacts as white-label-partner | Count of white-label-partner personas |
| Pipeline modes operational | 6 modes include referral step | Manual verification of full, rebuild, rescore, referrals, deep-scan, plus batch-deep-scan rebuild |
| Report renders referral section | All 5 sub-elements present | HTML element ID checks |

### 10.2 Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| No unhandled exceptions on production data | 0 crashes | Run against live N-contact graph.json |
| Scoring reproducibility | Identical output on repeated runs (same input) | Diff of two consecutive runs |
| Configuration changes reflected | Modifying weights changes output | Before/after score comparison |
| Edge case resilience | No NaN or Infinity values in output | `JSON.stringify` check + search for NaN |

### 10.3 Performance Targets

| Metric | Target | Current Baseline |
|--------|--------|-----------------|
| referral-scorer.mjs execution time | < 2 seconds for N contacts | New (no baseline) |
| Full pipeline (rebuild mode) | < 15 seconds | ~8 seconds (without referral step) |
| Report generation | < 10 seconds | ~6 seconds (without referral data) |
| graph.json file size | < 50MB for N contacts | ~35MB current |

---

## Appendix A: File Locations

All paths relative to the skill root `<project-root>/.claude/linkedin-prospector/skills/linkedin-prospector/`:

| Path | Description |
|------|-------------|
| `scripts/referral-scorer.mjs` | Referral likelihood scoring engine |
| `scripts/pipeline.mjs` | Pipeline orchestrator |
| `scripts/batch-deep-scan.mjs` | Criteria-driven batch scanning |
| `scripts/analyzer.mjs` | Analysis output modes |
| `scripts/report-generator.mjs` | HTML dashboard generator |
| `scripts/scorer.mjs` | Phase 1 ICP/hub/relationship scorer |
| `scripts/behavioral-scorer.mjs` | Behavioral scoring layer |
| `scripts/graph-builder.mjs` | Graph construction from contacts |
| `scripts/deep-scan.mjs` | Single-contact connection scanner |
| `scripts/lib.mjs` | Shared utilities (parseArgs, launchBrowser) |
| `scripts/db.mjs` | Contact database operations |
| `scripts/cache.mjs` | HTML cache utility |
| `data/graph.json` | Network graph with all scoring data |
| `data/contacts.json` | Raw contact database |
| `data/icp-config.json` | ICP profile configuration |
| `data/behavioral-config.json` | Behavioral scoring configuration |
| `data/referral-config.json` | Referral scoring configuration |
| `data/network-report.html` | Generated HTML dashboard |

## Appendix B: CLI Reference

```bash
# Referral scorer
node scripts/referral-scorer.mjs [--verbose]

# Pipeline modes
node scripts/pipeline.mjs --full [--niche <name>] [--verbose]
node scripts/pipeline.mjs --rebuild [--verbose]
node scripts/pipeline.mjs --rescore [--verbose]
node scripts/pipeline.mjs --referrals [--verbose]
node scripts/pipeline.mjs --deep-scan --url <url> [--verbose]
node scripts/pipeline.mjs --report

# Batch deep-scan
node scripts/batch-deep-scan.mjs --criteria <gold|referral|hub|all> [--min-score <n>] [--max-pages 3] [--max-results 50] [--delay 10] [--dry-run] [--skip <n>]

# Analyzer
node scripts/analyzer.mjs --mode referrals [--top <n>] [--persona <name>] [--tier <name>]
node scripts/analyzer.mjs --mode summary
node scripts/analyzer.mjs --mode recommend

# Report generator
node scripts/report-generator.mjs [--top <n>] [--output <path>]
```

## Appendix C: Validation Checklist

- [x] All requirements are testable (acceptance criteria in Gherkin format)
- [x] Acceptance criteria are clear (specific values, conditions, and expected outcomes)
- [x] Edge cases are documented (25 cases across 5 categories)
- [x] Performance metrics defined (6 NFRs with specific targets)
- [x] Security requirements specified (no PII export, local-only storage)
- [x] Dependencies identified (file dependencies, script dependencies, runtime dependencies, implicit data dependencies)
- [x] Constraints documented (8 technical, 5 business, 4 dependency constraints)
- [x] Data model fully specified (contact schema, graph structure, configuration schema)
- [x] Parallel development streams defined (5 streams with interface contracts and effort estimates)
- [x] Success metrics established (functional, quality, and performance targets)
