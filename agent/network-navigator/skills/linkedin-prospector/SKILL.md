---
name: "LinkedIn Prospector"
description: "Search, enrich, score, and analyze LinkedIn connections for prospecting. Use for finding leads, analyzing network hubs, scoring ICP fit, identifying referral partners, generating outreach campaigns, or producing network reports."
---

# LinkedIn Prospector (v2)

An API-first Claude Code skill for LinkedIn network intelligence. The agent orchestrates the NetworkNav web application at `http://localhost:3000` via REST APIs. Import contacts from CSV or the Chrome extension, enrich profiles through a waterfall of data providers, score contacts across 9 composite dimensions plus 6 referral components, analyze your network graph, and generate personalized outreach -- all backed by PostgreSQL.

## What This Does

Six-phase workflow:

0. **Configure** -- Set up ICP profiles, niches, offerings, and scoring weights via API
1. **Import** -- CSV upload or passive browser extension capture
2. **Enrich** -- Waterfall enrichment pipeline (PDL, Apollo, Lusha, Crunchbase, BuiltWith) with budget tracking
3. **Score** -- 9 composite dimensions + 6 referral components, tier assignment, persona classification
4. **Analyze** -- Dashboard KPIs, graph metrics, community detection, hybrid search, Claude AI analysis
5. **Outreach** -- Campaign creation, template management, AI-personalized messaging, pipeline tracking

### Scoring Engine

**9 Composite Dimensions:**

1. `icp_fit` -- How well the contact matches your Ideal Customer Profiles
2. `network_hub` -- Connection count, mutual connections, bridging potential
3. `relationship_strength` -- Interaction recency, mutual engagement signals
4. `signal_boost` -- Buying signals in headline, about, and activity
5. `skills_relevance` -- Overlap between contact skills and your target skills
6. `network_proximity` -- Degree of separation, shared connections
7. `behavioral` -- Activity level, content engagement, super-connector index
8. `content_relevance` -- Topical alignment of posted and shared content
9. `graph_centrality` -- PageRank, betweenness centrality, community role

**6 Referral Components:**

1. `referral_role` -- Role tier for referral potential (connector, advisor, peer)
2. `client_overlap` -- Shared client/industry overlap with your offerings
3. `network_reach` -- How far their network extends into your target segments
4. `amplification_power` -- Content amplification and visibility potential
5. `relationship_warmth` -- Warmth of the existing relationship
6. `buyer_inversion` -- Likelihood they refer buyers rather than being buyers themselves

### Tier System

| Tier | Threshold | Meaning |
|------|-----------|---------|
| Gold | >= 0.55 | High-priority: strong ICP fit, active network, warm relationship |
| Silver | >= 0.40 | Medium-priority: partial fit or developing relationship |
| Bronze | >= 0.28 | Low-priority: some relevance, worth monitoring |
| None | < 0.28 | Not currently a match |

### Persona Taxonomy

**7 Composite Personas:** buyer, warm-lead, advisor, hub, active-influencer, passive-contact, unknown

**7 Behavioral Personas:** super-connector, content-creator, silent-lurker, rising-star, dormant, engaged-commenter, industry-voice

**5 Referral Personas:** strategic-referrer, warm-introducer, white-label-partner, ecosystem-connector, passive-advocate

## Prerequisites

- **NetworkNav app running** -- `docker compose up -d` from the project root (PostgreSQL + Next.js on port 3000)
- **Chrome extension installed** -- Load `browser/dist/` as an unpacked extension in Chrome for passive LinkedIn capture
- **ANTHROPIC_API_KEY** -- Set in the app's `.env` for Claude AI analysis and personalization features

No Playwright. No `.browser-data/`. No local JSON files. The PostgreSQL database is the single source of truth.

## Quick Start

```bash
# 1. Start the app
docker compose up -d

# 2. Verify the app is running
curl -s http://localhost:3000/api/health | jq .

# 3. Configure your first ICP profile
curl -s -X POST http://localhost:3000/api/icps \
  -H "Content-Type: application/json" \
  -d '{"name":"AI Consulting","criteria":{"roles":{"high":["CTO","VP Engineering"],"medium":["Director Engineering","Head of AI"],"low":["Engineering Manager"]},"industries":["saas","technology"],"signals":["AI","machine learning","automation"]}}' | jq .

# 4. Create a niche
curl -s -X POST http://localhost:3000/api/niches \
  -H "Content-Type: application/json" \
  -d '{"name":"AI/ML Leaders","keywords":["artificial intelligence","machine learning","deep learning","LLM"]}' | jq .

# 5. Import contacts from CSV
curl -s -X POST http://localhost:3000/api/import/upload \
  -F "file=@contacts.csv" | jq .

# 6. Enrich a contact
curl -s -X POST http://localhost:3000/api/enrichment/enrich \
  -H "Content-Type: application/json" \
  -d '{"contactId":"<uuid>"}' | jq .

# 7. Score all contacts
curl -s -X POST http://localhost:3000/api/scoring/rescore-all | jq .

# 8. View dashboard
curl -s http://localhost:3000/api/dashboard | jq .

# 9. Get AI analysis of a contact
curl -s -X POST http://localhost:3000/api/claude/analyze \
  -H "Content-Type: application/json" \
  -d '{"contactId":"<uuid>"}' | jq .
```

## Available Commands

- `/linkedin-prospector` -- Configure, import, and enrich: ICP setup wizard, CSV import, extension guidance, enrichment orchestration
- `/network-intel` -- Score, analyze, and act: network graph queries, scoring, outreach campaigns, AI analysis, recommendations

## Script Reference

| Script | Purpose | Status |
|--------|---------|--------|
| `configure.mjs` | Conversational ICP wizard (generates JSON for API calls) | Active |
| All other `.mjs` scripts | Replaced by v2 API endpoints | Deprecated |

The `configure.mjs generate` mode is the only surviving script. It assembles ICP configuration JSON from conversational inputs, which the agent then sends to the v2 API via `POST /api/icps`, `POST /api/niches`, and `POST /api/offerings`.

## Enrichment Providers

The v2 enrichment pipeline uses a waterfall strategy across multiple providers:

| Provider | Data | Cost |
|----------|------|------|
| PDL (People Data Labs) | Email, phone, social profiles, employment history | Per-lookup |
| Apollo | Email, company info, technographics | Per-lookup |
| Lusha | Direct phone, email verification | Per-lookup |
| Crunchbase | Company funding, investors, news | Per-lookup |
| BuiltWith | Technology stack, website analytics | Per-lookup |

Budget tracking is built in. Check spend with `GET /api/enrichment/budget`. Estimate cost before enriching with `GET /api/enrichment/estimate?contactId=...`.

## Architecture

```
User <-> Claude Agent (this skill)
              |
              | curl / HTTP
              v
         NetworkNav App (localhost:3000)
              |
              +-- PostgreSQL (ruvector-postgres)
              |       - contacts, scores, edges, clusters
              |       - icp_profiles, niches, offerings
              |       - outreach_campaigns, outreach_entries
              |       - enrichment_transactions, budget_periods
              |       - vector embeddings (ruvector)
              |
              +-- Chrome Extension (passive capture)
              |       - Captures profiles as user browses LinkedIn
              |       - Sends to POST /api/extension/capture
              |
              +-- Claude AI (ANTHROPIC_API_KEY)
                      - Contact analysis
                      - Message personalization
                      - Next-best-action suggestions
```

## Troubleshooting

**"Connection refused on port 3000"** -- Run `docker compose up -d` from the project root.

**"No contacts found"** -- Import contacts via CSV (`POST /api/import/upload`) or use the Chrome extension to capture profiles while browsing LinkedIn.

**"Extension not connected"** -- Check `GET /api/extension/health`. Load `browser/dist/` as an unpacked extension in Chrome.

**"Enrichment failed"** -- Check provider API keys in `.env`. Check budget with `GET /api/enrichment/budget`.

**"Scoring returned empty"** -- Ensure contacts exist and have been enriched. Run `POST /api/scoring/rescore-all`.

**"ANTHROPIC_API_KEY not set"** -- Required for `/api/claude/analyze` and `/api/claude/personalize`. Set it in the app's `.env` file.
