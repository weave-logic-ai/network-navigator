# V2 Plan Vector Index

**Namespace**: `lp-v2-plans`
**Backend**: sql.js + HNSW
**Embedding**: all-MiniLM-L6-v2 (384 dimensions)
**Total Vectors**: 41

## Quick Reference

Search vectors before any implementation task:
```
mcp__claude-flow__memory_search(query="<your task>", namespace="lp-v2-plans", limit=5)
```

---

## Architecture & Decisions

| Key | Tags | Description |
|-----|------|-------------|
| `v2-architecture-overview` | architecture, tech-stack | Three-stream architecture (Backend/App/Extension), tech choices, key patterns |
| `v2-product-owner-decisions` | decisions, requirements, constraints | 21 key product owner decisions from symposium Q&A (single-user, local-first, no Redis, etc.) |
| `v2-business-requirements-index` | business-requirements, traceability | BR-101 through BR-1027 mapped to phases |

## Database Schema (7 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-database-schema-core` | schema, contacts, companies, edges | contacts, companies, edges (9 types), clusters tables |
| `v2-database-schema-enrichment` | schema, enrichment, provenance | person_enrichments, work_history, education, company_enrichments, enriched_contacts view |
| `v2-database-schema-scoring` | schema, scoring, dimensions, weights | contact_scores, score_dimensions, weight_profiles, tier_thresholds, default weights |
| `v2-database-schema-vectors` | schema, embeddings, HNSW | profile/content/company embeddings with HNSW indexes, ruvector functions |
| `v2-database-schema-outreach` | schema, outreach, campaigns | campaigns, templates, sequences, outreach_states, outreach_events, performance |
| `v2-database-schema-tasks-goals` | schema, tasks, goals | goals, tasks, task_types, categories |
| `v2-database-schema-icp-niche` | schema, icp, niche, wedge | niche_profiles, icp_profiles, contact_icp_fits, wedge_metrics, 3D wedge model |

## API Routes (3 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-api-routes-contacts` | api, contacts, CRUD | 17 contact endpoints with error format |
| `v2-api-routes-extension` | api, extension, capture, WebSocket | Capture, tasks, templates, health, register, settings, WebSocket events |
| `v2-api-routes-scoring-enrichment` | api, scoring, enrichment, graph | Scoring, enrichment, graph, ICP API routes |

## Data Pipelines (3 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-csv-import-pipeline` | import, CSV, dedup | Multi-CSV ordered processing, 2-line preamble, company resolution, edge construction |
| `v2-enrichment-waterfall` | enrichment, providers, budget | 5-stage waterfall (PDL->Apollo->Lusha->Crunchbase->BuiltWith), field-aware selection, budget |
| `v2-scoring-engine` | scoring, dimensions, weights, tiers | 9 dimensions with weights, composite calculator, tier thresholds, null-safe redistribution |

## Extension & Parsing (2 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-extension-architecture` | extension, MV3, capture | MV3 structure, permissions, capture flow, badge states, auth, "dumb capture + smart app" |
| `v2-page-parser-engine` | parser, cheerio, selectors | cheerio-based parsing, selector configs from DB, re-parse capability, confidence scoring |

## Visualization Catalog (4 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-visualization-catalog` | visualization, all, summary | Complete 27-chart catalog across Recharts/visx/reagraph |
| `v2-visualizations-recharts` | recharts, charts | 15 Recharts charts (histogram, bar, area, radar, funnel, pie, etc.) |
| `v2-visualizations-visx` | visx, charts | 5 visx visualizations (wedge 3D, sequence tree, parallel coords, heatmap, import progress) |
| `v2-visualizations-reagraph` | reagraph, graph, WebGL | 7 reagraph graphs (network 2D/3D, cluster hulls, ego network, warm intro path, etc.) |

## Intelligence & Automation (3 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-claude-integration` | claude, AI, analysis | 7 Claude integration areas (goals, tasks, analysis, templates, behavioral, patterns, chat) |
| `v2-claude-integration-points` | claude, AI, intelligence | Detailed integration: API routes, depth modes, budget tracking, model config |
| `v2-goals-tasks-system` | goals, tasks, automation | Goal generation triggers, task priority algorithm, auto-completion, UI components |

## Feature Systems (3 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-outreach-system` | outreach, templates, campaigns | State machine, templates with merge variables, sequences, campaigns, performance tracking |
| `v2-admin-panel` | admin, scoring, management | Scoring panel, RVF training, data purge, provider mgmt, selector config, health, APIs |
| `v2-security-hardening` | security, validation, GDPR | Zod validation, parameterized queries, DOMPurify, token rotation, rate limiting, CSP |

## Graph Analytics (1 vector)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-graph-analytics` | graph, PageRank, clustering, Cypher | PageRank, betweenness centrality, community detection, shortest path, HDBSCAN, ruvector functions |

## App Components (5 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-app-component-inventory` | components, ui, all | Full 60+ component inventory across 8 pages |
| `v2-app-components-dashboard` | dashboard, widgets | GoalFocusBanner, NetworkHealthRing, TaskQueueWidget, DiscoveryFeed, IcpRadarChart, BudgetBars |
| `v2-app-components-contact-detail` | contact, detail, tabs | ContactScoreCard, 5 tabs (Profile, Network, Outreach, Enrichment, Activity) |
| `v2-app-components-network` | network, graph, reagraph | NetworkGraph, GraphControls, ClusterSidebar, PathFinder, EgoNetwork |
| `v2-app-components-discover` | discover, icp, niche, wedge | NicheSwitcher, NicheCard, WedgeVisualization, IcpTreemap, IcpBuilder |

## Phase Summaries (7 vectors)

| Key | Tags | Description |
|-----|------|-------------|
| `v2-phase-summaries` | phases, summary, timeline | All 6 phases with agent counts, task counts, and gate criteria |
| `v2-phase-1-summary` | phase-1, foundation | Backend schema+docker+CSV, App Next.js setup, Extension scaffold |
| `v2-phase-2-summary` | phase-2, core-engine | Scoring 9-dim, enrichment waterfall, graph analytics |
| `v2-phase-3-summary` | phase-3, app-ui | Dashboard, contact detail, network graph, discover, enrichment mgmt |
| `v2-phase-4-summary` | phase-4, extension | Selectors, parser engine, content scripts, service worker, popup/panel |
| `v2-phase-5-summary` | phase-5, intelligence | Claude integration, goals/tasks, outreach templates |
| `v2-phase-6-summary` | phase-6, polish | Remaining providers, admin panel, security hardening, extension polish |

---

## Search Examples

```bash
# Find schema for contacts table
npx @claude-flow/cli@latest memory search --query "contacts table schema columns" --namespace lp-v2-plans --limit 3

# Find scoring engine implementation details
npx @claude-flow/cli@latest memory search --query "scoring engine dimensions weights calculation" --namespace lp-v2-plans --limit 3

# Find extension capture flow
npx @claude-flow/cli@latest memory search --query "Chrome extension capture HTML page" --namespace lp-v2-plans --limit 3

# Find what Phase 3 covers
npx @claude-flow/cli@latest memory search --query "Phase 3 app UI dashboard components" --namespace lp-v2-plans --limit 3

# Find outreach template system
npx @claude-flow/cli@latest memory search --query "outreach message templates merge variables" --namespace lp-v2-plans --limit 3

# Find admin panel features
npx @claude-flow/cli@latest memory search --query "admin scoring weights configuration" --namespace lp-v2-plans --limit 3

# Find Claude integration details
npx @claude-flow/cli@latest memory search --query "Claude API content analysis depth modes" --namespace lp-v2-plans --limit 3

# Find security requirements
npx @claude-flow/cli@latest memory search --query "security validation GDPR rate limiting" --namespace lp-v2-plans --limit 3
```

## Plan Files (for full detail when vectors aren't enough)

```
.claude/linkedin-prospector/docs/plans/v2/
├── orchestration.md                          # Master plan with gates and vector instructions
├── vector-index.md                           # This file
├── phase-1-foundation/
│   ├── backend.md    (1633 lines)
│   ├── app.md        (812 lines)
│   └── extension.md  (904 lines)
├── phase-2-core-engine/
│   ├── backend.md    (1328 lines)
│   ├── app.md        (585 lines)
│   └── extension.md  (49 lines - placeholder)
├── phase-3-app-ui/
│   ├── backend.md    (736 lines)
│   ├── app.md        (1887 lines)
│   └── extension.md  (44 lines - placeholder)
├── phase-4-extension/
│   ├── backend.md    (802 lines)
│   ├── app.md        (1520 lines)
│   └── extension.md  (2663 lines)
├── phase-5-intelligence/
│   ├── backend.md    (511 lines)
│   ├── app.md        (1318 lines)
│   └── extension.md  (611 lines)
└── phase-6-polish/
    ├── backend.md    (1142 lines)
    ├── app.md        (1171 lines)
    └── extension.md  (790 lines)
```

**Total plan content**: ~15,804 lines across 18 domain plans + orchestration
