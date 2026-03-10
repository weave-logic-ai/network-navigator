# Configuration Guide

This guide covers how to set up the LinkedIn Prospector's ICP (Ideal Customer Profile) configuration — the core of how contacts are scored, tiered, and searched.

## Overview

Two config files drive the system:

| File | Purpose | Required |
|------|---------|----------|
| `data/icp-config.json` | ICP profiles, scoring weights, tier thresholds, niche keywords | Yes |
| `data/behavioral-config.json` | Behavioral persona definitions and scoring rules | Optional (ships with defaults) |

## Setup Methods

### Method 1: Agent-assisted (recommended)

Tell the agent:
```
/linkedin-prospector configure my ICP
```
or
```
/network-intel set up my ICP
```

The agent will walk you through a conversation asking about your business, then generate the config automatically. See [Agent Configuration Flow](#agent-configuration-flow) below.

### Method 2: Interactive CLI (for humans in terminal)

```bash
cd .claude/linkedin-prospector/skills/linkedin-prospector

# Full wizard — multi-profile setup with prompts
node scripts/configure.mjs wizard

# Quick init — generates from a few inputs
node scripts/configure.mjs init
```

### Method 3: Non-interactive CLI (for scripts/automation)

```bash
node scripts/configure.mjs generate --json '{...full config JSON...}'
```

### Method 4: Manual edit

Copy and modify `data/icp-config.json` directly. Validate with:
```bash
node scripts/configure.mjs validate
```

---

## Agent Configuration Flow

When a user asks to configure their ICP, the agent should conduct a structured conversation. Here's the complete flow:

### Step 1: Ask about their business

> "What services do you offer? For example: AI consulting, fractional CTO, custom development, training, automation assessment."

The user's answer determines how many **profiles** to create. Each service = one ICP profile.

**Example answer:** "I do AI consulting and fractional CTO work"
**Result:** Two profiles: `ai-consulting` and `fractional-cto`

### Step 2: For each service, ask about target buyers

> "For **[service name]**, who are your ideal buyers? List the job titles/roles, starting with the highest-priority ones."

Map their answers to `rolePatterns`:
- First 3-5 titles → `high` (decision makers, budget holders)
- Next 3-5 titles → `medium` (influencers, recommenders)
- Remaining → `low` (end users, implementers)

**Example answer:** "CEOs, CTOs, and Founders are my main buyers. VPs and Directors are influencers. Engineering Managers are sometimes involved."
**Result:**
```json
"rolePatterns": {
  "high": ["CEO", "CTO", "Founder", "Co-Founder"],
  "medium": ["VP", "Vice President", "Director", "Head of"],
  "low": ["Engineering Manager", "Manager", "Lead"]
}
```

**Important:** Use partial-match keywords, not exact titles. "VP" matches "VP Engineering", "VP Product", etc. "Head of" matches "Head of Engineering", "Head of AI", etc.

### Step 3: Ask about target industries

> "What industries are your ideal customers in?"

Map to `industries` array. Use lowercase keywords that would appear in LinkedIn profiles.

**Example answer:** "SaaS companies, ecommerce brands, and startups"
**Result:** `["saas", "software", "ecommerce", "e-commerce", "startup", "digital commerce"]`

**Tip:** Include synonyms and variations. LinkedIn profiles use inconsistent terminology.

### Step 4: Ask about buying signals

> "What keywords in someone's profile would signal they might need **[service name]**? Think about problems they'd mention, initiatives they'd be working on, or technologies they'd reference."

Map to `signals` array.

**Example answer:** "People talking about AI adoption, digital transformation, or scaling their tech team"
**Result:** `["ai", "artificial intelligence", "digital transformation", "scaling", "modernization", "automation", "machine learning"]`

### Step 5: Ask about company size (optional)

> "What's the ideal company size range for **[service name]**? (employee count)"

Map to `companySizeSweet`. Default: `{ "min": 10, "max": 500 }`.

### Step 6: Ask about search niches

> "What keywords should I use when searching LinkedIn for potential contacts? These map to search terms used in the Pull phase."

Each niche = a named group of LinkedIn search keywords.

**Example answer:** "Search for AI-related people with 'AI', 'artificial intelligence', 'machine learning'. Also search ecommerce with 'ecommerce', 'DTC', 'Shopify'."
**Result:**
```json
"niches": {
  "ai": ["AI", "artificial intelligence", "machine learning"],
  "ecommerce": ["ecommerce", "DTC", "Shopify", "e-commerce"]
}
```

### Step 7: Assemble and write

Build the complete config JSON and run:

```bash
node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/configure.mjs generate --json '<assembled JSON>'
```

Then validate:

```bash
node .claude/linkedin-prospector/skills/linkedin-prospector/scripts/configure.mjs validate
```

### Step 8: Confirm to user

Report back:
- Number of profiles created and their names
- Number of niches defined
- Suggest next step: "You're set! Run `/linkedin-prospector search for [niche] contacts` to start pulling."

---

## Config File Reference

### `icp-config.json` Structure

```json
{
  "profiles": { ... },     // ICP profile definitions (1 per service)
  "scoring": { ... },      // Weight distribution for ICP scoring dimensions
  "goldScore": { ... },    // Composite score weights
  "tiers": { ... },        // Score thresholds for gold/silver/bronze
  "niches": { ... }        // LinkedIn search keyword groups
}
```

### Profile Definition

Each profile under `profiles` represents one service/offering:

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Human-readable name |
| `description` | string | Who this profile targets |
| `rolePatterns.high` | string[] | Decision-maker title keywords (highest score) |
| `rolePatterns.medium` | string[] | Influencer title keywords (medium score) |
| `rolePatterns.low` | string[] | End-user title keywords (lower score) |
| `industries` | string[] | Industry keywords to match against profile text |
| `signals` | string[] | Buying intent keywords to match against headline/about |
| `companySizeSweet.min` | number | Minimum ideal company size |
| `companySizeSweet.max` | number | Maximum ideal company size |
| `weight` | number | Profile importance multiplier (0.0–1.0) |

### Scoring Weights

Controls how the four scoring dimensions are weighted in the ICP score:

| Field | Default | Description |
|-------|---------|-------------|
| `roleWeight` | 0.35 | How much title match matters |
| `industryWeight` | 0.25 | How much industry match matters |
| `signalWeight` | 0.25 | How much buying signals matter |
| `companySizeWeight` | 0.15 | How much company size fit matters |

Must sum to 1.0.

### Gold Score Weights

Controls the composite "gold score" used for final tiering:

| Field | Default | Description |
|-------|---------|-------------|
| `icpWeight` | 0.35 | ICP fit score contribution |
| `networkHubWeight` | 0.30 | Network centrality/hub score |
| `relationshipWeight` | 0.25 | Mutual connections, shared context |
| `signalBoostWeight` | 0.10 | Extra boost from strong signals |

### Tier Thresholds

Contacts are classified into tiers based on their gold score:

| Tier | Default Threshold | Meaning |
|------|-------------------|---------|
| Gold | 0.55 | High-priority prospects |
| Silver | 0.40 | Worth pursuing |
| Bronze | 0.28 | Keep on radar |
| Watch | < 0.28 | Not a current fit |

Thresholds must be in descending order: gold > silver > bronze.

### Niche Keywords

Maps niche names to LinkedIn search terms:

```json
"niches": {
  "niche-slug": ["Search Term 1", "Search Term 2", "Search Term 3"]
}
```

Used by `search.mjs --niche <slug>` and by the scorer for niche-based filtering.

---

## `behavioral-config.json` Reference

Behavioral scoring runs after ICP scoring and identifies network behavior patterns. Most users don't need to modify this — the defaults work well.

### Scoring Dimensions

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| `connectionPower` | 0.20 | LinkedIn connection count (500+ = max) |
| `connectionRecency` | 0.15 | How recently you connected |
| `aboutSignals` | 0.25 | Behavioral keywords in their About section |
| `headlineSignals` | 0.15 | Profile headline patterns |
| `superConnectorIndex` | 0.15 | Combo score: 3+ traits = super-connector |
| `networkAmplifier` | 0.10 | Amplification potential: mutuals x connections |

### Behavioral Personas

Contacts are classified into personas based on behavioral signals:

| Persona | Criteria |
|---------|----------|
| **Super-connector** | 3+ behavioral traits AND 500+ connections |
| **Content-creator** | Speaker/author/podcast keywords in profile |
| **Silent-influencer** | 500+ connections but low behavioral signals |
| **Rising-connector** | < 500 connections, connected within 6 months |
| **Passive-network** | Default — no strong behavioral signals |

---

## Validation

Always validate after modifying config:

```bash
node scripts/configure.mjs validate
```

Checks:
- JSON is valid
- `profiles` exists with at least one entry
- Each profile has `rolePatterns`
- `scoring` weights sum to 1.0
- `tiers` are in descending order (gold > silver > bronze)
- Warns if `_example` marker is still present (uncustomized template)

---

## Examples

### Solo AI Consultant

```json
{
  "profiles": {
    "ai-consulting": {
      "label": "AI Consulting",
      "description": "Leaders exploring AI for their business",
      "rolePatterns": {
        "high": ["CEO", "CTO", "Founder", "Chief Digital"],
        "medium": ["VP", "Director", "Head of"],
        "low": ["Manager", "Lead"]
      },
      "industries": ["saas", "ecommerce", "fintech", "healthcare", "manufacturing"],
      "signals": ["ai", "artificial intelligence", "automation", "digital transformation", "machine learning"],
      "companySizeSweet": { "min": 20, "max": 500 },
      "weight": 1.0
    }
  },
  "scoring": { "roleWeight": 0.35, "industryWeight": 0.25, "signalWeight": 0.25, "companySizeWeight": 0.15 },
  "goldScore": { "icpWeight": 0.35, "networkHubWeight": 0.30, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": {
    "ai": ["AI", "artificial intelligence", "machine learning", "AI adoption"],
    "saas": ["SaaS", "software platform", "cloud"],
    "ecommerce": ["ecommerce", "e-commerce", "DTC", "Shopify"]
  }
}
```

### Multi-Service Agency

Create multiple profiles with different weights to prioritize services:

```json
{
  "profiles": {
    "web-development": {
      "label": "Web Development",
      "weight": 1.0,
      ...
    },
    "seo-services": {
      "label": "SEO Services",
      "weight": 0.8,
      ...
    },
    "branding": {
      "label": "Branding & Design",
      "weight": 0.6,
      ...
    }
  }
}
```

Higher `weight` = that profile contributes more to a contact's gold score.
