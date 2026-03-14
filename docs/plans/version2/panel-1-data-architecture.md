# Panel 1: Data Architecture & Graph Engine

## Version 2 Symposium -- LinkedIn Network Intelligence Tool

---

## 1. Panel Introduction

This panel convenes six experts to analyze and recommend the data architecture for Version 2 of the LinkedIn Network Intelligence tool. The V2 transition replaces Playwright-based browser scraping with a CSV-import-first approach, API-based enrichment, and a Chrome extension for behavioral data. This fundamentally changes the data ingestion layer, storage requirements, and graph construction pipeline.

### Panelists

| Expert | Domain | Focus Area |
|--------|--------|------------|
| **Dr. Elena Vasquez** | Graph Database Architect | Neo4j, property graphs, local-first graph storage, graph query patterns |
| **Marcus Chen** | Data Pipeline Engineer | ETL, CSV parsing, data normalization, incremental updates |
| **Dr. Priya Sharma** | API Integration Specialist | REST API orchestration, waterfall enrichment, rate limiting, cost optimization |
| **James Okonkwo** | Data Modeling Expert | Entity-relationship design, schema evolution, versioning |
| **Dr. Sarah Kim** | Privacy & Compliance Engineer | GDPR, data minimization, PII handling, consent tracking |
| **Raj Patel** | Local-First Architecture Advocate | Offline-capable systems, IndexedDB, SQLite, file-based storage |

---

## 2. Current State Analysis

### 2.1 V1 Architecture Summary

The V1 system is built around a **dual-store architecture** with a file-based data layer:

**Primary Data Store: RVF (RuVector File)**
- A local vector database (`network.rvf`) using 384-dimensional embeddings
- Stores flattened `RvfMetadata` per contact (identity, scores, behavioral data, referral data)
- Provides semantic search via HNSW-indexed vector queries
- Wrapped by `rvf-service.ts` with typed TypeScript interfaces
- Limitation: no "list all" or `getAll()` method -- requires a secondary index

**Supplementary Store: graph.json**
- A monolithic JSON file containing the complete graph structure
- Houses `contacts` (keyed by LinkedIn URL), `edges`, `clusters`, `companies`, and `meta`
- Serves as the contact URL index for paginated listing (since the VectorDB lacks enumeration)
- Contains rich nested objects: `GraphContactScores`, `BehavioralSignals`, `ReferralSignals`, `ActivityPost[]`
- Current size: approximately 956 connections based on the Connections.csv export

**Data Layer (`data.ts`)**
- Resolves paths relative to the ctox project root
- Defines well-known paths: `DATA_DIR` (`.linkedin-prospector/data/`), `SCRIPTS_DIR`, `CONFIG_DIR`
- Provides JSON file I/O with mtime-based cache invalidation
- Separates app code (`/.claude/linkedin-prospector/app/`) from runtime data (`/.linkedin-prospector/data/`)

**Graph Cache (`graph-cache.ts`)**
- Lazy-loaded singleton with 10-second stale-check intervals
- Builds derived in-memory indexes: `AdjacencyMap`, `ClusterMembershipMap`, `CompanyContactMap`
- Provides traversal APIs: `getNeighbors()`, `getEdgesForContact()`, `getClusterMembers()`

**Process Manager (`process-manager.ts`)**
- Manages child process lifecycle for pipeline scripts
- Playwright-aware: tracks Playwright vs non-Playwright scripts separately
- Supports queue, cancel, rate-budget enforcement, and operations logging
- LinkedIn override mechanism to block Playwright-based scripts

**Pipeline Orchestration (`pipeline.mjs`)**
- Sequential step runner: graph-builder -> scorer -> behavioral-scorer -> referral-scorer -> vectorize -> analyze -> snapshot
- Modes: `--full`, `--rebuild`, `--rescore`, `--behavioral`, `--referrals`, `--vectorize`
- GDPR compliance built in: `--forget`, `--auto-archive`, `--consent`

**Enrichment (`enrich.mjs`)**
- **Playwright-based**: launches a browser, navigates to LinkedIn profile pages, extracts DOM data
- Extracts: name, headline, location, currentRole, currentCompany, about, connections
- Rate-limited via `rate-budget.mjs`; saves profile pages to cache
- Batch mode with 2-5s random delays between visits

**Scoring (`scorer.mjs`)**
- Multi-dimensional: icpFit, networkHub, relationshipStrength, signalBoost, skillsRelevance, networkProximity, behavioral
- Gold Score V3: weighted composite with dynamic weight redistribution for missing dimensions
- Tier assignment (gold/silver/bronze/watch) with degree-specific thresholds
- Persona taxonomy: buyer, warm-lead, advisor, active-influencer, hub, ecosystem-contact, peer, network-node
- Account penetration scoring per company
- Tag derivation: industry tags, decision-maker, tech-leader, influencer, interest tags

### 2.2 Critical V1 Limitations for V2

1. **Playwright Dependency**: `enrich.mjs` directly scrapes LinkedIn pages -- this is being fully replaced
2. **Monolithic graph.json**: A single JSON file will not scale with enrichment data from 5-6 API sources
3. **No CSV Import Path**: V1 has no mechanism to ingest LinkedIn's native CSV export
4. **No API Enrichment Layer**: No infrastructure for PDL, Apollo, Lusha, Crunchbase, or BuiltWith integration
5. **Flat Contact Model**: The current `RvfMetadata` has no fields for emails, phones, funding data, technographics, or work history arrays
6. **No Chrome Extension Interface**: No data ingestion path from a browser extension
7. **Single-User Assumption**: No multi-account or team-aware data isolation
8. **Brittle Schema**: No schema versioning or migration path for adding enrichment fields

---

## 3. Expert Presentations

---

### 3.1 Dr. Elena Vasquez -- Graph Database Architecture

#### Domain Analysis

The V1 graph model is surprisingly sophisticated for a JSON file: contacts as nodes, typed edges with weights, cluster membership, and company aggregation. However, the monolithic `graph.json` approach has fundamental scaling issues as enrichment data grows from 7 CSV columns to potentially 50+ fields per contact across 6 API sources.

The V2 vision describes three node types (Person, Company, Niche/ICP Cluster) and five edge types (WORKS_AT, ENGAGED_WITH, SIMILAR_TO, NETWORK_PATH, WARM_INTRO_CANDIDATE). This is a property graph model, but the question is whether we need a graph *database* or a graph *data structure*.

#### Recommendation: Layered Graph Store

I recommend a **layered approach** rather than jumping to Neo4j:

```
+------------------------------------------------------------------+
|                       Graph Query Layer                           |
|   (Traversal, shortest path, cluster analysis, ICP matching)      |
+------------------------------------------------------------------+
|                    In-Memory Graph Engine                          |
|   (Property graph built from storage on startup, rebuilt on       |
|    import/enrichment, supports adjacency queries, BFS/DFS)        |
+------------------------------------------------------------------+
|                    Storage Abstraction Layer                       |
|   (Interface: loadGraph(), saveGraph(), getNode(), getEdges())    |
+------------------------------------------------------------------+
|   SQLite (primary)    |   JSON export    |   Future: Neo4j/       |
|   - contacts table    |   (graph.json    |   Memgraph adapter     |
|   - edges table       |    compat)       |   for large deploys    |
|   - enrichments table |                  |                        |
+------------------------------------------------------------------+
```

**Why SQLite over Neo4j for V2:**

1. **Local-first requirement**: The app runs on the user's machine. Neo4j requires a JVM and server process. SQLite is embedded.
2. **Dataset size**: ~1,000 contacts with enrichment data is comfortably within SQLite's sweet spot (up to 100K+ nodes trivially).
3. **Query patterns**: V1's queries are all either (a) key lookup by URL, (b) filtered list with sort/pagination, or (c) adjacency traversal. These are all efficient in SQLite with proper indexes.
4. **Migration path**: The `StorageAbstractionLayer` interface allows swapping to Neo4j later if datasets grow to 50K+ contacts.

**Graph structure in SQLite:**

```sql
-- Core contact node
CREATE TABLE contacts (
    id TEXT PRIMARY KEY,              -- LinkedIn URL (canonical)
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    headline TEXT,
    position TEXT,
    company TEXT,
    location TEXT,
    connected_on DATE,
    email TEXT,                        -- from CSV (if available)
    degree INTEGER DEFAULT 1,
    source TEXT DEFAULT 'csv_import',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Typed, weighted edges
CREATE TABLE edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL REFERENCES contacts(id),
    target_id TEXT NOT NULL REFERENCES contacts(id),
    edge_type TEXT NOT NULL,          -- WORKS_AT, ENGAGED_WITH, SIMILAR_TO, etc.
    weight REAL DEFAULT 1.0,
    metadata JSON,                    -- flexible edge attributes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_id, target_id, edge_type)
);

-- Cluster assignments (many-to-many)
CREATE TABLE cluster_memberships (
    contact_id TEXT REFERENCES contacts(id),
    cluster_id TEXT,
    is_hub BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (contact_id, cluster_id)
);

-- Company nodes
CREATE TABLE companies (
    id TEXT PRIMARY KEY,              -- slug
    name TEXT,
    industry TEXT,
    size_range TEXT,
    penetration_score REAL DEFAULT 0,
    metadata JSON,                    -- enrichment data
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Key indexes for graph traversal
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_type ON edges(edge_type);
CREATE INDEX idx_contacts_company ON contacts(company);
CREATE INDEX idx_contacts_tier ON contacts(tier);
```

**In-Memory Graph Engine Design:**

The in-memory graph should be rebuilt from SQLite on app startup and after import/enrichment operations. It provides:

- Adjacency list for O(1) neighbor lookups (replacing the current `AdjacencyMap`)
- BFS/DFS for shortest path and network path discovery
- Cluster detection algorithms (Louvain or label propagation)
- ICP similarity scoring using cosine similarity on feature vectors

**Migration from V1:**

graph.json continues to work as an export/import format. The `graph-cache.ts` module's API surface (`getEdgesForContact`, `getNeighbors`, `getClusterMembers`) becomes the interface for the new graph engine. The underlying storage changes from JSON file reads to SQLite queries, but the API contract stays identical.

#### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **SQLite (recommended)** | Zero-dependency, embedded, excellent for <100K nodes, ACID transactions, file-based backup | No native graph traversal language (Cypher), index management manual |
| **Neo4j Embedded** | Cypher queries, native graph algorithms, visualization tools | JVM dependency, 500MB+ memory, complex deployment for local-first app |
| **JSON files (current)** | Simple, human-readable, no dependencies | No concurrent writes, no indexing, O(n) scans, monolithic file load |
| **DuckDB** | Excellent analytics, columnar storage, embedded | Not optimized for graph traversal patterns |

---

### 3.2 Marcus Chen -- Data Pipeline Engineering

#### Domain Analysis

The V1 pipeline is a sequential script runner (`pipeline.mjs`) that orchestrates shell-spawned Node.js scripts. The V2 transition fundamentally changes the data ingestion story:

**V1 Input**: Playwright scrapes LinkedIn pages, producing enriched contact JSON.
**V2 Input**: Multiple CSV files from LinkedIn's native export + API responses from 5-6 enrichment providers + Chrome extension DOM captures.

The LinkedIn export provides **far richer** data than V1 realizes. Beyond `Connections.csv` (which has ~956 records), the export includes:

| CSV File | Records | Key Data |
|----------|---------|----------|
| `Connections.csv` | ~956 | First Name, Last Name, URL, Email, Company, Position, Connected On |
| `Positions.csv` | owner's history | Company, Title, Description, Location, Start/End dates |
| `Skills.csv` | owner's skills | Skill names |
| `Invitations.csv` | sent/received | From, To, Date, Direction, Profile URLs |
| `messages.csv` | conversation history | Conversation ID, From, To, Date, Subject, Content |
| `Endorsement_Received_Info.csv` | endorsements | Date, Skill, Endorser Name/URL |
| `Endorsement_Given_Info.csv` | given endorsements | Endorser details |
| `Recommendations_Given.csv` | recommendations given | Recipient details, text |
| `Recommendations_Received.csv` | recommendations received | Recommender details, text |
| `Company Follows.csv` | followed companies | Organization, Follow date |
| `Profile.csv` | owner profile | Name, Headline, Summary, Industry, Location, Websites |
| `Education.csv` | owner education | School, Dates, Degree, Activities |

#### Recommendation: Multi-Source CSV Import Pipeline

```
+-------------------------------------------------------------+
|                    CSV Import Orchestrator                    |
+-------------------------------------------------------------+
|                                                               |
|   Phase 1: Parse & Validate                                   |
|   +---------------------------+                               |
|   | CSV Parser (papaparse)    |-----> Validation Rules        |
|   | - Header detection        |       - Required fields       |
|   | - Encoding normalization  |       - URL format check      |
|   | - Note line skipping      |       - Date parsing          |
|   +---------------------------+       - Deduplication         |
|                                                               |
|   Phase 2: Entity Resolution                                  |
|   +---------------------------+                               |
|   | Contact Resolver          |                               |
|   | - URL canonicalization    |                               |
|   | - Name normalization      |                               |
|   | - Company slug generation |                               |
|   | - Merge with existing     |                               |
|   +---------------------------+                               |
|                                                               |
|   Phase 3: Graph Construction                                 |
|   +---------------------------+                               |
|   | Edge Builder              |                               |
|   | - CONNECTED_TO from CSV   |                               |
|   | - MESSAGED from messages  |                               |
|   | - ENDORSED from endorse   |                               |
|   | - RECOMMENDED             |                               |
|   | - INVITED_BY              |                               |
|   +---------------------------+                               |
|                                                               |
|   Phase 4: Signal Extraction                                  |
|   +---------------------------+                               |
|   | Relationship Signals      |                               |
|   | - Message frequency       |                               |
|   | - Connection recency      |                               |
|   | - Endorsement patterns    |                               |
|   | - Invitation directionality|                               |
|   +---------------------------+                               |
|                                                               |
+-------------------------------------------------------------+
```

**Critical Design Decision: Note Lines in Connections.csv**

LinkedIn's `Connections.csv` has a preamble note (2 lines) before the actual CSV header. The parser must:

1. Detect and skip non-header preamble lines (lines that do not match expected column headers)
2. Auto-detect the header row by matching known column names: `First Name`, `Last Name`, `URL`, `Email Address`, `Company`, `Position`, `Connected On`
3. Handle missing email addresses gracefully (LinkedIn only exports emails for connections who opted in)

**CSV-to-Entity Mapping:**

```
Connections.csv Row:
  First Name: "Jane"
  Last Name: "Smith"
  URL: "https://www.linkedin.com/in/janesmith"
  Email Address: "jane@example.com"
  Company: "Acme Corp"
  Position: "VP Engineering"
  Connected On: "13 Mar 2026"

                |
                v

Contact Entity:
  id: "https://www.linkedin.com/in/janesmith"
  first_name: "Jane"
  last_name: "Smith"
  display_name: "Jane Smith"
  email: "jane@example.com"
  company: "Acme Corp" ---------> Company Entity: { id: "acme-corp", name: "Acme Corp" }
  position: "VP Engineering"
  connected_on: "2026-03-13"
  source: "csv_import"
  degree: 1

Edge:
  source: owner_url
  target: "https://www.linkedin.com/in/janesmith"
  type: "CONNECTED_TO"
  weight: 1.0
```

**Incremental Import Strategy:**

V2 must support repeated CSV imports (user re-exports from LinkedIn periodically). The pipeline must:

1. **Detect new connections** by comparing URLs against existing contacts
2. **Update changed fields** (company, position changes indicate job moves -- a critical enrichment signal)
3. **Track import history** with timestamps for delta analysis
4. **Never delete contacts** on re-import -- only add or update (the user may have manually added data between imports)

```typescript
interface ImportResult {
  newContacts: number;
  updatedContacts: number;
  unchangedContacts: number;
  newEdges: number;
  jobChangesDetected: { contactId: string; oldCompany: string; newCompany: string }[];
  importTimestamp: string;
  csvFileHash: string;  // to detect duplicate imports
}
```

**Cross-CSV Enrichment:**

The `messages.csv` file is a goldmine for relationship strength scoring. By aggregating message frequency per conversation partner:

```
messages.csv --> aggregate by SENDER PROFILE URL + RECIPIENT PROFILE URLS
  --> message_count per contact pair
  --> last_message_date
  --> conversation_count
  --> message_direction_ratio (sent vs received)
```

This replaces V1's `recencyFactor()` and `proximityFactor()` with actual interaction data.

Similarly, `Invitations.csv` provides directionality:
- **Outgoing invitations**: user actively sought this connection (higher interest signal)
- **Incoming invitations**: the contact sought the user (potential lead signal)

`Endorsement_Received_Info.csv` and `Endorsement_Given_Info.csv` create bidirectional endorsement edges with skill-specific weights.

#### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **All-at-once import** | Simple, predictable | Slow for large exports, no partial progress |
| **Streaming import (recommended)** | Progress feedback, resumable, memory-efficient | More complex error handling |
| **Background worker import** | Non-blocking UI | Requires message passing, complexity |

---

### 3.3 Dr. Priya Sharma -- API Integration & Enrichment Orchestration

#### Domain Analysis

V2 replaces Playwright scraping with a multi-provider API enrichment pipeline. The V2 plan identifies six providers:

| Provider | Primary Data | Input | Cost Model |
|----------|-------------|-------|------------|
| **PDL (People Data Labs)** | Full profile, emails, phones, work history, education, skills | LinkedIn URL or name+company | ~$0.22-0.28/enrichment |
| **Apollo.io** | Emails, phones, buying intent, basic technographics | LinkedIn URL | Credits-based (~30K/yr at $49/mo) |
| **Lusha** | Verified emails and phones | LinkedIn URL | Credits (1/email, 5/phone) |
| **Crunchbase** | Funding, investors, revenue, acquisitions | Company name/domain | $99/mo for Pro |
| **BuiltWith/TheirStack** | Technographics (tech stack) | Company domain | $59-295/mo |
| **Clay** | Orchestration layer (waterfall across above) | Various | ~$185/mo |

#### Recommendation: Waterfall Enrichment Engine

```
+-------------------------------------------------------------------+
|                    Enrichment Orchestrator                          |
+-------------------------------------------------------------------+
|                                                                     |
|   Input: Contact { url, name, company, position }                  |
|                                                                     |
|   Step 1: Check Cache                                              |
|   +---------------------------+                                     |
|   | Enrichment Cache          |  Hit? --> Return cached data        |
|   | - TTL: 30 days (person)   |  Miss? --> Continue to providers    |
|   | - TTL: 90 days (company)  |                                     |
|   +---------------------------+                                     |
|                                                                     |
|   Step 2: Provider Waterfall (Person)                              |
|   +-----+     +--------+     +------+                              |
|   | PDL |---->| Apollo  |---->| Lusha |                             |
|   +-----+     +--------+     +------+                              |
|   (if no      (if PDL         (if still                             |
|    result)     incomplete)     no email)                            |
|                                                                     |
|   Step 3: Provider Waterfall (Company)                             |
|   +------------+     +-----------+                                  |
|   | Crunchbase |---->| BuiltWith |                                  |
|   +------------+     +-----------+                                  |
|   (funding,           (tech stack)                                  |
|    revenue)                                                        |
|                                                                     |
|   Step 4: Merge & Score                                            |
|   +---------------------------+                                     |
|   | Data Merger               |                                     |
|   | - Conflict resolution     |                                     |
|   | - Confidence scoring      |                                     |
|   | - Source attribution      |                                     |
|   +---------------------------+                                     |
|                                                                     |
|   Output: EnrichedContact { ...all fields, sources[], confidence } |
+-------------------------------------------------------------------+
```

**Waterfall Logic:**

The key insight is that different providers excel at different data types. The waterfall should be **field-aware**, not provider-aware:

```typescript
interface EnrichmentField {
  fieldName: string;
  value: unknown;
  source: string;              // "pdl" | "apollo" | "lusha" | "crunchbase" | "builtwith"
  confidence: number;          // 0.0 - 1.0
  retrievedAt: string;
  ttl: number;                 // seconds until stale
}

interface WaterfallConfig {
  personFields: {
    email: { providers: ["pdl", "apollo", "lusha"], stopOnFirst: true };
    phone: { providers: ["lusha", "pdl", "apollo"], stopOnFirst: true };
    workHistory: { providers: ["pdl"], stopOnFirst: true };
    skills: { providers: ["pdl"], stopOnFirst: true };
    intentSignals: { providers: ["apollo"], stopOnFirst: true };
  };
  companyFields: {
    funding: { providers: ["crunchbase"], stopOnFirst: true };
    techStack: { providers: ["builtwith"], stopOnFirst: true };
    revenue: { providers: ["crunchbase"], stopOnFirst: true };
  };
}
```

**Cost Management Architecture:**

```
+-------------------------------------------------------------------+
|                     Budget & Rate Manager                           |
+-------------------------------------------------------------------+
|                                                                     |
|   Per-Provider Budgets:                                            |
|   +------------------+------------------+------------------+        |
|   | PDL              | Apollo           | Lusha            |        |
|   | daily: 50 calls  | daily: 100 calls | daily: 40 calls  |        |
|   | monthly: 350     | monthly: 2500    | monthly: 600     |        |
|   | cost/call: $0.28 | cost/call: $0.02 | cost/call: $0.09 |        |
|   +------------------+------------------+------------------+        |
|                                                                     |
|   Rate Limiters (per provider):                                    |
|   - PDL: 10 req/sec, 350/month                                    |
|   - Apollo: 50 req/sec, 2500/month                                |
|   - Lusha: 5 req/sec, 600/month                                   |
|   - Crunchbase: 200/day                                            |
|   - BuiltWith: 500/day                                             |
|                                                                     |
|   Cost Estimator:                                                  |
|   - Before enrichment: estimate total cost                         |
|   - Show cost breakdown per provider                               |
|   - User approval for batches above threshold                      |
|   +---------------------------+                                     |
|   | "Enrich 50 contacts?"     |                                     |
|   | PDL: ~$14.00 (50 calls)   |                                     |
|   | Apollo: ~$1.00 (50 calls) |                                     |
|   | Total: ~$15.00            |                                     |
|   | [Approve] [Skip Apollo]   |                                     |
|   +---------------------------+                                     |
|                                                                     |
+-------------------------------------------------------------------+
```

**Provider Abstraction Layer:**

Each provider implements a common interface:

```typescript
interface EnrichmentProvider {
  name: string;
  isConfigured(): boolean;       // API key present?
  getCreditsRemaining(): Promise<number>;
  enrichPerson(input: PersonEnrichInput): Promise<PersonEnrichResult>;
  enrichCompany(input: CompanyEnrichInput): Promise<CompanyEnrichResult>;
  getRateLimitStatus(): RateLimitStatus;
}

interface PersonEnrichInput {
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
}

interface PersonEnrichResult {
  success: boolean;
  emails: { email: string; type: string; confidence: number }[];
  phones: { number: string; type: string }[];
  workHistory: WorkHistoryEntry[];
  education: EducationEntry[];
  skills: string[];
  socialProfiles: Record<string, string>;
  rawResponse: unknown;          // full API response for debugging
  creditsConsumed: number;
  provider: string;
}
```

**Batch Enrichment Strategy:**

The UI should present enrichment as a configurable operation with cost transparency:

1. User selects contacts (or applies filter: "all gold tier", "unenriched only")
2. System estimates cost per provider and total
3. User selects which providers to use and confirms budget
4. Enrichment runs with progress tracking, storing results as they arrive
5. Partial results are usable immediately (no all-or-nothing)

**API Key Storage:**

API keys should be stored in a local configuration file (never committed), separate from the app's data:

```
~/.linkedin-prospector/config/api-keys.json  (or use OS keychain)
{
  "pdl": { "apiKey": "...", "configured": true },
  "apollo": { "apiKey": "...", "configured": true },
  "lusha": { "apiKey": "...", "configured": false },
  "crunchbase": { "apiKey": "...", "configured": false },
  "builtwith": { "apiKey": "...", "configured": false }
}
```

#### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **Waterfall (recommended)** | Cost-efficient, stops early when data found | Slower for batch (sequential per provider) |
| **Parallel all providers** | Fastest, most complete data | Expensive, wastes credits when first provider suffices |
| **Clay orchestrator** | Handles waterfall automatically, built-in data cleaning | $185/mo cost, external dependency, less control |
| **Manual provider selection** | User has full control | Bad UX, requires provider knowledge |

---

### 3.4 James Okonkwo -- Data Modeling

#### Domain Analysis

The V1 data model is split across two incompatible shapes:

1. **`GraphContact`** (in graph.json): 40+ fields, nested objects (`scores`, `behavioralSignals`, `referralSignals`, `activity`), deeply coupled to scoring algorithms
2. **`RvfMetadata`** (in network.rvf): Flattened version of GraphContact with 35 fields, designed for vector storage constraints

V2 must accommodate:
- 7 CSV import fields per contact (base data)
- 20+ enrichment fields from PDL/Apollo/Lusha (person enrichment)
- 10+ fields from Crunchbase/BuiltWith (company enrichment)
- Behavioral data from Chrome extension (dynamic, append-only)
- Scoring outputs (unchanged from V1 but with new input dimensions)
- Multiple ICP/niche memberships (not single assignment)

#### Recommendation: Normalized Entity Model with Enrichment Layers

```
+-------------------------------------------------------------------+
|                     Entity Relationship Diagram                     |
+-------------------------------------------------------------------+

  +------------------+       +------------------+
  |    contact        |       |    company        |
  +------------------+       +------------------+
  | id (PK)          |       | id (PK)          |
  | first_name       |  M:1  | name             |
  | last_name        |------>| industry         |
  | display_name     |       | size_range       |
  | linkedin_url (U) |       | website          |
  | email            |       | founded_year     |
  | position         |       | created_at       |
  | headline         |       | updated_at       |
  | location         |       +------------------+
  | connected_on     |              |
  | degree           |              | 1:M
  | source           |              v
  | created_at       |       +------------------+
  | updated_at       |       | company_enrich   |
  +------------------+       +------------------+
         |                   | company_id (FK)  |
         | 1:M               | source           |
         v                   | funding_total    |
  +------------------+       | revenue_range    |
  | contact_enrich   |       | tech_stack (JSON)|
  +------------------+       | investors (JSON) |
  | contact_id (FK)  |       | employee_count   |
  | source           |       | growth_signals   |
  | field_name       |       | retrieved_at     |
  | field_value      |       | ttl_expires_at   |
  | confidence       |       +------------------+
  | retrieved_at     |
  | ttl_expires_at   |
  +------------------+
         |
         | 1:M
         v
  +------------------+       +------------------+
  | work_history     |       | contact_score    |
  +------------------+       +------------------+
  | id (PK)          |       | contact_id (FK)  |
  | contact_id (FK)  |       | score_version    |
  | company          |       | icp_fit          |
  | title            |       | network_hub      |
  | start_date       |       | relationship_str |
  | end_date         |       | signal_boost     |
  | is_current       |       | skills_relevance |
  | source           |       | network_proximity|
  +------------------+       | gold_score       |
                              | tier             |
  +------------------+       | persona          |
  | edge             |       | scored_at        |
  +------------------+       +------------------+
  | id (PK)          |
  | source_id (FK)   |       +------------------+
  | target_id (FK)   |       | behavioral_data  |
  | edge_type        |       +------------------+
  | weight           |       | contact_id (FK)  |
  | metadata (JSON)  |       | data_type        |
  | created_at       |       | data_value (JSON)|
  +------------------+       | captured_at      |
                              | source           |
  +------------------+       +------------------+
  | cluster          |
  +------------------+       +------------------+
  | id (PK)          |       | import_history   |
  | label            |       +------------------+
  | keywords (JSON)  |       | id (PK)          |
  | created_at       |       | file_name        |
  +------------------+       | file_hash        |
         |                   | record_count     |
         | M:N               | new_contacts     |
         v                   | updated_contacts |
  +------------------+       | imported_at      |
  | cluster_member   |       +------------------+
  +------------------+
  | cluster_id (FK)  |
  | contact_id (FK)  |
  | is_hub           |
  +------------------+
```

**Key Design Decisions:**

1. **Enrichment as separate tables, not columns on contact**: This allows multiple sources per field (PDL says "VP Engineering", Apollo says "SVP Engineering"), preserves provenance, and supports TTL-based refresh without touching the core contact record.

2. **Score history via `score_version`**: Each scoring run gets a version number. This enables delta analysis ("which contacts moved tiers?") and rollback. The V1 `delta.mjs` script currently does this via file snapshots; V2 does it via versioned rows.

3. **Behavioral data as append-only**: Chrome extension captures are timestamped events (profile views, post snapshots, engagement observations). These should never be overwritten -- they form a time series.

4. **JSON columns for flexible data**: Fields like `tech_stack`, `investors`, `metadata` use JSON columns. SQLite supports `json_extract()` for querying into these fields without full normalization.

**Schema Versioning:**

```typescript
interface SchemaVersion {
  version: number;
  appliedAt: string;
  description: string;
}

// Store in a _schema_versions table
// Each migration is an idempotent SQL script
// App checks version on startup and runs pending migrations
```

Migration example:
```sql
-- Migration 003: Add enrichment TTL tracking
ALTER TABLE contact_enrich ADD COLUMN ttl_expires_at TIMESTAMP;
ALTER TABLE company_enrich ADD COLUMN ttl_expires_at TIMESTAMP;
CREATE INDEX idx_enrich_ttl ON contact_enrich(ttl_expires_at);
```

**Backward Compatibility with V1:**

The V1 `GraphContact` type and `graph.json` format must remain exportable for backward compatibility. A `GraphExporter` module can reconstruct the V1 shape from the normalized tables:

```typescript
async function exportToGraphJson(): Promise<GraphData> {
  const contacts = await db.all('SELECT * FROM contacts');
  const edges = await db.all('SELECT * FROM edges');
  // ... reconstruct V1 shape
  return { contacts: {}, edges: [], clusters: {}, companies: {}, meta: {} };
}
```

#### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **Normalized tables (recommended)** | Clean separation of concerns, queryable, versionable | More complex queries for full contact view |
| **Single wide table** | Simple queries, fast reads | Schema changes break everything, 50+ columns |
| **Document store (JSON per contact)** | Flexible schema, easy to add fields | No relational queries, duplication |
| **EAV (entity-attribute-value)** | Infinitely flexible | Terrible query performance, no type safety |

---

### 3.5 Dr. Sarah Kim -- Privacy & Compliance

#### Domain Analysis

V1 already has commendable GDPR foundations:
- `--forget` command for right to erasure (purges across all data files)
- `--auto-archive` for data minimization (180-day terminal state archival)
- `--consent` for recording consent basis (legitimate_interest, explicit_consent, contract)
- GDPR consent tracking on `graph.contacts[url].gdpr`

V2 introduces new compliance challenges:
1. **CSV import contains PII**: Names, emails, connection dates are personal data under GDPR
2. **API enrichment amplifies PII**: Enrichment adds phone numbers, work history, education -- expanding the personal data footprint significantly
3. **Chrome extension captures behavioral data**: Profile views, post content, engagement patterns
4. **Multiple data sources require provenance tracking**: GDPR requires knowing *where* each piece of data came from
5. **Data subject access requests (DSAR)**: Users of the tool may receive requests from their contacts asking "what data do you have on me?"

#### Recommendation: Privacy-by-Design Data Layer

**1. Data Classification System:**

Every field in the database should have a privacy classification:

```typescript
enum PrivacyClass {
  PUBLIC = "public",           // Data visible on public LinkedIn profiles
  SEMI_PRIVATE = "semi-private", // Data from LinkedIn export (user-shared)
  PRIVATE = "private",         // Data from paid enrichment APIs (emails, phones)
  SENSITIVE = "sensitive",     // Behavioral observations, scoring outputs
  INTERNAL = "internal",       // System metadata (import timestamps, hashes)
}

interface FieldClassification {
  "contact.first_name": PrivacyClass.SEMI_PRIVATE;
  "contact.email": PrivacyClass.PRIVATE;
  "contact.position": PrivacyClass.PUBLIC;
  "enrichment.phone": PrivacyClass.PRIVATE;
  "behavioral.post_content": PrivacyClass.SENSITIVE;
  "score.gold_score": PrivacyClass.INTERNAL;
}
```

**2. Consent & Legal Basis Tracking (Enhanced):**

V2 needs per-source legal basis tracking, not just per-contact:

```sql
CREATE TABLE data_provenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL,
    data_source TEXT NOT NULL,        -- 'csv_import', 'pdl', 'apollo', 'chrome_ext'
    legal_basis TEXT NOT NULL,        -- 'legitimate_interest', 'explicit_consent'
    basis_details TEXT,               -- "User imported own LinkedIn connections"
    first_collected_at TIMESTAMP,
    last_processed_at TIMESTAMP,
    retention_expires_at TIMESTAMP,   -- auto-calculated based on policy
    is_active BOOLEAN DEFAULT TRUE
);
```

**3. Right to Erasure (Enhanced `--forget`):**

The V1 `forgetContact()` function is good but must be extended for V2's multi-table schema:

```typescript
async function forgetContact(contactUrl: string): Promise<ForgetResult> {
  const tx = db.transaction(() => {
    // Delete in correct order (foreign key constraints)
    db.run('DELETE FROM behavioral_data WHERE contact_id = ?', [contactUrl]);
    db.run('DELETE FROM contact_enrich WHERE contact_id = ?', [contactUrl]);
    db.run('DELETE FROM work_history WHERE contact_id = ?', [contactUrl]);
    db.run('DELETE FROM contact_score WHERE contact_id = ?', [contactUrl]);
    db.run('DELETE FROM cluster_member WHERE contact_id = ?', [contactUrl]);
    db.run('DELETE FROM edges WHERE source_id = ? OR target_id = ?', [contactUrl, contactUrl]);
    db.run('DELETE FROM data_provenance WHERE contact_id = ?', [contactUrl]);
    db.run('DELETE FROM contacts WHERE id = ?', [contactUrl]);
    // Also purge from vector store
  });
  tx();
  // Log the erasure for compliance audit
  await logErasureEvent(contactUrl);
  return { success: true, tablesAffected: 7 };
}
```

**4. Data Retention Policies:**

```typescript
interface RetentionPolicy {
  csvImportData: { ttl: "indefinite", basis: "user_imported_own_data" };
  enrichmentData: { ttl: "365_days", basis: "legitimate_interest", renewOnAccess: true };
  behavioralData: { ttl: "180_days", basis: "legitimate_interest" };
  scoringData: { ttl: "indefinite", basis: "derived_data" };
  messageAnalytics: { ttl: "90_days", basis: "legitimate_interest" };
  archivedContacts: { ttl: "30_days_after_archive", basis: "data_minimization" };
}
```

**5. DSAR (Data Subject Access Request) Export:**

```typescript
async function generateDSAR(contactUrl: string): Promise<DSARReport> {
  return {
    contact: await getContactById(contactUrl),
    enrichmentData: await getEnrichmentsByContact(contactUrl),
    behavioralData: await getBehavioralDataByContact(contactUrl),
    scores: await getScoresByContact(contactUrl),
    edges: await getEdgesByContact(contactUrl),
    provenance: await getProvenanceByContact(contactUrl),
    exportedAt: new Date().toISOString(),
    format: "JSON",
  };
}
```

**6. PII in Development:**

The V2 plan explicitly warns: "make SURE we do not integrate any PII from this into the app." The development workflow must:

- Never commit the `LinkedinExport/` directory (already in `.gitignore`)
- Use synthetic test data for unit tests (generate with Faker.js)
- Sanitize all examples in documentation (as this document does)
- Never log actual contact data in error messages

#### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **Privacy-by-design (recommended)** | GDPR compliant, audit-ready, trust-building | More complex data layer, slight performance overhead |
| **Retroactive compliance** | Faster initial development | Technical debt, risk of violations, expensive to retrofit |
| **Minimal PII storage** | Least risk | Reduces product value (no emails, no enrichment) |

---

### 3.6 Raj Patel -- Local-First Architecture

#### Domain Analysis

The V1 system is already local-first: all data lives on disk (`graph.json`, `contacts.json`, `network.rvf`), the Next.js app runs locally, and there is no cloud backend. V2 must maintain this property while adding:

1. API calls to external enrichment providers (requires network, but data is stored locally)
2. Chrome extension communication (localhost WebSocket or HTTP)
3. Larger dataset sizes (enrichment data expands storage 5-10x)
4. Potential multi-device usage (laptop + desktop)

#### Recommendation: SQLite + File-Based Hybrid Architecture

```
+-------------------------------------------------------------------+
|                    Local-First Data Architecture                    |
+-------------------------------------------------------------------+
|                                                                     |
|   Primary Store: SQLite                                            |
|   +---------------------------+                                     |
|   | network.db                |  <-- Single file, portable,        |
|   | - contacts                |      ACID transactions,            |
|   | - edges                   |      WAL mode for concurrency,     |
|   | - enrichments             |      instant backup via file copy   |
|   | - scores                  |                                     |
|   | - provenance              |                                     |
|   +---------------------------+                                     |
|                                                                     |
|   Vector Store: RVF (unchanged)                                    |
|   +---------------------------+                                     |
|   | network.rvf               |  <-- HNSW-indexed embeddings,      |
|   | - 384-dim vectors         |      semantic search,              |
|   | - metadata (flattened)    |      keep for similarity queries   |
|   +---------------------------+                                     |
|                                                                     |
|   Import Stage: File System                                        |
|   +---------------------------+                                     |
|   | .linkedin-prospector/     |                                     |
|   |   LinkedinExport/         |  <-- User drops CSV files here     |
|   |     Connections.csv       |                                     |
|   |     messages.csv          |                                     |
|   |     ...                   |                                     |
|   |   imports/                |  <-- Processed import artifacts     |
|   |     2026-03-13_import.log |                                     |
|   +---------------------------+                                     |
|                                                                     |
|   Config: File System                                              |
|   +---------------------------+                                     |
|   | .linkedin-prospector/     |                                     |
|   |   config/                 |                                     |
|   |     api-keys.json         |  <-- Encrypted or OS keychain      |
|   |     icp-config.json       |                                     |
|   |     rate-budget.json      |                                     |
|   |     retention-policy.json |                                     |
|   +---------------------------+                                     |
|                                                                     |
+-------------------------------------------------------------------+
```

**SQLite Configuration for Local-First:**

```typescript
const db = new Database('network.db', {
  // WAL mode: allows concurrent reads during writes
  // Critical for UI responsiveness during import/enrichment
  pragma: {
    journal_mode: 'WAL',
    synchronous: 'NORMAL',     // Good balance of safety and speed
    foreign_keys: 'ON',
    cache_size: -64000,        // 64MB cache
    busy_timeout: 5000,        // 5s wait on lock
  }
});
```

**Offline Capability Matrix:**

| Feature | Online Required? | Offline Behavior |
|---------|-----------------|------------------|
| CSV import | No | Full functionality |
| View contacts/graph | No | Full functionality |
| Scoring/analysis | No | Full functionality |
| API enrichment | Yes | Queue requests, execute when online |
| Chrome extension capture | No | Extension stores locally, syncs to app |
| Export/backup | No | Full functionality |

**Chrome Extension Communication:**

The extension communicates with the local Next.js app via localhost HTTP:

```
Chrome Extension                    Local App (Next.js)
+----------------+                 +------------------+
| Content Script |  --- HTTP --->  | API Route        |
| (reads DOM)    |  localhost:3000 | /api/extension/  |
|                |                 |   capture        |
| Popup UI       |  <-- HTTP ---  | /api/extension/  |
| (task list,    |  localhost:3000 |   tasks          |
|  clipboard)    |                 |                  |
+----------------+                 +------------------+
```

**Backup Strategy:**

SQLite's single-file nature makes backup trivial:

```typescript
async function backup(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${DATA_DIR}/backups/network-${timestamp}.db`;
  await db.backup(backupPath);
  return backupPath;
}
```

**Data Directory Structure (V2):**

```
.linkedin-prospector/
  data/
    network.db              <-- SQLite (replaces graph.json + contacts.json)
    network.rvf             <-- Vector store (unchanged)
    backups/
      network-2026-03-13.db
  LinkedinExport/           <-- User's CSV export (read-only input)
    Connections.csv
    messages.csv
    ...
  imports/
    2026-03-13T10-30-00.log <-- Import history
  config/
    api-keys.json           <-- Provider credentials (encrypted)
    icp-config.json         <-- ICP configuration
    rate-budget.json        <-- Rate limiting state
    retention-policy.json   <-- GDPR retention rules
```

**Migration Path from V1:**

```typescript
async function migrateV1toV2(): Promise<MigrationResult> {
  // 1. Read existing graph.json
  const graphData = await readJsonPath<GraphData>(GRAPH_JSON_PATH);

  // 2. Create SQLite schema
  await createTables(db);

  // 3. Import contacts
  for (const [url, contact] of Object.entries(graphData.contacts)) {
    await insertContact(db, url, contact);
    await insertScores(db, url, contact.scores);
    // ... behavioral, referral, etc.
  }

  // 4. Import edges
  for (const edge of graphData.edges) {
    await insertEdge(db, edge);
  }

  // 5. Import clusters, companies
  // ...

  // 6. Keep graph.json as backup, mark as migrated
  return { contactsMigrated, edgesMigrated, clustersMigrated };
}
```

#### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **SQLite + RVF (recommended)** | Best of both worlds: relational queries + vector search | Two storage systems to maintain |
| **SQLite only (with FTS5)** | Single storage system, full-text search via FTS5 | No vector similarity search |
| **IndexedDB (browser-only)** | Works in extension too | Size limits, no SQL, poor for server-side |
| **PouchDB/CouchDB** | Sync built in, offline-first | Over-engineered for single-user, document model |

---

## 4. Panel Consensus

After extensive discussion, the panel reaches the following consensus recommendations:

### 4.1 Storage: SQLite + RVF Dual-Store

- **SQLite** (`network.db`) replaces `graph.json` and `contacts.json` as the primary structured data store
- **RVF** (`network.rvf`) continues to serve as the vector store for semantic search
- Data flows: CSV -> SQLite (import), API -> SQLite (enrichment), SQLite -> RVF (vectorization)
- graph.json remains as an export format for backward compatibility and human inspection

### 4.2 Schema: Normalized with JSON Escape Hatches

- Core entities (contacts, companies, edges, clusters) get their own tables with proper foreign keys
- Enrichment data stored in separate tables with source attribution and TTL
- Flexible fields (tech stack, metadata) use SQLite JSON columns
- Schema versioning via a migrations table

### 4.3 Import Pipeline: Multi-CSV with Incremental Support

- Parse all available LinkedIn export CSVs (not just Connections.csv)
- Extract relationship signals from messages.csv, Invitations.csv, endorsement CSVs
- Support incremental re-import with change detection (job changes, new connections)
- File hash tracking to prevent duplicate imports

### 4.4 Enrichment: Waterfall with Cost Transparency

- Provider abstraction layer with common interface
- Field-aware waterfall: try cheapest/best provider per field first
- Budget management with per-provider limits and cost estimation before execution
- 30-day TTL for person enrichment, 90-day for company enrichment

### 4.5 Privacy: By-Design with Provenance Tracking

- Every data point tracks its source and legal basis
- Enhanced `--forget` covers all tables with transactional deletion
- DSAR export capability
- Data classification system (public/semi-private/private/sensitive)
- Retention policies with automatic expiry

### 4.6 Migration: Seamless V1 to V2

- One-time migration script reads graph.json and populates SQLite
- V1 scoring algorithms work unchanged (input comes from SQLite instead of JSON)
- graph.json export for any tooling that depends on the old format
- RVF store continues to work during and after migration

### 4.7 Architecture Principles

1. **Local-first**: All data resides on the user's machine. Network needed only for API enrichment.
2. **Progressive enrichment**: System is useful with CSV data alone; enrichment adds value incrementally.
3. **Cost-aware**: User always knows what enrichment will cost before it runs.
4. **Privacy-respecting**: GDPR compliance is structural, not bolted on.
5. **Backward-compatible**: V1 data and V1 export formats continue to work.

---

## 5. Questions for the Product Owner

The panel has identified the following open questions that directly affect architectural decisions. Answers to these questions will materially change the data model, storage approach, or pipeline design.

### Q1: Maximum Contact Scale
What is the expected maximum number of contacts per user instance? The LinkedIn export shows ~956 connections, but with 2nd-degree discovery and enrichment, this could grow significantly. Our SQLite recommendation works well up to ~100,000 contacts. Beyond that, we would need to evaluate Neo4j or PostgreSQL. What is the upper bound we should design for?

### Q2: Multi-LinkedIn-Account Support
Should the system support importing data from multiple LinkedIn accounts (e.g., a team scenario where several sales reps each export their connections)? This affects whether `contact.id` is globally unique or scoped per account, and whether the graph should support multiple "owner" nodes.

### Q3: Enrichment Data Storage Separation
Should enrichment data from APIs (emails, phones, work history) be stored alongside the core contact record in a single view, or in separate enrichment tables with provenance? The former is simpler to query but loses source attribution. The latter preserves "PDL says this email, Apollo says that email" but requires JOIN queries for the UI.

**Panel recommendation**: Separate tables with a materialized "current best" view, but we want to confirm this aligns with how the UI will display enrichment data.

### Q4: Chrome Extension Data Model
What specific data elements will the Chrome extension capture from LinkedIn pages? The V2 plan mentions "About section, visible recent posts, comments/likes, activity cadence, mutual connections." Should we design a generic `behavioral_observation` table (type + JSON value), or specific tables per observation type (posts, engagement, profile_views)?

### Q5: Message Analysis Scope
The `messages.csv` export contains full message content (1MB+ of conversation data). Should the system:
- (a) Only extract metadata (message count, frequency, recency per contact) for relationship scoring?
- (b) Store full message content for LLM-powered analysis (e.g., Claude analyzing conversation topics)?
- (c) Analyze messages on import but discard content after extracting signals?

This significantly affects storage size and privacy posture.

### Q6: ICP/Niche Dynamics
The V2 plan says "ICP and Niche should be more dynamic" and users may have "more than one." Should the data model support:
- Multiple active ICP profiles simultaneously (e.g., "AI Startups" + "Enterprise E-Commerce")?
- User-defined niches that emerge from data clustering?
- Per-ICP scoring (a contact could be Gold for one ICP and Bronze for another)?

If per-ICP scoring is needed, the `contact_score` table needs a `icp_profile_id` foreign key, which changes the scoring pipeline significantly.

### Q7: Real-Time vs Batch Processing
Should enrichment and scoring be:
- (a) Batch-only (user triggers "Enrich selected contacts" or "Re-score all")?
- (b) Event-driven (new CSV import auto-triggers scoring, new enrichment data auto-triggers re-scoring)?
- (c) Real-time with the Chrome extension (new DOM capture triggers immediate graph update)?

This affects whether we need a task queue, event bus, or simple function calls.

### Q8: Data Export and Interoperability
Beyond the existing graph.json export, should V2 support:
- CSV export of enriched contacts (for CRM import)?
- CRM integration (HubSpot, Salesforce direct sync)?
- Standard graph formats (GraphML, GEXF for visualization tools like Gephi)?

This affects whether we need an export abstraction layer or just JSON/CSV.

### Q9: Enrichment Provider Priority
The V2 plan lists 6 providers (PDL, Apollo, Lusha, Crunchbase, BuiltWith, Clay). For the initial V2 release, which providers are mandatory vs nice-to-have? Should we build the abstraction layer for all 6 but only implement 2-3 initially? This affects the scope of the provider interface and testing requirements.

### Q10: Vector Store Future
The current RVF store uses 384-dimensional embeddings. With enrichment data adding many new text fields (about sections, post content, work history descriptions), should we:
- (a) Keep the same 384-dim embeddings but rebuild with richer input text?
- (b) Move to larger embeddings (768 or 1024 dim) for better semantic separation?
- (c) Support multiple embedding spaces (one for profile similarity, one for content/topic similarity)?

### Q11: Scoring Algorithm Migration
The V1 scorer has a sophisticated multi-dimensional scoring system (7 dimensions, weighted with dynamic redistribution). With V2's richer data (actual message frequency instead of proxy signals, real enrichment data instead of scraped approximations), should the scoring weights be recalibrated? Should we version the scoring algorithm so users can compare V1-era scores with V2-era scores on the same contacts?

### Q12: Offline Enrichment Queue
When the user marks contacts for enrichment but is offline (or has exhausted API rate limits), should the system:
- (a) Queue the requests and execute when online/budget-available (requires a persistent queue)?
- (b) Simply show an error and let the user retry?
- (c) Provide a "scheduled enrichment" feature (e.g., "enrich 10 contacts per day at 9am")?

This affects whether we need a job scheduler or just synchronous API calls.

---

*Panel 1 presentation prepared for the Version 2 Symposium. All technical recommendations are subject to revision based on product owner answers to the questions above.*
