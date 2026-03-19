# Network Navigator — v2

An API-first Claude Code agent skill for LinkedIn network intelligence. All operations go through the NetworkNav REST API at `localhost:3000` — no Playwright, no local JSON files, no browser automation.

## Architecture

Three subsystems work together:

1. **Web App** (`app/`) — Next.js dashboard with REST API endpoints for contacts, scoring, enrichment, graph analysis, ICPs, niches, and offerings.
2. **Browser Extension** (`browser/`) — Chrome extension that captures LinkedIn profile data and sends it to the app API.
3. **Agent Scripts** (`agent/`) — Lightweight `.mjs` scripts that Claude invokes via slash commands. Each script calls the app's REST API.

## Prerequisites

- Docker Compose running: `docker compose up -d` (starts the app, database, and supporting services)
- Node.js 18+ (for running agent scripts; only uses built-in `fetch`)
- Browser extension installed and configured (for LinkedIn data capture)

## Slash Commands

### `/linkedin-prospector` — Configure and Manage

| What to say | What happens |
|-------------|--------------|
| `set up my ICP config` | Interactive ICP/niche/offering configuration |
| `validate config` | Check current ICP, niche, and offering setup |
| `list all profiles` | Display all configured ICPs, niches, offerings |

### `/network-intel` — Analyze and Pipeline

| What to say | What happens |
|-------------|--------------|
| `show me my network summary` | Dashboard stats overview |
| `who are my best hubs?` | Top contacts by network influence |
| `find my top prospects` | Top contacts by composite score |
| `who are my best referral partners?` | Referral candidate analysis |
| `show network clusters` | Community detection results |
| `search for "AI startup"` | Hybrid search across contacts |
| `what should I focus on next?` | AI-recommended next actions |
| `show contacts at Acme Corp` | Company-filtered contact list |
| `rescore everything` | Trigger full rescore pipeline |
| `check system health` | API and extension health check |
| `enrich contact [id]` | Trigger enrichment for a contact |
| `export my data` | Full data export as JSON |

## Agent Scripts

All scripts live in `skills/linkedin-prospector/scripts/` and use the shared `api-client.mjs` HTTP client.

### api-client.mjs

Lightweight fetch wrapper targeting `http://localhost:3000` (override with `NETWORKNAV_URL` env var). Exports `get`, `post`, `put`, `del`.

### configure.mjs

ICP, niche, and offering configuration manager.

```bash
node scripts/configure.mjs validate                # Check current config
node scripts/configure.mjs list                    # Full config listing
node scripts/configure.mjs generate --json '{...}' # Create from JSON
```

### pipeline.mjs

Pipeline orchestrator for scoring, enrichment, and graph operations.

```bash
node scripts/pipeline.mjs --status        # Dashboard stats
node scripts/pipeline.mjs --score [id]    # Score a contact
node scripts/pipeline.mjs --rescore-all   # Rescore all (polls until done)
node scripts/pipeline.mjs --enrich [id]   # Enrich a contact
node scripts/pipeline.mjs --compute-graph # Recompute network graph
node scripts/pipeline.mjs --export        # Export data to stdout
node scripts/pipeline.mjs --health        # Health check
```

### analyze.mjs

Network analysis with multiple modes.

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

## Data Flow

```
LinkedIn Profile (browser) --> Extension --> POST /api/extension/capture --> Database
                                                                              |
Claude Agent --> scripts/*.mjs --> REST API --> Database/Scoring/Graph Engine
                                                                              |
Dashboard (Next.js) <-- REST API <-- Database <-------------------------------+
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NETWORKNAV_URL` | `http://localhost:3000` | Base URL for the app API |

## License

MIT
