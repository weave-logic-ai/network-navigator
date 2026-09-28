# LinkedIn Prospector -- Comprehensive Reference Guide

A network intelligence tool for LinkedIn. It turns your LinkedIn connections into a scored, tiered, persona-classified contact database with referral partner identification.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [Configuring Your ICP](#3-configuring-your-icp)
4. [The /linkedin-prospector Agent](#4-the-linkedin-prospector-agent)
5. [The /network-intel Agent](#5-the-network-intel-agent)
6. [Scoring Engine Deep Dive](#6-scoring-engine-deep-dive)
7. [Pipeline Reference](#7-pipeline-reference)
8. [Building and Growing Your Dataset](#8-building-and-growing-your-dataset)
9. [Tuning Your Scoring](#9-tuning-your-scoring)
10. [Troubleshooting](#10-troubleshooting)
11. [Script Reference](#11-script-reference)

---

## 1. Overview

### What It Does

LinkedIn Prospector is a network intelligence tool built on a Next.js application with PostgreSQL. It captures LinkedIn profiles via a browser extension, scores them against configurable Ideal Customer Profiles (ICPs), analyzes behavioral patterns and graph centrality, identifies referral partners, and produces actionable intelligence through a web dashboard with semantic vector search.

The Claude Agent is a thin CLI layer over this system -- it is an **API client**, not a standalone tool. All operations go through the NetworkNav REST API at `localhost:3750`. There is no Playwright, no local JSON data store, and no browser automation in the agent itself; LinkedIn capture happens through the browser extension as you browse.

### Who It's For

- Founders and consultants looking for warm introductions to potential clients
- Business development professionals mapping referral partner networks
- Agencies identifying white-label partners and co-sellers
- Anyone who wants to understand the strategic value of their LinkedIn network

### Architecture

```
+-------------------+     +-------------------+     +-------------------+
|  Browser          |     |  Next.js App      |     |  PostgreSQL       |
|  Extension        |     |  (localhost:3750) |     |  + ruvector       |
|                   |     |                   |     |                   |
|  Capture profiles |---->|  REST API layer   |---->|  Contacts, scores |
|  Side panel UI    |     |  Scoring engine   |     |  Embeddings (HNSW)|
|  Auto-paginate    |     |  Dashboard UI     |     |  Graph data       |
|  search results   |     |  Outreach mgmt    |     |                   |
+-------------------+     +-------------------+     +-------------------+
                                |
                          REST API (HTTP)
                                |
                    +-----------+-----------+
                    |    Claude Agent       |
                    |    (agent/)           |
                    |                       |
                    |    api-client.mjs     |
                    |    configure.mjs      |
                    |    pipeline.mjs       |
                    |    analyze.mjs        |
                    +-----------------------+
```

Two Claude Code slash commands wrap the system:

```
/linkedin-prospector   -- Configure + manage (ICP setup, config validation)
/network-intel         -- Score + Analyze + Report (scoring, analysis, search)
```

### Key Concepts

**Contacts** -- Individual LinkedIn profiles stored in PostgreSQL. Each contact has raw profile data, enrichment data from external providers, and scoring metadata.

**Scoring Dimensions** -- Nine independent scoring dimensions run as a unified pipeline in the app, producing a single composite score per contact. A separate referral scoring phase adds further referral-specific dimensions.

**Tiers** -- Contacts are bucketed into gold, silver, bronze, or watch based on their composite score.

**Personas** -- Each scored contact carries persona classifications (e.g. buyer, hub, advisor) and, where applicable, a referral persona (e.g. white-label-partner, warm-introducer, co-seller, amplifier), computed server-side by the app's scoring engine.

---

## 2. Getting Started

### Prerequisites

- **Docker** -- The app, database, and all services run via `docker compose`.
- **Chrome/Chromium** -- For the browser extension that captures LinkedIn profiles.
- **Node.js 18+** -- To run the agent scripts (they use only the built-in `fetch`, no dependencies to install).
- **Claude Code** -- Required for the `/linkedin-prospector` and `/network-intel` slash commands.

### Step 1: Start the Application

```bash
cd /path/to/network-navigator
docker compose up -d
```

This starts the Next.js app on host port `3750`, PostgreSQL with the ruvector extension, and any supporting services.

### Step 2: Install the Browser Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked" and select the `browser/dist` directory
4. The NetworkNav icon appears in your toolbar

### Step 3: Configure Your ICP Profiles

Use the agent or the CLI:

```
/linkedin-prospector set up my ICP config
```

Or run the configuration script directly:

```bash
node agent/network-navigator/skills/linkedin-prospector/scripts/configure.mjs generate --json '{...}'
```

See [Section 3: Configuring Your ICP](#3-configuring-your-icp) and the [Configuration Guide](configuration-guide.md) for detailed guidance.

### Step 4: Capture Your First Contacts

Use the browser extension:
1. Navigate to LinkedIn
2. Click the NetworkNav extension icon
3. Open the side panel for bulk capture
4. Browse LinkedIn profiles or search results -- the extension captures visible profiles as you go, and can auto-paginate through search result pages if enabled in the popup settings

Or import from a LinkedIn data export:
```bash
# Import via the API
POST /api/import/from-directory
{ "path": "/path/to/linkedin/export" }
```

### Step 5: Score and Analyze

New contacts captured via the extension are scored automatically. To trigger a full rescore of everyone (after changing ICP criteria or weights):

```bash
POST /api/scoring/rescore-all
```

Or use the agent:
```
/network-intel rescore all my contacts
```

Or the script directly:

```bash
node agent/network-navigator/skills/linkedin-prospector/scripts/pipeline.mjs --rescore-all
```

### Complete Walkthrough: Zero to Scored Network

```bash
# 1. Start services
docker compose up -d

# 2. Install browser extension (manual step in Chrome)

# 3. Configure ICP (via agent or CLI)
node agent/network-navigator/skills/linkedin-prospector/scripts/configure.mjs generate --json '{
  "profiles": {
    "my-service": {
      "name": "My Service",
      "criteria": { "roles": ["CEO","CTO"], "industries": ["saas"], "signals": ["ai"] }
    }
  },
  "niches": {
    "ai": { "name": "AI Leaders", "keywords": ["AI", "machine learning"] }
  },
  "offerings": [{ "name": "My Service" }]
}'

# 4. Validate config
node agent/network-navigator/skills/linkedin-prospector/scripts/configure.mjs validate

# 5. Capture contacts via browser extension (browse LinkedIn)

# 6. Rescore everything
node agent/network-navigator/skills/linkedin-prospector/scripts/pipeline.mjs --rescore-all

# 7. Review results in the dashboard at http://localhost:3750
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NETWORKNAV_URL` | `http://localhost:3750` | Base URL the agent scripts use for the app's REST API |

---

## 3. Configuring Your ICP

See the dedicated [Configuration Guide](configuration-guide.md) for the complete reference, including the agent's conversational configuration flow, API request/response shapes, and full examples.

---

## 4. The /linkedin-prospector Agent

The `/linkedin-prospector` slash command handles configuration and contact management via the API.

### Capabilities

| Capability | What It Does |
|------------|---------------|
| **Configure ICP** | Walks you through ICP setup conversationally, then creates ICPs/niches/offerings via `POST /api/icps`, `/api/niches`, `/api/offerings` |
| **Validate Config** | Checks configuration by calling the `GET` equivalents of those endpoints |
| **List Profiles** | Displays all configured ICPs, niches, and offerings |

### How the Agent Works

1. **Calls the API directly** -- All data operations go through the REST API at `localhost:3750`; there is no local state to inspect.
2. **Guides capture via the extension** -- Since the agent cannot browse LinkedIn itself, it instructs the user on using the browser extension to capture profiles.

---

## 5. The /network-intel Agent

The `/network-intel` slash command handles scoring, analysis, and reporting by calling the app's REST API. It can answer questions like: "Who are my best prospects?", "Who are my best referral partners?", "What should I focus on next?", "Show contacts at Acme Corp", "Search for AI startup".

---

## 6. Scoring Engine Deep Dive

Scoring runs entirely server-side in the app -- there is no agent-local scoring code in v2.

### Phase 1: Composite Score (9 Dimensions)

The scoring engine evaluates each contact across nine weighted dimensions:

| Dimension | Key | What It Measures |
|-----------|-----|-------------------|
| **ICP Fit** | `icp_fit` | Role match, industry match, signal match, company size fit |
| **Network Hub** | `network_hub` | Connection count, cluster breadth, connector role |
| **Relationship Strength** | `relationship_strength` | Mutual connections, recency, proximity |
| **Signal Boost** | `signal_boost` | High-intent keywords in headline/about |
| **Skills Relevance** | `skills_relevance` | Skills overlap with ICP signals |
| **Network Proximity** | `network_proximity` | Graph distance and shared paths |
| **Behavioral** | `behavioral` | Activity level, engagement, connection power |
| **Content Relevance** | `content_relevance` | Content topics, posting frequency |
| **Graph Centrality** | `graph_centrality` | PageRank, betweenness, degree centrality |

Each dimension produces a raw score (0-1). The composite score is the weighted sum of all dimensions. Weights are configurable via `PUT /api/scoring/weights`.

### Tier Assignment

| Tier | Default Threshold | Meaning |
|------|--------------------|---------|
| **gold** | >= 0.55 | Top prospects -- pursue immediately |
| **silver** | >= 0.40 | Good prospects -- nurture relationship |
| **bronze** | >= 0.28 | Some potential -- monitor and engage |
| **watch** | < 0.28 | Low priority -- passive awareness |

### Phase 2: Referral Scoring

After composite scoring, a separate referral phase evaluates each contact's ability to send you business, producing a referral likelihood, referral tier, and referral persona (e.g. white-label-partner, warm-introducer, co-seller, amplifier).

---

## 7. Pipeline Reference

Scoring runs through the application's API. The primary endpoints:

| Endpoint | Method | What It Does |
|----------|--------|----------------|
| `/api/scoring/rescore-all` | POST | Re-scores all contacts (composite + referral). Returns a `runId` for polling. |
| `/api/scoring/run` | POST | Score a single contact or batch |
| `/api/scoring/status` | GET | Check the status of a scoring run (optionally by `runId`) |
| `/api/scoring/weights` | GET/PUT | View or update scoring weights |
| `/api/scoring/preview` | POST | Preview score changes before applying |

### Scoring Pipeline Flow

```
Contact captured/updated (via extension or import)
  --> Phase 1: 9 dimension scorers run
  --> Composite score computed (weighted sum)
  --> Tier assigned (gold/silver/bronze/watch)
  --> Persona classified
  --> Phase 2: referral scorers run
  --> Referral tier + persona assigned
```

### Auto-scoring

New contacts captured via the browser extension are automatically scored. A manual rescore (`pipeline.mjs --rescore-all` or `POST /api/scoring/rescore-all`) is needed when:
- ICP profiles or criteria change
- Scoring weights change
- New enrichment data arrives in bulk

---

## 8. Building and Growing Your Dataset

### Capture Strategy

1. **Configure your ICPs** -- Define at least one ICP profile and a few niches.
2. **Install the browser extension** and confirm it can reach the app (`node scripts/pipeline.mjs --health`).
3. **Browse LinkedIn** -- Visit search results pages for your niches. The extension captures visible profiles as you browse, and can auto-paginate through search results if that popup setting is enabled.
4. **Import existing data** -- Use `POST /api/import/from-directory` for LinkedIn CSV exports.
5. **Enrich contacts** -- Use `POST /api/enrichment/enrich` (or `node scripts/pipeline.mjs --enrich [contactId]`) to pull in data from configured external providers.
6. **Capture regularly** -- Keep the extension active during normal LinkedIn use.
7. **Rescore after changes** -- Trigger `pipeline.mjs --rescore-all` when ICP criteria or contacts change.
8. **Review distributions** -- Aim for 5-15% gold, 15-25% silver, 25-35% bronze.

---

## 9. Tuning Your Scoring

### Reviewing Distributions

Use the dashboard at `http://localhost:3750` to see tier distributions, or ask the agent:

```
/network-intel give me an overview
```

Manually review the top gold contacts. Ask: "Are these actually my best prospects?" If not, adjust your scoring.

### Common Adjustments

- **Too many gold contacts:** Raise thresholds or increase `icp_fit` weight.
- **Too few gold contacts:** Broaden ICP criteria (more roles, industries, signals) or lower thresholds.
- **Wrong referral partners:** Narrow referral role scoring to agency/partner/advisor roles.
- **Hubs undervalued:** Increase `network_hub` weight via `PUT /api/scoring/weights`.

After updating weights, trigger `node scripts/pipeline.mjs --rescore-all`.

---

## 10. Troubleshooting

### Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| App not responding at localhost:3750 | Docker containers not running | Run `docker compose up -d` and check `docker compose logs app` |
| Extension shows "Not connected" | App not running or wrong URL | Ensure the app is up; check extension settings point to localhost:3750 |
| No contacts appearing | Extension not capturing | Verify extension is loaded; check the side panel while browsing LinkedIn |
| Contacts not scored | Scoring pipeline not triggered | Run `node scripts/pipeline.mjs --rescore-all` |
| "Failed to create ICP" | Invalid criteria format | Ensure `criteria` is an object with valid fields (roles, industries, signals) |
| Database connection error | PostgreSQL container down | Run `docker compose up -d db` and check logs |
| Scoring weights rejected | Weights don't sum to 1.0 | Ensure all weight values sum to exactly 1.0 |
| Semantic/hybrid search returns no results | ruvector extension or embeddings unavailable | Check that the ruvector-postgres container is running; the search falls back to keyword-only when vector search is unavailable |

### Extension Issues

- Ensure you are on a LinkedIn page (linkedin.com domain)
- Check that the extension has permissions for linkedin.com
- Open DevTools on the extension background page to check for errors
- For side panel issues, click the extension icon then "Open Side Panel"

### Docker Issues

```bash
# Check logs
docker compose logs --tail 50 app
docker compose logs --tail 50 db

# Reset database
docker compose down -v && docker compose up -d

# Rebuild app
docker compose build app && docker compose up -d
```

---

## 11. Script Reference

All v2 agent scripts are in `agent/network-navigator/skills/linkedin-prospector/scripts/`. There are exactly four of them.

### api-client.mjs

**Purpose:** Shared HTTP client for calling the NetworkNav REST API. Not a CLI entry point -- it's imported by the other three scripts.

**Exports:**
- `api(path, options)` -- Generic fetch wrapper with JSON handling; throws on non-2xx responses
- `get(path)` -- GET request
- `post(path, body)` -- POST request with JSON body
- `put(path, body)` -- PUT request with JSON body
- `del(path)` -- DELETE request

Base URL defaults to `http://localhost:3750`. Override with the `NETWORKNAV_URL` env var.

### configure.mjs

**Purpose:** ICP/niche/offering configuration management via API.

```bash
node scripts/configure.mjs validate              # Check current config via API
node scripts/configure.mjs list                   # List all configured profiles
node scripts/configure.mjs generate --json '{}'   # Create profiles from JSON
```

### pipeline.mjs

**Purpose:** Pipeline orchestrator for scoring, enrichment, and graph operations.

```bash
node scripts/pipeline.mjs --status        # GET /api/dashboard
node scripts/pipeline.mjs --score [id]    # POST /api/scoring/run
node scripts/pipeline.mjs --rescore-all   # POST /api/scoring/rescore-all, polls /api/scoring/status until done
node scripts/pipeline.mjs --enrich [id]   # POST /api/enrichment/enrich
node scripts/pipeline.mjs --compute-graph # POST /api/graph/compute
node scripts/pipeline.mjs --export        # GET /api/admin/export
node scripts/pipeline.mjs --health        # Checks /api/health and /api/extension/health-internal
```

### analyze.mjs

**Purpose:** Network analysis with eight modes, all read-only against the app's API.

```bash
node scripts/analyze.mjs --mode summary
node scripts/analyze.mjs --mode hubs --top 10
node scripts/analyze.mjs --mode prospects --top 10
node scripts/analyze.mjs --mode referrals --top 10
node scripts/analyze.mjs --mode clusters
node scripts/analyze.mjs --mode search --query "cloud infrastructure"
node scripts/analyze.mjs --mode recommend
node scripts/analyze.mjs --mode company --name "Acme"
```

### Key API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/icps` | GET/POST | ICP profiles |
| `/api/niches` | GET/POST | Niches |
| `/api/offerings` | GET/POST | Offerings |
| `/api/scoring/weights` | GET/PUT | Scoring weights |
| `/api/scoring/rescore-all` | POST | Full rescore |
| `/api/scoring/run` | POST | Score contacts |
| `/api/scoring/status` | GET | Scoring run status |
| `/api/enrichment/enrich` | POST | Enrich via provider |
| `/api/extension/capture` | POST | Extension capture |
| `/api/import/from-directory` | POST | LinkedIn import |
| `/api/dashboard` | GET | Dashboard stats |
| `/api/graph/compute` | POST | Recompute graph metrics and communities |
| `/api/graph/data` | GET | Graph nodes/edges |
| `/api/graph/communities` | GET | Cluster/community list |
| `/api/contacts/hybrid-search` | GET | Combined keyword + vector search |
| `/api/actions/next` | GET | Highest-value next action |
| `/api/admin/export` | GET | CSV export of contacts with scores |
