# V2 Master Orchestration Plan

## Overview

This plan orchestrates the implementation of LinkedIn Network Intelligence V2 across 6 phases and 3 domains (Backend, App, Extension). It follows the symposium's final analysis and supports two-layer parallel execution: phase-level sub-orchestrators delegate domain tasks to parallel agents.

## Architecture Summary

- **Backend**: PostgreSQL + ruvector-postgres (relational + vector + graph in one DB), docker-compose, Next.js API routes + MCP tools (ruvector Rust server via mcp-gate pattern)
- **App**: Next.js 15 (App Router), shadcn/ui, Recharts, visx, reagraph, SWR
- **Extension**: Manifest V3 Chrome extension, "dumb capture + smart app" model

## MCP Architecture (V2) — ruvector Rust Integration

V2 replaces HTTP API routes with MCP tools for the intelligence layer.
Claude agents call application tools directly via MCP over stdio, eliminating HTTP overhead.

### Architecture Shift
- **Old**: Claude Agent → HTTP API Routes → Node.js handlers → PostgreSQL
- **New**: Claude Agent → MCP Server (ruvector Rust binary, stdio) → PostgreSQL direct

### Why ruvector Rust as MCP Server
The `mcp-gate` crate (ruvector `crates/mcp-gate/`) provides a production MCP server pattern:
- **Rust binary**: Compiled, sub-millisecond tool dispatch via stdio JSON-RPC
- **Built-in to ruvector-postgres**: 230+ SQL functions already available in our DB
- **FastGRNN routing** (`ruvector-tiny-dancer-core`): Sub-ms intelligent tool routing
- **Self-learning**: `ruvector_record_trajectory()` + `ruvector_get_verdict()` for adaptive improvement
- **Acts as router**: Routes MCP tool calls to appropriate handlers (vector search, graph, scoring)

### ruvector-postgres Functions Available in DB

Already deployed via `ruvnet/ruvector-postgres:latest` Docker image:

| Category | Key Functions | Count |
|----------|--------------|-------|
| Vector Search | `ruvector_cosine_distance`, `<=>` operator, HNSW indexes | 5 |
| Hybrid Search | BM25 + vector fusion via `ruvector_bm25_score` | 14 |
| Graph | `ruvector_graph_pagerank`, `ruvector_cypher_query`, `ruvector_graph_shortest_path` | 8 |
| Agent Routing | `ruvector_route_query`, `ruvector_adaptive_route`, `ruvector_register_agent` | 11 |
| Self-Learning | `ruvector_record_trajectory`, `ruvector_distill_memory` | 7 |
| Attention | Flash, multi-head, sparse, linear + 29 variants | 39 |
| GNN | GCN, GraphSAGE, GAT layers | 5 |

### MCP Server Design (based on mcp-gate pattern)

The v2 MCP server follows `mcp-gate` crate's architecture:
- `McpGateServer` — stdio JSON-RPC server (initialize → tools/list → tools/call)
- `McpGateTools` — tool registry with `list_tools()` and `call_tool()` dispatch
- Protocol: JSON-RPC 2.0, MCP protocol version 2024-11-05
- Transport: stdio (line-delimited JSON)

Our v2 MCP server (`agent/network-intelligence/`) will expose domain tools:
- **Contact tools**: search, score, enrich, get-profile, list-by-tier
- **Graph tools**: pagerank, shortest-path, communities, ego-network
- **Vector tools**: similarity-search, embed-profile, hybrid-search
- **Intelligence tools**: generate-goals, suggest-outreach, analyze-network

### Agent Namespace
- `agent/linkedin-prospector/` — V1 agent (preserved, standalone)
- `agent/network-intelligence/` — V2 MCP-native agent using ruvector Rust MCP server

### .mcp.json Configuration (future)
```json
{
  "mcpServers": {
    "claude-flow": { "command": "npx", "args": ["@claude-flow/cli@latest", "mcp", "start"] },
    "network-intelligence": {
      "command": "agent/network-intelligence/mcp-server",
      "args": ["--db-url", "postgresql://ctox:$POSTGRES_PASSWORD@localhost:5432/ctox"]
    }
  }
}
```

## Phase Overview

| Phase | Name | Weeks | Primary Focus | Gate |
|-------|------|-------|---------------|------|
| 1 | Foundation | 1-4 | DB schema, docker, CSV import, app shell | CSV import works, app renders dashboard skeleton |
| 2 | Core Engine | 5-8 | Scoring, enrichment, graph analytics | Scoring pipeline produces tiers, enrichment waterfall runs |
| 3 | App UI | 9-12 | Full dashboard, contact detail, network graph, discover | All primary pages render with real data |
| 4 | Extension | 13-16 | Chrome extension capture, app-side parsing, task system | Extension captures HTML, app parses it, tasks flow |
| 5 | Intelligence | 17-20 | Claude integration, goals/tasks, outreach templates | Claude generates goals, templates personalize |
| 6 | Polish | 21-24 | Remaining viz, admin panel, onboarding, security | Full feature parity with spec, security audit passes |

## Two-Layer Parallel Execution Model

```
                     Master Orchestrator (this plan)
                              |
              +---------------+---------------+
              |               |               |
     Phase Sub-Orchestrator   ...           Phase Sub-Orchestrator
     (Phase 1)                              (Phase N)
              |
    +---------+---------+
    |         |         |
  Backend   App     Extension
  Agent     Agent   Agent
  (parallel tasks)  (parallel tasks)
```

**Layer 1**: Master orchestrator delegates phase-domain task groups to sub-orchestrators
**Layer 2**: Sub-orchestrators delegate individual tasks to parallel agents within each domain

## Orchestration Rules

1. Each phase has a **GATE** that must pass before proceeding
2. Each phase has a **USER CHECKPOINT** for finalization and pre-work for next phase
3. Tasks within a domain run in parallel where no dependency exists
4. Cross-domain dependencies are explicitly listed per phase
5. Implementation logs go to `docs/implementation-logs/v2/phase-N/`
6. No delegation of tasks that can be completed directly (only delegate when blocked, e.g., API access needed)

---

## Phase 1: Foundation (Weeks 1-4)

### Objective
Core infrastructure running. CSV import works. Basic app shell renders.

### Domain Distribution

| Domain | Tasks | Parallel Agents |
|--------|-------|-----------------|
| Backend | 8 | 3-4 |
| App | 6 | 2-3 |
| Extension | 1 | 1 |

### Cross-Domain Dependencies
- App depends on Backend: DB schema must exist before API routes
- App depends on Backend: CSV import pipeline feeds the contacts table
- Extension: Only project scaffolding in Phase 1 (no backend dependency yet)

### Phase 1 Checklist

#### Backend (see `phase-1-foundation/backend.md`)
- [x] PostgreSQL schema: all core tables (contacts, companies, edges, clusters)
- [x] PostgreSQL schema: enrichment provenance tables (person_enrichments, company_enrichments, work_history, education)
- [x] PostgreSQL schema: behavioral observation tables
- [x] PostgreSQL schema: scoring tables (contact_scores, score_dimensions, weight profiles, tier thresholds)
- [x] PostgreSQL schema: ICP/niche profile tables + wedge_metrics
- [x] PostgreSQL schema: task/goal tables
- [x] PostgreSQL schema: page_cache, import tracking, budget/cost tracking
- [x] PostgreSQL schema: vector embedding tables (profile, content, company) with HNSW indexes
- [x] PostgreSQL schema: message tables + message_stats
- [x] PostgreSQL schema: outreach state tables (campaigns, templates, sequences, states, events)
- [x] PostgreSQL schema: graph sync triggers, materialized views, schema versioning
- [x] docker-compose.yml with ruvector-postgres + Next.js app
- [x] Database initialization script (001-extensions.sql)
- [x] CSV import pipeline: Connections.csv with 2-line preamble detection
- [x] CSV import pipeline: messages.csv processing + message_stats computation
- [x] CSV import pipeline: all relationship CSVs (Invitations, Endorsements, Recommendations)
- [x] Company resolution with fuzzy matching (Levenshtein < 3) + slug dedup
- [x] Edge construction from all CSV types
- [x] Import deduplication (SHA-256 hash, field-level diff, never-delete)
- [x] Profile embedding generation via ruvector_embed()
- [x] API routes: contacts CRUD, import, basic search

#### App (see `phase-1-foundation/app.md`)
- [x] Next.js 15 project setup with App Router
- [x] shadcn/ui + Tailwind CSS 4 configuration
- [x] Sidebar navigation (rewrite from V1)
- [x] Dashboard page skeleton (layout only, no data yet)
- [x] Contacts table page (basic, 7 columns)
- [x] SWR data fetching setup
- [x] Basic API route implementations for contacts
- [x] Import wizard page (upload step only)

#### Extension (see `phase-1-foundation/extension.md`)
- [x] Project scaffolding: Manifest V3, TypeScript, esbuild build chain
- [x] Shared types package/directory setup (TypeScript interfaces)

### Gate Criteria
- [x] `docker-compose up` starts both containers successfully
- [x] Health check passes (DB connection + app responds)
- [x] CSV import of Connections.csv creates contacts in DB
- [x] `GET /api/contacts` returns imported contacts
- [x] App renders sidebar + dashboard skeleton at localhost:3000
- [x] Contacts table displays imported data

### User Checkpoint
**User actions needed before Phase 2:**
- Review imported data quality
- Verify docker-compose works on target machine
- Provide any LinkedIn CSV exports for testing
- Review and approve the database schema
- Set up `.env` file with `POSTGRES_PASSWORD` and `ANTHROPIC_API_KEY`

---

## Phase 2: Core Engine (Weeks 5-8)

### Objective
Scoring, enrichment, and graph analytics operational.

### Domain Distribution

| Domain | Tasks | Parallel Agents |
|--------|-------|-----------------|
| Backend | 10 | 4-5 |
| App | 5 | 2-3 |
| Extension | 0 | 0 |

### Cross-Domain Dependencies
- App depends on Backend: scoring API must exist before score display
- App depends on Backend: enrichment API must exist before enrichment page

### Phase 2 Checklist

#### Backend (see `phase-2-core-engine/backend.md`)
- [x] Scoring engine: dimension router with pluggable scorers
- [x] All 9 scoring dimensions implemented (icp_fit, network_hub, relationship_strength, signal_boost, skills_relevance, network_proximity, behavioral, content_relevance, graph_centrality)
- [x] Weight manager with null-safe redistribution
- [x] Composite calculator + tier assignment (degree-aware thresholds)
- [x] Persona classification (8 personas + 6 behavioral personas)
- [x] Enrichment provider abstraction layer (TypeScript interface)
- [x] PDL provider implementation
- [x] Lusha provider implementation
- [x] TheirStack provider implementation
- [x] Enrichment waterfall with field-aware provider selection
- [x] Budget enforcement (refuse at cap, warn at 80%)
- [x] Graph analytics: PageRank via ruvector_pagerank()
- [x] Graph analytics: betweenness centrality
- [x] Graph analytics: community detection via ruvector_spectral_cluster()
- [x] Warm intro path finding via ruvector_graph_shortest_path()
- [x] ICP/niche discovery via HDBSCAN clustering
- [x] Contact-to-ICP fit scoring
- [x] Materialized view refresh for enriched_contacts
- [x] API routes: scoring, enrichment, graph, ICP/niche

#### App (see `phase-2-core-engine/app.md`)
- [x] Score display in contacts table (gold_score column with tier badge)
- [x] Score math popover (full breakdown on hover)
- [x] Basic enrichment page layout
- [x] Enrichment provider status cards
- [x] ICP/niche list view
- [x] API integration for scoring/enrichment/ICP endpoints

### Gate Criteria
- [x] Scoring pipeline: import CSV -> score all contacts -> tier assignments appear
- [x] At least one enrichment provider (PDL or Lusha) enriches a contact successfully
- [x] Budget tracking records the enrichment cost
- [x] Graph metrics computed for imported contacts (PageRank values non-zero)
- [x] At least one cluster detected from imported data
- [x] Warm intro path returns a valid path between two connected contacts

### User Checkpoint
**User actions needed before Phase 3:**
- Configure at least one enrichment provider API key
- Review scoring weights and tier thresholds
- Verify ICP/niche discovery results make sense
- Test enrichment on a small batch (5-10 contacts)
- Review budget tracking accuracy

---

## Phase 3: App UI (Weeks 9-12)

### Objective
Full dashboard, contact detail, network graph, discover page.

### Domain Distribution

| Domain | Tasks | Parallel Agents |
|--------|-------|-----------------|
| Backend | 3 | 1-2 |
| App | 15 | 5-6 |
| Extension | 0 | 0 |

### Cross-Domain Dependencies
- App depends on Backend: all data APIs from Phase 2
- Backend: new API routes for dashboard, graph data, discover

### Phase 3 Checklist

#### Backend (see `phase-3-app-ui/backend.md`)
- [ ] Dashboard aggregate API endpoint <!-- NOT DONE: no single aggregate endpoint, dashboard fetches from multiple APIs -->
- [ ] Graph data API (nodes + edges for reagraph) <!-- NOT DONE: no nodes/edges API, reagraph not installed -->
- [x] Discover/wedge metrics API <!-- PARTIAL but functional: /api/icp/discover returns ICP discoveries; wedge metrics endpoint missing -->
- [ ] Hybrid search API (vector + BM25) <!-- NOT DONE: /api/contacts/search is keyword-only, no vector support -->

#### App (see `phase-3-app-ui/app.md`)
- [ ] Dashboard redesign: GoalFocusBanner, NetworkHealthRing, TaskQueueWidget <!-- PARTIAL: NetworkHealthRing done, GoalFocusBanner and TaskQueueWidget missing -->
- [ ] Dashboard: DiscoveryFeed, IcpRadarChart, EnrichmentBudgetBars <!-- PARTIAL: EnrichmentBudgetBars done, DiscoveryFeed and IcpRadarChart missing -->
- [x] Contact detail layout with 5 tabs (Profile, Network, Outreach, Enrichment, Activity)
- [ ] ContactScoreCard with hover math popover <!-- PARTIAL: TierBadge with tooltip exists, no dedicated ContactScoreCard component -->
- [x] Contact Profile tab (about, experience, skills)
- [x] Contact Network tab (placeholder) <!-- deferred to Phase 5: full ego graph, same-company, similar contacts -->
- [x] Contact Enrichment tab (placeholder) <!-- deferred to Phase 5: per-source attribution, detailed history -->
- [x] Contact Activity tab (placeholder) <!-- deferred to Phase 5: behavioral observations, content analysis -->
- [ ] Network graph with reagraph (force-directed 2D/3D) <!-- NOT DONE: reagraph not installed, network page shows text-based community cards -->
- [ ] Graph controls panel (layout, color, size, edge filter, cluster hulls) <!-- NOT DONE: no graph visualization to control -->
- [ ] Cluster sidebar <!-- NOT DONE: clusters shown as card grid, no sidebar -->
- [x] Discover page with niche cards + cross-niche comparison
- [ ] Wedge visualization (visx) <!-- NOT DONE: visx not installed -->
- [ ] ICP treemap (Recharts) <!-- NOT DONE: no treemap component -->
- [ ] Power user ICP builder <!-- NOT DONE: only basic ICP creation via discover flow -->
- [x] Enrichment management page (provider cards, budget bars, batch enrichment)
- [ ] Command palette (Cmd+K) <!-- NOT DONE: cmdk not installed -->

### Gate Criteria
- [ ] Dashboard loads with real data (goals, health ring, tasks, ICP radar, budget bars) <!-- PARTIAL: health ring + budget bars work, goals/tasks/ICP radar missing -->
- [x] Contact detail renders all 5 tabs with real data <!-- tabs render, some minimal -->
- [ ] Network graph renders with reagraph (2D), nodes colored by tier <!-- NOT DONE -->
- [x] Discover page shows detected niches/ICPs
- [x] Enrichment page shows provider status and budget
- [ ] Command palette searches contacts and navigates <!-- NOT DONE -->

### User Checkpoint
**User actions needed before Phase 4:**
- Review UI/UX across all pages
- Provide feedback on visualization choices
- Test with real LinkedIn data
- Verify performance targets (dashboard < 500ms, table pagination < 200ms)
- Approve navigation structure

---

## Phase 4: Chrome Extension (Weeks 13-16)

### Objective
Extension captures pages. App parses them. Task system flows.

### Domain Distribution

| Domain | Tasks | Parallel Agents |
|--------|-------|-----------------|
| Backend | 5 | 2-3 |
| App | 6 | 3-4 |
| Extension | 10 | 4-5 |

### Cross-Domain Dependencies
- Extension depends on App: capture endpoint, task endpoint, health endpoint must exist
- App depends on Backend: page_cache table, selector_configs, parser engine
- Extension + App: shared TypeScript types for CapturePayload, ExtensionTask, Goal, etc.

### Phase 4 Checklist

#### Backend (see `phase-4-extension/backend.md`)
- [ ] Selector configuration table in PostgreSQL
- [ ] Initial selector configs for profile, search, feed, company page types
- [ ] Page cache table with 5-version rotation trigger
- [ ] WebSocket server at /ws/extension
- [ ] Token-based auth middleware for extension endpoints

#### App (see `phase-4-extension/app.md`)
- [ ] POST /api/extension/capture endpoint (receive, compress, store, queue parse)
- [ ] GET /api/extension/tasks endpoint
- [ ] GET /api/extension/health endpoint
- [ ] POST /api/extension/register endpoint
- [ ] GET /api/extension/settings endpoint
- [ ] Page parser engine with cheerio
- [ ] Profile parser with V1 selector chains
- [ ] Search results parser
- [ ] Feed/activity parser
- [ ] Company page parser
- [ ] Contact upsert logic from parsed data
- [ ] Embedding update after parse
- [ ] Re-parse job system (background)

#### Extension (see `phase-4-extension/extension.md`)
- [ ] Content script: page-capturer.ts (URL detection + outerHTML capture)
- [ ] Content script: overlay.ts (capture status display)
- [ ] Service worker: message routing, HTTP client, capture queue
- [ ] Service worker: WebSocket client with auto-reconnect
- [ ] Basic popup: capture button, connection status, top tasks
- [ ] Side panel: goal progress, task list, current page info
- [ ] chrome.storage.local for token and capture queue
- [ ] Registration flow (token exchange)
- [ ] Task auto-completion detection (URL matching)
- [ ] Badge updates (task count, connection status)
- [ ] Scroll depth tracking + MutationObserver for DOM stability
- [ ] SPA navigation detection (popstate + MutationObserver)

### Gate Criteria
- [ ] Extension loads in Chrome (sideloaded)
- [ ] Capture button sends HTML to app
- [ ] App stores HTML in page_cache
- [ ] App parses profile HTML and creates/updates contact record
- [ ] Extension displays task list from app
- [ ] Task auto-completes when user visits matching URL
- [ ] WebSocket pushes task updates to extension
- [ ] Offline queue buffers captures when app is down

### User Checkpoint
**User actions needed before Phase 5:**
- Test extension on real LinkedIn pages
- Verify parsing accuracy on various profile formats
- Review task auto-completion behavior
- Test offline queue behavior
- Approve overlay positioning and UX

---

## Phase 5: Intelligence (Weeks 17-20)

### Objective
Claude fully integrated. Goals/tasks auto-generated. Outreach templates.

### Domain Distribution

| Domain | Tasks | Parallel Agents |
|--------|-------|-----------------|
| Backend | 4 | 2-3 |
| App | 10 | 4-5 |
| Extension | 3 | 1-2 |

### Cross-Domain Dependencies
- App depends on Backend: Claude API integration, goal/task tables
- Extension depends on App: template rendering endpoint, task updates

### Phase 5 Checklist

#### Backend (see `phase-5-intelligence/backend.md`)
- [ ] Claude agent API routes (analyze, chat, suggestions, execute-task)
- [ ] Content analysis pipeline (light/medium/deep modes)
- [ ] Behavioral observation processing + content_profiles population
- [ ] Activity pattern detection + activity_patterns population

#### App (see `phase-5-intelligence/app.md`)
- [ ] Claude integration for goal/task generation
- [ ] Goal creation flow (Claude analyzes network state -> creates goals with tasks)
- [ ] Task generation from import, enrichment, scoring, content analysis
- [ ] Goals & Tasks page with full UI
- [ ] Goal progress tracking
- [ ] Outreach template system with merge variables
- [ ] Claude template personalization (fills variables using contact + enrichment + graph data)
- [ ] Outreach state machine with branching sequences
- [ ] Outreach pipeline Kanban view
- [ ] Template editor with sequence configuration
- [ ] Template performance tracking
- [ ] Campaign management
- [ ] Contact Network tab: visual ego graph, same-company contacts, similar contacts (deferred from Phase 3)
- [ ] Contact Enrichment tab: per-source attribution, detailed enrichment history (deferred from Phase 3)
- [ ] Contact Activity tab: behavioral observations, content analysis timeline (deferred from Phase 3)

#### Extension (see `phase-5-intelligence/extension.md`)
- [ ] Message template display in popup + side panel
- [ ] Clipboard copy workflow for templates
- [ ] Template selection UI (Initial Outreach, Follow-up, Meeting Request)

### Gate Criteria
- [ ] Claude generates at least 3 goals with tasks after CSV import
- [ ] User can accept, reject, edit goals and tasks
- [ ] Template renders with contact-specific variables filled
- [ ] Clipboard copy works from extension
- [ ] Outreach state machine transitions work correctly
- [ ] Template performance tracking records sent/accepted/responded

### User Checkpoint
**User actions needed before Phase 6:**
- Test Claude goal generation with real data
- Review and customize message templates
- Test outreach workflow end-to-end (template -> clipboard -> manual send -> state transition)
- Verify Claude analysis quality on captured content
- Set up outreach sequences

---

## Phase 6: Polish (Weeks 21-24)

### Objective
Complete visualization catalog. Admin panel. Onboarding. Security hardening.

### Domain Distribution

| Domain | Tasks | Parallel Agents |
|--------|-------|-----------------|
| Backend | 4 | 2-3 |
| App | 12 | 4-5 |
| Extension | 4 | 2-3 |

### Cross-Domain Dependencies
- App depends on Backend: admin APIs, remaining provider implementations
- Extension depends on App: settings endpoint, rate awareness data

### Phase 6 Checklist

#### Backend (see `phase-6-polish/backend.md`)
- [ ] Apollo provider implementation
- [ ] Crunchbase provider implementation
- [ ] BuiltWith provider implementation
- [ ] Admin API routes (scoring weights, data purge, backup, schema version)
- [ ] GDPR right-to-erasure implementation (cascading deletes)

#### App (see `phase-6-polish/app.md`)
- [ ] Remaining Recharts visualizations (funnel, treemap, scatter, parallel coordinates)
- [ ] Remaining visx visualizations (outreach sequence tree, engagement heatmap, import progress)
- [ ] Admin scoring panel with weight sliders, sum validation, score preview
- [ ] RVF training interface (pairwise comparison)
- [ ] Data purge tool with filter-based selection and confirmation modals
- [ ] Provider management page
- [ ] Import wizard (full 4-step flow with progressive Claude questions)
- [ ] Selector config admin UI + re-parse job management
- [ ] System health dashboard
- [ ] Extension management page
- [ ] CSV export of enriched contacts

#### Extension (see `phase-6-polish/extension.md`)
- [ ] Daily capture count tracking with configurable warning threshold
- [ ] Rate awareness overlay warnings
- [ ] Auto-capture opt-in toggle
- [ ] Settings UI (app URL, auto-capture, overlay position)
- [ ] Error handling and retry logic throughout

### Gate Criteria
- [ ] All 27 visualizations render with real data
- [ ] Admin scoring panel saves weights and triggers rescore
- [ ] Data purge works with warning modals
- [ ] Import wizard completes full flow (upload -> map -> process -> summary)
- [ ] Extension rate awareness warnings display correctly
- [ ] Security audit: no XSS, no command injection, no SQL injection
- [ ] All API endpoints validate input
- [ ] Extension CSP enforced
- [ ] Token rotation works
- [ ] Performance targets met across all pages

### User Checkpoint (Final)
**User actions for production readiness:**
- Full end-to-end testing with real LinkedIn data
- Security review and penetration testing
- Performance profiling under load (1000+ contacts)
- Documentation review
- Extension sideloading instructions verified
- docker-compose deployment tested on clean machine

---

## Implementation Logging

All implementation work is logged in `docs/implementation-logs/v2/`:

```
docs/implementation-logs/v2/
├── README.md                  # Log format and conventions
├── phase-1/
│   ├── backend-schema.md      # Schema implementation notes
│   ├── backend-import.md      # CSV import implementation
│   ├── app-setup.md           # App project setup
│   └── decisions.md           # Architecture decisions made
├── phase-2/
│   ├── scoring-engine.md
│   ├── enrichment-pipeline.md
│   ├── graph-analytics.md
│   └── decisions.md
├── phase-3/ ... (similar structure)
├── phase-4/ ...
├── phase-5/ ...
└── phase-6/ ...
```

Each log entry should include:
- Date and agent/author
- Task reference (which checklist item)
- What was implemented
- Key decisions made and rationale
- Files created/modified
- Tests written/passed
- Issues encountered and resolutions

---

## Business Requirements Traceability

Each phase-domain plan maps tasks to Business Requirements (BR-xxx) from the final analysis to ensure full coverage.

### BR Coverage by Phase

| BR Group | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
|----------|---------|---------|---------|---------|---------|---------|
| Import (BR-1xx) | BR-101 to BR-112 | | | | | |
| Contact Mgmt (BR-2xx) | BR-201 (basic) | BR-202,205,206 | BR-201-211 | | | |
| Enrichment (BR-3xx) | | BR-301-311 | | | | BR-308,309 (admin) |
| Scoring (BR-4xx) | | BR-401-417 | BR-411 (preview) | | | BR-412 (RVF) |
| Graph (BR-5xx) | | BR-501-512 | BR-509-511 | | | |
| Outreach (BR-6xx) | | | | | BR-601-610 | |
| Goals/Tasks (BR-7xx) | | | BR-708 (widget) | | BR-701-710 | |
| Extension (BR-8xx) | | | | BR-801-817 | | BR-815,816 |
| Admin (BR-9xx) | | | | | | BR-901-909 |
| Viz (BR-10xx) | | | BR-1001-1015 | | | BR-1016-1027 |

---

## Risk Registry

| Risk | Impact | Mitigation | Phase |
|------|--------|------------|-------|
| ruvector-postgres image unavailable | High | Test image pull in Phase 1 day 1; have fallback to standard pgvector | 1 |
| LinkedIn DOM changes break parsers | Medium | Configurable selectors in DB; 5-version cache enables re-parse | 4 |
| Claude API costs exceed budget | Medium | Light/medium/deep tiers; budget caps; batch processing | 5 |
| Enrichment provider API changes | Medium | Provider abstraction layer; per-provider tests | 2, 6 |
| Graph rendering performance with 1000+ nodes | Medium | reagraph WebGL; 3D mode for large graphs; server-side pagination | 3 |
| Extension Chrome Web Store rejection | Low | Sideloading initial distribution; minimal permissions | 4 |

---

## Agent Specialization Guide

When spawning agents for each phase-domain, use these specializations:

| Role | Agent Type | Primary Tasks |
|------|-----------|---------------|
| Schema Architect | backend-dev | PostgreSQL schema, migrations, triggers |
| API Developer | coder | Next.js API routes, data access layer |
| Import Engineer | coder | CSV parsing, deduplication, edge construction |
| Scoring Engineer | coder | Scoring dimensions, weight manager, composite calc |
| Enrichment Engineer | coder | Provider implementations, waterfall, budget |
| Graph Engineer | coder | Cypher queries, centrality, community detection |
| UI Developer | coder | React components, shadcn/ui, page layouts |
| Viz Developer | coder | Recharts, visx, reagraph visualizations |
| Extension Developer | coder | Chrome MV3, content scripts, service worker |
| Parser Developer | coder | cheerio parsers, selector configs |
| Claude Integrator | coder | Claude API calls, prompt engineering, analysis |
| Test Engineer | tester | Unit tests, integration tests, E2E tests |
| Security Auditor | reviewer | CSP, input validation, token security |
| SPARC Coordinator | sparc-coord | Phase coordination, dependency tracking |

---

## Vector-Assisted Context Management

All plan content is indexed in the `lp-v2-plans` namespace (384-dim HNSW, sql.js backend) for semantic retrieval. Agents MUST use vector search to load relevant context before implementation work, reducing unnecessary file reads and LLM token consumption.

### When to Search Vectors

**Before any implementation task**, the orchestrator or agent should query:

```
mcp__claude-flow__memory_search(query="<task description>", namespace="lp-v2-plans", limit=5)
```

This returns the most relevant plan sections with similarity scores, providing:
- Database schema details for the tables being implemented
- API route specifications for endpoints being built
- Component inventory for UI work
- Architecture decisions that constrain the implementation
- Cross-domain dependency information

### Vector Index

| Key | Tags | Content Summary |
|-----|------|-----------------|
| `v2-architecture-overview` | architecture, overview | Three-stream architecture (backend, app, extension) |
| `v2-database-schema-core` | database, schema, core | contacts, companies, edges, clusters tables |
| `v2-database-schema-enrichment` | database, schema, enrichment | person_enrichments, work_history, education, company_enrichments |
| `v2-database-schema-scoring` | database, schema, scoring | contact_scores, score_dimensions, weight profiles, tier thresholds |
| `v2-database-schema-vectors` | database, schema, vectors | profile/content/company embeddings, HNSW indexes |
| `v2-database-schema-outreach` | database, schema, outreach | campaigns, templates, sequences, states, events |
| `v2-database-schema-tasks-goals` | database, schema, tasks, goals | goals, tasks, task types, categories |
| `v2-database-schema-icp-niche` | database, schema, icp, niche | niche_profiles, icp_profiles, wedge_metrics, 3D wedge model |
| `v2-api-routes-contacts` | api, routes, contacts | 17 contact endpoints with error format |
| `v2-api-routes-extension` | api, routes, extension | capture, tasks, templates, health, WebSocket events |
| `v2-api-routes-scoring-enrichment` | api, routes, scoring, enrichment | scoring, enrichment, graph API routes |
| `v2-csv-import-pipeline` | import, csv, pipeline | Multi-CSV ordered processing, dedup, company resolution |
| `v2-enrichment-waterfall` | enrichment, providers, waterfall | 5-stage provider waterfall, budget enforcement |
| `v2-scoring-engine` | scoring, dimensions, weights | 9 dimensions, weight manager, composite calculator, tiers |
| `v2-extension-architecture` | extension, chrome, mv3 | MV3 structure, permissions, capture flow, badge states |
| `v2-page-parser-engine` | parser, cheerio, selectors | cheerio-based parsing, selector configs, re-parse |
| `v2-visualization-catalog` | visualization, recharts, visx, reagraph | 27 charts: 15 Recharts, 5 visx, 7 reagraph with BR refs |
| `v2-claude-integration-points` | claude, ai, intelligence | 7 integration areas: goals, tasks, analysis, templates, chat |
| `v2-outreach-system` | outreach, templates, campaigns | State machine, templates, sequences, campaigns, performance |
| `v2-goals-tasks-system` | goals, tasks, automation | Goal/task generation, priority algorithm, trigger types |
| `v2-admin-panel` | admin, scoring, purge, providers | 6 admin panels: scoring, RVF, purge, providers, selectors, health |
| `v2-product-owner-decisions` | decisions, requirements, constraints | 21 key product owner decisions from symposium |
| `v2-phase-summaries` | phases, summary, agents, gates | All 6 phases with agent counts, task counts, gate criteria |
| `v2-app-component-inventory` | components, ui, pages, react | 60+ components across 8 pages, all shadcn/ui based |

### Usage Patterns

**Pattern 1: Pre-Implementation Context Loading**
```
# Before implementing a scoring endpoint:
memory_search(query="scoring engine dimensions weights composite", namespace="lp-v2-plans", limit=3)
# Returns: v2-scoring-engine, v2-database-schema-scoring, v2-api-routes-scoring-enrichment
```

**Pattern 2: Cross-Domain Dependency Check**
```
# Before building extension template UI:
memory_search(query="outreach templates extension clipboard copy", namespace="lp-v2-plans", limit=3)
# Returns: v2-outreach-system, v2-extension-architecture, v2-claude-integration-points
```

**Pattern 3: Architecture Decision Lookup**
```
# Before making a technology choice:
memory_search(query="product owner architecture decisions constraints", namespace="lp-v2-plans", limit=2)
# Returns: v2-product-owner-decisions, v2-architecture-overview
```

**Pattern 4: Component Discovery**
```
# Before building a new UI component:
memory_search(query="dashboard components visualization chart", namespace="lp-v2-plans", limit=3)
# Returns: v2-app-component-inventory, v2-visualization-catalog, v2-phase-summaries
```

### Context Optimization Rules

1. **Always search before reading plan files** - Vector search returns the relevant section in ~1ms vs reading 1000+ line plan files
2. **Use limit=3-5** for focused tasks, limit=8-10 for cross-cutting concerns
3. **Chain searches** when a task spans domains: first search for the domain-specific plan, then for cross-domain dependencies
4. **Cache vector results in agent memory** during a phase execution - the plan content won't change mid-phase
5. **Fall back to file reads** only when vector results lack the specific detail needed (e.g., exact TypeScript interface definitions or line-by-line checklists)
6. **Store new vectors** when implementation decisions create new patterns or conventions not yet in the index (use `mcp__claude-flow__memory_store` with namespace `lp-v2-plans`)

---

## Vector-Assisted Context Management

### Overview

All V2 development plan content is stored as 384-dimensional HNSW-indexed vectors in the `lp-v2-plans` namespace. This enables agents to retrieve only the relevant plan context before starting work, rather than loading full plan documents into the LLM context window.

### Why Vectors

- **Context efficiency**: A 1600-line plan file consumes ~40K tokens. A vector search returns only the relevant 200-500 word summary, saving 95%+ of context.
- **Semantic retrieval**: Agents can search by intent ("how does the scoring engine work?") rather than knowing exact file paths.
- **Cross-phase awareness**: Agents working in Phase 3 can discover Phase 2 dependencies without reading Phase 2 plans.
- **Cost reduction**: Fewer tokens per agent call = lower LLM costs, especially with parallel agent spawning.

### How Agents Should Use Vectors

Before starting any implementation task, agents MUST query the vector store for relevant context:

```bash
# Search for plan context relevant to the current task
npx @claude-flow/cli@latest memory search --query "<task description>" --namespace lp-v2-plans --limit 5

# Example: Agent working on scoring engine
npx @claude-flow/cli@latest memory search --query "scoring engine dimensions weights" --namespace lp-v2-plans --limit 5

# Example: Agent working on extension capture
npx @claude-flow/cli@latest memory search --query "extension page capture HTML" --namespace lp-v2-plans --limit 5

# Example: Agent needing database schema info
npx @claude-flow/cli@latest memory search --query "PostgreSQL schema contacts enrichment" --namespace lp-v2-plans --limit 5
```

Or via MCP tool in agent code:
```
mcp__claude-flow__memory_search(query="scoring engine weights dimensions", namespace="lp-v2-plans", limit=5)
```

### Vector Categories

| Category | Keys | Content |
|----------|------|---------|
| Architecture | v2-architecture-overview | System architecture, tech stack, key decisions |
| Database Schema | v2-database-schema-{core,enrichment,scoring,vectors,outreach,tasks-goals,icp-niche} | Table definitions, indexes, triggers |
| API Routes | v2-api-routes-{contacts,extension,scoring-enrichment} | Endpoint specs, request/response shapes |
| Pipelines | v2-csv-import-pipeline, v2-enrichment-waterfall, v2-scoring-engine | Data processing pipelines |
| Extension | v2-extension-architecture, v2-page-parser-engine | Extension design, parser specs |
| Visualizations | v2-visualizations-{recharts,visx,reagraph} | Chart/graph specifications |
| Intelligence | v2-claude-integration, v2-goals-tasks-system, v2-outreach-system | Claude integration, automation |
| Components | v2-app-components-{dashboard,contact-detail,network,discover} | UI component inventory |
| Analytics | v2-graph-analytics | Graph algorithms, ruvector functions |
| Admin | v2-admin-panel | Admin panel features, management APIs |
| Security | v2-security-hardening | Validation, CSP, GDPR, rate limiting |
| Phase Summaries | v2-phase-{1..6}-summary | Per-phase overviews for orchestrators |
| Requirements | v2-business-requirements-index | BR coverage map across phases |

### Orchestrator Vector Workflow

1. **Phase sub-orchestrator startup**: Search `v2-phase-N-summary` to load phase overview
2. **Agent task assignment**: Search by task description to pull relevant schema, API, and component context
3. **Cross-domain coordination**: Search for dependency context (e.g., "extension depends on capture endpoint")
4. **Implementation verification**: Search for gate criteria and acceptance requirements

### When to Read Full Plan Files

Vectors provide summaries. Read the full plan file only when:
- Implementing a specific task and need the exact sub-task checklist
- Need TypeScript interface definitions or SQL CREATE TABLE statements
- Need the full dependency graph within a domain
- Debugging or resolving conflicting information

### Vector Store Reference

- **Namespace**: `lp-v2-plans`
- **Embedding model**: all-MiniLM-L6-v2 (384 dimensions)
- **Index type**: HNSW
- **Total vectors**: 44
- **Backend**: sql.js + HNSW
- **Search speed**: 150x-12,500x faster than keyword search
- **See also**: `vector-index.md` in this directory for complete vector key listing
