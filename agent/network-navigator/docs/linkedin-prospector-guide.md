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

### Who It's For

- Founders and consultants looking for warm introductions to potential clients
- Business development professionals mapping referral partner networks
- Agencies identifying white-label partners and co-sellers
- Anyone who wants to understand the strategic value of their LinkedIn network

### Architecture

```
+-------------------+     +-------------------+     +-------------------+
|  Browser          |     |  Next.js App      |     |  PostgreSQL       |
|  Extension        |     |  (localhost:3000)  |     |  + ruvector       |
|                   |     |                   |     |                   |
|  Capture profiles |---->|  REST API layer   |---->|  Contacts, scores |
|  Side panel UI    |     |  Scoring engine   |     |  Embeddings (HNSW)|
|  Quick actions    |     |  Dashboard UI     |     |  Graph data       |
+-------------------+     +-------------------+     +-------------------+
                                |
                    +-----------+-----------+
                    |                       |
              +-----v-----+         +------v------+
              |  Claude    |         |  Agent      |
              |  Agent     |         |  Scripts    |
              |  Skills    |         |             |
              |            |         |  api-client |
              |  /linkedin |         |  configure  |
              |  -prospector|        |             |
              |  /network  |         +-------------+
              |  -intel    |
              +------------+

Two Claude Code slash commands wrap the system:

  /linkedin-prospector   -- Configure + Capture (ICP setup, extension guidance)
  /network-intel         -- Score + Analyze + Report (scoring, analysis, search)
```

### Key Concepts

**Contacts** -- Individual LinkedIn profiles stored in PostgreSQL. Each contact has raw profile data, enrichment data from external providers, and scoring metadata.

**Scoring Dimensions** -- Nine independent scoring dimensions run as a unified pipeline, producing a single composite score per contact. A separate referral scoring phase adds six more dimensions.

**Tiers** -- Contacts are bucketed into gold, silver, bronze, or watch based on their composite score.

**Personas** -- Each contact is assigned persona labels:
- ICP Persona: buyer, warm-lead, advisor, hub, active-influencer, or passive-contact
- Behavioral Persona: super-connector, content-creator, silent-influencer, engaged-professional, rising-connector, or passive-observer
- Referral Persona: white-label-partner, warm-introducer, co-seller, amplifier, or passive-referral

---

## 2. Getting Started

### Prerequisites

- **Docker** -- The app, database, and all services run via `docker compose`.
- **Chrome/Chromium** -- For the browser extension that captures LinkedIn profiles.
- **Claude Code** -- Required for the `/linkedin-prospector` and `/network-intel` slash commands.

### Step 1: Start the Application

```bash
cd /path/to/networknav
docker compose up -d
```

This starts the Next.js app (port 3000), PostgreSQL with ruvector (port 5432), and any supporting services.

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
4. Browse LinkedIn profiles or search results -- the extension captures visible profiles

Or import from a LinkedIn data export:
```bash
# Import via the API
POST /api/import/from-directory
{ "path": "/path/to/linkedin/export" }
```

### Step 5: Score and Analyze

Scoring runs automatically when contacts are captured. To trigger a full rescore:

```bash
POST /api/scoring/rescore-all
```

Or use the agent:
```
/network-intel rescore all my contacts
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

# 6. Review results in the dashboard at http://localhost:3000
```

---

## 3. Configuring Your ICP

See the dedicated [Configuration Guide](configuration-guide.md) for the complete reference, including the 8-step agent wizard flow, API request/response shapes, and full examples.

---

## 4. The /linkedin-prospector Agent

The `/linkedin-prospector` slash command handles configuration, capture guidance, and contact management.

### Capabilities

| Capability | What It Does |
|------------|-------------|
| **Configure ICP** | Walks you through ICP setup conversationally, then creates via API |
| **Validate Config** | Checks configuration by calling GET endpoints |
| **Import Contacts** | Triggers import from LinkedIn data exports |
| **Database Stats** | Shows contact counts, enrichment status, niche breakdown |
| **Export** | Exports contacts as CSV or JSON |
| **Rescore** | Triggers scoring pipeline via API |

### How the Agent Works

1. **Checks existing data first** -- Before suggesting actions, the agent calls the API to see current contact counts and scoring status.
2. **Guides capture via extension** -- Instructs the user on how to use the browser extension to capture profiles.
3. **Calls APIs directly** -- All data operations go through the REST API at localhost:3000.

---

## 5. The /network-intel Agent

The `/network-intel` slash command handles scoring, analysis, and reporting. It can answer questions like: "Who are my best prospects?", "Who are my best referral partners?", "What should I focus on next?", "Show me super-connectors", "Find contacts similar to [person]", "Who talks about AI transformation?"

---

## 6. Scoring Engine Deep Dive

### Phase 1: Composite Score (9 Dimensions)

The scoring engine evaluates each contact across nine weighted dimensions:

| Dimension | Key | What It Measures |
|-----------|-----|------------------|
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
|------|-------------------|---------|
| **gold** | >= 0.55 | Top prospects -- pursue immediately |
| **silver** | >= 0.40 | Good prospects -- nurture relationship |
| **bronze** | >= 0.28 | Some potential -- monitor and engage |
| **watch** | < 0.28 | Low priority -- passive awareness |

Second-degree contacts receive an 0.85x multiplier before tier assignment.

### Persona Classification

**ICP Personas** (based on dimension composition):

| Persona | Criteria |
|---------|----------|
| **buyer** | High ICP fit (>0.6) + relationship strength (>0.4) |
| **warm-lead** | Moderate ICP fit (>0.4) + some relationship (>0.3) |
| **active-influencer** | High behavioral (>0.6) + content relevance (>0.4) |
| **hub** | Strong network position (network_hub >0.6) |
| **advisor** | High relationship (>0.6) + moderate ICP (>0.2) |
| **passive-contact** | Default for 1st/2nd degree connections |

**Behavioral Personas:**

| Persona | Criteria |
|---------|----------|
| **super-connector** | Network hub >0.7 AND 500+ connections |
| **content-creator** | High content relevance + behavioral score |
| **silent-influencer** | High graph centrality but low behavioral |
| **rising-connector** | <500 connections, connected within 180 days |
| **engaged-professional** | Moderate behavioral score |
| **passive-observer** | Default |

### Phase 2: Referral Scoring (6 Dimensions)

After composite scoring, a separate referral phase evaluates each contact's ability to send you business:

| Component | What It Measures |
|-----------|-----------------|
| **referralRole** | Role-based referral potential (agency, partner, advisor = high) |
| **clientOverlap** | Whether they serve the same industries you target |
| **networkReach** | Connection count, cluster breadth, edge density |
| **amplificationPower** | Super-connector traits, content creation signals |
| **relationshipWarmth** | Mutual connections, existing relationship strength, recency |
| **buyerInversion** | Inverse ICP fit + ecosystem keywords (partner, not buyer) |

**Referral Personas:**

| Persona | What They Do |
|---------|-------------|
| **white-label-partner** | Agency/consultancy that can resell your services |
| **warm-introducer** | Strong relationship + broad network for warm intros |
| **co-seller** | Consultant/advisor serving overlapping clients |
| **amplifier** | Super-connector/content creator who amplifies your brand |
| **passive-referral** | Has some referral potential, needs deepening |

---

## 7. Pipeline Reference

Scoring runs through the application's API. The primary endpoints:

| Endpoint | Method | What It Does |
|----------|--------|-------------|
| `/api/scoring/rescore-all` | POST | Re-scores all contacts (composite + referral) |
| `/api/scoring/run` | POST | Score a single contact or batch |
| `/api/scoring/status` | GET | Check the status of a scoring run |
| `/api/scoring/weights` | GET/PUT | View or update scoring weights |
| `/api/scoring/preview` | POST | Preview score changes before applying |

### Scoring Pipeline Flow

```
Contact captured/updated
  --> Phase 1: 9 dimension scorers run in parallel
  --> Composite score computed (weighted sum)
  --> Tier assigned (gold/silver/bronze/watch)
  --> ICP + behavioral persona classified
  --> Phase 2: 6 referral scorers run
  --> Referral tier + persona assigned
  --> Profile embeddings updated (for semantic search)
```

### Auto-scoring

New contacts captured via the browser extension are automatically scored. Manual rescore is needed when:
- ICP profiles or criteria change
- Scoring weights change
- New enrichment data arrives

---

## 8. Building and Growing Your Dataset

### Capture Strategy

1. **Configure your ICPs** -- Define at least one ICP profile and a few niches.
2. **Install the browser extension** and link it to the app.
3. **Browse LinkedIn** -- Visit search results pages for your niches. The extension captures visible profiles.
4. **Import existing data** -- Use `POST /api/import/from-directory` for LinkedIn exports.
5. **Enrich contacts** -- Use `POST /api/enrichment/enrich` with external providers (Apollo, BuiltWith, Crunchbase).
6. **Capture regularly** -- Keep the extension active during normal LinkedIn use.
7. **Rescore after changes** -- Trigger `POST /api/scoring/rescore-all` when ICP criteria or contacts change.
8. **Review distributions** -- Aim for 5-15% gold, 15-25% silver, 25-35% bronze.

---

## 9. Tuning Your Scoring

### Reviewing Distributions

Use the dashboard at `http://localhost:3000` to see tier distributions, or ask the agent:

```
/network-intel give me an overview
```

Manually review the top gold contacts. Ask: "Are these actually my best prospects?" If not, adjust your scoring.

### Common Adjustments

- **Too many gold contacts:** Raise thresholds or increase `icp_fit` weight.
- **Too few gold contacts:** Broaden ICP criteria (more roles, industries, signals) or lower thresholds.
- **Wrong referral partners:** Narrow referral role scoring to agency/partner/advisor roles.
- **Hubs undervalued:** Increase `network_hub` weight via `PUT /api/scoring/weights`.

After updating weights, trigger `POST /api/scoring/rescore-all`.

---

## 10. Troubleshooting

### Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| App not responding at localhost:3000 | Docker containers not running | Run `docker compose up -d` and check `docker compose logs app` |
| Extension shows "Not connected" | App not running or wrong URL | Ensure the app is up; check extension settings point to localhost:3000 |
| No contacts appearing | Extension not capturing | Verify extension is loaded; check the side panel while browsing LinkedIn |
| Contacts not scored | Scoring pipeline not triggered | Call `POST /api/scoring/rescore-all` |
| "Failed to create ICP" | Invalid criteria format | Ensure `criteria` is an object with valid fields (roles, industries, signals) |
| Database connection error | PostgreSQL container down | Run `docker compose up -d db` and check logs |
| Scoring weights rejected | Weights don't sum to 1.0 | Ensure all weight values sum to exactly 1.0 |
| Semantic search returns no results | Embeddings not generated | Check that the ruvector-postgres container is running |

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

All v2 agent scripts are in `agent/network-navigator/skills/linkedin-prospector/scripts/`.

### api-client.mjs

**Purpose:** Shared HTTP client for calling the NetworkNav REST API.

**Exports:**
- `api(path, options)` -- Generic fetch wrapper with JSON handling
- `get(path)` -- GET request
- `post(path, body)` -- POST request with JSON body
- `put(path, body)` -- PUT request with JSON body
- `del(path)` -- DELETE request

Base URL defaults to `http://localhost:3000`. Override with `NETWORKNAV_URL` env var.

### configure.mjs

**Purpose:** ICP/niche/offering configuration management via API.

```bash
node scripts/configure.mjs validate              # Check current config via API
node scripts/configure.mjs list                   # List all configured profiles
node scripts/configure.mjs generate --json '{}'   # Create profiles from JSON
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
