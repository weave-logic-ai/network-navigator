# LinkedIn Prospector

A Claude Code skill that turns your LinkedIn connections into a scored, tiered, persona-classified knowledge graph. Install it, configure your ideal customer profiles through conversation, and let Claude handle the searching, scoring, and analysis.

## What You Get

- **Scored contacts** -- every connection scored on ICP fit, network influence, behavioral signals, and referral potential
- **Tiered classification** -- gold/silver/bronze tiers with persona labels (buyer, advisor, hub, referral-partner)
- **Referral partner identification** -- finds warm introducers, co-sellers, and white-label partners in your existing network
- **Interactive dashboard** -- HTML report with charts, tables, and a 3D network graph
- **Delta tracking** -- see what changed in your network since your last analysis

## Install

### 1. Copy the skill into your project

Clone or copy this repository into your project's `.claude/` directory:

```bash
cd your-project
git clone git@github.com:weave-logic-ai/linkedin-prospector.git .claude/linkedin-prospector
```

This gives you two slash commands in Claude Code: `/linkedin-prospector` and `/network-intel`.

### 2. Install Playwright

From your project root:

```bash
npm i playwright
npx playwright install chromium
```

### 3. Log into LinkedIn

Tell Claude:

```
/linkedin-prospector log me into LinkedIn
```

Claude will launch a browser window. Log into LinkedIn manually, then close the browser. Your session is saved and reused for all future searches.

## Getting Started

Everything is done through conversation with Claude. No need to run scripts directly.

### Step 1: Configure your ICP

Tell Claude what kind of contacts you're looking for:

```
/linkedin-prospector set up my ICP config
```

Claude will ask you about your services, target buyer roles, industries, and signals, then generate your configuration. Some examples:

```
/linkedin-prospector I'm a cybersecurity consultant targeting CISOs and IT Directors at mid-market companies
/linkedin-prospector I run a financial advisory practice focused on tech executives and business owners
/linkedin-prospector I'm a recruiter specializing in placing engineering leaders at SaaS companies
```

To verify your config looks right:

```
/linkedin-prospector validate config
```

### Step 2: Search for contacts

Tell Claude what niche to search:

```
/linkedin-prospector find me 20 healthcare IT contacts
/linkedin-prospector search for SaaS founders in my network
/linkedin-prospector pull contacts in the ecommerce niche
```

Claude will search your LinkedIn connections, extract profiles, and cache everything locally.

### Step 3: Enrich profiles

```
/linkedin-prospector enrich unenriched contacts
```

Claude visits each profile to pull detailed information -- headline, about section, current role, company, connection count. This data feeds the scoring engine.

### Step 4: Score and analyze

Switch to the analysis command:

```
/network-intel rebuild and rescore everything
```

This builds the knowledge graph, runs all three scoring layers (ICP, behavioral, referral), and produces a summary. You can then ask specific questions:

```
/network-intel who are my best hubs?
/network-intel find my top prospects
/network-intel who are my best referral partners?
/network-intel what should I focus on next?
/network-intel give me an overview of my network
```

### Step 5: Generate a report

```
/network-intel generate a report
```

Claude creates an interactive HTML dashboard you can open in any browser.

## Slash Command Reference

### `/linkedin-prospector` -- Configure and Pull

Use this command for setup, searching, and data collection:

| What to say | What happens |
|-------------|--------------|
| `set up my ICP config` | Interactive configuration for your ideal customer profiles |
| `validate config` | Check that your configuration is valid |
| `find me 20 [niche] contacts` | Search your LinkedIn connections by keyword/niche |
| `enrich unenriched contacts` | Visit profiles to pull detailed data |
| `how many contacts do I have?` | Show database statistics |
| `search for [role/industry/keyword]` | Targeted LinkedIn search |
| `log me into LinkedIn` | Launch browser for manual LinkedIn login |

### `/network-intel` -- Analyze and Report

Use this command for scoring, analysis, and reports:

| What to say | What happens |
|-------------|--------------|
| `rebuild and rescore everything` | Full graph build + all 3 scoring layers |
| `who are my best hubs?` | Top contacts by network influence |
| `find my top prospects` | Top contacts by ICP fit |
| `who are my best referral partners?` | Referral partner analysis with explanations |
| `what should I focus on next?` | Strategic recommendations |
| `give me an overview` | Network summary with tier/persona distribution |
| `any new connections since last time?` | Delta comparison with previous snapshot |
| `generate a report` | Interactive HTML dashboard |
| `export my contacts` | JSON export of scored contacts |
| `deep-scan [contact name/URL]` | Discover a contact's connections (2nd-degree) |

## How It Works

### Five Phases

```
Phase 0: CONFIGURE  -- Define ICP profiles, target niches, scoring weights
Phase 1: PULL       -- Search LinkedIn, enrich profiles, cache locally
Phase 2: SCORE      -- Build knowledge graph, run 3-layer scoring engine
Phase 3: ANALYZE    -- 10 analysis modes (hubs, prospects, referrals, clusters...)
Phase 4: REPORT     -- Interactive HTML dashboard with 3D graph and charts
```

### Three-Layer Scoring

**Layer 1 -- ICP + Gold Score**: Scores each contact on role fit, industry match, buying signals, and company size. Produces a composite Gold Score and assigns a tier (gold/silver/bronze) and persona (buyer/advisor/hub/peer).

**Layer 2 -- Behavioral**: Analyzes connection patterns, recency, about section signals, headline keywords, and super-connector indicators. Assigns behavioral personas (super-connector, content-creator, silent-influencer, rising-connector).

**Layer 3 -- Referral**: Scores referral potential based on role complementarity, client overlap, network reach, amplification power, and relationship warmth. Identifies referral partners (warm-introducer, white-label-partner, co-seller, amplifier).

## Configuration

Claude generates your configuration during the setup conversation. Three config files control scoring:

- **`icp-config.json`** -- ICP profiles, role patterns, industries, signals, scoring weights, tier thresholds, niche keywords
- **`behavioral-config.json`** -- Behavioral persona definitions and scoring rules
- **`referral-config.json`** -- Referral scoring weights, role tiers, persona thresholds

### Tuning Tips

After your first analysis, review the results and adjust:

| Observation | What to tell Claude |
|-------------|---------------------|
| Too many gold contacts | "Raise the gold threshold" |
| Wrong people flagged as referral partners | "Narrow the referral role patterns" |
| Buyers showing up as referrals | "Increase the buyer inversion weight" |
| Network hubs not getting credit | "Increase the network hub weight in gold score" |

Then rescore: `/network-intel rescore everything`

## Data Separation

Your contact data (names, profiles, scores) is stored separately from the skill code. By default it lives in `skills/linkedin-prospector/data/`, but you can redirect it:

```bash
export PROSPECTOR_DATA_DIR=/path/to/your/data
```

This keeps PII out of the skill's code tree. Config files always load from the skill directory regardless of this setting.

## Advanced Usage

### Network Expansion

Discover contacts beyond your 1st-degree network:

```
/network-intel deep-scan https://linkedin.com/in/someone
/linkedin-prospector batch deep-scan my gold contacts
/linkedin-prospector batch deep-scan referral partners with min score 0.5
```

### Delta Tracking

Track changes over time:

```
/network-intel any new connections since last time?
/network-intel show my snapshots
```

### Database Operations

```
/linkedin-prospector how many contacts do I have?
/linkedin-prospector search for "machine learning" in my contacts
/linkedin-prospector export my contacts as JSON
```

## Prerequisites

- **Claude Code** with slash command support
- **Node.js 18+**
- **Playwright** with Chromium (`npm i playwright && npx playwright install chromium`)
- **LinkedIn account** with an active session

## Troubleshooting

**"Browser not found"** -- Run `npx playwright install chromium` from your project root.

**"Not logged in"** -- Use `/linkedin-prospector log me into LinkedIn` to launch the browser and log in manually.

**"No contacts found"** -- Run a search first: `/linkedin-prospector find me 20 [your niche] contacts`

**"Config is example template"** -- Run `/linkedin-prospector set up my ICP config` to customize for your business.

**"graph.json missing"** -- Run `/network-intel rebuild and rescore everything`

## License

MIT
