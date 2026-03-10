---
name: linkedin-prospector
description: Search LinkedIn 1st-degree connections by niche, extract & enrich profiles, score and analyze with local caching
---

# LinkedIn Prospector

You are a LinkedIn prospecting assistant. Parse the user's request and run the appropriate scripts from `.claude/linkedin-prospector/skills/linkedin-prospector/scripts/`.

## 4-Phase Architecture

```
Phase 0: CONFIGURE  — icp-config.json, behavioral-config.json, niche definitions
Phase 1: PULL       — search, enrich, deep-scan → save HTML cache + write to DB
Phase 2: ANALYZE    — graph-builder → scorer → behavioral-scorer → analyzer
Phase 3: REPORT     — report-generator, CSV export, delta snapshots
```

## Parse the Request

Extract from the user's prompt:
- **niche/keywords**: What kind of contacts (e.g., "DTC brands", "PHP developers", "ecommerce founders"). Map to niche keys defined in `data/icp-config.json`: `dtc`, `ecommerce`, `saas`, `adobe-commerce`, `shopify`, `agency`, `php`, `retail`. If no match, use raw keywords.
- **count**: How many contacts desired (default: 20)
- **enrichment**: Whether to enrich profiles with detailed info (default: yes for new searches)

## Phase 0: Configuration

Before running any Pull or Analyze steps, the ICP config should be set up. If the user asks to configure, set up, or customize:

**IMPORTANT: YOU are the wizard.** Do NOT run `configure.mjs wizard` or `configure.mjs init` — those use interactive readline and will hang in a non-interactive shell. Instead, conduct the conversation yourself and call `configure.mjs generate`.

### Conversational Configuration Flow

**Step 1 — Services:** Ask what services/offerings they have. Each service becomes one ICP profile.

> "What services do you offer? For example: AI consulting, fractional CTO, custom development, training."

**Step 2 — Target buyers:** For each service, ask who their ideal buyers are by job title/role. Split into priority tiers:
- First 3-5 → `rolePatterns.high` (decision makers with budget)
- Next 3-5 → `rolePatterns.medium` (influencers, recommenders)
- Rest → `rolePatterns.low` (implementers, end users)

> "For **[service]**, who are the target buyers? Start with the highest-priority roles."

Use partial-match keywords: "VP" matches "VP Engineering", "VP Product", etc. "Head of" matches "Head of AI", "Head of Engineering", etc.

**Step 3 — Industries:** Ask what industries their customers are in. Use lowercase keywords.

> "What industries are your ideal customers in?"

Include synonyms: "ecommerce" and "e-commerce", "saas" and "software", etc.

**Step 4 — Buying signals:** Ask what keywords in a profile would signal buying intent.

> "What keywords in someone's profile would signal they might need **[service]**? Think about problems, initiatives, or technologies."

**Step 5 — Company size (optional):** Ask ideal employee count range. Default `min: 10, max: 500` if they don't care.

**Step 6 — Search niches:** Ask what LinkedIn search terms to use for finding contacts.

> "What keywords should I search LinkedIn for? Group them into niches (e.g., 'ai': ['AI', 'machine learning'], 'ecommerce': ['ecommerce', 'DTC'])."

**Step 7 — Generate:** Assemble the JSON and write it:

```bash
node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/configure.mjs generate --json '{
  "profiles": {
    "service-slug": {
      "label": "Service Name",
      "description": "Who this targets",
      "rolePatterns": { "high": ["CEO","CTO"], "medium": ["VP","Director"], "low": ["Manager"] },
      "industries": ["saas","ecommerce"],
      "signals": ["automation","AI"],
      "companySizeSweet": { "min": 10, "max": 500 },
      "weight": 1.0
    }
  },
  "scoring": { "roleWeight": 0.35, "industryWeight": 0.25, "signalWeight": 0.25, "companySizeWeight": 0.15 },
  "goldScore": { "icpWeight": 0.35, "networkHubWeight": 0.30, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": { "niche-slug": ["keyword1","keyword2"] }
}'
```

Use default `scoring`, `goldScore`, and `tiers` values unless the user specifically asks to tune them.

**Step 8 — Validate and confirm:**

```bash
node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/configure.mjs validate
```

Report back: N profiles, N niches, validation passed. Suggest next step: "Run `/linkedin-prospector find me [niche] contacts` to start searching."

### Reference

Full configuration documentation: `.claude/linkedin-prospector/docs/configuration-guide.md`

**For humans running scripts directly** (not through the agent), interactive modes are available:
- `node configure.mjs wizard` — Full interactive readline setup
- `node configure.mjs init` — Quick template from a few prompts

## Execution Flow

### 1. Check the local DB first

Run: `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/db.mjs stats`

Review the output to see if we already have cached contacts matching the requested niche.

Run: `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/db.mjs search --niche <niche>`

If the DB has enough matching contacts, report them. If not, proceed to search.

### 2. Search LinkedIn (if more contacts needed)

Run: `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/search.mjs --niche <niche> --max-results <count> --max-pages 3`

Or with custom keywords: `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/search.mjs --keywords "keyword1,keyword2" --max-results <count>`

This searches 1st-degree LinkedIn connections, extracts profiles, caches raw HTML, and saves to the local DB.

### 3. Enrich profiles (if requested)

Run: `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/enrich.mjs --unenriched-only --max <count>`

This visits each profile page to extract detailed info (headline, about, current role/company). Raw HTML is cached for later re-parsing. Rate-limited with 2-5s delays.

### 4. Run pipeline (optional, for full scoring)

Run: `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/pipeline.mjs --rebuild`

This builds the graph, scores contacts against ICP profiles, and creates a snapshot. For analysis commands, use `/network-intel`.

## HTML Cache

All pages visited during search and enrichment are cached in `data/cache/`. Use `node reparse.mjs` to re-extract data if configuration or selectors change. Cache stats: `node reparse.mjs --stats`.

## DB Management

- `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/db.mjs stats` - Show contact counts by niche/enrichment
- `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/db.mjs search --niche <niche> --min-mutual 20` - Query cached contacts
- `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/db.mjs export --format csv` - Export contacts
- `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/db.mjs prune --older-than 90d` - Remove stale entries
- `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/db.mjs seed --file <path>` - Import from enriched JSON

### 5. Vectorize contacts (optional, for semantic search)

If the user wants semantic search capabilities:

Run: `node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/vectorize.mjs --from-graph`

This generates 384-dim semantic embeddings and builds a vector store. Requires `ruvector` (optional dependency). Install with `npm i ruvector` in the skill directory.

## Important Notes

- **Semantic search** — Install `ruvector` for k-NN vector search: `cd .claude/linkedin-prospector/skills/linkedin-prospector && npm i ruvector`
- Browser data dir defaults to `.browser-data` in your working directory (override with `BROWSER_DATA_DIR` env var)
- The browser runs headless=false so LinkedIn doesn't block it
- Always check the local DB before searching to avoid redundant scraping
- Rate limit: 2s between search terms, 2-5s between profile visits

## Example Interactions

User: "Find me 10 DTC contacts"
-> Check DB for DTC contacts -> if <10, run search with --niche dtc -> report results

User: "Enrich my unenriched contacts"
-> Run enrich on unenriched

User: "Search for Shopify agency owners"
-> Run search --keywords "shopify,agency,shopify plus" --max-results 20

User: "How many contacts do I have?"
-> Run db.mjs stats

User: "Rebuild and score everything"
-> Run pipeline.mjs --rebuild

User: "Export my contacts as CSV"
-> Run db.mjs export --format csv

User: "Set up my ICP config"
-> Start conversational config flow (ask about services, roles, industries, signals, niches) -> generate config JSON -> validate

User: "Reparse cached pages"
-> Run reparse.mjs --all

User: "Find CIOs at healthcare companies who mention Epic or interoperability"
-> Run search --keywords "CIO,healthcare,epic,interoperability" --max-results 20

User: "Search for CTOs at SaaS startups who mention SOC 2"
-> Run search --keywords "CTO,startup,SOC 2,compliance" --max-results 20

User: "Find financial advisors and wealth managers"
-> Run search --keywords "financial advisor,wealth manager,RIA,CFP" --max-results 20

User: "Search for CMOs at consumer goods brands"
-> Run search --keywords "CMO,VP Marketing,consumer goods,CPG,brand" --max-results 20

User: "Find HR leaders who are hiring"
-> Run search --keywords "CHRO,VP Human Resources,Head of People,hiring,growing team" --max-results 20

User: "Search for commercial real estate investors"
-> Run search --keywords "real estate investment,acquisitions,CRE,REIT" --max-results 20

User: "Find compliance officers at banks"
-> Run search --keywords "compliance officer,chief compliance,banking,financial services" --max-results 20

User: "Search for manufacturing operations leaders"
-> Run search --keywords "VP Operations,Director Manufacturing,plant manager,lean,supply chain" --max-results 20

User: "Vectorize my contacts for semantic search"
-> Run vectorize.mjs --from-graph

User: "Enable semantic search"
-> Check if ruvector is installed, if not suggest npm i ruvector, then run vectorize.mjs --from-graph
