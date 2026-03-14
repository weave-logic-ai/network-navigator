# SPARC Architecture Document
## Referral Likelihood Scoring + Criteria-Driven Network Expansion

**Phase**: Architecture (A)
**System**: LinkedIn Network Intelligence Pipeline
**Date**: 2026-03-09
**Status**: Active Production

---

## Table of Contents

1. [System Architecture Diagram](#1-system-architecture-diagram)
2. [Component Architecture](#2-component-architecture)
3. [Data Architecture](#3-data-architecture)
4. [Pipeline Architecture](#4-pipeline-architecture)
5. [Scoring Architecture](#5-scoring-architecture)
6. [Expansion Architecture](#6-expansion-architecture)
7. [Reporting Architecture](#7-reporting-architecture)
8. [API Design (CLI Interface)](#8-api-design-cli-interface)
9. [Infrastructure](#9-infrastructure)
10. [Security Considerations](#10-security-considerations)
11. [Parallel Development Streams](#11-parallel-development-streams)
12. [Multi-Agent Coordination](#12-multi-agent-coordination)

---

## 1. System Architecture Diagram

### High-Level Data Flow

```
+-----------------------------------------------------------------------+
|                        ORCHESTRATION LAYER                            |
|                          pipeline.mjs                                 |
|  Modes: --full --rebuild --rescore --behavioral --referrals           |
|          --report --deep-scan --configure --validate --reparse        |
+-----------------------------------------------------------------------+
        |              |              |              |              |
        v              v              v              v              v
+-------------+  +----------+  +-----------+  +----------+  +----------+
| DATA INGEST |  | GRAPH    |  | SCORING   |  | ANALYSIS |  | EXPANSION|
|             |  | LAYER    |  | ENGINE    |  | LAYER    |  | LAYER    |
| search.mjs  |  | graph-   |  | scorer    |  | analyzer |  | deep-    |
| enrich.mjs  |  | builder  |  | behavioral|  | report-  |  | scan.mjs |
| reparse.mjs |  | .mjs     |  | referral  |  | gen.mjs  |  | batch-   |
|             |  |          |  |           |  |          |  | deep-scan|
+------+------+  +----+-----+  +-----+-----+  +----+-----+  +----+-----+
       |              |              |              |              |
       v              v              v              v              v
+-----------------------------------------------------------------------+
|                         DATA LAYER (JSON Files)                       |
|                                                                       |
|  contacts.json   graph.json   icp-config.json   behavioral-config.json|
|                               referral-config.json                    |
|  data/cache/     data/snapshots/     data/network-report.html         |
+-----------------------------------------------------------------------+
```

### Detailed Pipeline Flow

```
                    +------------------+
                    | contacts.json    |   Raw contact database
                    | (N contacts)     |   from LinkedIn scraping
                    +--------+---------+
                             |
                    +--------v---------+
                    | graph-builder.mjs|   Normalize companies, detect
                    | Step 1: Build    |   clusters, create edges
                    +--------+---------+
                             |
                    +--------v---------+
                    | graph.json       |   contacts{} + companies{}
                    | (Central Store)  |   + clusters{} + edges[]
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
     +--------v---------+         +--------v---------+
     | icp-config.json  |         | scorer.mjs       |
     | (5 ICP profiles) |-------->| Step 2: ICP +    |
     +------------------+         | Gold Scoring     |
                                  +--------+---------+
                                           |
                                  +--------v---------+
                                  | behavioral-      |
                                  | config.json      |
                                  +--------+---------+
                                           |
                                  +--------v---------+
                                  | behavioral-      |
                                  | scorer.mjs       |
                                  | Step 3:          |
                                  | Behavioral +     |
                                  | GoldScore v2     |
                                  +--------+---------+
                                           |
                                  +--------v---------+
                                  | referral-        |
                                  | config.json      |
                                  +--------+---------+
                                           |
                                  +--------v---------+
                                  | referral-        |
                                  | scorer.mjs       |
                                  | Step 4:          |
                                  | 6-component      |
                                  | referral scoring |
                                  +--------+---------+
                                           |
                        +------------------+------------------+
                        |                                     |
               +--------v---------+                  +--------v---------+
               | analyzer.mjs     |                  | report-          |
               | 12 query modes   |                  | generator.mjs    |
               | CLI text output  |                  | HTML dashboard   |
               +------------------+                  +------------------+
```

### Network Expansion Feedback Loop

```
  +--------------------+
  | batch-deep-scan.mjs|
  | Criteria selection |--+
  +--------------------+  |
                          |    For each contact:
                          v
  +--------------------+  +--------------------+
  | graph.json scores  |  | deep-scan.mjs      |
  | Gold / Referral /  |  | Playwright browser  |
  | Hub priorities     |  | Scrape connections  |
  +--------------------+  +---------+----------+
                                    |
                          +---------v----------+
                          | contacts.json      |
                          | +N degree-2 nodes  |
                          | +discoveredVia[]   |
                          +---------+----------+
                                    |
                          +---------v----------+
                          | graph-builder.mjs  | <--- discovered-connection
                          | + scorer.mjs       |      and shared-connection
                          | + behavioral.mjs   |      edge types added
                          | + referral.mjs     |
                          | + report-gen.mjs   |
                          +---------+----------+
                                    |
                          +---------v----------+
                          | Updated graph.json |
                          | with new contacts, |
                          | edges, and scores  |
                          +--------------------+
```

---

## 2. Component Architecture

### 2.1 Data Ingestion Layer

| Component | File | Responsibility | Inputs | Outputs |
|-----------|------|----------------|--------|---------|
| **Search** | `search.mjs` | LinkedIn search by niche keywords | Niche terms, Playwright browser | contacts.json (new profiles) |
| **Enrich** | `enrich.mjs` | Navigate to profile pages, extract detailed data | contacts.json (unenriched), browser | contacts.json (enriched fields) |
| **Reparse** | `reparse.mjs` | Re-extract data from cached HTML | data/cache/ HTML files | contacts.json (updated fields) |
| **Configure** | `configure.mjs` | Interactive/CLI config generation | User input or JSON payload | icp-config.json, behavioral-config.json, referral-config.json |

### 2.2 Graph Construction

| Component | File | Responsibility |
|-----------|------|----------------|
| **Graph Builder** | `graph-builder.mjs` | Reads contacts.json, normalizes companies, detects cluster membership via keyword matching, builds 5 edge types, writes graph.json |

**Edge Types Produced:**

| Edge Type | Weight | Algorithm |
|-----------|--------|-----------|
| `same-company` | 0.8 | All-pairs within same normalized company |
| `same-cluster` | 0.3 | Top 20% by mutuals within each cluster, hub-to-hub |
| `mutual-proximity` | 0.5 | Top 25% by mutuals, same or adjacent clusters |
| `discovered-connection` | 0.9 | Deep-scan: A found in B's connection list |
| `shared-connection` | 0.7 | Deep-scan: multiple 1st-degree contacts discovered the same person |

**Cluster Detection:**

10 clusters defined by keyword matching against contact text (headline, title, about, currentRole, searchTerms):

| Cluster | Keywords |
|---------|----------|
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

Adjacency matrix governs `mutual-proximity` edges between non-overlapping clusters.

### 2.3 Scoring Engine (3-Phase)

| Phase | Component | Dependencies | Writes to graph.json |
|-------|-----------|-------------|---------------------|
| 1 | `scorer.mjs` | graph.json, icp-config.json | `scores.{icpFit, networkHub, relationshipStrength, signalBoost, goldScore, tier}`, `personaType`, `icpCategories`, `tags` |
| 2 | `behavioral-scorer.mjs` | graph.json (with Phase 1 scores), behavioral-config.json, icp-config.json | `behavioralScore`, `behavioralPersona`, `behavioralSignals{}`, `scores.behavioral`, `scores.goldScoreV1` (backup), re-tiers via `scores.goldScore` (v2) |
| 3 | `referral-scorer.mjs` | graph.json (with Phase 1+2 scores), referral-config.json, icp-config.json | `scores.referralLikelihood`, `referralTier`, `referralPersona`, `referralSignals{}` |

### 2.4 Analysis Layer

| Component | File | Responsibility |
|-----------|------|----------------|
| **Analyzer** | `analyzer.mjs` | 10 CLI query modes for text-based analysis output |
| **Report Generator** | `report-generator.mjs` | Self-contained HTML dashboard with 3D graph, Chart.js charts, sortable tables, click-through modals |

**Analyzer Modes:**

| Mode | Description | Key Filters |
|------|-------------|-------------|
| `summary` | Network overview with tier/persona counts | -- |
| `hubs` | Top N contacts by networkHub score | `--cluster`, `--top` |
| `prospects` | Top N contacts by icpFit | `--icp`, `--tier`, `--top` |
| `recommend` | Strategic recommendations (5 categories) | -- |
| `clusters` | Cluster map with tier distribution | -- |
| `company` | Company deep dive | `--name` |
| `behavioral` | Top N by behavioral score | `--persona`, `--top` |
| `visibility` | Content visibility strategy (6 sections) | `--cluster` |
| `employers` | Top N companies by Employer Network Value | `--top` |
| `referrals` | Top N referral partners with signal breakdown | `--persona`, `--tier`, `--top` |

### 2.5 Expansion Layer

| Component | File | Responsibility |
|-----------|------|----------------|
| **Deep Scan** | `deep-scan.mjs` | Single-contact connection list scraping via Playwright |
| **Batch Deep Scan** | `batch-deep-scan.mjs` | Prioritized multi-contact scanning with post-scan rebuild |

### 2.6 Support Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **Database** | `db.mjs` | contacts.json CRUD: load, save, merge, find, seed, export, prune |
| **Cache** | `cache.mjs` | HTML cache for scraped LinkedIn pages (search, profile, connections) |
| **Delta** | `delta.mjs` | Snapshot creation and diff reporting (track network changes over time) |
| **Shared Library** | `lib.mjs` | `parseArgs()` helper, `launchBrowser()` (Playwright persistent context), niche keyword loading |

---

## 3. Data Architecture

### 3.1 contacts.json Schema

```
{
  "contacts": {
    "<linkedin-profile-url>": {
      // -- Identity (from search/enrich) --
      "name": string,                    // Raw scraped name
      "enrichedName": string?,           // Full name from profile page
      "headline": string?,               // LinkedIn headline
      "title": string?,                  // Parsed job title
      "currentRole": string?,            // Enriched current role
      "currentCompany": string?,         // Enriched company name
      "about": string?,                  // About section text
      "location": string?,              // Raw location from search
      "enrichedLocation": string?,       // Detailed location from profile
      "connections": string?,            // "500+ connections" or "277 connections"
      "connectedTime": string?,          // "Connected on March 5, 2026"
      "profileUrl": string,              // Canonical URL

      // -- Network data --
      "mutualConnections": number,       // Count of shared connections
      "searchTerms": string[],           // Niche keywords that matched this contact

      // -- Enrichment state --
      "enriched": boolean,               // Whether profile page was visited
      "cachedAt": string (ISO),          // Last cache timestamp

      // -- Deep-scan metadata (degree-2+ contacts) --
      "degree": number?,                 // 1 = direct, 2 = discovered
      "discoveredVia": string[]?,        // URLs of contacts who led to discovery
      "discoveredAt": string (ISO)?,     // When discovered
      "source": string?,                 // "deep-scan:<scanner-url>"
      "deepScanned": boolean?,           // Was this contact itself scanned?
      "deepScannedAt": string (ISO)?,    // When scanned
      "deepScanResults": number?,        // Count discovered from this contact

      // -- LinkedIn metadata --
      "linkedinDegree": string?,         // "1st", "2nd", "3rd"
      "currentInfo": string?,            // Current role text from search card
      "pastInfo": string?                // Past role text from search card
    }
  },
  "searches": {
    "<search-term>": {
      "lastRun": string (ISO),
      "resultCount": number
    }
  },
  "meta": {
    "totalContacts": number,
    "lastUpdated": string (ISO)
  }
}
```

### 3.2 graph.json Schema

```
{
  "contacts": {
    "<linkedin-profile-url>": {
      // -- All fields from contacts.json PLUS: --

      "companyId": string | null,        // Normalized company key

      // -- Phase 1: scorer.mjs --
      "scores": {
        "icpFit": number (0-1),           // Best ICP profile match
        "networkHub": number (0-1),        // Network centrality composite
        "relationshipStrength": number (0-1), // Connection warmth
        "signalBoost": number (0-1),       // AI/automation keyword boost
        "goldScore": number (0-1),         // Composite (v2 after behavioral)
        "goldScoreV1": number (0-1),       // Backup of pre-behavioral goldScore
        "tier": "gold" | "silver" | "bronze" | "watch",
        "behavioral": number (0-1),        // Behavioral composite (Phase 2)
        "referralLikelihood": number (0-1)  // Referral composite (Phase 3)
      },
      "personaType": "buyer" | "advisor" | "hub" | "peer" | "referral-partner",
      "icpCategories": string[],           // Matched ICP profile names
      "tags": string[],                    // Derived industry/role/signal tags

      // -- Phase 2: behavioral-scorer.mjs --
      "behavioralScore": number (0-1),
      "behavioralPersona": "super-connector" | "content-creator" |
                           "silent-influencer" | "rising-connector" |
                           "passive-network",
      "behavioralSignals": {
        "connectionCount": number,
        "connectionPower": number (0-1),
        "connectionRecency": number (0-1),
        "connectedDaysAgo": number | null,
        "aboutSignals": string[],          // Matched categories
        "headlineSignals": string[],       // Matched patterns
        "superConnectorTraits": string[],  // Trait sources
        "traitCount": number,
        "amplification": number (0-1)
      },

      // -- Phase 3: referral-scorer.mjs --
      "referralTier": "gold-referral" | "silver-referral" |
                      "bronze-referral" | null,
      "referralPersona": "white-label-partner" | "warm-introducer" |
                         "co-seller" | "amplifier" | "passive-referral",
      "referralSignals": {
        "referralRole": number (0-1),
        "referralRoleMatch": string | null,
        "clientOverlap": number (0-1),
        "clientOverlapIndustries": string[],
        "networkReach": number (0-1),
        "networkReachDetail": {
          "connections": number,
          "clusters": number,
          "edges": number
        },
        "amplificationPower": number (0-1),
        "amplificationSignals": string[],
        "relationshipWarmth": number (0-1),
        "buyerInversion": number (0-1)
      }
    }
  },
  "companies": {
    "<normalized-key>": {
      "name": string,                     // Display name (longest variant)
      "contacts": string[]                // URLs of contacts at this company
    }
  },
  "clusters": {
    "<cluster-id>": {
      "label": string,
      "keywords": string[],
      "contacts": string[],               // URLs of contacts in this cluster
      "hubContacts": string[]             // URLs of high-hub-score contacts
    }
  },
  "edges": [
    {
      "source": string,                   // Contact URL
      "target": string,                   // Contact URL
      "type": "same-company" | "same-cluster" | "mutual-proximity" |
              "discovered-connection" | "shared-connection",
      "weight": number (0-1)
    }
  ],
  "meta": {
    "totalContacts": number,
    "lastBuilt": string (ISO),
    "version": number,
    "lastScored": string (ISO),
    "scoringVersion": number,
    "lastBehavioralScored": string (ISO),
    "behavioralVersion": number,
    "lastReferralScored": string (ISO),
    "referralVersion": number
  }
}
```

### 3.3 Configuration File Schemas

#### icp-config.json

```
{
  "profiles": {
    "<profile-name>": {
      "label": string,
      "description": string,
      "rolePatterns": {
        "high": string[],    // Score 1.0
        "medium": string[],  // Score 0.7
        "low": string[]      // Score 0.3
      },
      "industries": string[],
      "signals": string[],
      "companySizeSweet": { "min": number, "max": number },
      "weight": number (0-1)
    }
  },
  "scoring": {
    "roleWeight": 0.35,
    "industryWeight": 0.25,
    "signalWeight": 0.25,
    "companySizeWeight": 0.15
  },
  "goldScore": {
    "icpWeight": 0.35,
    "networkHubWeight": 0.30,
    "relationshipWeight": 0.25,
    "signalBoostWeight": 0.10
  },
  "tiers": {
    "gold": number,      // Threshold (default 0.55)
    "silver": number,    // Default 0.40
    "bronze": number     // Default 0.28
  },
  "niches": {
    "<niche-id>": string[]  // Keywords for search filtering
  }
}
```

#### behavioral-config.json

```
{
  "connectionPower": {
    "weight": 0.20,
    "thresholds": { "500+": 1.0, "300": 0.7, "100": 0.4, "0": 0.1 },
    "followerMultiplier": 0.8
  },
  "connectionRecency": {
    "weight": 0.15,
    "ranges": { "30": 1.0, "90": 0.7, "180": 0.4, "365": 0.2, "older": 0.1 }
  },
  "aboutSignals": {
    "weight": 0.25,
    "keywords": { "<category>": string[] }
  },
  "headlineSignals": {
    "weight": 0.15,
    "patterns": {
      "<pattern-name>": {
        "keywords"?: string[],
        "regex"?: string,
        "score": number
      }
    }
  },
  "superConnectorIndex": {
    "weight": 0.15,
    "minTraits": 3,
    "traitSources": string[]
  },
  "networkAmplifier": { "weight": 0.10 },
  "goldScoreV2": {
    "icpWeight": 0.30,
    "networkHubWeight": 0.25,
    "relationshipWeight": 0.20,
    "behavioralWeight": 0.15,
    "signalBoostWeight": 0.10
  },
  "behavioralPersonas": {
    "<persona-name>": {
      "minTraits"?: number,
      "minConnections"?: number,
      "maxConnections"?: number,
      "maxAboutSignals"?: number,
      "recencyDays"?: number,
      "keywords"?: string[],
      "description": string
    }
  }
}
```

#### referral-config.json

```
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
    "high": { "score": 1.0, "patterns": string[] },
    "medium": { "score": 0.7, "patterns": string[] },
    "low": { "score": 0.3, "patterns": string[] }
  },
  "targetIndustries": string[],
  "industrySignals": {
    "servesTargetClients": string[],
    "industryKeywords": string[]
  },
  "referralTiers": {
    "gold-referral": number,    // Threshold (default 0.65)
    "silver-referral": number,  // Default 0.45
    "bronze-referral": number   // Default 0.30
  },
  "personas": {
    "<persona-name>": {
      "description": string,
      "requires": { /* persona-specific thresholds */ }
    }
  },
  "networkReachBaselines": {
    "connectionCountNorm": number,
    "clusterBreadthWeight": number,
    "edgeDensityWeight": number,
    "connectionCountWeight": number
  }
}
```

### 3.4 Supporting Data Files

| File | Purpose |
|------|---------|
| `data/cache/index.json` | Cache manifest mapping keys to HTML files |
| `data/cache/search/*.html` | Cached LinkedIn search result pages |
| `data/cache/profiles/*.html` | Cached LinkedIn profile pages |
| `data/cache/connections/*.html` | Cached connection list pages from deep-scan |
| `data/snapshots/snapshot-YYYY-MM-DD.json` | Daily network state snapshots for delta tracking |
| `data/network-report.html` | Self-contained interactive HTML dashboard |

---

## 4. Pipeline Architecture

### 4.1 Pipeline Mode Definitions

```
Mode            Steps (sequential order)                        Use Case
-----------     -------------------------------------------     -------------------------
--full          search -> enrich -> graph-builder -> scorer     First-time full pipeline
                -> behavioral -> referral -> analyzer -> delta

--rebuild       graph-builder -> scorer -> behavioral           Re-process from contacts.json
                -> referral -> analyzer -> delta                (default mode)

--rescore       scorer -> behavioral -> referral -> analyzer    Config changes, weight tuning

--behavioral    behavioral -> analyzer(behavioral)              Behavioral-only analysis
                -> analyzer(visibility)

--referrals     referral-scorer -> analyzer(referrals)          Referral scoring only

--report        report-generator                                Dashboard regeneration

--deep-scan     [deep-scan] -> graph-builder -> scorer          Single contact expansion
                -> behavioral -> referral -> report-gen         + full rebuild

--configure     (interactive mode - prints instructions)        ICP config setup

--validate      configure.mjs validate                          Config validation

--reparse       reparse.mjs --all                               Re-extract from cache
```

### 4.2 Dependency Chain and Skip Logic

The pipeline implements cascading dependency guards. If an upstream step fails, all dependent downstream steps are skipped:

```
graph-builder FAILS
  |
  +--> scorer: SKIP (depends on graph.json structure)
        |
        +--> behavioral-scorer: SKIP (depends on scores.*)
              |
              +--> referral-scorer: SKIP (depends on behavioralScore)
```

Implementation detail from `pipeline.mjs`:
- `graphOk` flag tracks graph-builder success
- `scorerOk` flag tracks scorer success
- `behavioralOk` flag tracks behavioral-scorer success
- Each step checks its upstream flag before execution

### 4.3 Execution Model

```
pipeline.mjs
  |
  +-- execFileSync('node', [scriptPath, ...args])
  |     timeout: 120,000ms (2 min per step)
  |     stdio: 'pipe' (captures output)
  |     encoding: 'utf-8'
  |
  +-- Sequential execution (no parallelism)
  |
  +-- Results tracked per step: { script, ok, skipped }
  |
  +-- Exit code: 0 if all pass, 1 if any fail
```

### 4.4 Failure Recovery

| Failure Point | Recovery Strategy |
|---------------|-------------------|
| graph-builder fails | Fix contacts.json, re-run `--rebuild` |
| scorer fails | Verify graph.json exists and has contacts, re-run `--rescore` |
| behavioral fails | Verify scorer ran (contacts have `scores`), re-run `--behavioral` |
| referral fails | Verify behavioral ran (contacts have `behavioralScore`), re-run `--referrals` |
| deep-scan browser timeout | `batch-deep-scan --skip N` to resume from last success |
| Corrupt graph.json | Delete graph.json, run `--rebuild` to regenerate from contacts.json |

---

## 5. Scoring Architecture

### 5.1 Three-Layer Scoring Stack

Each scorer reads graph.json, computes scores across all contacts, and writes results back to the same file. Scorers are strictly ordered because each layer depends on fields written by the previous one.

```
Layer 1: ICP + Network Scoring (scorer.mjs)
  |
  | Writes: scores.icpFit, scores.networkHub, scores.relationshipStrength,
  |         scores.signalBoost, scores.goldScore (v1), scores.tier, personaType,
  |         icpCategories, tags
  |
  v
Layer 2: Behavioral Scoring (behavioral-scorer.mjs)
  |
  | Reads:  scores.* (from Layer 1)
  | Writes: behavioralScore, behavioralPersona, behavioralSignals{},
  |         scores.behavioral, scores.goldScore (v2, replaces v1),
  |         scores.goldScoreV1 (backup), re-computes scores.tier
  |
  v
Layer 3: Referral Scoring (referral-scorer.mjs)
  |
  | Reads:  scores.icpFit (Layer 1), scores.relationshipStrength (Layer 1),
  |         behavioralScore (Layer 2), behavioralPersona (Layer 2),
  |         behavioralSignals.{traitCount, connectionCount, connectedDaysAgo} (Layer 2)
  |
  | Writes: scores.referralLikelihood, referralTier, referralPersona, referralSignals{}
```

### 5.2 Layer 1: ICP + Network Scoring

**ICP Fit** (0-1): Best match across 5 configurable ICP profiles

```
icpFit = max over profiles:
  roleLevel(0.35) + industryMatch(0.25) + signalMatch(0.25) + companySize(0.15)
```

| Sub-score | Algorithm |
|-----------|-----------|
| roleLevel | Pattern match against high/medium/low role patterns: 1.0/0.7/0.3 |
| industryMatch | Count matching industry keywords: >=2 = 1.0, 1 = 0.5, 0 = 0.0 |
| signalMatch | Fraction of signal keywords found in contact text |
| companySize | Default 0.5 (no direct data available from LinkedIn) |

**Network Hub** (0-1):

```
networkHub =
  (mutualConnections / P90_mutuals)(0.30) +
  (clusterCount / totalActiveClusters)(0.25) +
  connectorIndex(role)(0.25) +
  (edgeCount / maxEdges)(0.20)
```

Where `connectorIndex` returns: partner/consultant/advisor = 1.0, C-suite = 0.7, director/VP = 0.5, other = 0.2.

**Relationship Strength** (0-1):

```
relationshipStrength =
  (mutualConnections / maxMutuals)(0.40) +
  (searchTermCount / maxSearchTerms)(0.20) +
  recencyFactor(cachedAt)(0.20) +
  proximityFactor(location, industry)(0.20)
```

**Gold Score v1** (0-1):

```
goldScore = icpFit(0.35) + networkHub(0.30) + relationship(0.25) + signalBoost(0.10)
```

**Tier Assignment:**

| Tier | Threshold |
|------|-----------|
| Gold | >= 0.55 |
| Silver | >= 0.40 |
| Bronze | >= 0.28 |
| Watch | < 0.28 |

**Persona Assignment:**

| Persona | Rule |
|---------|------|
| buyer | icpFit >= 0.6 AND goldScore >= 0.5 |
| advisor | connectorIndex >= 0.8 |
| hub | networkHub >= 0.6 AND icpFit < 0.5 |
| peer | Role contains engineer/developer/architect |
| referral-partner | Default |

### 5.3 Layer 2: Behavioral Scoring

6 components with configurable weights:

| Component | Weight | Input | Scoring Logic |
|-----------|--------|-------|---------------|
| connectionPower | 0.20 | `contact.connections` (string) | Parse "500+" -> thresholds: 500+=1.0, 300=0.7, 100=0.4, 0=0.1; follower mode *= 0.8 |
| connectionRecency | 0.15 | `contact.connectedTime` | Parse "Connected on March 5, 2026"; 30d=1.0, 90d=0.7, 180d=0.4, 365d=0.2, older=0.1 |
| aboutSignals | 0.25 | `contact.about` | Match against 8 keyword categories (connector, speaker, mentor, builder, helper, thought-leader, community, teacher); score = matchedCount / (totalCategories * 0.4) |
| headlineSignals | 0.15 | `contact.headline` | Pattern detection: multi-role (pipe), helping-language, credentials, creator-mode; blended max+avg for multi-match |
| superConnectorIndex | 0.15 | aboutSignals + headlineSignals + connectionPower | Trait set union from all sources; score = traitCount / (minTraits + 2) |
| networkAmplifier | 0.10 | mutualConnections, connectionPower | (mutuals / P90_mutuals) * connectionPower.score |

**Gold Score v2** (replaces v1):

```
goldScoreV2 = icpFit(0.30) + networkHub(0.25) + relationship(0.20)
            + behavioral(0.15) + signalBoost(0.10)
```

**Behavioral Persona Assignment (priority order):**

| Persona | Criteria |
|---------|----------|
| super-connector | traitCount >= 3 AND connectionCount >= 500 |
| content-creator | Keywords (speaker, author, writer, etc.) in about/headline |
| silent-influencer | connectionCount >= 500 AND aboutSignals.matchedCategories.length <= 1 |
| rising-connector | connectionCount < 500 AND connectedDaysAgo <= 180 |
| passive-network | Default |

### 5.4 Layer 3: Referral Scoring

6 weighted components:

| Component | Weight | Algorithm |
|-----------|--------|-----------|
| **referralRole** | 0.25 | Match headline/title/about against 3-tier role patterns: high (agency, partner, advisor) = 1.0, medium (consultant, freelance, BD) = 0.7, low (manager, founder, lead) = 0.3 |
| **clientOverlap** | 0.20 | industryScore = min(industryMatches/3, 1.0); serviceScore = min(serviceMatches/2, 1.0); combined = industryScore*0.6 + serviceScore*0.4 |
| **networkReach** | 0.20 | connScore = connectionCount/500; clusterScore = clusterCount/(activeClusters*0.3); edgeScore = edgeCount/P90_edges; weighted sum by config weights |
| **amplificationPower** | 0.15 | traitCount: >=3 = +0.4, 1-2 = +0.12/trait; helpingLanguage: >=2 words = +0.3; contentCreation: >=1 signal = +0.3 |
| **relationshipWarmth** | 0.10 | (mutuals/P90_mutuals)(0.35) + relationshipStrength(0.35) + recencyScore(0.30) |
| **buyerInversion** | 0.10 | invertedIcp = (1 - icpFit); ecosystemScore = min(ecosystemKeywordCount/3, 1.0); combined = invertedIcp*0.5 + ecosystemScore*0.5 |

**Referral Likelihood Composite:**

```
referralLikelihood = sum(component_i.score * weight_i) for all 6 components
```

**Referral Tier Thresholds:**

| Tier | Threshold |
|------|-----------|
| gold-referral | >= 0.65 |
| silver-referral | >= 0.45 |
| bronze-referral | >= 0.30 |
| (none) | < 0.30 |

**Referral Persona Assignment (priority order):**

| Persona | Criteria |
|---------|----------|
| white-label-partner | Role text matches WLP patterns AND referralRole >= 0.7 AND clientOverlap >= 0.4 |
| warm-introducer | relationshipWarmth >= 0.5 AND networkReach >= 0.5 |
| co-seller | Role text matches CS patterns AND clientOverlap >= 0.5 |
| amplifier | amplificationPower >= 0.5 OR behavioralPersona in [super-connector, content-creator] |
| passive-referral | Default |

### 5.5 Baseline Computation

Each scorer computes statistical baselines from the full dataset before scoring individual contacts. This ensures score normalization relative to the network:

| Baseline | Used By | Computation |
|----------|---------|-------------|
| P90 mutuals | All scorers | 90th percentile of non-zero mutualConnections |
| Max mutuals | scorer.mjs | Maximum mutualConnections |
| Max edges | scorer.mjs | Maximum edge count per contact |
| Max search terms | scorer.mjs | Maximum searchTerms array length |
| P90 edges | referral-scorer.mjs | 90th percentile of non-zero edge counts |
| Active clusters | All scorers | Count of clusters with >0 contacts |
| Edge counts map | scorer, referral | Per-contact edge count from edges[] |
| Contact-cluster map | scorer, referral | Per-contact cluster membership |

---

## 6. Expansion Architecture

### 6.1 Single-Contact Deep Scan (deep-scan.mjs)

**Execution Flow:**

```
1. Parse CLI: --url, --max-pages (5), --max-results (100), --depth (2)
2. Verify target exists in contacts.json
3. Launch Playwright persistent browser (reuses LinkedIn session)
4. Navigate to target's profile page
5. Locate connections link (3 fallback strategies):
   a. <a href*="/search/results/people"> link
   b. li.text-body-small a[href*="connection"]
   c. Extract member URN from page source -> construct search URL
   d. Slug-based fallback search URL
6. Paginate: scroll, extract connections, click "Next"
   - Per page: scroll 6x600px + 8x400px with delays
   - Cache each page HTML via cache.mjs
   - Extract: name, title, location, profileUrl, mutuals, degree
   - Filter: remove target itself, optionally mutual-only
   - Stop at: maxPages, maxResults, 2 consecutive empty pages
7. Deduplicate by URL (keep richest data)
8. For each discovered contact:
   - If known: append to discoveredVia[], update sparse fields
   - If new: create degree-N entry in contacts.json
9. Mark target as deepScanned in contacts.json
10. Save contacts.json
```

**Data Created per Discovery:**

```javascript
{
  name, title, location, profileUrl,
  mutualConnections: 0,
  linkedinDegree: "2nd",
  degree: 2,                    // Store as degree-N
  discoveredVia: [scannerUrl],  // Provenance chain
  discoveredAt: ISO,
  source: "deep-scan:<scanner-url>",
  enriched: false,
  searchTerms: []
}
```

### 6.2 Batch Deep Scan (batch-deep-scan.mjs)

**Criteria-Based Prioritization:**

| Criteria Mode | Contact Selection | Sort Order |
|---------------|-------------------|------------|
| `gold` (default) | All gold-tier + top 5 each of ICP/hub/behavioral/relationship | goldScore desc |
| `referral` | gold-referral tier, warm-introducers, white-label partners, top silver-referral (10) | referralLikelihood desc |
| `hub` | Top 10 by networkHub (above --min-score) | networkHub desc |
| `all` | Union of gold + referral + hub + top 5 ICP/behavioral/relationship | Mixed |

**Execution Model:**

```
1. Build prioritized scan list from graph.json scores
2. Filter: skip deepScanned contacts, apply --min-score threshold
3. Display plan (--dry-run stops here)
4. For each contact (sequential, with --delay seconds between):
   a. execFileSync('node', ['deep-scan.mjs', '--url', url, ...])
   b. Timeout: 180,000ms (3 min per scan)
   c. Track success/failure
5. Post-scan rebuild (if any succeeded):
   graph-builder -> scorer -> behavioral -> referral -> report-generator
6. Print summary: success/fail counts per contact
```

**Resume Support:**
- `--skip N` to resume after interruption
- Already-scanned contacts auto-excluded (deepScanned flag)

### 6.3 Feedback Loop: How Expansion Enriches Scores

When a deep-scan discovers that contact B appears in contact A's connection list, graph-builder creates a `discovered-connection` edge (weight 0.9). If contact B appears in multiple scans (A1 and A2), it also creates `shared-connection` edges (weight 0.7) between A1 and A2, revealing hidden network structure.

These high-weight edges increase:
- **networkHub** scores for well-connected contacts
- **networkReach** in referral scoring (more edges = higher edge density)
- **relationshipWarmth** indirectly (through relationship strength)

---

## 7. Reporting Architecture

### 7.1 Report Generator (report-generator.mjs)

**Input:** graph.json (fully scored)
**Output:** Self-contained HTML file (~1700 lines) at `data/network-report.html`

**Processing Pipeline:**

```
loadGraph() -> computeReportData(graph, topN) -> generateHTML(data) -> writeFile()
```

**Data Computation:**

| Data Section | Source | Processing |
|-------------|--------|------------|
| Top contacts | All scored contacts sorted by goldScore | Take top N (default 200) |
| Graph nodes | Top contacts mapped to node objects | ID, scores, metadata for 3D graph |
| Graph edges | edges[] filtered to top contact set | Source/target/type/weight |
| Tier/persona counts | Full dataset aggregation | Counts per category |
| Score distributions | goldScore, behavioralScore, referralLikelihood | 10-14 bucket histograms |
| Cluster data | Per-cluster: size, hubs, amplifiers, avg behavioral, tier distribution | Aggregation |
| Referral data | Top 20 referral partners + tier/persona distributions | Sorted by referralLikelihood |
| Recommendations | 5 categories: Immediate Pursuit, Hub Activation, Quick Wins, Referral Partnerships, Content Amplification | Rule-based selection |

### 7.2 Dashboard Sections

| Section | Visualization | Technology |
|---------|--------------|------------|
| Overview | Stat cards: gold/silver/bronze/watch counts, graph node/edge counts | HTML/CSS |
| 3D Network Graph | Interactive force-directed graph with tier coloring, edge type coloring, cluster/persona/tier filters, click-to-detail | Three.js via 3d-force-graph |
| Score Distributions | Gold score histogram, behavioral histogram, tier donut, behavioral persona donut | Chart.js |
| Top Contacts | Sortable table with all score columns, click-to-modal | Vanilla JS |
| Network Hubs | Info cards: top 10 by networkHub | HTML |
| Super-Connectors | Info cards: top 15 by behavioral (super-connector persona) | HTML |
| Referral Partners | Stat cards + referral score histogram + referral persona donut + top 20 table with 6-component breakdown | Chart.js + HTML |
| Company Beachheads | Table: top 10 by Employer Network Value (ENV) | HTML |
| Visibility Strategy | Cluster amplifiers bar chart, bridge connectors, silent influencers, rising stars | Chart.js + HTML |
| Data Explorer | Tabbed searchable/sortable tables: All, Hubs, Super-Connectors, Companies, Referrals, Degree-2 | Vanilla JS |
| Recommendations | Categorized action cards with name/detail/action | HTML |

### 7.3 Interactive Features

- **3D Graph Filtering:** Checkboxes for tier visibility, dropdowns for cluster/persona
- **Node Click:** Opens detail modal with all scores, tags, traits, LinkedIn profile link
- **Table Sorting:** Click column headers for ascending/descending sort
- **Search:** Text search across name, role, company in Data Explorer
- **Clickable Rows:** Any table row opens the contact detail modal
- **Sidebar Navigation:** Scroll-tracking active section highlighting
- **Print Mode:** CSS `@media print` hides interactive elements

---

## 8. API Design (CLI Interface)

### 8.1 Pipeline Orchestrator

```
node pipeline.mjs [mode] [options]

Modes:
  --full              Full pipeline: search -> enrich -> build -> score -> analyze
  --rebuild           Rebuild from contacts.json (default)
  --rescore           Score only (after config changes)
  --behavioral        Behavioral scoring + analysis
  --referrals         Referral scoring + analysis
  --report            Generate HTML dashboard
  --deep-scan         Deep-scan + rebuild + report
  --configure         Print config instructions
  --validate          Validate configuration files
  --reparse           Re-extract from HTML cache
  --visualize         (Phase 2 placeholder)

Options:
  --niche <name>      Filter niche for search (--full mode only)
  --url <url>         Target URL (--deep-scan mode only)
  --output <path>     Output path (--report mode)
  --top <N>           Top N contacts (--report mode)
  --verbose           Pass-through verbose logging to sub-scripts
```

### 8.2 Individual Scripts

#### graph-builder.mjs
```
node graph-builder.mjs [--verbose]
  Input:  data/contacts.json
  Output: data/graph.json
```

#### scorer.mjs
```
node scorer.mjs [--verbose]
  Input:  data/graph.json, data/icp-config.json
  Output: data/graph.json (contacts annotated with scores.*, personaType, tags)
```

#### behavioral-scorer.mjs
```
node behavioral-scorer.mjs [--verbose]
  Input:  data/graph.json (scored), data/behavioral-config.json, data/icp-config.json
  Output: data/graph.json (contacts annotated with behavioralScore, behavioralPersona, etc.)
```

#### referral-scorer.mjs
```
node referral-scorer.mjs [--verbose]
  Input:  data/graph.json (scored + behavioral), data/referral-config.json, data/icp-config.json
  Output: data/graph.json (contacts annotated with referralLikelihood, referralTier, etc.)
```

#### analyzer.mjs
```
node analyzer.mjs --mode <mode> [options]

Modes: summary | hubs | prospects | recommend | clusters | company |
       behavioral | visibility | employers | referrals

Options:
  --top <N>           Limit results (default: 10-20 depending on mode)
  --cluster <id>      Filter by cluster
  --icp <profile>     Filter by ICP profile
  --tier <tier>       Filter by tier
  --persona <type>    Filter by persona type
  --name <company>    Company name (company mode)
  --verbose           Verbose output
```

#### report-generator.mjs
```
node report-generator.mjs [--top N] [--output path]
  Default: --top 200 --output ../data/network-report.html
```

#### deep-scan.mjs
```
node deep-scan.mjs --url <linkedin-url> [options]

Options:
  --max-pages <N>     Pages to scrape (default: 5)
  --max-results <N>   Max connections (default: 100)
  --depth <N>         Store as degree-N (default: 2)
  --mutual-only       Only mutual connections
```

#### batch-deep-scan.mjs
```
node batch-deep-scan.mjs [options]

Options:
  --criteria <type>   gold | referral | hub | all (default: gold)
  --min-score <n>     Minimum score threshold (0-1, default: 0)
  --max-pages <N>     Pages per scan (default: 3)
  --max-results <N>   Connections per scan (default: 50)
  --delay <s>         Seconds between scans (default: 10)
  --dry-run           Show plan without executing
  --skip <N>          Resume from Nth contact
```

#### delta.mjs
```
node delta.mjs <command>

Commands:
  --snapshot          Create snapshot of current network state
  --check             Compare current state against most recent snapshot
  --list              List all saved snapshots
```

#### db.mjs
```
node db.mjs <command> [options]

Commands:
  stats                                Show contact counts by niche
  search --niche <n> [--min-mutual N]  Find matching contacts
  export --format csv|json [--niche n] Export contacts
  prune --older-than 90d               Remove stale entries
  seed --file <path>                   Import from JSON file
```

---

## 9. Infrastructure

### 9.1 Runtime Environment

| Aspect | Technology |
|--------|------------|
| Runtime | Node.js (ESM modules, `.mjs` extension) |
| Module System | ES Modules (`import`/`export`), no CommonJS |
| Package Dependencies | `playwright` (browser automation), `chromium` (browser) |
| External Services | LinkedIn (web scraping via authenticated Playwright session) |
| Database | JSON files on local filesystem |
| Build System | None (direct Node.js execution, no transpilation) |

### 9.2 File System Layout

```
linkedin-prospector/
  skills/linkedin-prospector/
    scripts/                    # All executable scripts
      pipeline.mjs              # Orchestrator
      graph-builder.mjs         # Graph construction
      scorer.mjs                # ICP + network scoring
      behavioral-scorer.mjs     # Behavioral scoring
      referral-scorer.mjs       # Referral scoring
      analyzer.mjs              # CLI analysis
      report-generator.mjs      # HTML dashboard
      deep-scan.mjs             # Single contact expansion
      batch-deep-scan.mjs       # Criteria-based batch expansion
      search.mjs                # LinkedIn search scraper
      enrich.mjs                # Profile enrichment scraper
      reparse.mjs               # Re-extract from cache
      configure.mjs             # Config wizard/generator
      delta.mjs                 # Snapshot & delta tracking
      db.mjs                    # Database operations
      cache.mjs                 # HTML cache management
      lib.mjs                   # Shared utilities
    data/                       # All data files
      contacts.json             # Raw contact database
      graph.json                # Scored network graph
      icp-config.json           # ICP scoring configuration
      behavioral-config.json    # Behavioral scoring configuration
      referral-config.json      # Referral scoring configuration
      network-report.html       # Generated HTML dashboard
      cache/                    # Cached LinkedIn HTML pages
        index.json
        search/
        profiles/
        connections/
      snapshots/                # Network state snapshots
        snapshot-YYYY-MM-DD.json
    .browser-data/              # Playwright persistent browser context
```

### 9.3 No External Database Dependencies

All state is managed through JSON files. This architectural decision provides:

- **Portability:** Copy the data directory to move the entire system
- **Transparency:** Human-readable data for debugging and manual inspection
- **Atomicity:** Write operations use `writeFileSync` (synchronous, no partial writes)
- **Simplicity:** No database server, connection pooling, or schema migrations

**Trade-offs:**
- **File size:** graph.json grows with contact count (N contacts ~ several MB)
- **Concurrency:** No file locking; sequential pipeline execution prevents conflicts
- **Query performance:** Full file reads for every operation (acceptable at current dataset scale)

### 9.4 Browser Automation

Playwright with persistent Chromium context:
- **Authentication:** Uses pre-existing LinkedIn session from `.browser-data/` directory
- **Headless:** `headless: false` (visible browser for debugging and CAPTCHA resolution)
- **Anti-detection:** `--disable-blink-features=AutomationControlled`
- **Viewport:** 1400x900 (desktop layout)
- **Timeouts:** Script-level: 120s (pipeline), 180s (batch-deep-scan); page-level: various `waitForTimeout` calls with 500-4000ms delays

---

## 10. Security Considerations

### 10.1 LinkedIn Terms of Service Compliance

| Risk | Mitigation |
|------|------------|
| Automated scraping violates LinkedIn ToS | User-initiated manual triggering, no continuous/scheduled scraping |
| Rate limiting | batch-deep-scan defaults: 3 pages/scan, 50 results/scan, 10s delay between scans |
| CAPTCHA triggers | Headless=false allows manual CAPTCHA solving |
| Account suspension | Conservative scraping (max 5 pages per deep-scan), human-like scroll patterns |

**Recommended Operational Practices:**
- Run deep-scans during business hours with natural variation
- Limit batch-deep-scan to 10-20 contacts per session
- Monitor for LinkedIn "unusual activity" warnings
- Space batch runs across multiple days

### 10.2 Credential Handling

| Item | Storage | Risk Level |
|------|---------|------------|
| LinkedIn session cookies | `.browser-data/` directory (Playwright persistent context) | Medium: local filesystem only, not committed to git |
| API keys (InfraNodus) | `~/.claude.json` MCP config | Low: outside project directory |
| ICP configuration | `data/icp-config.json` | None: no secrets, business logic only |

**No secrets in source code.** Browser authentication relies on Playwright's persistent context, which stores cookies in the local `.browser-data/` directory. This directory must never be committed.

### 10.3 Data Privacy

| Concern | Handling |
|---------|----------|
| PII in contacts.json | Names, job titles, LinkedIn URLs are semi-public LinkedIn data |
| About text (personal content) | Stored for scoring, not shared externally |
| Network topology (edges) | Inferred from public connection lists, not LinkedIn private data |
| Report sharing | network-report.html contains full contact data; treat as confidential |

**Recommendations:**
- Add `data/` to `.gitignore`
- Do not commit contacts.json, graph.json, or network-report.html
- The `.browser-data/` directory must be in `.gitignore`
- When sharing reports, consider the `--top N` flag to limit exposure

### 10.4 Input Validation

| Boundary | Validation |
|----------|------------|
| CLI arguments | `parseArgs()` in lib.mjs; pipeline.mjs warns on unknown flags |
| File existence | All scripts check `existsSync()` before reading, exit(1) with message |
| Dependency guards | Pipeline skips downstream steps when upstream fails |
| Contact URLs | Normalized (trailing slash stripped, query params removed) |
| Company names | Normalized via regex: suffix stripping, lowercase key generation |
| Score values | `cap()` function enforces 0-1 bounds on all computed scores |

---

## 11. Parallel Development Streams

### 11.1 Stream Definitions

Five independent development streams that can proceed in parallel once the interfaces between them are agreed upon:

```
                    +---------------------------+
                    | graph.json Schema         |
                    | (Section 3.2 Contract)    |
                    +--+---------+---------+----+
                       |         |         |
          +------------+  +------+------+  +----------+
          |               |             |             |
+---------v---------+ +---v-----------+ +---v---------+---+
| Stream A:         | | Stream B:     | | Stream C:       |
| Scoring Engine    | | Pipeline      | | Analysis &      |
|                   | | Integration   | | Reporting       |
| referral-scorer   | | pipeline.mjs  | | analyzer.mjs    |
| + config          | | batch-deep-   | | report-gen.mjs  |
| + behavioral mods | | scan.mjs      | | delta.mjs       |
+-------------------+ +---------------+ +-----------------+

+---------v---------+ +---------v---------+
| Stream D:         | | Stream E:         |
| Network Expansion | | Testing           |
|                   | |                   |
| deep-scan.mjs     | | Unit tests for    |
| criteria logic    | | all scorers,      |
| dedup/merge       | | builders, config  |
+-------------------+ +-------------------+
```

### 11.2 Stream A: Scoring Engine

**Scope:** referral-scorer.mjs, referral-config.json, potential modifications to behavioral-scorer.mjs

**Contract (input):** graph.json contact object must have:
- `scores.icpFit` (number 0-1)
- `scores.relationshipStrength` (number 0-1)
- `behavioralScore` (number 0-1)
- `behavioralPersona` (string)
- `behavioralSignals.traitCount` (number)
- `behavioralSignals.connectionCount` (number)
- `behavioralSignals.connectedDaysAgo` (number|null)
- `headline`, `about`, `currentRole`, `currentCompany`, `tags` (strings)
- `mutualConnections` (number)

**Contract (output):** Each contact receives:
- `scores.referralLikelihood` (number 0-1)
- `referralTier` (string|null)
- `referralPersona` (string)
- `referralSignals` (object with 6 component scores)
- `meta.lastReferralScored` (ISO string)

**Independence:** Can develop and test with a frozen graph.json fixture. No dependency on live pipeline execution.

**Potential work items:**
- Add temporal decay to referral signals
- A/B test weight configurations
- Add "referral engagement history" tracking
- Implement confidence intervals on referral scores

### 11.3 Stream B: Pipeline Integration

**Scope:** pipeline.mjs modes, batch-deep-scan.mjs criteria, step ordering

**Dependencies:** Requires scorer outputs to exist (field names). Does NOT need correct scorer logic -- only that scripts exit cleanly and write expected fields.

**Contract:** Each step must:
- Accept `--verbose` flag
- Exit 0 on success, non-zero on failure
- Write to graph.json (scorers) or stdout (analyzers)

**Independence:** Can be developed with stub scorers that write fixture data.

**Potential work items:**
- Add `--parallel` mode for independent scorers
- Implement step-level retry with backoff
- Add pipeline state persistence for crash recovery
- Performance timing and bottleneck reporting

### 11.4 Stream C: Analysis and Reporting

**Scope:** analyzer.mjs modes, report-generator.mjs sections, delta.mjs

**Dependencies:** Depends on field names in graph.json, NOT scorer algorithms. Can work with any data that conforms to the schema.

**Contract (input):** graph.json with populated `scores.*`, `behavioralScore`, `referralTier`, `referralPersona`, `referralSignals`.

**Independence:** Can develop with a frozen scored graph.json. New analyzer modes and report sections can be added without touching scorers.

**Potential work items:**
- Add `analyzer.mjs --mode network-gaps` for coverage analysis
- Add referral conversion tracking to report
- Implement PDF export from HTML dashboard
- Add historical trend charts using snapshot data

### 11.5 Stream D: Network Expansion

**Scope:** deep-scan.mjs, batch-deep-scan.mjs, cache.mjs

**Dependencies:** deep-scan.mjs writes to contacts.json only. batch-deep-scan reads graph.json scores for prioritization but only needs field names.

**Contract (output):** Discovered contacts stored in contacts.json with:
- `degree: 2+`
- `discoveredVia: [urls]`
- `source: "deep-scan:<url>"`

**Independence:** Can develop and test against LinkedIn independently. Criteria selection logic can be tested with graph.json fixtures.

**Potential work items:**
- Implement "smart scan" that prioritizes contacts likely to yield high-value discoveries
- Add scan scheduling and distributed execution
- Implement connection quality pre-filtering (only scan contacts with 100+ mutuals)
- Add scan result quality scoring (were discovered contacts valuable?)

### 11.6 Stream E: Testing

**Scope:** Unit tests for all components, integration tests for pipeline modes

**Dependencies:** None -- can start immediately with the existing codebase.

**Test Categories:**

| Category | What to Test | Fixture Needs |
|----------|-------------|---------------|
| Scorer unit tests | Each scoring function with known inputs/outputs | Small contact objects |
| Baseline computation | P90, max, edge count algorithms | graph.json with 10-20 contacts |
| Persona assignment | Priority ordering, edge cases | Contacts with various score combinations |
| Config validation | Schema compliance, threshold ranges | Valid and invalid config files |
| Pipeline skip logic | Dependency guards, failure cascading | Mock execFileSync |
| Graph builder | Edge creation, cluster detection, company normalization | contacts.json with 10-20 contacts |
| Deep-scan merge | Dedup, discoveredVia append, degree tracking | contacts.json + discovered contacts |

---

## 12. Multi-Agent Coordination

### 12.1 Agent Allocation

For parallel development with 5+ agents, assign roles aligned to development streams:

| Agent Role | Stream | Primary Files | Can Start Immediately |
|------------|--------|--------------|----------------------|
| **Scoring Agent** | A | referral-scorer.mjs, referral-config.json, scorer.mjs, behavioral-scorer.mjs | Yes (freeze graph.json fixture) |
| **Pipeline Agent** | B | pipeline.mjs, batch-deep-scan.mjs | Yes (stub scorers) |
| **Analysis Agent** | C | analyzer.mjs, report-generator.mjs, delta.mjs | Yes (freeze scored graph.json) |
| **Expansion Agent** | D | deep-scan.mjs, batch-deep-scan.mjs criteria, cache.mjs | Yes (independent of scorers) |
| **Testing Agent** | E | tests/*.mjs (new directory) | Yes (read existing code, write tests) |
| **Config Agent** | A+C | configure.mjs, all config JSONs, analyzer recommendations | Yes |

### 12.2 Shared Contracts

All agents must agree on and not independently change these interfaces:

1. **graph.json contact object schema** (Section 3.2) -- the central contract
2. **Score field names:** `scores.referralLikelihood`, `referralTier`, `referralPersona`, `referralSignals`
3. **Behavioral field names:** `behavioralScore`, `behavioralPersona`, `behavioralSignals`
4. **Config file schemas** (Section 3.3)
5. **CLI argument conventions:** `--verbose`, `--mode`, `--top`, `--tier`, `--persona`

### 12.3 Coordination Protocol

```
Phase 1: Contract Agreement (all agents)
  - Review and lock graph.json schema
  - Generate fixture data files for testing
  - Each agent declares their read/write boundaries

Phase 2: Parallel Development (5 agents)
  - Scoring Agent: Implement/refine scoring algorithms
  - Pipeline Agent: Improve orchestration reliability
  - Analysis Agent: Add new analysis modes and report sections
  - Expansion Agent: Improve deep-scan reliability and criteria
  - Testing Agent: Write comprehensive test suites

Phase 3: Integration (sequential)
  - Testing Agent validates all components against schema contract
  - Pipeline Agent runs full pipeline with all real components
  - Analysis Agent verifies report with real scored data

Phase 4: Validation
  - Full pipeline run: --full or --rebuild
  - Compare output against known baselines
  - Review report for data accuracy
```

### 12.4 Conflict Avoidance

| Resource | Owned By | Others May |
|----------|----------|------------|
| graph.json schema (Section 3.2) | All agents (locked) | Read, not modify schema |
| referral-scorer.mjs | Scoring Agent | Read only |
| referral-config.json | Scoring Agent + Config Agent | Read only |
| pipeline.mjs | Pipeline Agent | Read only |
| analyzer.mjs | Analysis Agent | Read only |
| report-generator.mjs | Analysis Agent | Read only |
| deep-scan.mjs | Expansion Agent | Read only |
| batch-deep-scan.mjs | Expansion + Pipeline Agents | Coordinate criteria changes |
| graph-builder.mjs | Pipeline Agent | Expansion Agent may propose new edge types |

### 12.5 Communication Points

Critical handoff points where agents must coordinate:

1. **New score fields:** If Scoring Agent adds a new score, Analysis Agent must add it to analyzer.mjs and report-generator.mjs
2. **New edge types:** If Expansion Agent adds a new edge type, Graph Builder must recognize it, and Report Generator must color it
3. **Config schema changes:** If Config Agent adds new config fields, the corresponding scorer must read them
4. **Pipeline mode changes:** If Pipeline Agent adds a new mode, it must reference the correct scripts
5. **New persona types:** If Scoring Agent adds a new referral persona, Analysis Agent must add recommendation text for it

---

## Appendix A: Current System Metrics

| Metric | Value |
|--------|-------|
| Total contacts | N |
| Total edges | M |
| Active clusters | 10 |
| Degree-2 contacts | 31 |
| ICP profiles | 5 (ai-assessment, automation-assessment, fractional-cto, training, development) |
| Behavioral personas | 5 (super-connector, content-creator, silent-influencer, rising-connector, passive-network) |
| Referral personas | 5 (white-label-partner, warm-introducer, co-seller, amplifier, passive-referral) |
| Edge types | 5 (same-company, same-cluster, mutual-proximity, discovered-connection, shared-connection) |

## Appendix B: Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | JavaScript (ESM) | No build step, native JSON support, Playwright compatibility |
| Module system | ES Modules (.mjs) | Modern standard, top-level await support for async scripts |
| Database | JSON files | Zero-dependency, portable, human-readable, sufficient at <1000 contacts |
| Browser automation | Playwright | Best LinkedIn compatibility, persistent context for session reuse |
| Visualization | Chart.js + 3d-force-graph (CDN) | Self-contained HTML, no build required |
| Orchestration | execFileSync | Simple process isolation, predictable error handling, timeout support |
| Config format | JSON | Native to Node.js, easy to validate, no parser dependencies |

## Appendix C: Scaling Considerations

The current architecture is designed for a single user with up to ~5,000 contacts. Beyond that:

| Scale Trigger | Recommended Change |
|---------------|--------------------|
| >5,000 contacts | Move graph.json to SQLite for indexed queries |
| >10,000 contacts | Parallelize scorer execution (currently sequential over all contacts) |
| >50,000 contacts | Replace JSON files with a proper database (PostgreSQL) |
| Multiple users | Add user isolation layer, separate data directories |
| Automated scheduling | Add cron-based pipeline execution with rate limiting |
| Team collaboration | Move to a shared database with conflict resolution |

---

*This architecture document is the A phase of the SPARC methodology for the Referral Likelihood Scoring + Criteria-Driven Network Expansion system. It defines the system boundaries, component responsibilities, data contracts, and parallel development strategy required for the Refinement and Completion phases to proceed.*
