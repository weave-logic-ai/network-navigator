---
name: "LinkedIn Prospector"
description: "Search, enrich, score, and analyze LinkedIn connections for prospecting. Use for finding leads, analyzing network hubs, scoring ICP fit, identifying referral partners, or generating network reports."
---

# LinkedIn Prospector

A portable Claude Code plugin for LinkedIn network intelligence. Search your 1st-degree connections, enrich profiles, build a knowledge graph, score contacts across three layers (ICP fit, behavioral, referral), and generate actionable intelligence -- all locally cached.

## What This Does

Five-phase workflow:

0. **Configure** — Set up ICP profiles, scoring weights, niche definitions, referral config
1. **Pull** — Search LinkedIn connections by niche/keywords, enrich profiles, cache raw HTML locally
2. **Score** — Build knowledge graph, ICP scoring, behavioral analysis, referral scoring
3. **Analyze** — 10 analysis modes: hubs, prospects, referrals, clusters, visibility, etc.
4. **Report** — Interactive HTML dashboard with 3D graph, charts, tables, delta snapshots

### Scoring Engine (3-Layer)

- **Layer 1: ICP + Gold Score** — icpFit, networkHub, relationship, signalBoost -> Gold Score, Tier, Persona
- **Layer 2: Behavioral** — connectionPower, recency, aboutSignals, headlineSignals, superConnectorIndex, networkAmplifier -> Gold Score v2, Behavioral Persona
- **Layer 3: Referral** — referralRole, clientOverlap, networkReach, amplificationPower, relationshipWarmth, buyerInversion -> Referral Tier, Referral Persona

## Network Expansion (2nd/3rd Degree)

Deep-scan discovers contacts beyond your 1st-degree network by scanning a contact's connections list. Bridge contacts appearing in multiple scans indicate high-value connectors and hidden network clusters.

## Prerequisites

- **Node.js 18+**
- **Playwright** — `npm i playwright` (Chromium browser automation)
- **LinkedIn session** — Log into LinkedIn once in the Playwright browser to establish cookies

## Quick Start

```bash
# 1. Install Playwright
npm i playwright && npx playwright install chromium

# 2. Launch browser and log into LinkedIn (one-time setup)
node -e "import('playwright').then(p => p.chromium.launchPersistentContext('.browser-data', {headless:false, channel:'chromium'}).then(c => console.log('Log into LinkedIn, then close the browser')))"

# 3. Configure your ICP profiles (interactive wizard)
node scripts/configure.mjs wizard

# 4. Validate config
node scripts/configure.mjs validate

# 5. Search for contacts
node scripts/search.mjs --niche technology --max-results 20

# 6. Build the graph, score all layers, snapshot
node scripts/pipeline.mjs --rebuild

# 7. Generate HTML report
node scripts/pipeline.mjs --report
```

## Available Commands

- `/linkedin-prospector` — Configure + Pull phase: search, enrich, cache contacts
- `/network-intel` — Score + Analyze + Report: hubs, prospects, referrals, recommendations, reports

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `configure.mjs` | ICP config wizard, template generator, and validator |
| `search.mjs` | Search LinkedIn 1st-degree connections by niche/keywords (caches HTML) |
| `enrich.mjs` | Visit profiles to extract detailed info (caches HTML) |
| `deep-scan.mjs` | Scan a contact's connections for 2nd-degree discovery (caches HTML) |
| `batch-deep-scan.mjs` | Batch deep-scan multiple contacts by criteria |
| `reparse.mjs` | Re-extract data from cached HTML pages |
| `cache.mjs` | HTML cache utility module (used by search/enrich/deep-scan) |
| `graph-builder.mjs` | Build knowledge graph from contacts.json |
| `scorer.mjs` | Layer 1: ICP fit, network hub, relationship, gold score |
| `behavioral-scorer.mjs` | Layer 2: behavioral score, connection power, amplification |
| `referral-scorer.mjs` | Layer 3: referral likelihood, referral tier, referral persona |
| `analyzer.mjs` | 10 analysis modes (hubs, prospects, referrals, clusters, etc.) |
| `delta.mjs` | Snapshot and change detection |
| `report-generator.mjs` | Interactive HTML dashboard (3D graph, Chart.js) |
| `pipeline.mjs` | Pipeline orchestrator (10+ modes with dependency guards) |
| `db.mjs` | Contact database CLI (stats, search, export, seed, prune) |
| `lib.mjs` | Shared utilities (browser launch, arg parsing, niche keywords) |

## Configuration

Three config files drive scoring (all in `data/`):

| File | Purpose |
|------|---------|
| `icp-config.json` | ICP profiles, scoring weights, tier thresholds, niche keywords |
| `behavioral-config.json` | Behavioral persona definitions and scoring rules |
| `referral-config.json` | Referral scoring weights, role tiers, persona thresholds |

Set up via `node scripts/configure.mjs wizard` or `/linkedin-prospector set up my ICP config`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_DATA_DIR` | `.browser-data/` | Path to Playwright persistent browser data (auto-created) |

## Troubleshooting

**"Browser not found"** — Run `npx playwright install chromium`

**"Not logged in"** — Launch the browser manually, navigate to linkedin.com, and log in. The session persists in `.browser-data/`.

**"No contacts found"** — Run a search first or seed the DB: `node scripts/db.mjs seed --file <your-contacts.json>`

**"graph.json missing"** — Run `node scripts/pipeline.mjs --rebuild` to build from contacts.json.

**"Config is example template"** — Run `node scripts/configure.mjs wizard` to customize for your business.

**"referral-scorer failed"** — Referral scoring requires behavioral scores. Run `--rebuild` (not `--referrals` alone) if scores are missing.
