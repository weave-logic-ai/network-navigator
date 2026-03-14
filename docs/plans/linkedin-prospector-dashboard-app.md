# LinkedIn Network Intelligence Dashboard — Application Plan

**Created**: 2026-03-12
**Method**: Expert Symposium (5 domain specialists)
**Location**: `.claude/linkedin-prospector/app/`
**Data Source**: `.linkedin-prospector/data/`
**Primary Data Layer**: RVF (RuVector Format) via `ruvector` — 5,289 vectors, 384-dim HNSW-indexed

---

## Executive Summary

A local Next.js 15 + shadcn/ui dashboard application for exploring, analyzing, and acting on LinkedIn network intelligence data. The app uses an **RVF-first data architecture** — the `network.rvf` vector store (33MB, 5,289 contacts with 384-dim HNSW-indexed embeddings and 40+ metadata fields per entry) is the primary data source for all contact operations, with `graph.json` as a supplementary source for edge data, cluster structures, and company aggregations that RVF doesn't store. This provides semantic search capabilities, fast k-NN similarity lookups, and efficient metadata filtering without parsing a 44MB JSON file.

**Key characteristics:**
- Single-user local tool (localhost)
- **RVF vector store as primary data layer** — `ruvector` VectorDB with HNSW indexing
- Graph.json as supplementary source (edges, clusters, companies only)
- Dark mode primary, data-dense power-user interface
- Semantic search via OnnxEmbedder (384-dim) + k-NN vector queries
- Hybrid 3D network graph (server-side pruning + client-side Three.js)
- SSE-based process streaming for script execution
- Real-time config editing with "What If" scoring preview

---

## 1. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 (App Router) | Server components for data-heavy pages, API routes for backend ops |
| UI Library | shadcn/ui + Tailwind CSS | Full source control, excellent dark mode, data-dense components |
| Charts | Recharts (via shadcn Chart) | Theme-integrated, good performance, supports radar/area/bar/pie |
| 3D Graph | 3d-force-graph + Three.js | Already proven in existing report-generator.mjs |
| Data Tables | TanStack Table | Handles 5,000+ rows with virtualization, type-safe columns |
| Vector Store | ruvector (VectorDB) | RVF-first data access — HNSW search, metadata filtering, k-NN similarity |
| Embeddings | ruvector (OnnxEmbedder) | 384-dim semantic embeddings for search queries |
| Data Fetching | SWR | Client-side polling with 5s refresh intervals |
| Dark Mode | next-themes | Instant CSS variable swapping, system preference detection |
| Icons | Lucide React | Already used by shadcn |
| Process Mgmt | child_process.spawn | SSE streaming of stdout/stderr |
| File Watching | chokidar (optional) | Cache invalidation on external file changes |

### Initialization Commands

```bash
npx create-next-app@latest .claude/linkedin-prospector/app --typescript --tailwind --eslint --app
cd .claude/linkedin-prospector/app
npx shadcn@latest init
npx shadcn@latest add card table chart sidebar command tabs badge tooltip \
  button input separator breadcrumb sheet avatar dropdown-menu \
  dialog select checkbox scroll-area skeleton slider accordion \
  navigation-menu progress alert-dialog
npm install next-themes @tanstack/react-table recharts swr lucide-react ruvector
```

---

## 2. Page Structure & Navigation

### Sidebar Navigation (256px, collapsible to 64px)

```
[App Logo: "Network Intelligence"]
[Collapse toggle]

--- Primary ---
Dashboard          (LayoutDashboard)     /
Network            (Network)             /network
Contacts           (Users)               /contacts
ICP & Niches       (Target)              /icp
Outreach Pipeline  (GitBranch)           /outreach

--- System ---
Actions            (Play)                /actions
Configuration      (Settings)            /config

--- Footer ---
Rate Budget Meter  (inline progress bar, always visible)
Last Sync Time     (from graph.meta.lastScored)
```

**Navigation behaviors:**
- Active page highlighted with left border accent
- Badge counts on nav items (Contacts: "5,289", Pipeline: planned count)
- Rate budget meter color-coded: green (<50%), amber (50-80%), red (>80%)
- Sidebar state persists to localStorage

### URL Structure

```
/                           Dashboard (home)
/network                    3D network graph + cluster explorer
/network?cluster=saas       Graph filtered to cluster
/contacts                   Contacts data table
/contacts/[slug]            Contact detail (slug = linkedin handle)
/contacts/[slug]?tab=outreach  Contact with outreach tab active
/icp                        ICP & Niche overview
/icp/[niche-slug]           Drill into specific niche
/outreach                   Outreach pipeline
/actions                    Process runner
/config                     Configuration editor
```

---

## 3. Dashboard Home Page (`/`)

### Layout Grid (4 columns)

```
Row 1: [Total Contacts] [Gold Tier] [Silver Tier] [Bronze Tier]
Row 2: [Outreach Conversion] [Network Reach] [Rate Budget Status (span 2)]
Row 3: [Top 5 Gold Contacts (span 2)] [Top 5 Suggested Actions (span 2)]
Row 4: [Recent Activity (span 3)] [Quick Actions (span 1)]
```

### KPI Cards

| Card | Value | Secondary |
|------|-------|-----------|
| Total Contacts | 5,289 | +N since last refresh |
| Gold Tier | 62 | 1.2% of total |
| Silver Tier | 461 | 8.7% of total |
| Bronze Tier | 2,150 | 40.7% of total |
| Outreach Conversion | % converted | N converted / M sent |
| Network Reach | Unique 2nd-degree reachable | Median centrality |
| Rate Budget | Operations used / limit | Segmented bar per operation type |

### Top 5 Gold Contacts Card

Top 5 by `goldScore` who have NOT been contacted (outreach state null or "planned"). Each row shows:
- **Name** (linked to `/contacts/[slug]`)
- Title + Company (truncated)
- Gold Score badge
- ICP Fit bar
- Top cluster chip
- Click row → quick-action popover: "Start Outreach", "Deep Dive", "View Profile"

### Top 5 Suggested Actions Card

Algorithmically ranked:
1. **High-goldScore uncontacted** — "Reach out to [Name] (goldScore: 0.66)" → "Plan Outreach"
2. **Stale outreach follow-ups** — "Follow up with [Name] (sent 12 days ago)" → "View Outreach"
3. **Warm re-engagement** — "Re-engage [Name] (active this week)" → "View Profile"
4. **Company penetration** — "Expand at [Company] (2 engaged, 3 more targets)" → "View Company"
5. **Cluster gaps** — "Explore [cluster] (42 high-ICP contacts, 0 outreach)" → "View Niche"

### Recent Activity Feed

Last 15-20 events: outreach transitions, scan completions, score changes, report generations, config updates. Reverse chronological with relative timestamps.

### Quick Actions

Vertical button stack: Run Deep Scan, Rescore All, Generate Reports, Export Gold CSV, Check Budget.

---

## 4. Network Graph Page (`/network`)

### Integration Strategy: Hybrid (Recommended)

Reuse the existing `computeReportData()` and `pruneEdgesToKNN()` logic from report-generator.mjs server-side via an API route. Render client-side with a React wrapper around `3d-force-graph`.

**Why not iframe?** No cross-page navigation (clicking a node should route to `/contacts/[slug]`).
**Why not full rewrite?** The existing pruning, cluster positioning, and edge affinity algorithms are proven — reuse them.

### Page Layout

```
[Graph Viewport (full width, 75vh height)]
[Floating Control Panel (top-right, 300px)]
[Cluster Sidebar (left, collapsible, 240px)]
[Stats Footer Bar (bottom, 48px)]
```

### Graph Viewport

- Full-viewport 3D force-directed graph (3d-force-graph)
- 200 nodes (top by goldScore), ~871 edges (after KNN pruning)
- Cluster anchoring with Fibonacci sphere positions
- Node sizing by tier: gold (6-20px), silver (3-11px), bronze (1.5-5px), watch (0.8px)
- Gold nodes: glow ring + name label
- Node click → navigate to `/contacts/[slug]`
- Right-click → neighborhood isolation mode

### Control Panel

- **Color by**: dropdown (cluster / tier / persona / degree)
- **Edge type checkboxes**: company, cluster, mutual, discovered, bridges
- **Cluster spacing**: slider (100-500)
- **Weight threshold**: slider (0-1)
- **Degree filter**: checkboxes (1st / 2nd)

### Cluster Sidebar

List all 10 clusters with contact count, gold count. Click to isolate cluster. "Show All" button to reset.

### Stats Footer

Node count, edge count, density %, largest cluster, most connected node.

---

## 5. Contacts Page (`/contacts`)

### Data Loading

Server-side pagination via `/api/contacts`. **RVF store is the primary source** — contacts are read from `network.rvf` via `rvf-store.mjs` functions (`openStore()`, `getContact()`, `queryStore()`). All 40+ metadata fields (name, title, company, scores, tier, persona, cluster, enrichment state) are stored directly in RVF metadata, eliminating the need to parse graph.json for contact data. Client fetches pages of 50 via SWR.

### Default Table Columns

| Column | Width | Notes |
|--------|-------|-------|
| Checkbox | 40px | Bulk selection |
| Name | 200px | Linked to detail page |
| Title | 200px | Truncated with tooltip |
| Company | 150px | Linked to company filter |
| Gold Score | 80px | Color-coded heat gradient |
| ICP Fit | 80px | Inline bar |
| Tier | 80px | Badge chip |
| Network Hub | 80px | Score |
| Behavioral | 80px | Score |
| Top Cluster | 120px | Tag chip |
| Outreach State | 120px | Colored state label |
| Degree | 60px | 1st/2nd badge |

Additional toggleable: referralScore, location, linkedinUrl, lastScanDate.

### Filter Bar

- **Search**: **Semantic search** via OnnxEmbedder — query text is embedded to 384-dim vector, then `queryStore(vector, k)` returns nearest neighbors ranked by cosine similarity. Falls back to metadata substring match for exact-match queries (debounced 300ms, server-side)
- **Tier**: Multi-select chips (Gold / Silver / Bronze / Watch)
- **Cluster**: Multi-select dropdown (10 clusters)
- **Outreach State**: Multi-select chips
- **Advanced**: Score range sliders for goldScore, icpFit, networkHub, behavioral
- **Active filter pills**: Removable, "Clear all" button

### Pagination

Server-side, 50 rows/page (configurable: 25, 50, 100). "Showing 51-100 of 5,289 (filtered: 842)".

### Bulk Actions

Floating bottom bar on selection: Generate Outreach Plan, Export CSV, Clear Selection.

---

## 6. Contact Detail Page (`/contacts/[slug]`)

### Layout: Two-column (65% / 35%)

### Header Bar

Back arrow, contact name (large), title at company, LinkedIn link, tier badge, action buttons: **Start Outreach**, **Deep Dive**, **Export**.

### Left Column

**Score Radar Chart** (Recharts)
7 axes: ICP Fit, Network Hub, Relationship, Signal Boost, Skills Relevance, Network Proximity, Behavioral. Contact polygon + faint tier-average overlay. Below: exact values with percentile ranks.

**Cluster Memberships**
Tag chips, clickable → `/icp/[cluster]`.

**Outreach History Timeline**
Vertical timeline of state transitions with dates, templates used, responses. "Advance State" dropdown at top. Empty state: "No outreach history. Start a plan."

**Notes Section**
Freeform textarea, auto-saved to local JSON.

### Right Sidebar

**Company Penetration Card**
Penetration score, total contacts at company, list with name/title/tier, tier breakdown bar.

**Network Position Card**
2D ego network mini-graph (react-force-graph-2d, 200x200px) showing top 20 connections. "View in Network" link → `/network?focus=[slug]`.

**Similar Contacts Card**
5 most similar contacts via **RVF vector similarity** — retrieves the contact's stored 384-dim embedding vector, then calls `queryStore(vector, 6)` for k-NN cosine similarity. Returns semantically similar profiles (matching role, industry, skills) rather than just score similarity. Far more useful for discovering "people like this person" connections.

### Deep Dive Flow

1. Click "Deep Dive" → check rate budget
2. Confirmation dialog with budget status
3. Spawn `deep-scan.mjs --url <url>` via API
4. SSE stream progress to bottom panel
5. On completion: refresh data, show new connections discovered, score changes

---

## 7. ICP & Niche Explorer Page (`/icp`)

### Global "What If" Mode Toggle

Floating panel with gold score weight sliders + tier threshold inputs. All page data recalculates client-side in real-time (goldScore is a weighted sum of stored component scores — recomputation is instant for 5,289 contacts).

### Section: Niche Overview

Responsive grid of 10 niche cards sorted by gold density. Each card: niche name, contact count, tier stacked bar, avg goldScore, top 3 contacts preview. Click → drill-down.

### Section: Niche Drill-Down (`/icp/[niche-slug]`)

- Full stats header for selected niche
- Sortable/filterable contacts table (same DataTable pattern)
- GoldScore distribution histogram with tier threshold lines
- Key companies in niche table
- Keyword analysis (role + headline keyword bars weighted by goldScore)

### Section: Cross-Niche Comparison

Radar chart: one polygon per niche, 6 axes (avg goldScore, avg icpFit, avg networkHub, contact count, gold ratio, ICP alignment).
Comparison table: niches as columns, metrics as rows.

### Section: ICP Fit Analysis

- ICP Fit histogram stacked by tier
- **Almost-Gold list**: Contacts within 0.05 of gold threshold (20 per degree)
- ICP Fit breakdown: donut charts for role/industry/signal match distribution
- Score correlation scatter: icpFit (x) vs networkHub (y), color-coded by tier, quadrant labels

### Section: Reverse ICP Discovery

- Unexpected high-scoring niches (avg goldScore > 1 SD above mean)
- Emerging keyword patterns not in configured ICP signals → "Add to ICP" quick action
- Cluster overlap heatmap (shared contacts between niches)

---

## 8. Outreach Pipeline Page (`/outreach`)

### Layout

- **Funnel visualization**: Horizontal bars — planned → sent → responded → engaged → converted
- **State cards**: 9 colored cards showing count per state
- **Conversion rate table**: Stage-to-stage percentages with visual bars
- **Outreach plans list**: Expandable cards with template preview and recipient list
- **CSV export**

---

## 9. Actions Page (`/actions`)

### Layout: Two-column (70% / 30%)

**Left column**: Script categories, parameter forms, live output viewer.
**Right column**: Rate budget sidebar, process history.

### Script Categories

| Category | Scripts | Rate Limited? |
|----------|---------|--------------|
| **Scoring** | scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs | No |
| **Data Collection** | deep-scan.mjs, batch-deep-scan.mjs, enrich.mjs, enrich-graph.mjs, search.mjs, activity-scanner.mjs | Yes (Playwright) |
| **Pipeline** | pipeline.mjs --rebuild, pipeline.mjs --rescore | No |
| **Reports** | report-generator.mjs, targeted-plan.mjs | No |
| **GDPR** | pipeline.mjs --forget | No (destructive) |

### Action Row Components

Each row: script name + description, parameter inputs (inline or expandable), Run button, status badge.

### Script Parameter Forms

| Script | Parameters |
|--------|-----------|
| deep-scan.mjs | Contact autocomplete → `--url` |
| batch-deep-scan.mjs | Tier dropdown + count slider |
| enrich-graph.mjs | Batch size slider (1-50) |
| search.mjs | Niche dropdown + keyword input |
| activity-scanner.mjs | Tier dropdown |
| pipeline.mjs | Mode radio (rebuild/rescore/forget) |
| targeted-plan.mjs | Tier dropdown + max count |
| pipeline.mjs --forget | Contact autocomplete (destructive confirmation) |

### Live Output Viewer

Terminal-style panel: dark background, monospace, auto-scroll, timestamp prefixes. `stdout` in light text, `stderr` in amber. Cancel button. Max 2000 lines scrollback.

### Rate Budget Sidebar

5 operation progress bars (profile_visits, search_pages, activity_feeds, connection_requests, messages_sent). Color-coded thresholds. Always visible.

### Process History

Last 20 runs with script name, timestamp, duration, exit code badge. Persisted to `action-history.json`.

---

## 10. Configuration Page (`/config`)

### Tabbed Layout (5 tabs)

#### Tab: ICP Profiles
- Profile selector (pill list with add/delete)
- Role patterns editor (high/medium/low tag inputs)
- Industries and signals tag inputs
- **Gold Score weight sliders** (7 sliders, sum-to-1.0 with lock pins):
  - ICP Fit (0.28), Network Hub (0.22), Relationship (0.17), Signal Boost (0.08), Skills Relevance (0.10), Network Proximity (0.08), Behavioral (0.07)
- Live formula preview: `goldScore = icpFit(0.28) + networkHub(0.22) + ...`
- **Tier thresholds** (per degree): numeric inputs with visual number line
- **Niche keywords** editor (key-value table with tag inputs)
- **Impact preview panel**: Current vs estimated tier distribution, delta indicators, "Almost Gold" contacts list

#### Tab: Behavioral Scoring
- 6 component weight sliders (sum-to-1.0)
- Connection power thresholds table
- Connection recency ranges table
- About signals keywords (8 categories, tag inputs per category)
- Headline signal patterns (inline editable cards)
- Super connector index settings
- Behavioral persona definitions (accordion)
- Persona distribution doughnut chart

#### Tab: Outreach
- Lifecycle state machine visualization (directed graph, read-only)
- Daily limits with editable progress bars
- Template selection rules (drag-reorderable)
- Template list and preview (16 templates, grouped by type, inline edit, 300-char counter)
- Sequence editor (step timeline with channel/delay/condition)
- Receptiveness scoring weights (5 sliders, sum-to-1.0)

#### Tab: Referral Scoring
- 6 weight sliders (sum-to-1.0)
- Role tiers editor (high/medium/low patterns)
- Referral tier thresholds
- Referral persona definitions (accordion)
- Network reach baselines

#### Tab: System
- Rate budget status + history chart
- Data file inventory (file sizes, last modified)
- Pipeline timestamps from graph.meta
- GDPR controls: forget contact input, auto-archive button, archive age setting

### Save & Apply Flow

1. "Unsaved changes" indicator on modified tabs
2. **Save**: Writes JSON to disk (creates backup first, validates structure)
3. **Save and Apply**: Save + run `pipeline.mjs --rescore` with streaming progress
4. Post-apply: before/after tier count comparison, "Top movers" list

---

## 11. Data Layer Architecture

### RVF-First Data Model

The app uses a **two-tier data architecture** with RVF as the primary layer:

```
┌─────────────────────────────────────────────────┐
│  PRIMARY: network.rvf (33MB)                    │
│  5,289 vectors · 384-dim · HNSW(m=16,ef=200)   │
│  Cosine distance · 40+ metadata fields/entry    │
│                                                 │
│  Provides:                                      │
│  • Contact lookups (getContact by LinkedIn URL) │
│  • Semantic search (queryStore with embeddings) │
│  • k-NN similarity (vector proximity)           │
│  • Metadata filtering (tier, cluster, persona)  │
│  • Dashboard aggregation (iterate store)        │
│  • Contact count (storeLength)                  │
└─────────────────────────────────────────────────┘
         │
         ▼ Falls back to graph.json ONLY for:
┌─────────────────────────────────────────────────┐
│  SUPPLEMENTARY: graph.json (44MB)               │
│  Loaded on-demand, module-scope cached          │
│                                                 │
│  Provides (not stored in RVF):                  │
│  • Edge data (156K edges with types/weights)    │
│  • Cluster structure (definitions, members)     │
│  • Company aggregations (graph.companies)       │
│  • Meta timestamps (graph.meta)                 │
│  • Warm intro paths (edge traversal)            │
│  • Network graph visualization (nodes + edges)  │
└─────────────────────────────────────────────────┘
```

### RVF Metadata Fields (per entry)

Each RVF entry stores `{ id: linkedInUrl, vector: number[384], metadata }` where metadata includes:

| Category | Fields |
|----------|--------|
| Identity | `name`, `headline`, `title`, `location`, `currentRole`, `currentCompany`, `about`, `connections`, `mutualConnections` |
| Enrichment | `enriched`, `enrichedAt`, `degree`, `discoveredVia`, `searchTerms` |
| ICP/Gold Score | `icpFit`, `networkHub`, `relationshipStrength`, `signalBoost`, `goldScore`, `tier`, `persona` |
| Behavioral | `behavioralScore`, `behavioralPersona` |
| Referral | `referralLikelihood`, `referralTier`, `referralPersona` |
| Graph | `cluster`, `clusterLabel` |
| Timestamps | `createdAt`, `updatedAt`, `embeddedAt` |

### RVF Service (`lib/rvf-service.ts`)

The app wraps the existing `rvf-store.mjs` functions in a TypeScript service layer:

```typescript
// lib/rvf-service.ts — Primary data access layer
import { openStore, getContact, queryStore, storeLength,
         upsertMetadata, buildProfileText, isRvfAvailable } from '../scripts/rvf-store.mjs';

// Singleton embedder for search queries (lazy init, ~2s cold start)
let embedder: OnnxEmbedder | null = null;
async function getEmbedder() { /* ... */ }

// Primary operations used by API routes:
export async function getContactBySlug(slug: string)      // getContact(linkedInUrl)
export async function searchContacts(query: string, k: number) // embed query → queryStore
export async function getSimilarContacts(slug: string, k: number) // get vector → queryStore
export async function listContacts(options: ListOptions)   // iterate store with metadata filter
export async function getContactCount()                    // storeLength()
export async function getDashboardAggregates()             // iterate store, compute KPIs
export async function getContactsByTier(tier: string)      // metadata filter
export async function getContactsByCluster(cluster: string) // metadata filter
```

### API Routes

| Route | Method | Source | Purpose | Caching |
|-------|--------|--------|---------|---------|
| `/api/dashboard` | GET | **RVF** | Aggregated KPIs, top contacts, recent activity | 30s TTL |
| `/api/contacts` | GET | **RVF** | Paginated, filtered, sorted contact list | mtime-based |
| `/api/contacts/[slug]` | GET | **RVF** + graph.json (edges) | Single contact with full detail + connections | mtime-based |
| `/api/contacts/[slug]/similar` | GET | **RVF** | k-NN vector similarity (top 5) | mtime-based |
| `/api/contacts/[slug]/notes` | PUT | local JSON | Save contact notes | None |
| `/api/search` | GET | **RVF** | Semantic search — embed query → k-NN | 10s TTL |
| `/api/graph` | GET | graph.json | Network graph data (nodes + pruned edges) | 60s TTL |
| `/api/graph/subgraph/[slug]` | GET | graph.json | Ego network for a contact | mtime-based |
| `/api/clusters` | GET | graph.json + **RVF** | Cluster definitions (json) + member stats (rvf) | mtime-based |
| `/api/companies` | GET | graph.json + **RVF** | Company list with penetration scores | mtime-based |
| `/api/niches` | GET | **RVF** + graph.json | Cluster/niche analysis data | mtime-based |
| `/api/pipeline` | GET | outreach-state.json | Outreach state and funnel counts | 30s TTL |
| `/api/config/[filename]` | GET/PUT | config files | Read or update config files | None |
| `/api/budget` | GET | rate-budget.json | Rate budget status | 60s TTL |
| `/api/actions/run` | POST | — | Start a script | None |
| `/api/actions/stream` | GET | — | SSE stream of process output | Streaming |
| `/api/actions/cancel` | POST | — | Cancel running process | None |
| `/api/actions/active` | GET | — | List running/queued processes | None |
| `/api/actions/history` | GET | action-history.json | Recent action runs | None |

### Data Source Per Page

| Page | Primary (RVF) | Supplementary (JSON) |
|------|---------------|---------------------|
| Dashboard | Contact counts, tier distribution, top gold contacts, suggested actions | outreach-state.json (pipeline stats), rate-budget.json |
| Contacts | Contact listing, filtering, sorting, search (semantic) | — |
| Contact Detail | Contact profile, scores, similar contacts (vector k-NN) | graph.json (edges for ego network), outreach-state.json |
| Network | — | graph.json (nodes + edges required for force graph) |
| ICP & Niches | Contact stats per cluster, keyword analysis, almost-gold | graph.json (cluster definitions) |
| Outreach | — | outreach-state.json, outreach-plan.json |
| Actions | — | rate-budget.json, action-history.json |
| Configuration | — | icp-config.json, behavioral-config.json, outreach-config.json, etc. |

### Graph.json Handling (Supplementary, 44MB)

**Module-scope singleton cache** with lazy initialization — loaded ONLY when edge/cluster/company data is needed:
- **Not loaded** for: Dashboard, Contacts list, Contact search, Similar contacts
- **Loaded** for: Network graph, ego networks, cluster structures, company aggregations, warm intro paths
- First access triggers full parse (~3s cold start)
- Subsequent reads are sub-millisecond (in-memory)
- Build in-memory indices: adjacency map (edges by node), cluster-to-members, company-to-contacts
- Cache invalidation: mtime polling every 10s, immediate invalidation after script runs
- Estimated memory: ~116MB for parsed + indexed data (acceptable for local tool)

### Semantic Search Flow

```
User types query → debounce 300ms → /api/search?q=...&k=20
                                          │
                                          ▼
                               OnnxEmbedder.embed(query)
                               → 384-dim vector (~50ms)
                                          │
                                          ▼
                               queryStore(vector, k=20)
                               → HNSW k-NN search (~5ms)
                                          │
                                          ▼
                               [{ id, score, metadata }]
                               → map to ContactResult[]
                               → return to client
```

**OnnxEmbedder initialization**: Lazy singleton, ~2s first-load (downloads ONNX model if not cached). Subsequent calls are ~50ms. The embedder uses the same `buildProfileText()` function as the vectorization pipeline, ensuring embedding consistency.

### File Watching & Cache Invalidation

Three-tier strategy:
1. **RVF store**: Reopened automatically on store modifications (after vectorize.mjs runs). `openStore()` handles lifecycle.
2. **Graph.json mtime polling** (10s interval) — detect external modifications to supplementary data
3. **Proactive invalidation** — after any script run via Actions page, invalidate both RVF handle and graph cache
4. **SSE broadcast** — notify connected clients to refetch via SWR revalidation

---

## 12. Process Manager Architecture

### Concurrency Rules

**Critical**: Only ONE Playwright process at a time (shared `.browser-data/` session). Non-Playwright scripts can run concurrently (soft limit: 4).

| Incoming Script | Playwright Running? | Action |
|----------------|--------------------| ------|
| Playwright | No | Start immediately |
| Playwright | Yes | Enqueue (FIFO, max 5) |
| Non-Playwright | - | Start immediately |

### Process Lifecycle

1. **Request** → validate script against allowlist
2. **Queue or Start** → return processId
3. **SSE Stream** → stdout/stderr/progress/exit events
4. **Completion** → update history, trigger cache invalidation, dequeue next

### SSE Event Types

| Event | When |
|-------|------|
| `started` | Process spawned (pid, script, args) |
| `stdout` | Each stdout line |
| `stderr` | Each stderr line |
| `progress` | Structured `[PROGRESS]` lines parsed |
| `exit` | Process terminates (exitCode, duration) |
| `queued` | Enqueued with position |
| `cancelled` | Cancelled by user |
| `keepalive` | Every 15s |

### Environment Variables Passed to Scripts

```
PROSPECTOR_DATA_DIR=<absolute path to .linkedin-prospector/data/>
BROWSER_DATA_DIR=<absolute path to .browser-data/>
NODE_ENV=production
```

---

## 13. Visualization Specifications

### Chart Library Selection

| Chart Type | Library | Use Case |
|-----------|---------|----------|
| Bar, Area, Line, Pie, Donut | Recharts (shadcn Chart) | Dashboard stats, histograms, funnels |
| Radar/Spider | Recharts | Contact score breakdown, niche comparison |
| Scatter | Recharts | ICP fit vs network hub correlation |
| 3D Force Graph | 3d-force-graph | Main network visualization |
| 2D Force Graph | react-force-graph-2d | Contact detail ego network |
| Treemap | Recharts | Cluster size visualization |
| Heatmap | Custom SVG | Cluster overlap matrix |

### Dashboard Charts

- **Tier distribution**: Donut chart (gold/silver/bronze/watch)
- **Gold score histogram**: 20 bins, tier threshold lines overlaid
- **Cluster treemap**: Rectangles sized by contact count, colored by avg goldScore
- **Persona bar chart**: Horizontal bars for persona distribution
- **Outreach funnel**: Horizontal bars (planned → sent → responded → engaged → converted)
- **Network growth** (if delta snapshots exist): Area chart over time

### Theme Integration

All charts use shadcn CSS variables for colors. Custom tier palette:
- Gold: `hsl(45, 93%, 47%)` (#E5A100)
- Silver: `hsl(210, 13%, 60%)` (#8E9BAE)
- Bronze: `hsl(30, 55%, 45%)` (#B27A3A)
- Watch: `hsl(0, 0%, 45%)` (#737373)

---

## 14. Project Structure

```
.claude/linkedin-prospector/app/
├── app/
│   ├── layout.tsx                    # Root: ThemeProvider, SidebarProvider, shell
│   ├── page.tsx                      # Dashboard
│   ├── loading.tsx                   # Global skeleton
│   ├── error.tsx                     # Global error boundary
│   ├── network/
│   │   └── page.tsx                  # 3D network graph
│   ├── contacts/
│   │   ├── page.tsx                  # Contacts table
│   │   └── [slug]/
│   │       └── page.tsx              # Contact detail
│   ├── icp/
│   │   ├── page.tsx                  # ICP & Niche overview
│   │   └── [niche]/
│   │       └── page.tsx              # Niche drill-down
│   ├── outreach/
│   │   └── page.tsx                  # Pipeline dashboard
│   ├── actions/
│   │   └── page.tsx                  # Process runner
│   ├── config/
│   │   └── page.tsx                  # Configuration editor
│   └── api/
│       ├── dashboard/route.ts
│       ├── contacts/
│       │   ├── route.ts              # GET (list), POST
│       │   └── [slug]/
│       │       ├── route.ts          # GET (detail)
│       │       └── notes/route.ts    # PUT
│       ├── graph/
│       │   ├── route.ts              # GET (pruned graph)
│       │   └── subgraph/[slug]/route.ts
│       ├── clusters/route.ts
│       ├── companies/route.ts
│       ├── niches/route.ts
│       ├── pipeline/route.ts
│       ├── config/[filename]/route.ts
│       ├── budget/route.ts
│       ├── search/route.ts
│       └── actions/
│           ├── run/route.ts
│           ├── stream/route.ts       # SSE
│           ├── cancel/route.ts
│           ├── active/route.ts
│           └── history/route.ts
├── components/
│   ├── ui/                           # shadcn components (auto-generated)
│   ├── layout/
│   │   ├── sidebar-nav.tsx           # Client: sidebar with navigation
│   │   ├── header.tsx                # Breadcrumbs, theme toggle
│   │   ├── rate-budget-meter.tsx     # Client: sidebar footer budget bar
│   │   └── theme-toggle.tsx          # Client: dark/light toggle
│   ├── dashboard/
│   │   ├── kpi-card.tsx              # Server: metric card
│   │   ├── gold-contacts-card.tsx    # Client: interactive list
│   │   ├── suggested-actions.tsx     # Client: action CTA buttons
│   │   └── recent-activity.tsx       # Client: scrollable feed
│   ├── contacts/
│   │   ├── contacts-table.tsx        # Client: TanStack Table
│   │   ├── columns.tsx               # Column definitions
│   │   ├── filter-bar.tsx            # Client: search + filters
│   │   ├── contact-detail.tsx        # Contact profile layout
│   │   ├── score-radar.tsx           # Client: Recharts radar
│   │   ├── outreach-timeline.tsx     # Client: state timeline
│   │   └── deep-dive-dialog.tsx      # Client: confirmation + progress
│   ├── network/
│   │   ├── network-graph.tsx         # Client: 3d-force-graph wrapper
│   │   ├── graph-controls.tsx        # Client: filter panel
│   │   ├── cluster-sidebar.tsx       # Client: cluster list
│   │   └── ego-network.tsx           # Client: 2D mini-graph
│   ├── icp/
│   │   ├── niche-card.tsx            # Client: clickable niche card
│   │   ├── niche-radar.tsx           # Client: cross-niche comparison
│   │   ├── what-if-panel.tsx         # Client: floating weight sliders
│   │   └── almost-gold-table.tsx     # Client: promotion candidates
│   ├── outreach/
│   │   ├── pipeline-funnel.tsx       # Client: funnel bars
│   │   └── state-cards.tsx           # Client: 9 state cards
│   ├── actions/
│   │   ├── terminal-output.tsx       # Client: SSE log viewer
│   │   ├── script-form.tsx           # Client: dynamic param forms
│   │   ├── budget-sidebar.tsx        # Client: rate budget display
│   │   ├── action-row.tsx            # Client: script run row
│   │   └── history-panel.tsx         # Client: recent runs
│   └── config/
│       ├── weight-sliders.tsx        # Client: sum-to-1.0 sliders
│       ├── tag-input.tsx             # Client: keyword chip editor
│       ├── threshold-editor.tsx      # Client: tier threshold inputs
│       ├── template-preview.tsx      # Client: message preview
│       └── impact-preview.tsx        # Client: before/after scoring
├── lib/
│   ├── rvf-service.ts                # PRIMARY: RVF store wrapper (contacts, search, similarity)
│   ├── embedder.ts                   # OnnxEmbedder singleton for semantic search queries
│   ├── graph-cache.ts                # SUPPLEMENTARY: graph.json cache (edges, clusters, companies)
│   ├── data.ts                       # File reading, path resolution, data dir config
│   ├── process-manager.ts            # Child process lifecycle
│   ├── script-definitions.ts         # Script metadata + param schemas
│   └── utils.ts                      # cn() + shared utilities
├── hooks/
│   ├── use-process-stream.ts         # SSE consumption for actions
│   ├── use-budget.ts                 # Rate budget polling
│   └── use-file-watch.ts             # Cache invalidation hook
├── types/
│   ├── contact.ts                    # Contact, RvfEntry, RvfMetadata, Edge, Cluster, Company
│   ├── graph.ts                      # GraphData, GraphMeta (supplementary JSON types)
│   ├── search.ts                     # SearchResult, SimilarContact, SemanticQuery
│   ├── outreach.ts                   # OutreachState, OutreachPlan
│   ├── config.ts                     # ICPConfig, BehavioralConfig, etc.
│   └── process.ts                    # ProcessRecord, SSEEvent
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── components.json                   # shadcn/ui config
└── package.json
```

---

## 15. Component Hierarchy (Server vs Client)

```
RootLayout (Server)
  ThemeProvider (Client)
    SidebarLayout (Client)
      Sidebar (Client)
        SidebarNavItem (Client) — active state
        RateBudgetMeter (Client) — polls /api/budget
      MainContent (Server)
        Breadcrumbs (Server)
        {page content}

DashboardPage (Server)
  KPICard (Server) x 7
  RateBudgetCard (Client) — interactive bar
  GoldContactsCard (Client) — hover, popover
  SuggestedActionsCard (Client) — CTA buttons
  RecentActivityFeed (Client) — scrollable
  QuickActionsPanel (Client) — triggers API

ContactsPage (Server)
  FilterBar (Client) — all filter state
  ContactsTable (Client) — TanStack Table
  BulkActionBar (Client) — sticky bottom

ContactDetailPage (Server)
  ActionButtons (Client) — Deep Dive, Outreach
  ScoreRadarChart (Client) — Recharts
  OutreachTimeline (Client) — expandable
  NotesSection (Client) — auto-save
  EgoNetworkGraph (Client) — react-force-graph-2d
  DeepDiveModal (Client) — SSE progress

NetworkPage (Server)
  NetworkGraph (Client) — 3d-force-graph
  GraphControls (Client) — filters
  ClusterSidebar (Client) — isolation

ICPPage (Server)
  WhatIfPanel (Client) — weight sliders
  NicheCards (Client) — clickable
  NicheRadar (Client) — Recharts radar
  AlmostGoldTable (Client) — DataTable

ConfigPage (Server)
  ConfigTabs (Client) — tab state
  WeightSliders (Client) — sum-to-1.0
  TagInputs (Client) — keyword chips
  ImpactPreview (Client) — live scoring
  TemplatePreviews (Client) — inline edit

ActionsPage (Server)
  ActionRows (Client) — param forms + run
  TerminalOutput (Client) — SSE stream
  BudgetSidebar (Client) — progress bars
  HistoryPanel (Client) — recent runs
```

---

## 16. Implementation Phases

### Phase 1: Foundation (Est. scope: core scaffold + RVF integration)
- [ ] Next.js project setup with shadcn/ui + ruvector
- [ ] Root layout with sidebar navigation
- [ ] Dark mode with next-themes
- [ ] `lib/data.ts` — file reading + path resolution + PROSPECTOR_DATA_DIR config
- [ ] `lib/rvf-service.ts` — RVF store wrapper (openStore, getContact, queryStore, storeLength, metadata iteration)
- [ ] `lib/embedder.ts` — OnnxEmbedder singleton for search queries (lazy init, ~2s cold start)
- [ ] `lib/graph-cache.ts` — supplementary graph.json cache (edges/clusters/companies only)
- [ ] `/api/dashboard` — aggregated KPIs from RVF store
- [ ] Dashboard page with KPI cards

### Phase 2: Contacts & Detail
- [ ] `/api/contacts` — paginated, filtered, sorted from **RVF metadata**
- [ ] `/api/contacts/[slug]` — single contact from **RVF** + edges from graph.json
- [ ] `/api/contacts/[slug]/similar` — k-NN vector similarity from **RVF**
- [ ] `/api/search` — **semantic search** via OnnxEmbedder → queryStore
- [ ] Contacts table page with FilterBar + DataTable
- [ ] Contact detail page with score radar + similar contacts
- [ ] Company penetration card
- [ ] Ego network mini-graph (graph.json edges)

### Phase 3: Network Graph
- [ ] `/api/graph` — pruned graph data (reuse KNN logic)
- [ ] Network graph page with 3d-force-graph wrapper
- [ ] Graph controls (color-by, edge filters, cluster spacing)
- [ ] Cluster sidebar with isolation
- [ ] Node click → contact detail navigation

### Phase 4: ICP & Niches
- [ ] `/api/niches` — cluster analysis data
- [ ] Niche overview grid
- [ ] Niche drill-down with contacts table + charts
- [ ] Cross-niche radar comparison
- [ ] ICP fit analysis (histogram, almost-gold, scatter)
- [ ] Reverse ICP discovery
- [ ] "What If" mode (client-side score recomputation)

### Phase 5: Actions & Process Management
- [ ] `lib/process-manager.ts` — spawn, queue, cancel, SSE
- [ ] `lib/script-definitions.ts` — script metadata
- [ ] `/api/actions/*` — run, stream, cancel, active, history
- [ ] Actions page with script categories + param forms
- [ ] Terminal output component
- [ ] Rate budget sidebar
- [ ] Deep Dive integration on contact detail page

### Phase 6: Configuration
- [ ] `/api/config/[filename]` — read/write config
- [ ] Config page with 5 tabs
- [ ] Weight sliders with sum-to-1.0 constraint
- [ ] Tag input for keyword arrays
- [ ] Template preview + edit
- [ ] Impact preview (before/after tier distribution)
- [ ] Save & Apply with pipeline streaming

### Phase 7: Outreach Pipeline
- [ ] `/api/pipeline` — outreach state + funnel
- [ ] Pipeline page with funnel visualization
- [ ] State cards
- [ ] Outreach timeline on contact detail

---

## 17. Key Design Principles

1. **Data density over whitespace** — Power-user analytics tool. Compact rows, small fonts for secondary data, minimize decorative spacing.
2. **RVF-first data access** — Use the vector store for all contact operations. Only fall back to graph.json for edge/cluster/company data. Semantic search over keyword matching.
3. **URL-driven state** — Every filter, sort, page, tab reflected in URL. Browser back/forward works correctly.
4. **Instant local performance** — RVF HNSW lookups in <5ms, metadata iteration in <50ms. Pages render within 200ms. Loading skeletons rare.
5. **Non-destructive by default** — Rate-consuming or data-modifying actions require explicit confirmation.
6. **Progressive disclosure** — Summary first, detail on demand. Dashboard → Table → Detail → Deep Dive.
7. **Dark mode primary** — Design dark-first, provide light toggle.

---

## Expert Panel

| Expert | Domain | Key Contributions |
|--------|--------|-------------------|
| UX Architect | Pages, navigation, component hierarchy | Page structure, dashboard layout, contacts table, contact detail, component tree |
| Data Architect | API routes, caching, TypeScript types | 19 API endpoints, RVF-first data layer, graph.json supplementary handling, file watching |
| Process Architect | Script execution, SSE, Deep Dive | Process manager, Playwright concurrency, SSE events, script param forms, rate safety |
| Visualization Architect | Charts, 3D graph, data viz | Hybrid graph integration, chart library selection, per-page viz specs, theme colors |
| Config/ICP Architect | Configuration, ICP exploration | 5-tab config editor, ICP explorer sections, "What If" mode, save & apply flow |

---

## Appendix: RVF Store API Reference

The app integrates with `rvf-store.mjs` (`.claude/linkedin-prospector/skills/linkedin-prospector/scripts/rvf-store.mjs`). Key functions:

| Function | Signature | Used By |
|----------|-----------|---------|
| `isRvfAvailable()` | `() → boolean` | Startup check — graceful fallback to graph.json if ruvector missing |
| `openStore()` | `() → VectorDB \| null` | All RVF operations (singleton, auto-opens) |
| `getContact(id)` | `(string) → { id, vector, metadata } \| null` | Contact detail, ego network seed |
| `queryStore(vector, k, filter?)` | `(number[], number, object?) → [{ id, score, metadata }]` | Semantic search, similar contacts |
| `storeLength()` | `() → number` | Dashboard KPI (total contacts) |
| `upsertMetadata(id, partial)` | `(string, object) → boolean` | Contact notes, outreach state updates |
| `deleteContact(id)` | `(string) → boolean` | GDPR forget |
| `buildProfileText(contact)` | `(object) → string` | Search query embedding (must match vectorize-time format) |

**Important**: The RVF store file is at `PROSPECTOR_DATA_DIR/network.rvf`. The app must set `PROSPECTOR_DATA_DIR` to the absolute path of `.linkedin-prospector/data/` (resolved relative to project root) since the default DATA_DIR in `lib.mjs` resolves to the skill's config-only data/ directory.
