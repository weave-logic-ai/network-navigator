# V2 Final Analysis: Master Synthesis

## 1. Executive Summary

LinkedIn Network Intelligence V2 is a local-first, single-user prospecting platform that transforms a LinkedIn CSV export into an actionable, AI-driven network intelligence system. The product replaces V1's Playwright-based scraping with a compliant three-stream architecture:

- **Backend**: PostgreSQL with the ruvector-postgres extension provides a unified relational, vector, and graph database. It stores contacts, companies, enrichment provenance, behavioral observations, outreach state machines, and 384-dim embeddings across two spaces (profile similarity and content/topic similarity). The database runs in a docker-compose stack alongside the Next.js application.

- **App**: A Next.js 15 application serving as both the web UI and the API layer. It hosts the dashboard, contact management, ICP/niche discovery (the "wedge" model), enrichment management, outreach pipeline, goals/tasks system, and 27 data visualizations built with Recharts, visx, and reagraph. Claude is the primary actor (80%+ of system effort), driving task generation, ICP discovery, message personalization, and network analysis.

- **Chrome Extension**: A Manifest V3 "dumb capture + smart app" architecture. The extension captures full rendered HTML from LinkedIn pages and pushes it to the local app. It contains zero DOM parsing logic, zero CSS selectors, and zero knowledge of LinkedIn's page structure. All parsing happens app-side using cheerio with configurable, versioned selectors stored in PostgreSQL. The extension's primary UX is a goal/task system (80% of its interface) that guides the user through prospecting workflows.

**Key architectural decisions made by the product owner:**

1. PostgreSQL + ruvector-postgres replaces both graph.json and network.rvf from V1, providing ACID transactions, native Cypher queries, HNSW vector search, PageRank, spectral clustering, and GNN inference in a single database.
2. The extension captures raw HTML only; all DOM parsing lives in the app. This enables re-parsing cached pages when LinkedIn changes its DOM, without updating the extension.
3. Claude drives the system through goals and tasks. The agent creates goals, populates task queues, discovers ICPs from data clustering, personalizes outreach messages, and explains scoring math. The user can accept, reject, or modify anything Claude proposes.
4. Multiple ICP/niche profiles are supported simultaneously, modeled as a 3D "wedge" where radius = user penetration depth, arc = niche breadth, and height = ICP depth.
5. All enrichment providers are available; the system offers the cheapest path to maximum data. No message is ever sent without user approval (clipboard-only delivery).
6. Single-user, local-only, no external data transmission from the extension. All API calls to enrichment providers and Claude go through the Next.js app.

---

## 2. Architecture Overview

### 2.1 Docker-Compose Orchestration

The V2 system runs as two containers:

```
docker-compose stack
  +------------------+    +---------------------------+
  | lp-postgres      |    | lp-app                    |
  | ruvector-postgres|<---| Next.js 15 + Node 20      |
  | Port: 5432       |    | Port: 3000                |
  | Vol: pgdata      |    | Vol: ./data, ./config     |
  +------------------+    +---------------------------+
                               ^            ^
                               |            |
                          HTTP/WS       Browser UI
                          (Extension)   (User)
```

The ruvector-postgres image provides PostgreSQL with 143 SQL functions covering vectors, graph operations, GNN layers, BM25, local embedding generation, and self-healing HNSW indexes.

### 2.2 Extension to App to Database Data Flow

```
User browses LinkedIn
        |
        v
Chrome Extension (content script)
  - Detects page URL pattern (profile, search, feed, company, etc.)
  - Waits for DOM stability (MutationObserver)
  - Captures document.documentElement.outerHTML
  - Sends raw HTML + URL + metadata to service worker
        |
        v
Service Worker
  - Queues in chrome.storage.local if app offline
  - POST /api/extension/capture (with X-Extension-Token)
  - Maintains WebSocket to ws://localhost:3000/ws/extension
        |
        v
Next.js App (/api/extension/capture)
  1. Validates token + origin
  2. Compresses HTML (gzip), stores in page_cache table (5-version rotation)
  3. Queues for parsing
        |
        v
Page Parser Engine (cheerio + configurable selectors from DB)
  1. Detects page type from URL
  2. Loads versioned SelectorConfig from PostgreSQL
  3. Extracts structured data (name, headline, experience, etc.)
  4. Upserts into contacts, work_history, education, behavioral_observations
  5. Generates/updates profile_embeddings and content_embeddings via ruvector_embed()
  6. Triggers Claude analysis pipeline if warranted
  7. Pushes task updates to extension via WebSocket
```

### 2.3 Enrichment Provider to Database Flow

```
Enrichment Trigger (user-initiated, batch, or agent-driven background drip)
        |
        v
Waterfall Pipeline (field-aware, cost-optimal order)
  Stage 1: PDL ($0.22-0.28/call) -- email, phone, work history, skills
  Stage 2: Apollo ($0.02-0.24/call) -- missing email/phone, intent signals
  Stage 3: Lusha ($0.00-0.087/call) -- verified email + phone
  Stage 4: Crunchbase ($99/mo) -- funding, revenue, investors (per company)
  Stage 5: BuiltWith/TheirStack ($59-295/mo) -- tech stack (per company)
        |
        v
PostgreSQL (provenance-tracked, per-provider tables)
  - person_enrichments (per contact, per provider, with TTL)
  - company_enrichments (per company, per provider, with TTL)
  - enrichment_transactions (cost tracking, ROI)
  - budget_periods (credit/spend tracking per provider)
        |
        v
Materialized View: enriched_contacts (best-of-breed merge across providers)
```

### 2.4 Claude Agent Integration Points

Claude integrates at seven points across all three streams:

| Integration Point | Stream | What Claude Does |
|---|---|---|
| CSV Import Analysis | Backend + App | Analyzes clusters, asks progressive questions, refines ICP/niche |
| Task/Goal Generation | App + Extension | Creates goals with tasks, auto-populates queues based on network state |
| ICP Discovery | Backend + App | Identifies natural ICPs from HDBSCAN clustering, proposes new ICPs |
| Message Personalization | App + Extension | Fills templates using enrichment + behavioral + graph context |
| Scoring Analysis | App | Explains scoring math on hover, provides narrative rationale |
| Content Analysis | Backend + App | Batch NLP on captured posts for topics, pain points, engagement style |
| Network Intelligence | Backend + App | Identifies gaps, super hubs, warm intro paths, wedge expansion |

### 2.5 Shared TypeScript Types Across Stream Boundaries

These interfaces are used by both the extension and the app:

- `PageUrlPattern` -- page type enum shared between extension URL detection and app parser routing
- `CapturePayload` / `CaptureRequest` / `CaptureResponse` -- the capture submission contract
- `ExtensionTask` / `Goal` -- task/goal types displayed in extension, managed in app
- `TaskType` -- enum of task types (`visit_profile`, `capture_page`, `send_message`, etc.)
- `TemplateResponse` -- rendered message template fetched by extension from app
- `HealthResponse` -- app health check contract
- `ExtensionSettings` -- app-managed settings synced to extension
- `WsMessage` / `WsOutMessage` -- WebSocket event types for real-time push

These types should live in a shared package or directory accessible to both the extension and app builds.

---

## 3. Cross-Cutting Concerns

### 3.1 Contact Data Lifecycle

A contact flows through the system in stages, accumulating data from multiple sources:

```
CSV Import (Connections.csv)
  -> contacts table (name, position, company, connected_on)
  -> companies table (de-duplicated by slug)
  -> CONNECTED_TO edges
  -> profile_embeddings (generated via ruvector_embed)
        |
        v
Chrome Extension Capture (profile page HTML)
  -> page_cache (raw HTML, 5 versions)
  -> Parser extracts: headline, about, experience, education, skills
  -> behavioral_observations (posts, engagement patterns)
  -> content_embeddings (topic space)
        |
        v
API Enrichment (PDL, Apollo, Lusha, etc.)
  -> person_enrichments (email, phone, full history)
  -> company_enrichments (funding, tech stack, growth)
  -> enrichment_transactions (cost tracking)
        |
        v
Scoring Engine
  -> contact_scores (gold_score, tier, persona)
  -> score_dimensions (per-dimension breakdown)
  -> contact_icp_fits (per-ICP fit scores)
        |
        v
Graph Analytics
  -> graph_metrics (PageRank, betweenness, community)
  -> cluster_memberships
  -> warm intro paths via ruvector_graph_shortest_path()
        |
        v
Outreach
  -> outreach_states (state machine per contact per campaign)
  -> outreach_events (audit trail)
  -> template_performance (A/B tracking)
```

### 3.2 Security Model

- **Extension authentication**: Shared secret token stored in `chrome.storage.local` and `config/extension-token.json`. Every HTTP request includes `X-Extension-Token` header. App validates token + `Origin` header.
- **Localhost-only communication**: Extension only talks to `http://localhost:3000` and `ws://localhost:3000`. No external HTTP from extension. CSP enforced in manifest.
- **No PII in code**: API keys in `.env` and `config/api-keys.json`, both gitignored. LinkedIn data stays local in PostgreSQL.
- **GDPR compliance**: `POST /api/admin/forget/:contactId` implements right to erasure with cascading deletes across all tables. Manual purge tool in admin with filter-based deletion and warning modals.
- **No automation of LinkedIn**: Extension does not auto-navigate, click UI elements, send messages, intercept API calls, read cookies, or access the Voyager API. User performs all LinkedIn actions manually.
- **HTML sanitization**: App-side parser uses cheerio (no JS execution). Extracted text is sanitized before database storage. Cached HTML is never rendered directly in the app UI.

### 3.3 Error Handling Patterns

- **API errors**: Consistent `ApiError` format (`{error, message, details, status}`) across all endpoints.
- **Extension offline**: Captures queued in `chrome.storage.local` (max ~50 captures). Flushed chronologically on reconnect. Badge turns orange. Extension does not function without app running.
- **Enrichment failures**: Logged in `enrichment_transactions` with `success: false`. Waterfall continues to next provider. Budget not charged for failed lookups.
- **Parser failures**: Low-confidence extractions flagged in `ParseResult.warnings`. Fields extracted via heuristic fallback marked as `confidence: 'low'`.
- **WebSocket reconnect**: Exponential backoff (5s initial, 60s max). Badge indicates connection state.

### 3.4 Budget and Cost Management

- **Per-provider budget periods**: `budget_periods` table tracks credits used/remaining per provider per billing cycle.
- **Pre-enrichment cost estimation**: `POST /api/enrichment/estimate` returns cost before any operation. UI shows preview ("12 contacts x $0.22 = $2.64").
- **Hard enforcement**: If budget cap exceeded, operation refused with message. Warning at 80% threshold.
- **Background agent budget**: Daily spend cap configurable. Agent prioritizes gold-tier unenriched contacts.
- **Claude API costs**: Tracked as a provider in `enrichment_providers`. Light analysis ~$0.003/contact, medium ~$0.008, deep ~$0.015.
- **ROI tracking**: `enrichment_roi` view calculates match rate and cost-per-enriched-contact by provider by month.

### 3.5 Rate Limiting and LinkedIn ToS Compliance

- **No automated page loading**: User manually navigates LinkedIn. Extension only captures what the user sees.
- **Daily capture warnings**: Configurable threshold (default 30/day). Extension shows warning overlay.
- **Opt-in auto-capture**: Disabled by default. When enabled, captures on every LinkedIn page navigation the user performs.
- **No API calls to LinkedIn**: All data comes from CSV export, user-browsed page captures, or licensed third-party enrichment APIs.
- **Clipboard-only outreach**: Messages are copied to clipboard. Extension never sends messages or connection requests.

### 3.6 Single-User, Local-First Constraints

- No user authentication in the app (single user, localhost only).
- No multi-account support (one LinkedIn account per installation).
- No server deployment or cloud hosting in V2 scope.
- All data stored in local PostgreSQL volume (`pgdata`).
- Extension registration uses a simple token exchange, not OAuth.

---

## 4. Business Requirements Summary

### Import & Data Ingestion (BR-1xx)

| ID | Requirement |
|---|---|
| BR-101 | Import LinkedIn Connections.csv with 2-line preamble detection and field auto-mapping |
| BR-102 | Import all LinkedIn export CSVs in defined order: Profile, Connections, Messages, Invitations, Endorsements, Recommendations, Positions, Education, Skills, Company Follows |
| BR-103 | Detect and skip duplicate files via SHA-256 hash checking |
| BR-104 | Detect job changes between re-imports (company changed = high-value signal) |
| BR-105 | Never delete contacts on re-import; add or update only |
| BR-106 | Log all import changes (new contacts, field updates, job changes) in import_change_log |
| BR-107 | Resolve companies by fuzzy matching (Levenshtein < 3) with slug-based de-duplication |
| BR-108 | Import messages.csv with full content storage for Claude analysis |
| BR-109 | Compute message_stats per contact (count, direction ratio, recency) |
| BR-110 | Construct typed, weighted edges from all CSV files (CONNECTED_TO, MESSAGED, INVITED_BY, ENDORSED, RECOMMENDED) |
| BR-111 | Progressive Claude questioning during import to refine ICP/niche understanding |
| BR-112 | Auto-generate initial clusters and goals after import |

### Contact Management (BR-2xx)

| ID | Requirement |
|---|---|
| BR-201 | Contact table with 7 columns: Name, Title/Company, Score, ICP Fit, Tier, Enrichment Status, Outreach State |
| BR-202 | Full scoring math visible on hover (all dimensions with weights and values) |
| BR-203 | Tabbed contact detail: Profile, Network, Outreach, Enrichment, Activity |
| BR-204 | Per-source enrichment attribution ("PDL says X, Apollo says Y") in enrichment tab |
| BR-205 | Similar contacts via vector search (profile_embeddings) |
| BR-206 | Hybrid search (vector + BM25 keyword) across contacts |
| BR-207 | Ego network graph per contact (reagraph radial layout) |
| BR-208 | Company cluster graph showing account penetration (reagraph concentric) |
| BR-209 | CSV export of enriched contacts |
| BR-210 | GDPR right-to-erasure per contact with cascading delete |
| BR-211 | Command palette (Cmd+K) searching contacts, clusters, tasks, goals, and actions |

### Enrichment (BR-3xx)

| ID | Requirement |
|---|---|
| BR-301 | Field-aware waterfall pipeline: PDL -> Apollo -> Lusha -> Crunchbase -> BuiltWith/TheirStack |
| BR-302 | Provider abstraction layer with common TypeScript interface |
| BR-303 | Individual, batch, background drip, selective, and re-enrichment execution modes |
| BR-304 | Pre-operation cost estimation with user confirmation |
| BR-305 | Per-provider budget tracking with configurable caps |
| BR-306 | Budget enforcement (refuse at cap, warn at 80%) |
| BR-307 | Background enrichment agent driven by Claude, prioritizing gold-tier unenriched contacts |
| BR-308 | Provider configuration UI (API key, balance, rate limits, enable/disable) |
| BR-309 | ROI tracking per provider (match rate, cost per enriched contact) |
| BR-310 | TTL-based staleness detection for re-enrichment triggers |
| BR-311 | All providers available; cheapest path to maximum data |

### Scoring & ICP (BR-4xx)

| ID | Requirement |
|---|---|
| BR-401 | Extensible scoring engine with pluggable dimension scorers |
| BR-402 | 9 scoring dimensions: ICP fit, network hub, relationship strength, signal boost, skills relevance, network proximity, behavioral, content relevance (new), graph centrality (new) |
| BR-403 | Null-safe weight redistribution when dimensions lack data |
| BR-404 | User-tunable weight profiles via admin panel with slider controls |
| BR-405 | Named weight profiles ("Sales-focused", "Networking-focused") |
| BR-406 | Bayesian weight learning from outreach outcomes (when data > 200 attempts) |
| BR-407 | Degree-aware tier thresholds (separate for 1st and 2nd degree) |
| BR-408 | Per-ICP fit scoring (contact scored against all active ICPs) |
| BR-409 | Persona classification: buyer, warm-lead, advisor, hub, active-influencer, ecosystem-contact, peer, network-node |
| BR-410 | Behavioral persona: super-connector, content-creator, silent-influencer, rising-connector, data-insufficient, passive-network |
| BR-411 | Score preview showing before/after impact on sample contacts when weights change |
| BR-412 | RVF training interface for user feedback (pairwise comparison) |
| BR-413 | Multiple simultaneous ICP profiles supported |
| BR-414 | Multiple simultaneous niche profiles with switching |
| BR-415 | 3D wedge model: radius = penetration, arc = niche breadth, height = ICP depth |
| BR-416 | ICP discovery from HDBSCAN clustering with user confirmation |
| BR-417 | Power user ICP builder (wizard with Claude assistance) |

### Graph & Network (BR-5xx)

| ID | Requirement |
|---|---|
| BR-501 | Cypher queries via ruvector_cypher_query() for graph traversal and pattern matching |
| BR-502 | Warm introduction path finding via ruvector_graph_shortest_path() |
| BR-503 | PageRank for influence scoring |
| BR-504 | Spectral clustering for community detection |
| BR-505 | Per-contact graph metrics: betweenness, PageRank, eigenvector, degree centrality |
| BR-506 | Bridge and hub node detection |
| BR-507 | Incremental graph recomputation on new contacts/edges (affected 2-hop subgraph) |
| BR-508 | On-demand full graph recomputation |
| BR-509 | Full network graph (reagraph force-directed 2D and 3D) |
| BR-510 | Graph controls: layout, color by, size by, edge filter, cluster hulls, path finder, model selector |
| BR-511 | Cluster sidebar with summary, top contacts, and cluster-level actions |
| BR-512 | GNN inference via ruvector_gnn_gcn_layer() for influence propagation (future) |

### Outreach (BR-6xx)

| ID | Requirement |
|---|---|
| BR-601 | Reusable message templates with merge variables |
| BR-602 | Claude fills templates using contact data + enrichment + behavioral + graph context |
| BR-603 | Timed, branching, configurable outreach sequences |
| BR-604 | Outreach state machine: planned -> sent -> pending_response -> responded -> engaged -> converted -> declined -> deferred -> closed_lost |
| BR-605 | Clipboard-only message delivery (no auto-send) |
| BR-606 | Kanban-style outreach pipeline view |
| BR-607 | Template performance tracking (accept rate, response rate, by tier and persona) |
| BR-608 | Campaign groupings with daily limits |
| BR-609 | Template editor with sequence position and branching configuration |
| BR-610 | Outreach event log (append-only audit trail) |

### Goals & Tasks (BR-7xx)

| ID | Requirement |
|---|---|
| BR-701 | Claude auto-generates goals with associated tasks based on network state |
| BR-702 | User can accept, reject, edit, or pause any goal or task |
| BR-703 | Task categories: Explore (blue), Enrich (purple), Engage (green), Analyze (amber) |
| BR-704 | Task prioritization by expected value (tier, data completeness, recency) |
| BR-705 | Tasks drive enrichment (gold-tier no-email = highest priority) |
| BR-706 | Tasks drive network exploration (orphan contacts, cluster gaps, bridge contacts) |
| BR-707 | Goal progress tracking with completion percentage |
| BR-708 | Dashboard widget showing top 3 goals with progress |
| BR-709 | Discovery feed showing AI insights chronologically |
| BR-710 | Task dependency locking (e.g., outreach locked until enrichment complete) |

### Chrome Extension (BR-8xx)

| ID | Requirement |
|---|---|
| BR-801 | Capture full rendered HTML (document.documentElement.outerHTML) after DOM stability |
| BR-802 | Detect page type by URL pattern only (no DOM inspection in extension) |
| BR-803 | Support 8 page types: Profile, Profile Activity, Search People, Search Content, Feed, Company, Connections, Messages |
| BR-804 | Store last 5 cached pages per URL with version rotation |
| BR-805 | App-side parsing with cheerio using configurable, versioned selectors from PostgreSQL |
| BR-806 | Re-parse all cached pages when selectors update (no re-visit required) |
| BR-807 | Extension popup with capture button, top tasks, connection status, message template |
| BR-808 | Side panel (Chrome 114+) with full goal/task/template UI |
| BR-809 | Floating overlay showing capture status (ready, capturing, synced, scroll-more, error) |
| BR-810 | Token-based authentication with origin validation |
| BR-811 | WebSocket for real-time push (task updates, capture confirmations, enrichment results) |
| BR-812 | Offline queue (chrome.storage.local) with flush on reconnect |
| BR-813 | Auto-detection of task completion when user navigates to matching URL |
| BR-814 | Badge showing pending task count, connection status |
| BR-815 | Opt-in auto-capture toggle (off by default) |
| BR-816 | Daily capture count tracking with configurable warning threshold |
| BR-817 | Extension does not function without app running |

### Admin & Configuration (BR-9xx)

| ID | Requirement |
|---|---|
| BR-901 | Scoring weight tuning panel with sliders and sum validation |
| BR-902 | Data purge tool with filter-based selection and warning modals |
| BR-903 | Provider management (API key, balance, configuration per provider) |
| BR-904 | Schema versioning table for migrations |
| BR-905 | System health dashboard (DB connection, extension status, provider status) |
| BR-906 | Materialized view refresh for enriched_contacts |
| BR-907 | Database backup capability |
| BR-908 | Admin Cypher query interface |
| BR-909 | Selector config editing and re-parse job management |

### Visualization (BR-10xx)

| ID | Requirement |
|---|---|
| BR-1001 | Network Health Ring (Recharts donut) -- data maturity breakdown |
| BR-1002 | ICP Radar Overlay (Recharts radar) -- top 3 ICP comparison |
| BR-1003 | Enrichment Budget Bars (Recharts horizontal bar) -- per-provider spend vs limit |
| BR-1004 | Score Breakdown Bar (Recharts stacked bar) -- weighted dimension contributions |
| BR-1005 | Tier Distribution Pie (Recharts pie) -- Gold/Silver/Bronze/Watch distribution |
| BR-1006 | Gold Concentration Bars (Recharts bar) -- per-niche gold percentage |
| BR-1007 | Cross-Niche Comparison (Recharts grouped bar) -- side-by-side niche dimensions |
| BR-1008 | Enrichment Coverage Area (Recharts stacked area) -- coverage growth over time |
| BR-1009 | Outreach Pipeline Funnel (Recharts funnel) -- contacts by outreach stage |
| BR-1010 | Goal Progress Bars (Recharts bar) -- per-goal completion |
| BR-1011 | Activity Timeline Scatter (Recharts scatter) -- post frequency with engagement size |
| BR-1012 | ICP Match Treemap (Recharts treemap) -- contacts grouped by ICP, sized by score |
| BR-1013 | Scoring Weight Distribution (Recharts pie) -- weight allocation |
| BR-1014 | Score Impact Preview Line (Recharts line) -- before/after comparison |
| BR-1015 | Enrichment Cost Breakdown Pie (Recharts pie) -- spend by provider |
| BR-1016 | 3D Wedge Model (visx) -- the signature visualization: radius/arc/height |
| BR-1017 | Outreach Sequence Tree (visx hierarchy) -- branching message sequence |
| BR-1018 | Score Dimension Parallel Coordinates (visx) -- multi-dimension scoring profile |
| BR-1019 | Import Progress Visualization (visx pack) -- clusters forming in real-time |
| BR-1020 | Engagement Heatmap (visx heatmap) -- day-of-week x time-of-day activity |
| BR-1021 | Full Network Graph (reagraph force-directed 2D) -- primary network view |
| BR-1022 | 3D Network Graph (reagraph force-directed 3D) -- for 500+ contact networks |
| BR-1023 | Cluster View (reagraph clustering) -- nodes grouped by cluster |
| BR-1024 | Path Finder (reagraph selections) -- shortest path highlighting |
| BR-1025 | Ego Network (reagraph radial) -- single contact's 1st-degree connections |
| BR-1026 | ICP Overlay Graph (reagraph custom nodes) -- network colored by ICP |
| BR-1027 | Company Cluster Graph (reagraph concentric) -- account penetration view |

---

## 5. SPARC Planning Structure

### Specification

Define these artifacts first, before any implementation:

1. **Database schema** -- All tables, indexes, triggers, materialized views, and seed data as documented in the backend stream analysis. This is the foundation everything builds on.
2. **Shared TypeScript interfaces** -- `CapturePayload`, `ExtensionTask`, `Goal`, `PageUrlPattern`, `WsMessage`, `EnrichmentProvider`, `ApiError`, and all API request/response shapes. These are the contracts between extension, app, and database.
3. **API route specifications** -- Complete OpenAPI-style specification for all ~80 endpoints across contacts, companies, import, scoring, ICP, graph, enrichment, outreach, tasks, extension, agent, and admin domains.
4. **Selector configurations** -- Initial JSON selector configs for each LinkedIn page type, migrated from V1 extractors to the new `SelectorConfig` format.
5. **Enrichment provider contracts** -- Per-provider input/output schemas for PDL, Apollo, Lusha, Crunchbase, BuiltWith, TheirStack.
6. **Scoring dimension specifications** -- Input requirements, calculation method, and output range for each of the 9 scoring dimensions.

### Pseudocode

Key algorithms requiring detailed pseudocode before implementation:

1. **Scoring pipeline** -- Dimension router, null-safe weight redistribution, composite calculator, tier assignment, persona classification. The backend analysis provides the structure; pseudocode should cover edge cases (no enrichment data, single-dimension contacts).
2. **Enrichment waterfall** -- Field-aware provider selection, cache checking, budget enforcement, cost estimation, fallback chains, provenance tracking. The waterfall must stop as soon as required fields are filled.
3. **Graph analytics** -- Cypher query construction for warm intros, incremental vs full recomputation triggers, community detection pipeline, bridge/hub classification logic.
4. **Page parser engine** -- Selector chain fallback with confidence scoring, heuristic rules, field extraction, contact upsert logic, re-parse job workflow.
5. **Task generation** -- Claude prompt engineering for goal/task creation from network state analysis. Prioritization algorithm. Dependency graph (which tasks unlock other tasks).
6. **CSV import pipeline** -- Multi-file ordered processing, deduplication, job change detection, edge construction from each CSV type.

### Architecture

Component boundaries and module structure:

1. **App module structure**: `src/db/` (schema, migrations, queries), `src/enrichment/` (provider registry, waterfall, budget), `src/scoring/` (dimensions, weights, pipeline), `src/graph/` (analytics, cypher, communities), `src/parser/` (page type parsers, selector configs), `src/import/` (CSV processors), `src/agent/` (Claude integration, goal/task generation), `src/api/` (Next.js route handlers).
2. **Extension module structure**: `content-scripts/` (page-capturer, overlay), `service-worker.ts`, `popup/`, `sidepanel/`, `shared/` (types, app-client, storage, constants).
3. **Dependency graph**: Extension depends on shared types only. App depends on shared types + database. No circular dependencies between extension and app modules.
4. **Data access layer**: Drizzle ORM or raw SQL via pg client. Materialized view refresh strategy. Connection pooling.

### Refinement

1. **Testing strategy**: Unit tests for scoring dimensions, enrichment providers, CSV parsers, page parsers. Integration tests for API endpoints with test database. E2E tests for import-to-scoring pipeline. Extension tests using Chrome Extension Testing Library or manual protocol.
2. **Performance targets**: Dashboard load < 500ms. Contact table pagination < 200ms. Graph rendering < 2s for 1000 nodes. Enrichment waterfall < 5s per contact. Scoring run < 10ms per contact.
3. **Security review**: Extension CSP validation. Token rotation mechanism. Input sanitization at all API boundaries. HTML sanitization in parser. No eval/innerHTML in extension.

### Completion

1. **Integration testing**: Full pipeline from CSV import through enrichment, scoring, graph analytics, task generation, extension capture, and outreach template rendering.
2. **Deployment**: docker-compose up with health checks. First-run schema initialization. Extension sideloading documentation.
3. **Documentation**: Admin guide for provider configuration. User guide for extension usage. Architecture decision records for PostgreSQL adoption, dumb-capture pattern, and scoring engine design.

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

**Goal**: Core infrastructure running. CSV import works. Basic app shell.

- PostgreSQL schema (all tables, indexes, triggers, materialized views)
- docker-compose.yml with ruvector-postgres + Next.js app
- Database initialization script (extensions, seed data)
- CSV import pipeline (Connections.csv, messages.csv, all relationship CSVs)
- Company resolution and de-duplication
- Edge construction from all CSV types
- Profile embedding generation via ruvector_embed()
- Basic app shell: sidebar navigation, dashboard page skeleton, contacts table
- SWR data fetching setup
- API routes: contacts CRUD, import, basic search

### Phase 2: Core Engine (Weeks 5-8)

**Goal**: Scoring, enrichment, and graph analytics operational.

- Scoring engine: all 9 dimensions, weight manager, composite calculator, tier assignment
- Enrichment provider abstraction layer
- PDL and Lusha provider implementations (cheapest path)
- TheirStack provider implementation (company tech stacks)
- Enrichment waterfall with budget enforcement
- Graph analytics: PageRank, betweenness, community detection via ruvector functions
- Warm intro path finding
- ICP/niche discovery via HDBSCAN clustering
- Contact-to-ICP fit scoring
- Materialized views and enriched_contacts refresh
- API routes: scoring, enrichment, graph, ICP/niche

### Phase 3: App UI (Weeks 9-12)

**Goal**: Full dashboard, contact detail, network graph, discover page.

- Dashboard redesign: GoalFocusBanner, NetworkHealthRing, TaskQueueWidget, DiscoveryFeed, IcpRadarChart, EnrichmentBudgetBars
- Contact detail with 5 tabs (Profile, Network, Outreach, Enrichment, Activity)
- Score math popover (full breakdown on hover)
- Network graph with reagraph (force-directed 2D/3D, cluster view, path finder)
- Graph controls panel
- Discover page with wedge visualization (visx), niche cards, ICP treemap
- Power user ICP builder
- Enrichment management page (provider cards, budget bars, batch enrichment)
- Command palette
- API routes for all app pages

### Phase 4: Chrome Extension (Weeks 13-16)

**Goal**: Extension captures pages. App parses them. Task system flows.

- Extension project setup (Manifest V3, TypeScript, esbuild)
- Content script: page-capturer with URL pattern detection and outerHTML capture
- Content script: overlay with capture status
- Service worker: message routing, HTTP client, capture queue
- Basic popup: capture button, connection status, top tasks
- App-side page parser engine with cheerio
- Profile parser with V1 selector chains
- Search results parser
- Page cache table with 5-version rotation
- Token-based auth (registration flow, validation middleware)
- Side panel with goal/task list
- Task auto-completion detection
- Additional parsers: feed, company, connections, messages
- API routes: extension capture, tasks, health, templates, settings
- WebSocket server for real-time push

### Phase 5: Intelligence (Weeks 17-20)

**Goal**: Claude fully integrated. Goals/tasks auto-generated. Outreach templates.

- Claude agent integration for task/goal generation
- Claude content analysis pipeline (light/medium/deep)
- Behavioral observation processing
- Content profile generation (topics, pain points, engagement style)
- Activity pattern detection
- Outreach template system with merge variables
- Claude template personalization
- Outreach state machine with branching sequences
- Outreach campaign management
- Template performance tracking
- Goals & tasks page with full UI
- Extension template delivery (clipboard copy workflow)

### Phase 6: Polish (Weeks 21-24)

**Goal**: Complete visualization catalog. Admin panel. Onboarding.

- Remaining Recharts visualizations (funnel, treemap, scatter, parallel coordinates)
- Remaining visx visualizations (outreach sequence tree, engagement heatmap, import progress)
- Admin scoring panel with weight sliders, score preview, RVF training
- Data purge tool with filter-based selection and confirmation modals
- Provider management page
- Import wizard with progressive Claude questions
- Selector config admin UI and re-parse job management
- Apollo, Crunchbase, BuiltWith provider implementations
- Daily capture warnings and rate awareness
- Extension settings UI
- Security hardening and audit
- Documentation

---

## 7. Stream Document Index

### Symposium Documents

| Document | Path | Content |
|---|---|---|
| Panel 1: Data Architecture & Graph Engine | `docs/plans/version2/panel-1-data-architecture.md` | SQLite/Neo4j analysis, graph schema, embedding strategy, migration paths |
| Panel 2: App UX & Dashboard Design | `docs/plans/version2/panel-2-app-ux-design.md` | Navigation redesign, dashboard wireframes, component specifications, visualization catalog |
| Panel 3: Chrome Extension Architecture | `docs/plans/version2/panel-3-chrome-extension.md` | Manifest V3 design, DOM extractors, communication protocol, task surfacing |
| Panel 4: Enrichment & Intelligence Engine | `docs/plans/version2/panel-4-enrichment-intelligence.md` | Provider analysis, waterfall design, scoring algorithm, Claude integration |
| Symposium Q&A | `docs/plans/version2/symposium-qa.md` | 39 product owner decisions on scope, architecture, UX, security, compliance |

### Final Analysis Documents

| Document | Path | Content |
|---|---|---|
| Backend Stream Analysis | `docs/plans/version2/final-analysis-backend.md` | PostgreSQL schema (30+ tables), CSV import pipeline, enrichment waterfall, scoring engine, graph analytics, agent task system, complete API specification (~80 endpoints) |
| App Stream Analysis | `docs/plans/version2/final-analysis-app.md` | Navigation redesign, dashboard wireframes, contact management, ICP/niche system, goals/tasks, outreach/templates, enrichment management, network graph, admin panel, 27 visualization specifications, complete component inventory |
| Extension Stream Analysis | `docs/plans/version2/final-analysis-extension.md` | "Dumb capture + smart app" architecture, Manifest V3 config, page capture system, communication protocol (HTTP + WebSocket), goal/task system in extension, message template delivery, overlay/popup/side panel UX, app-side page parser, security model |

### V2 Plan

| Document | Path | Content |
|---|---|---|
| V2 Plan (Product Owner Brief) | `docs/plans/version2.md` | Original requirements: CSV import, enrichment pipeline, Chrome extension, ICP/niche model, data source comparison, architecture vision |
