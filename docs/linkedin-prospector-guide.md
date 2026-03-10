# LinkedIn Prospector -- Comprehensive Reference Guide

A portable Claude Code plugin for LinkedIn network intelligence. It turns your 1st-degree LinkedIn connections into a scored, tiered, persona-classified knowledge graph with referral partner identification.

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

LinkedIn Prospector is a local-first network intelligence tool that searches your LinkedIn 1st-degree connections, enriches their profiles, scores them against configurable Ideal Customer Profiles (ICPs), analyzes behavioral patterns, identifies referral partners, and produces actionable intelligence through 12 analysis modes (including semantic vector search) and an interactive HTML dashboard.

### Who It's For

- Founders and consultants looking for warm introductions to potential clients
- Business development professionals mapping referral partner networks
- Agencies identifying white-label partners and co-sellers
- Anyone who wants to understand the strategic value of their LinkedIn network

### Architecture

```
+-------------------+     +-------------------+     +-------------------+
|  Phase 0          |     |  Phase 1          |     |  Phase 2          |
|  CONFIGURE        |     |  PULL             |     |  SCORE            |
|                   |     |                   |     |                   |
|  icp-config.json  |---->|  search.mjs       |---->|  graph-builder    |
|  behavioral-cfg   |     |  enrich.mjs       |     |  scorer.mjs       |
|  referral-cfg     |     |  deep-scan.mjs    |     |  behavioral-scorer|
|  configure.mjs    |     |  batch-deep-scan  |     |  referral-scorer  |
+-------------------+     +-------------------+     +-------------------+
                                                            |
                          +-------------------+     +-------v-----------+
                          +-------------------+     +-------------------+
                          |  Phase 4          |     |  Phase 3          |
                          |  REPORT           |     |  ANALYZE          |
                          |                   |<----|                   |
                          |  report-generator |     |  analyzer.mjs     |
                          |  HTML dashboard   |     |  12 modes         |
                          |  delta snapshots  |     |  delta.mjs        |
                          +-------------------+     +-------------------+

Two Claude Code slash commands wrap all of this:

  /linkedin-prospector   -- Configure + Pull (Phase 0-1)
  /network-intel         -- Score + Analyze + Report (Phase 2-4)
```

### Key Concepts

**Contacts** -- Individual LinkedIn profiles stored in `contacts.json`. Each contact has raw profile data, enrichment data, and scoring metadata.

**Graph** -- A knowledge graph (`graph.json`) built from contacts. Contains nodes (contacts), edges (relationships between contacts sharing companies/clusters/mutual connections), clusters (industry/niche groupings), and company aggregations.

**Scoring Layers** -- Three independent scoring engines run in sequence:
- Layer 1: ICP + Gold Score (are they a potential buyer?)
- Layer 2: Behavioral (how active and connected are they?)
- Layer 3: Referral (could they send you business?)

**Tiers** -- Contacts are bucketed into gold, silver, bronze, or watch based on their composite Gold Score.

**Personas** -- Each contact is assigned up to three persona labels:
- ICP Persona: buyer, advisor, hub, peer, or referral-partner
- Behavioral Persona: super-connector, content-creator, silent-influencer, rising-connector, or passive-network
- Referral Persona: white-label-partner, warm-introducer, co-seller, amplifier, or passive-referral

---

## 2. Getting Started

### Prerequisites

- **Node.js 18+** -- The scripts use ES modules and modern JavaScript features.
- **Playwright with Chromium** -- Used for browser automation. Install it as described below.
- **LinkedIn account** -- You need to be logged into LinkedIn in a persistent Playwright browser session.
- **Claude Code** -- Required if you want to use the `/linkedin-prospector` and `/network-intel` slash commands.
- **ruvector** (optional) -- For semantic vector search. Install: `npm i ruvector` in the skill directory.

### Step 1: Install Dependencies

```bash
npm install playwright
npx playwright install chromium
```

### Step 2: Establish a LinkedIn Browser Session

Launch a persistent Playwright browser, log into LinkedIn manually, then close the browser. The session persists in a `.browser-data/` directory.

```bash
node -e "import('playwright').then(p => p.chromium.launchPersistentContext('.browser-data', {headless:false, channel:'chromium'}).then(c => console.log('Log into LinkedIn, then close browser')))"
```

A Chromium window will open. Navigate to `linkedin.com`, log in with your credentials, and then close the browser window. The session cookies persist in `.browser-data/` and are reused by all scripts.

To use a different browser data location:

```bash
export BROWSER_DATA_DIR=/path/to/your/browser-data
```

### Step 3: Configure Your ICP Profiles

Run the interactive configuration wizard (recommended for first-time setup):

```bash
cd .claude/linkedin-prospector/skills/linkedin-prospector
node scripts/configure.mjs wizard
```

Or use the Claude Code slash command and let the agent walk you through it:

```
/linkedin-prospector set up my ICP config
```

See [Section 3: Configuring Your ICP](#3-configuring-your-icp) for detailed guidance.

### Step 4: Pull Your First Contacts

Search for contacts in a niche defined in your config:

```bash
node scripts/search.mjs --niche ecommerce --max-results 20
```

Enrich those contacts with detailed profile data:

```bash
node scripts/enrich.mjs --unenriched-only --max 50
```

Or run the entire pipeline in one shot:

```bash
node scripts/pipeline.mjs --full --niche ecommerce
```

### Step 5: Build the Graph, Score, and Analyze

Build the knowledge graph, run all three scoring layers, and create a snapshot:

```bash
node scripts/pipeline.mjs --rebuild
```

Generate the interactive HTML dashboard:

```bash
node scripts/pipeline.mjs --report
```

Open `data/network-report.html` in your browser to explore the results.

### Complete Walkthrough: Zero to Scored Graph

Here is the full sequence from a brand-new installation:

```bash
# 1. Install dependencies
npm install playwright
npx playwright install chromium

# 2. Establish LinkedIn session (log in manually in the browser window)
node -e "import('playwright').then(p => p.chromium.launchPersistentContext('.browser-data', {headless:false, channel:'chromium'}).then(c => console.log('Log into LinkedIn, then close browser')))"

# 3. Configure ICP (interactive wizard)
cd .claude/linkedin-prospector/skills/linkedin-prospector
node scripts/configure.mjs wizard

# 4. Validate config
node scripts/configure.mjs validate

# 5. Search for contacts
node scripts/search.mjs --niche ecommerce --max-results 30

# 6. Enrich profiles
node scripts/enrich.mjs --unenriched-only --max 50

# 7. Build graph + score all layers + snapshot
node scripts/pipeline.mjs --rebuild

# 8. Generate HTML report
node scripts/pipeline.mjs --report

# 9. Review results
node scripts/analyzer.mjs --mode summary
node scripts/analyzer.mjs --mode hubs --top 10
node scripts/analyzer.mjs --mode prospects --top 10
node scripts/analyzer.mjs --mode referrals --top 10
```

---

## 3. Configuring Your ICP

### What Is an ICP and Why It Matters

An Ideal Customer Profile (ICP) defines who your best customers are by role, industry, company size, and buying signals. The scoring engine uses your ICP configuration to determine how well each contact matches your target audience. Without a customized ICP, scores will be generic and unhelpful.

The configuration system manages three files:

| File | Purpose |
|------|---------|
| `icp-config.json` | ICP profiles, scoring weights, tier thresholds, niche definitions |
| `behavioral-config.json` | Behavioral persona definitions and scoring rules |
| `referral-config.json` | Referral scoring weights, role tiers, persona thresholds |

### Configuration Methods

#### Method 1: Interactive Wizard (Terminal)

For humans running scripts directly in a terminal:

```bash
node scripts/configure.mjs wizard
```

The wizard walks through services, target roles, industries, buying signals, company size, and search niches. It generates all three config files.

#### Method 2: Quick Init (Terminal)

For a faster setup with fewer questions:

```bash
node scripts/configure.mjs init
```

#### Method 3: Conversational via /linkedin-prospector

When using the Claude Code slash command:

```
/linkedin-prospector set up my ICP config
```

The agent asks about your services, target buyers, industries, buying signals, and search niches, then generates the configuration non-interactively using `configure.mjs generate`.

#### Method 4: Non-Interactive (for Automation)

Pass the full configuration as JSON:

```bash
node scripts/configure.mjs generate --json '{
  "profiles": {
    "my-service": {
      "label": "My Service",
      "description": "Who this targets",
      "rolePatterns": {
        "high": ["CEO", "CTO"],
        "medium": ["VP", "Director"],
        "low": ["Manager"]
      },
      "industries": ["saas", "ecommerce"],
      "signals": ["automation", "AI", "scaling"],
      "companySizeSweet": { "min": 10, "max": 500 },
      "weight": 1.0
    }
  },
  "scoring": {
    "roleWeight": 0.35,
    "industryWeight": 0.25,
    "signalWeight": 0.25,
    "companySizeWeight": 0.15
  },
  "goldScore": {
    "icpWeight": 0.35,
    "networkHubWeight": 0.30,
    "relationshipWeight": 0.25,
    "signalBoostWeight": 0.10
  },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": {
    "saas": ["SaaS", "platform", "software as a service"],
    "ecommerce": ["ecommerce", "e-commerce", "digital commerce"]
  }
}'
```

#### Validating Configuration

After creating or editing your config:

```bash
node scripts/configure.mjs validate
```

This checks for missing fields, weight sums, tier ordering, and warns about potential issues.

### The Configuration Wizard Flow

The wizard asks questions in this order:

1. **Services** -- What services/offerings do you have? Each becomes one ICP profile.
2. **Target Buyers (per service)** -- Who are the ideal buyers by job title? The first 3-4 become `rolePatterns.high` (decision makers with budget), the next 3-4 become `rolePatterns.medium` (influencers), and the rest become `rolePatterns.low` (implementers).
3. **Industries** -- What industries are your customers in? Use lowercase keywords. Include synonyms (e.g., "ecommerce" and "e-commerce").
4. **Buying Signals** -- What keywords in a profile would signal buying intent? Think about problems ("scaling"), initiatives ("digital transformation"), or technologies ("AI").
5. **Company Size** -- Ideal employee count range. Defaults to 10-500 if not specified.
6. **Search Niches** -- What LinkedIn search terms to use for finding contacts, grouped by niche.

### Config File Format Reference: `icp-config.json`

```json
{
  "profiles": {
    "<profile-slug>": {
      "label": "Human-readable service name",
      "description": "Who this profile targets",
      "rolePatterns": {
        "high": ["CEO", "Founder", "CTO"],
        "medium": ["VP", "Director", "Head of"],
        "low": ["Manager", "Lead", "Senior"]
      },
      "industries": ["keyword1", "keyword2"],
      "signals": ["buying-signal1", "buying-signal2"],
      "companySizeSweet": { "min": 10, "max": 500 },
      "weight": 1.0
    }
  },
  "scoring": {
    "roleWeight": 0.35,
    "industryWeight": 0.25,
    "signalWeight": 0.25,
    "companySizeWeight": 0.15
  },
  "goldScore": {
    "icpWeight": 0.35,
    "networkHubWeight": 0.30,
    "relationshipWeight": 0.25,
    "signalBoostWeight": 0.10
  },
  "tiers": {
    "gold": 0.55,
    "silver": 0.40,
    "bronze": 0.28
  },
  "niches": {
    "<niche-slug>": ["search term 1", "search term 2"]
  }
}
```

**Field-by-field breakdown:**

| Field | Type | Description |
|-------|------|-------------|
| `profiles` | Object | Map of ICP profile slugs to profile definitions. You can have multiple profiles (one per service). |
| `profiles.<slug>.label` | String | Display name for this profile. |
| `profiles.<slug>.description` | String | Brief description of who this profile targets. |
| `profiles.<slug>.rolePatterns` | Object | Three tiers of role keywords: `high` (1.0 score), `medium` (0.7 score), `low` (0.3 score). Keywords are partial matches -- "VP" matches "VP Engineering", "VP Product", etc. |
| `profiles.<slug>.industries` | Array | Lowercase industry keywords to match against contact text. |
| `profiles.<slug>.signals` | Array | Buying intent keywords to match against contact text. |
| `profiles.<slug>.companySizeSweet` | Object | `min` and `max` employee count for ideal company size. |
| `profiles.<slug>.weight` | Number | Profile weight (0.0-1.0). Lower weights reduce the profile's contribution to scores. |
| `scoring` | Object | Weights for the four ICP fit sub-components. Must sum to 1.0. |
| `goldScore` | Object | Weights for the four Gold Score components. Must sum to 1.0. |
| `tiers` | Object | Threshold values for tier assignment. `gold > silver > bronze`. |
| `niches` | Object | Map of niche slugs to arrays of LinkedIn search keywords. |

### ICP Configuration Examples

Below are six diverse ICP configuration examples from different industries and business models. Each can be used directly with `configure.mjs generate --json` or as a starting point for customization. For the full set of 15 verticals with detailed persona descriptions, scoring weight recommendations, and role hierarchies, see [docs/icp-vertical-research.md](icp-vertical-research.md).

#### Example 1: Cybersecurity Consultant / vCISO

A virtual CISO or managed security services provider targeting mid-market companies that lack a dedicated CISO.

```json
{
  "profiles": {
    "security-budget-holder": {
      "label": "Security Budget Holder",
      "description": "Executives who authorize cybersecurity spending",
      "rolePatterns": {
        "high": ["CISO", "Chief Information Security", "CIO", "CTO", "VP Cybersecurity"],
        "medium": ["Director Information Security", "Director IT Security", "Head of Security", "IT Director"],
        "low": ["Security Manager", "IT Security Manager", "Security Architect"]
      },
      "industries": ["financial services", "banking", "healthcare", "government", "energy", "manufacturing", "retail"],
      "signals": ["compliance", "soc 2", "iso 27001", "nist", "hipaa", "zero trust", "incident response", "penetration testing", "risk assessment", "security audit"],
      "companySizeSweet": { "min": 50, "max": 2000 },
      "weight": 1.0
    },
    "no-ciso-company": {
      "label": "Company Without CISO (vCISO Target)",
      "description": "Growing companies that need security leadership but lack a dedicated CISO",
      "rolePatterns": {
        "high": ["CEO", "Founder", "CTO", "COO", "VP Engineering"],
        "medium": ["IT Director", "Director Engineering", "Head of IT", "CFO"],
        "low": ["IT Manager", "Engineering Manager", "DevOps Manager"]
      },
      "industries": ["saas", "fintech", "healthtech", "startup", "technology", "ecommerce"],
      "signals": ["soc 2 readiness", "compliance requirements", "first ciso", "building security", "cyber insurance", "series a", "series b"],
      "companySizeSweet": { "min": 20, "max": 500 },
      "weight": 0.9
    }
  },
  "scoring": { "roleWeight": 0.30, "industryWeight": 0.25, "signalWeight": 0.30, "companySizeWeight": 0.15 },
  "goldScore": { "icpWeight": 0.40, "networkHubWeight": 0.25, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": {
    "ciso-community": ["CISO", "VP Security", "security leader"],
    "startup-cto": ["CTO startup", "VP Engineering", "technical co-founder"],
    "infosec": ["information security", "cybersecurity", "pentesting"]
  }
}
```

#### Example 2: Healthcare IT Consultant

A health IT vendor or consultant selling EHR implementation, interoperability solutions, telehealth, or HIPAA compliance services.

```json
{
  "profiles": {
    "health-system-cio": {
      "label": "Health System CIO/CMIO",
      "description": "Technology and clinical informatics leaders at health systems",
      "rolePatterns": {
        "high": ["CIO", "CMIO", "Chief Medical Information", "Chief Digital", "VP Information Technology"],
        "medium": ["Director IT", "Director Clinical Informatics", "Head of IT", "VP Digital Health"],
        "low": ["IT Manager", "Clinical Informatics Manager", "EHR Analyst"]
      },
      "industries": ["hospital", "health system", "healthcare", "academic medical center", "physician group", "ambulatory care"],
      "signals": ["ehr implementation", "epic", "cerner", "interoperability", "hl7 fhir", "telehealth", "population health", "clinical decision support", "value-based care"],
      "companySizeSweet": { "min": 100, "max": 20000 },
      "weight": 1.0
    },
    "revenue-cycle-buyer": {
      "label": "Revenue Cycle Buyer",
      "description": "Leaders responsible for billing, coding, and revenue cycle operations",
      "rolePatterns": {
        "high": ["CFO", "VP Revenue Cycle", "VP Finance", "Chief Revenue Officer"],
        "medium": ["Director Revenue Cycle", "Director Billing", "Head of Revenue Cycle"],
        "low": ["Revenue Cycle Manager", "Billing Manager", "Coding Manager"]
      },
      "industries": ["hospital", "health system", "physician group", "medical billing", "healthcare finance"],
      "signals": ["revenue cycle", "denial management", "claims processing", "prior authorization", "reimbursement", "charge capture"],
      "companySizeSweet": { "min": 50, "max": 10000 },
      "weight": 0.9
    }
  },
  "scoring": { "roleWeight": 0.35, "industryWeight": 0.30, "signalWeight": 0.25, "companySizeWeight": 0.10 },
  "goldScore": { "icpWeight": 0.40, "networkHubWeight": 0.25, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": {
    "health-it-leaders": ["CIO hospital", "CMIO", "health system CIO"],
    "ehr-implementation": ["epic", "cerner", "oracle health", "ehr implementation"],
    "revenue-cycle": ["revenue cycle", "medical billing", "denial management"],
    "digital-health": ["telehealth", "digital health", "remote patient monitoring"]
  }
}
```

#### Example 3: Executive Recruiter / Headhunter

A retained or contingency recruiter placing C-suite and VP-level candidates. Dual ICP: one for candidate sourcing, one for client development.

```json
{
  "profiles": {
    "hiring-authority": {
      "label": "Hiring Authority (Client)",
      "description": "Executives who authorize and fund executive searches",
      "rolePatterns": {
        "high": ["CEO", "President", "CHRO", "Chief People", "CPO"],
        "medium": ["VP Human Resources", "VP Talent", "Head of People", "Head of Talent Acquisition"],
        "low": ["Director HR", "Director Talent Acquisition", "Talent Acquisition Manager"]
      },
      "industries": ["technology", "financial services", "healthcare", "manufacturing", "private equity"],
      "signals": ["hiring", "growing team", "scaling", "executive search", "succession planning", "rapid growth"],
      "companySizeSweet": { "min": 100, "max": 10000 },
      "weight": 1.0
    },
    "passive-candidate": {
      "label": "Passive Executive Candidate",
      "description": "Employed executives who could be placed at client companies",
      "rolePatterns": {
        "high": ["CEO", "CFO", "CTO", "COO", "CMO", "CRO", "President"],
        "medium": ["SVP", "EVP", "VP", "Managing Director"],
        "low": ["Director", "Senior Director", "Head of", "Principal"]
      },
      "industries": ["technology", "saas", "fintech", "healthtech", "manufacturing", "consulting"],
      "signals": ["open to opportunities", "in transition", "board member", "advisor", "p&l responsibility", "transformation leader"],
      "companySizeSweet": { "min": 50, "max": 50000 },
      "weight": 0.9
    }
  },
  "scoring": { "roleWeight": 0.40, "industryWeight": 0.15, "signalWeight": 0.35, "companySizeWeight": 0.10 },
  "goldScore": { "icpWeight": 0.40, "networkHubWeight": 0.20, "relationshipWeight": 0.30, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": {
    "hr-leaders": ["CHRO", "VP Human Resources", "Head of People"],
    "c-suite-tech": ["CTO", "CIO", "VP Engineering"],
    "open-to-work": ["open to opportunities", "in transition", "seeking new role"]
  }
}
```

#### Example 4: Financial Advisor / Wealth Manager

A wealth manager or RIA prospecting for HNW individuals, business owners approaching liquidity events, and Centers of Influence (estate attorneys, CPAs) who refer wealthy clients.

```json
{
  "profiles": {
    "hnw-prospect": {
      "label": "High-Net-Worth Prospect",
      "description": "Business owners and executives with significant investable assets",
      "rolePatterns": {
        "high": ["CEO", "Founder", "Owner", "President", "Managing Partner", "Chairman"],
        "medium": ["CFO", "SVP", "EVP", "Partner", "Managing Director"],
        "low": ["VP", "Director", "Physician", "Surgeon", "Attorney"]
      },
      "industries": ["business owner", "entrepreneur", "real estate", "medical", "legal", "technology", "manufacturing"],
      "signals": ["exited", "acquired", "sold my company", "liquidity event", "retired", "angel investor", "family office", "succession planning"],
      "companySizeSweet": { "min": 1, "max": 500 },
      "weight": 1.0
    },
    "center-of-influence": {
      "label": "Center of Influence (COI)",
      "description": "Professionals who serve HNWIs and can refer wealth management clients",
      "rolePatterns": {
        "high": ["Estate Attorney", "CPA", "Tax Partner", "Business Broker", "M&A Advisor"],
        "medium": ["Partner", "Managing Partner", "Senior Partner", "Insurance Broker"],
        "low": ["Associate", "Attorney", "Accountant", "Financial Planner"]
      },
      "industries": ["law firm", "accounting", "cpa firm", "business brokerage", "estate planning", "insurance"],
      "signals": ["estate planning", "business succession", "tax planning", "mergers and acquisitions", "charitable giving", "generational wealth transfer"],
      "companySizeSweet": { "min": 1, "max": 200 },
      "weight": 0.85
    }
  },
  "scoring": { "roleWeight": 0.30, "industryWeight": 0.20, "signalWeight": 0.30, "companySizeWeight": 0.20 },
  "goldScore": { "icpWeight": 0.35, "networkHubWeight": 0.30, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": {
    "business-owners": ["business owner", "founder", "CEO", "entrepreneur"],
    "estate-attorneys": ["estate planning attorney", "trust attorney", "probate"],
    "cpa-tax": ["CPA", "certified public accountant", "tax partner"],
    "pre-exit": ["exit planning", "business succession", "selling business"]
  }
}
```

#### Example 5: Marketing Agency Owner (Mid-Market)

Owner of a 50-200 person marketing/branding agency selling retainer services (brand strategy, creative, performance marketing, web) to B2C and B2B brands with $10M-$500M revenue.

```json
{
  "profiles": {
    "cmo-vp-marketing": {
      "label": "CMO / VP Marketing",
      "description": "Senior marketing leaders with agency-hiring authority",
      "rolePatterns": {
        "high": ["CMO", "Chief Marketing", "VP Marketing", "VP Brand", "SVP Marketing", "Head of Marketing"],
        "medium": ["Director Marketing", "Director Brand", "Director Digital Marketing", "Head of Growth"],
        "low": ["Marketing Manager", "Brand Manager", "Growth Manager", "Digital Marketing Manager"]
      },
      "industries": ["consumer goods", "cpg", "food and beverage", "beauty", "fashion", "hospitality", "travel", "b2b saas", "fintech"],
      "signals": ["agency search", "rfp", "rebranding", "brand refresh", "new product launch", "customer acquisition", "agency of record", "marketing transformation"],
      "companySizeSweet": { "min": 50, "max": 2000 },
      "weight": 1.0
    },
    "dtc-ecommerce-leader": {
      "label": "DTC / E-commerce Leader",
      "description": "Founders and marketing leads at digitally native brands",
      "rolePatterns": {
        "high": ["CEO", "Founder", "CMO", "VP Marketing", "VP Ecommerce", "Head of Marketing"],
        "medium": ["Director Ecommerce", "Director Marketing", "Director Growth", "Head of Growth"],
        "low": ["Marketing Manager", "Ecommerce Manager", "Performance Marketing Manager"]
      },
      "industries": ["dtc", "direct to consumer", "ecommerce", "e-commerce", "shopify", "amazon", "online retail", "subscription", "marketplace"],
      "signals": ["scaling paid media", "customer acquisition cost", "retention", "brand building", "product launch", "omnichannel", "influencer marketing", "content strategy"],
      "companySizeSweet": { "min": 10, "max": 500 },
      "weight": 0.9
    }
  },
  "scoring": { "roleWeight": 0.30, "industryWeight": 0.25, "signalWeight": 0.30, "companySizeWeight": 0.15 },
  "goldScore": { "icpWeight": 0.40, "networkHubWeight": 0.25, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": {
    "cmo-brand": ["CMO", "VP Marketing", "Chief Marketing Officer", "Head of Marketing"],
    "dtc-ecommerce": ["DTC", "direct to consumer", "ecommerce founder", "Shopify"],
    "cpg-brands": ["consumer goods", "CPG", "food and beverage", "beauty brand"]
  }
}
```

#### Example 6: SaaS Sales Rep (Outbound Prospecting)

An Account Executive or SDR at a B2B SaaS company selling a horizontal product (CRM, analytics, project management) to mid-market and enterprise buyers.

```json
{
  "profiles": {
    "saas-enterprise-buyer": {
      "label": "Enterprise Software Buyer",
      "description": "Senior leaders with budget authority for SaaS purchasing decisions",
      "rolePatterns": {
        "high": ["CIO", "CTO", "Chief Digital", "Chief Revenue", "VP IT"],
        "medium": ["VP Engineering", "VP Operations", "VP Sales", "Director IT", "Head of Engineering"],
        "low": ["IT Manager", "Engineering Manager", "Solutions Architect", "RevOps Manager"]
      },
      "industries": ["financial services", "healthcare", "manufacturing", "retail", "professional services", "technology"],
      "signals": ["digital transformation", "cloud migration", "evaluating solutions", "rfp", "vendor selection", "tech stack", "consolidation"],
      "companySizeSweet": { "min": 200, "max": 5000 },
      "weight": 1.0
    },
    "saas-mid-market-champion": {
      "label": "Mid-Market Champion",
      "description": "Hands-on leaders who evaluate and recommend tools internally",
      "rolePatterns": {
        "high": ["Director IT", "Director Engineering", "Head of IT", "Head of RevOps"],
        "medium": ["Senior Manager", "IT Manager", "Engineering Manager", "Sales Operations Manager"],
        "low": ["Team Lead", "Project Manager", "Business Analyst"]
      },
      "industries": ["saas", "software", "fintech", "healthtech", "martech"],
      "signals": ["implementing", "migrating from", "replacing", "evaluating", "poc", "pilot program", "tech stack audit"],
      "companySizeSweet": { "min": 50, "max": 500 },
      "weight": 0.85
    }
  },
  "scoring": { "roleWeight": 0.30, "industryWeight": 0.25, "signalWeight": 0.30, "companySizeWeight": 0.15 },
  "goldScore": { "icpWeight": 0.45, "networkHubWeight": 0.20, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": {
    "enterprise-it": ["CIO", "IT director", "enterprise technology", "digital transformation"],
    "revops": ["revenue operations", "sales operations", "RevOps"],
    "mid-market-tech": ["IT manager", "technology leader", "software buyer"]
  }
}
```

#### Scoring Weight Recommendations by Vertical

Different verticals benefit from different scoring emphasis. Here are recommended starting weights:

| Vertical | roleWeight | industryWeight | signalWeight | companySizeWeight | Rationale |
|----------|-----------|---------------|-------------|-------------------|-----------|
| SaaS Sales Rep | 0.30 | 0.25 | 0.30 | 0.15 | Signal-heavy: evaluation/RFP signals are strong predictors |
| Executive Recruiter | 0.40 | 0.15 | 0.35 | 0.10 | Role + signal dominant: title and "hiring"/"open to" signals matter most |
| Cybersecurity / vCISO | 0.30 | 0.25 | 0.30 | 0.15 | Balanced: compliance signals as important as role |
| Financial Advisor | 0.30 | 0.20 | 0.30 | 0.20 | Company size proxy for wealth; signals for liquidity events |
| Healthcare IT | 0.35 | 0.30 | 0.25 | 0.10 | Industry critical: healthcare is a narrow vertical |
| Marketing Agency | 0.30 | 0.25 | 0.30 | 0.15 | Balanced: role, industry, and buying signals equally important |
| CRE Broker | 0.25 | 0.30 | 0.30 | 0.15 | Industry-heavy: CRE is highly vertical-specific |
| Manufacturing Consultant | 0.30 | 0.30 | 0.25 | 0.15 | Industry matters: manufacturing/supply chain is niche |

For the full set of 15 verticals with complete ICP configurations, role hierarchies, signal taxonomies, and reusable config templates, see [docs/icp-vertical-research.md](icp-vertical-research.md).

---

## 4. The /linkedin-prospector Agent

The `/linkedin-prospector` slash command is the **Pull agent** -- it handles configuration, searching, enrichment, and database management (Phases 0 and 1).

### Capabilities

| Capability | What It Does |
|------------|-------------|
| **Configure ICP** | Walks you through ICP setup conversationally, then generates config files |
| **Validate Config** | Checks config file validity |
| **Search LinkedIn** | Searches your 1st-degree connections by niche keywords |
| **Enrich Profiles** | Visits individual profile pages to extract detailed data |
| **Database Stats** | Shows contact counts, enrichment status, niche breakdown |
| **Database Search** | Queries contacts by niche, keywords, or mutual count |
| **Export** | Exports contacts as CSV or JSON |
| **Rebuild/Score** | Delegates to pipeline.mjs for graph building and scoring |
| **Reparse Cache** | Re-extracts data from cached HTML pages |

### How the Agent Works

1. **Checks the local DB first** -- Before searching LinkedIn, the agent runs `db.mjs stats` and `db.mjs search` to see if matching contacts already exist.
2. **Searches only when needed** -- If the DB lacks enough contacts, it runs `search.mjs` with the appropriate niche or keywords.
3. **Enriches profiles** -- Visits each un-enriched profile to extract headline, about, current role/company, and connection count.
4. **Caches everything** -- All LinkedIn pages are cached as raw HTML in `data/cache/` for offline re-extraction.

### Search Syntax and Options

Search by niche (using keywords from `icp-config.json`):

```
/linkedin-prospector Find me 20 ecommerce contacts
/linkedin-prospector Search for SaaS founders
```

Search by custom keywords:

```
/linkedin-prospector Search for "machine learning engineer" contacts
/linkedin-prospector Find people who work with Kubernetes
```

Underlying script options:

```bash
# By niche
node scripts/search.mjs --niche ecommerce --max-results 30 --max-pages 3

# By keywords
node scripts/search.mjs --keywords "AI,machine learning,data science" --max-results 20

# Multiple niches
node scripts/search.mjs --niche ecommerce,saas --max-results 40
```

### Enrichment Workflow

Enrichment visits each contact's individual LinkedIn profile page to extract:
- Full name
- Headline
- Location
- Current role and company
- About section
- Connection count
- Connected-on date

```
/linkedin-prospector Enrich my unenriched contacts
```

```bash
node scripts/enrich.mjs --unenriched-only --max 50
```

Rate limiting: 2-5 seconds between profile visits to avoid LinkedIn throttling.

### Database Management

```
/linkedin-prospector How many contacts do I have?
/linkedin-prospector Export my contacts as CSV
```

```bash
# Show stats
node scripts/db.mjs stats

# Search contacts
node scripts/db.mjs search --niche ecommerce
node scripts/db.mjs search --keywords "CTO,founder" --min-mutual 20

# Export
node scripts/db.mjs export --format csv
node scripts/db.mjs export --format json

# Prune stale contacts
node scripts/db.mjs prune --older-than 90d

# Seed from external JSON
node scripts/db.mjs seed --file /path/to/contacts.json
```

### HTML Cache System

All LinkedIn pages visited during search, enrichment, and deep-scan are cached as raw HTML in `data/cache/`. This provides:

- **No redundant scraping** -- Pages are only fetched once.
- **Offline re-extraction** -- If selectors change or config is updated, data can be re-extracted from cache without visiting LinkedIn again.
- **Cache statistics** -- See what is cached and when.

```bash
# Show cache stats
node scripts/reparse.mjs --stats

# Re-extract everything from cache
node scripts/reparse.mjs --all

# Re-extract profiles only
node scripts/reparse.mjs --type profiles

# Re-extract a specific profile
node scripts/reparse.mjs --url https://linkedin.com/in/someone
```

### Example Conversations

**Setting up configuration (cybersecurity consultant):**
```
User: /linkedin-prospector set up my ICP config
Agent: What services do you offer?
User: vCISO services and managed security assessments
Agent: For "vCISO services", who are your target buyers?
User: CISO, CTO, VP Engineering, IT Director at companies without a full-time CISO
Agent: What industries are your ideal customers in?
User: fintech, healthtech, SaaS startups, ecommerce
Agent: What keywords in someone's profile signal they need your services?
User: SOC 2, compliance, security audit, cyber insurance, first CISO
Agent: Config written. 2 profiles (security-budget-holder, no-ciso-company),
       3 niches. Validation passed.
       Run `/linkedin-prospector find me startup-cto contacts` to start.
```

**Setting up configuration (financial advisor):**
```
User: /linkedin-prospector set up my ICP config
Agent: What services do you offer?
User: Wealth management and retirement planning for business owners
Agent: For "Wealth management", who are your target buyers?
User: CEO, Founder, Owner, Managing Partner -- business owners with significant assets
Agent: What industries are your ideal customers in?
User: Manufacturing, construction, medical practice, professional services
Agent: What keywords would signal someone might need your services?
User: Exit planning, succession, retirement, sold my company, liquidity event
Agent: Config written. 2 profiles (hnw-prospect, center-of-influence),
       4 niches. Validation passed.
       Run `/linkedin-prospector find me business-owners contacts` to start.
```

**Searching and enriching (healthcare IT):**
```
User: /linkedin-prospector Find me 15 health-it-leaders contacts
Agent: Checked DB -- 2 existing health-it-leaders contacts. Searching
       LinkedIn for "CIO hospital", "CMIO", "health system CIO"...
       Found 16 new profiles. Total: 18 health IT contacts.
       Would you like me to enrich them?

User: /linkedin-prospector Enrich unenriched contacts
Agent: Enriching 16 unenriched profiles... Done. 16/16 enriched.

User: /linkedin-prospector How many contacts do I have?
Agent: 230 total contacts. 215 enriched, 15 unenriched.
       By niche: health-it (18), infosec (42), enterprise-it (35),
       ciso-community (28), other (107).
```

**Searching (marketing agency owner):**
```
User: /linkedin-prospector Search for CMOs at consumer goods companies
Agent: Searching LinkedIn for "CMO", "VP Marketing", "consumer goods"...
       Found 22 new profiles. 8 already in DB. Net new: 14.
```

**Rebuilding after data changes:**
```
User: /linkedin-prospector Rebuild and score everything
Agent: Running pipeline --rebuild...
       Graph: 230 contacts, 10 clusters, 612 edges
       Scoring: 15 gold, 42 silver, 68 bronze, 105 watch
       Snapshot saved.
```

---

## 5. The /network-intel Agent

The `/network-intel` slash command is the **Analyze/Report agent** -- it handles scoring, analysis, expansion, and reporting (Phases 2-4).

### All 12 Analysis Modes

#### 1. summary

Provides a high-level overview of your entire network.

**Returns:** Total contacts, tier counts, enrichment ratio, persona distribution, cluster count, company count, edge count, top 3 gold prospects, top 3 network hubs, referral tier counts, and last-scored timestamp.

```
/network-intel give me an overview
```

```bash
node scripts/analyzer.mjs --mode summary
```

#### 2. hubs

Identifies your most connected and influential contacts.

**Returns:** Contacts ranked by `networkHub` score. Each entry shows gold score, tier, role/company, mutual connection count, cluster membership, and a "why hub" explanation (high mutuals, broad niche coverage, connector role).

```
/network-intel who are my best hubs?
```

```bash
node scripts/analyzer.mjs --mode hubs --top 15
node scripts/analyzer.mjs --mode hubs --top 10 --cluster ecommerce
```

#### 3. prospects

Identifies your best potential buyers based on ICP fit.

**Returns:** Contacts ranked by `icpFit` score. Shows gold score, tier, ICP profile matches, and signal matches found in the profile.

```
/network-intel find me prospects
/network-intel show cloud-consulting prospects
```

```bash
node scripts/analyzer.mjs --mode prospects --top 10
node scripts/analyzer.mjs --mode prospects --icp cloud-consulting --top 20
node scripts/analyzer.mjs --mode prospects --tier gold
```

#### 4. recommend

Provides strategic action recommendations across multiple dimensions.

**Returns:** Five sections:
1. **Immediate Pursuit** -- Top gold-tier buyers to contact now
2. **Hub Activation** -- Top hubs to ask for introductions, with reachable gold buyer counts
3. **Cluster Opportunities** -- Gap analysis per cluster showing where you need more gold contacts
4. **Quick Wins** -- Silver-tier contacts close to gold (high relationship + decent ICP fit)
5. **Referral Partnerships** -- Top referral partners with suggested actions per persona
6. **Enrich Next** -- Prioritized unenriched contacts (by mutual count)

```
/network-intel what should I focus on next?
```

```bash
node scripts/analyzer.mjs --mode recommend
```

#### 5. clusters

Maps your network by industry/niche clusters.

**Returns:** Each cluster with contact count, tier distribution, top hub, top prospect, and top companies within the cluster.

```
/network-intel show me clusters
```

```bash
node scripts/analyzer.mjs --mode clusters
```

#### 6. company

Deep-dive into a specific company's contacts in your network.

**Returns:** All contacts at the company ranked by gold score, with tier, ICP fit, and persona information.

```
/network-intel show me contacts at Acme Corp
```

```bash
node scripts/analyzer.mjs --mode company --name "Acme Corp"
```

#### 7. behavioral

Ranks contacts by behavioral score -- how active, connected, and engaged they are.

**Returns:** Contacts ranked by behavioral score with persona label, connection count, trait count, about/headline/super-connector signals, amplification score, and recency.

```
/network-intel who are the most active networkers?
/network-intel show me super-connectors
```

```bash
node scripts/analyzer.mjs --mode behavioral --top 20
node scripts/analyzer.mjs --mode behavioral --persona super-connector
node scripts/analyzer.mjs --mode behavioral --persona content-creator --top 10
```

#### 8. visibility

Content strategy recommendations based on network position and behavioral analysis.

**Returns:** Six sections:
1. **Engage Their Content** -- Super-connectors whose posts you should comment on
2. **Post Topics Targeting Clusters** -- Cluster-by-cluster amplifier counts and suggested topics
3. **Company Beachheads** -- Companies with 3+ contacts (internal amplification potential)
4. **Bridge Connectors** -- Contacts spanning 3+ clusters who amplify across communities
5. **Rising Stars** -- Recently connected contacts with high behavioral potential
6. **Silent Influencers** -- Contacts with 500+ connections but low engagement (dormant amplifiers)

```
/network-intel content visibility strategy
```

```bash
node scripts/analyzer.mjs --mode visibility
```

#### 9. employers

Ranks companies by their "Employer Network Value" (ENV) -- a composite of contact count, behavioral scores, mutual connections, gold percentage, and cluster breadth.

**Returns:** Companies ranked by ENV with contact count, gold count/percentage, average behavioral score, average mutuals, cluster coverage, and top contact.

```
/network-intel which companies have the best network value?
```

```bash
node scripts/analyzer.mjs --mode employers --top 15
```

#### 10. referrals

Identifies your best referral partners -- people who can send you business.

**Returns:** Contacts ranked by referral likelihood with referral tier, persona, gold score, all 6 component scores, and a "why referral" explanation showing which factors are strongest.

```
/network-intel who are my best referral partners?
/network-intel show me white-label partners
```

```bash
node scripts/analyzer.mjs --mode referrals --top 20
node scripts/analyzer.mjs --mode referrals --persona white-label-partner
node scripts/analyzer.mjs --mode referrals --persona warm-introducer
node scripts/analyzer.mjs --mode referrals --tier gold-referral
```

#### 11. similar

Finds contacts whose profiles are most similar to a specific person using k-NN vector search. Requires ruvector and a built vector store.

**Returns:** Contacts ranked by cosine similarity to the target contact's profile vector, with tier and headline.

```
/network-intel find contacts similar to https://linkedin.com/in/someone
```

```bash
node scripts/analyzer.mjs --mode similar --url "https://linkedin.com/in/someone" --top 20
```

#### 12. semantic

Searches for contacts by natural language description. Embeds your query and finds the most relevant profiles by meaning, not exact keywords.

**Returns:** Contacts ranked by relevance (cosine similarity) to the query text.

```
/network-intel who talks about AI transformation?
/network-intel search for people in cloud infrastructure
```

```bash
node scripts/analyzer.mjs --mode semantic --query "AI transformation leaders" --top 20
node scripts/analyzer.mjs --mode semantic --query "cloud infrastructure scaling" --top 15
```

For detailed documentation on the semantic search system, see [semantic-search-guide.md](semantic-search-guide.md).

### Pipeline Modes

See [Section 7: Pipeline Reference](#7-pipeline-reference) for complete details.

### Deep-Scan and Network Expansion

Deep-scan discovers contacts beyond your 1st-degree network by scanning a contact's connection list.

```
/network-intel deep scan https://linkedin.com/in/someone
/network-intel expand my network through referral partners
/network-intel deep scan the top hubs
```

```bash
# Single contact deep-scan
node scripts/deep-scan.mjs --url https://linkedin.com/in/someone

# Batch deep-scan by criteria
node scripts/batch-deep-scan.mjs --criteria referral --dry-run
node scripts/batch-deep-scan.mjs --criteria gold --max-targets 5
node scripts/batch-deep-scan.mjs --criteria hub --min-score 0.5
node scripts/batch-deep-scan.mjs --criteria all --dry-run
```

### Delta Tracking

Track changes in your network over time.

```
/network-intel any new connections since last time?
/network-intel save a snapshot
```

```bash
# Create a snapshot of current state
node scripts/delta.mjs --snapshot

# Compare current state vs. last snapshot
node scripts/delta.mjs --check

# List all snapshots
node scripts/delta.mjs --list
```

The delta report shows:
- New contacts added since last snapshot
- Contacts removed/disconnected
- Tier changes (e.g., contacts that moved from silver to gold)
- Recommendations for what to do next (enrich, rescore, etc.)

### Report Generation

```
/network-intel generate a report
```

```bash
node scripts/pipeline.mjs --report
```

This generates `data/network-report.html` -- an interactive HTML dashboard with:
- 3D network graph visualization
- Chart.js tier and persona distribution charts
- Sortable contact tables
- Cluster views

### Example Conversations

**Strategic overview:**
```
User: /network-intel what should I focus on next?
Agent: Running strategic recommendations...

       IMMEDIATE PURSUIT (Gold Buyers):
       1. Jane Smith (goldScore: 0.72) - VP Engineering @ TechCorp
       2. Alex Chen (goldScore: 0.68) - CTO @ DataFlow

       HUB ACTIVATION:
       1. Maria Garcia (networkHub: 0.81) - Managing Partner @ ConsultCo
          Clusters: saas, ecommerce | Gold buyers reachable: ~4

       REFERRAL PARTNERSHIPS:
       1. Sam Taylor (ref: 0.71, gold-referral) - Agency Founder
          Persona: white-label-partner | Action: Propose white-label arrangement

       QUICK WINS (Silver, Near Gold):
       1. Pat Johnson (goldScore: 0.52, icpFit: 0.48) - Director Eng @ GrowthCo
```

**Referral analysis:**
```
User: /network-intel who can bring me work?
Agent: Running referral analysis...

       TOP 10 REFERRAL PARTNERS:
       1. Maria Garcia (referral: 0.71, gold-referral)
          Agency Founder @ ConsultCo
          Persona: white-label-partner
          Why referral: Agency/partner role; Serves target industries (ecommerce, saas);
                       Broad network (500+ conn, 4 clusters)

       Referral Tier Breakdown:
         gold-referral     8
         silver-referral  23
         bronze-referral  34
```

**Behavioral analysis:**
```
User: /network-intel show me super-connectors
Agent: Running behavioral analysis (super-connector filter)...

       TOP 15 by Behavioral Score [super-connector]:
       1. Chris Lee (behavioral: 0.68, goldScore: 0.55, tier: gold)
          Community Builder | Tech Ecosystem
          Persona: super-connector | Connections: 500+ | Traits: 5
          Signals: About: connector, community, mentor | Headline: multi-role
          Amplification: 0.72 | Recency: 45d ago
```

---

## 6. Scoring Engine Deep Dive

### Layer 1: ICP + Gold Score (scorer.mjs)

The first scoring layer evaluates how well each contact matches your Ideal Customer Profile and computes a composite Gold Score.

#### ICP Fit Score (0-1)

ICP Fit measures how well a contact matches your defined buyer profiles. It consists of four weighted components:

| Component | Default Weight | How It Works |
|-----------|---------------|--------------|
| **roleLevel** | 0.35 | Matches contact's role against `rolePatterns`. High match (CEO, CTO) = 1.0, Medium (VP, Director) = 0.7, Low (Manager) = 0.3, No match = 0.1. Uses partial string matching. |
| **industryMatch** | 0.25 | Counts industry keyword matches in the contact's text (headline, about, role). 2+ matches = 1.0, 1 match = 0.5, 0 = 0.0. |
| **signalMatch** | 0.25 | Proportion of buying signal keywords found in the contact's text. |
| **companySize** | 0.15 | Defaults to 0.5 (company size data is not directly available from LinkedIn search results). |

When multiple ICP profiles exist, the contact is scored against all of them and the highest score (weighted by profile weight) is used.

A contact is assigned to an ICP category if their fit score for that profile is >= 0.4.

#### Network Hub Score (0-1)

Measures how well-connected and central the contact is in your network.

| Component | Weight | How It Works |
|-----------|--------|--------------|
| **Mutual connections** | 0.30 | Normalized against the P90 (90th percentile) of all mutual connection counts. |
| **Cluster breadth** | 0.25 | Number of clusters the contact belongs to, divided by total active clusters. |
| **Connector index** | 0.25 | Role-based: partner/consultant/advisor = 1.0, CEO/founder = 0.7, director/VP = 0.5, other = 0.2. |
| **Edge density** | 0.20 | Number of graph edges for this contact, normalized against the max. |

#### Relationship Strength Score (0-1)

Measures the warmth and recency of your connection.

| Component | Weight | How It Works |
|-----------|--------|--------------|
| **Mutual connections** | 0.40 | Normalized against the max mutual count across all contacts. |
| **Search term overlap** | 0.20 | How many of your search terms matched this contact, normalized. |
| **Recency** | 0.20 | Based on when the contact was last cached: <7 days = 1.0, <30 days = 0.7, <90 days = 0.4, else = 0.2. |
| **Proximity** | 0.20 | Location in a major metro area (+0.5) and industry overlap with ICP (+0.5). |

#### Signal Boost (0-1)

Detects high-intent signals in the contact's headline or about section. Currently checks for "ai", "automation", "scaling", "growth". Returns 1.0 if found in headline, 0.5 if found in about, 0.0 otherwise.

#### Gold Score (0-1)

The composite score that determines the contact's tier:

```
goldScore = icpFit * 0.35 + networkHub * 0.30 + relationship * 0.25 + signalBoost * 0.10
```

(Weights are configurable in `goldScore` section of `icp-config.json`.)

#### Tier Assignment

Based on goldScore thresholds (configurable in `tiers`):

| Tier | Default Threshold | Meaning |
|------|-------------------|---------|
| **gold** | >= 0.55 | Top prospects -- pursue immediately |
| **silver** | >= 0.40 | Good prospects -- nurture relationship |
| **bronze** | >= 0.28 | Some potential -- monitor and engage |
| **watch** | < 0.28 | Low priority -- passive awareness |

#### ICP Persona Assignment

Based on score composition:

| Persona | Criteria |
|---------|----------|
| **buyer** | icpFit >= 0.6 AND goldScore >= 0.5 |
| **advisor** | Connector index >= 0.8 (partner/consultant/advisor role) |
| **hub** | networkHub >= 0.6 AND icpFit < 0.5 |
| **peer** | Role matches engineer/developer/architect |
| **referral-partner** | Default (none of the above) |

### Layer 2: Behavioral Scoring (behavioral-scorer.mjs)

The behavioral layer analyzes how active, connected, and engaged each contact is. It runs after Layer 1 and updates the Gold Score to a "v2" that includes behavioral weight.

#### Six Components

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| **connectionPower** | 0.20 | LinkedIn connection/follower count. 500+ = 1.0, 300+ = 0.7, 100+ = 0.4, <100 = 0.1. Follower mode (creator mode) applies a 0.8 multiplier. |
| **connectionRecency** | 0.15 | Days since you connected. <30d = 1.0, <90d = 0.7, <180d = 0.4, <365d = 0.2, older = 0.1. |
| **aboutSignals** | 0.25 | Scans about section for 8 keyword categories: connector, speaker, mentor, builder, helper, thought-leader, community, teacher. Score is proportion of categories matched. |
| **headlineSignals** | 0.15 | Detects four patterns in headline: multi-role (pipe separators = 0.7), helping-language (0.6), credentials (0.4), creator-mode (0.8). Blends max and average for multi-match bonus. |
| **superConnectorIndex** | 0.15 | Counts behavioral traits from about signals, headline patterns, and connection power. Score is traits / 5 (capped at 1.0). 3+ traits qualifies as super-connector. |
| **networkAmplifier** | 0.10 | Mutual connections (normalized) times connection power. Measures potential to amplify your content. |

#### Gold Score v2

After behavioral scoring, the Gold Score is recomputed with different weights:

```
goldScoreV2 = icpFit * 0.30 + networkHub * 0.25 + relationship * 0.20
            + behavioral * 0.15 + signalBoost * 0.10
```

Tiers are reassigned based on the v2 score. The v1 Gold Score is preserved as `goldScoreV1`.

#### Five Behavioral Personas

| Persona | Detection Criteria |
|---------|-------------------|
| **super-connector** | 3+ behavioral traits AND 500+ connections. These are the most active and connected people in your network. |
| **content-creator** | Speaker, author, writer, keynote, podcast, published, or content creator keywords in about/headline. These people create visible content. |
| **silent-influencer** | 500+ connections but 0-1 about signal categories. Large network but low visible activity -- dormant amplifiers. |
| **rising-connector** | <500 connections AND connected in the last 180 days. Newer connections with growth potential. |
| **passive-network** | Default. No strong behavioral signals detected. |

### Layer 3: Referral Scoring (referral-scorer.mjs)

The referral layer identifies contacts who can refer business to you (as opposed to being buyers themselves). It runs after Layer 2.

#### Six Components

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| **referralRole** | 0.25 | Role-based referral potential. High (1.0): agency, partner, fractional, advisor, white-label, reseller, alliance. Medium (0.7): consultant, freelance, broker, community manager, partnerships, account executive. Low (0.3): manager, director, founder, VP. |
| **clientOverlap** | 0.20 | Whether they serve the same industries you target. Combines industry keyword overlap (60%) with service-provider signals (40%). 3+ industry matches = 1.0. |
| **networkReach** | 0.20 | Connection count normalized against 500, cluster breadth, and edge density. Weighted: connections 0.3, cluster breadth 0.4, edge density 0.3. |
| **amplificationPower** | 0.15 | Super-connector traits (+0.4 for 3+, partial credit for fewer), helping/connecting language (+0.3 for 2+), and content creation signals (+0.3). |
| **relationshipWarmth** | 0.10 | Mutual connections (35%), existing relationship strength from Layer 1 (35%), and connection recency (30%). |
| **buyerInversion** | 0.10 | Inverse of ICP fit (low ICP = high inversion, meaning they are an ecosystem partner, not a buyer) combined with ecosystem keywords (partner, community, alliance, etc.). Only scores high if BOTH low ICP fit AND ecosystem presence. |

#### Referral Tier Assignment

| Tier | Threshold | Meaning |
|------|-----------|---------|
| **gold-referral** | >= 0.65 | Strong referral partner -- prioritize the relationship |
| **silver-referral** | >= 0.45 | Good referral potential -- deepen the relationship |
| **bronze-referral** | >= 0.30 | Some referral potential -- stay connected |
| *(none)* | < 0.30 | Low referral potential |

#### Five Referral Personas

| Persona | Detection Criteria | What They Do |
|---------|-------------------|-------------|
| **white-label-partner** | Referral role >= 0.7 AND client overlap >= 0.4 AND role matches (agency, consultancy, partner, solutions, services, implementation, white label, reseller) | Agency/consultancy that can resell your services to their clients |
| **warm-introducer** | Relationship warmth >= 0.5 AND network reach >= 0.5 | Strong relationship + broad network -- makes warm intros to decision-makers |
| **co-seller** | Client overlap >= 0.5 AND role matches (consultant, advisor, freelance, fractional, independent) | Consultant/advisor serving overlapping clients -- mutual referral arrangements |
| **amplifier** | Amplification power >= 0.5 OR behavioral persona is super-connector/content-creator | Super-connector or content creator who amplifies your brand |
| **passive-referral** | Default (none of the above) | Has some referral potential, needs relationship deepening |

### How Scores Compose and Interact

The three layers build on each other sequentially:

1. **Layer 1** runs first: computes ICP fit, network hub, relationship, signal boost, and Gold Score v1. Assigns ICP tier and persona.

2. **Layer 2** runs second: computes 6 behavioral components and a behavioral score. Recomputes Gold Score to v2 (which includes behavioral weight). Reassigns tiers. Assigns behavioral persona. Note: Layer 2 requires Layer 1 scores to exist.

3. **Layer 3** runs third: computes 6 referral components and a referral likelihood score. Assigns referral tier and persona. Uses data from both Layer 1 (ICP fit, relationship strength) and Layer 2 (behavioral persona, trait counts, connection counts). Note: Layer 3 requires Layer 2 scores to exist.

The dependency chain is enforced by the pipeline's dependency guards.

---

## 7. Pipeline Reference

The pipeline orchestrator (`pipeline.mjs`) runs multi-step workflows. It enforces dependency guards -- if an upstream step fails, downstream steps that depend on it are automatically skipped.

### All Pipeline Modes

| Mode | Steps | When to Use |
|------|-------|-------------|
| `--full` | search -> enrich -> graph -> score -> behavioral -> referral -> analyze -> snapshot | First-time setup. Combine with `--niche <name>` to filter the search. |
| `--rebuild` | graph -> score -> behavioral -> referral -> analyze -> snapshot | After data changes (new contacts, enrichment, deep-scans, config changes). **This is the default mode.** |
| `--rescore` | score -> behavioral -> referral -> analyze | After config weight/threshold changes when the graph structure has not changed. Faster than rebuild. |
| `--behavioral` | behavioral -> analyze(behavioral) -> analyze(visibility) | Run behavioral analysis only. Useful when you only care about behavioral personas and visibility strategy. |
| `--referrals` | referral-scorer -> analyze(referrals) | Run referral analysis only. Requires behavioral scores to exist. |
| `--report` | report-generator | Generate the HTML dashboard from existing graph.json. No scoring. |
| `--deep-scan` | deep-scan -> graph -> score -> behavioral -> referral -> report | Deep-scan a contact (use with `--url`) then rebuild and regenerate report. |
| `--configure` | (prints instructions) | Tells you to use `configure.mjs wizard` or `generate` directly. Cannot be run non-interactively via pipeline. |
| `--validate` | configure validate | Validates `icp-config.json`. |
| `--reparse` | reparse --all | Re-extracts data from all cached HTML pages. |

### Options

| Option | Description |
|--------|-------------|
| `--niche <name>` | Filter niche for the search step (`--full` mode only). |
| `--url <linkedin-url>` | Target URL for `--deep-scan` mode. |
| `--verbose` | Pass-through to sub-scripts for detailed logging. |
| `--top <N>` | Passed to analyzer for result limits. |
| `--output <path>` | Output path for report. |

### Dependency Guards

The pipeline tracks whether each step succeeded:

- If `graph-builder.mjs` fails, `scorer.mjs` is skipped (it depends on `graph.json`).
- If `scorer.mjs` fails, `behavioral-scorer.mjs` is skipped (it depends on Layer 1 scores).
- If `behavioral-scorer.mjs` fails, `referral-scorer.mjs` is skipped (it depends on Layer 2 scores).

Failed or skipped steps are clearly marked in the pipeline summary output.

### Example Output

```
######################################################
  Network Intelligence Pipeline
  Mode: rebuild
######################################################

============================================================
  STEP: graph-builder.mjs
============================================================
  -> completed in 2.3s

============================================================
  STEP: scorer.mjs
============================================================
  -> completed in 1.1s

  ...

============================================================
  Pipeline Summary
============================================================
  [OK     ] graph-builder.mjs
  [OK     ] scorer.mjs
  [OK     ] behavioral-scorer.mjs
  [OK     ] referral-scorer.mjs
  [OK     ] analyzer.mjs --mode summary
  [OK     ] delta.mjs --snapshot

  Total: 6 steps | 6 passed | 0 failed | 0 skipped
  Elapsed: 8.7s
```

---

## 8. Building and Growing Your Dataset

### Initial Pull Strategy

Start with your strongest niches -- the areas where you already have the most connections:

1. **Run database stats** to see what you already have:
   ```bash
   node scripts/db.mjs stats
   ```

2. **Search your top 2-3 niches** with moderate limits:
   ```bash
   node scripts/search.mjs --niche ecommerce --max-results 30
   node scripts/search.mjs --niche saas --max-results 30
   ```

3. **Enrich all contacts** to get full profile data:
   ```bash
   node scripts/enrich.mjs --unenriched-only --max 100
   ```

4. **Build and score**:
   ```bash
   node scripts/pipeline.mjs --rebuild
   ```

### When to Enrich vs. Search More

- **Enrich first** if you have unenriched contacts. Enriched data dramatically improves scoring accuracy.
- **Search more** if your current contacts do not adequately cover a niche. Check `analyzer.mjs --mode clusters` to see coverage gaps.
- **Re-enrich** (via reparse) if you changed ICP config and need to re-extract signals from cached profiles.

### Deep-Scan Strategy

Deep-scan reveals 2nd-degree contacts by scanning a contact's connection list. This is LinkedIn's most powerful growth lever, but it is rate-limited.

**Who to deep-scan first:**

1. **Gold-tier contacts** -- Their connections are likely relevant to your ICP.
2. **Gold-referral partners** -- Their connections include your potential buyers.
3. **Top hubs** -- They bridge multiple clusters and have the broadest reach.

Preview before executing:

```bash
node scripts/batch-deep-scan.mjs --criteria referral --dry-run
```

### Batch Deep-Scan Criteria Modes

| Criteria | Who Gets Scanned |
|----------|-----------------|
| `gold` | All gold-tier contacts, plus top 5 by ICP fit, network hub, behavioral, and relationship (non-gold). Default. |
| `referral` | Gold-referral tier first, then warm-introducers and white-label partners, then top silver-referral contacts. |
| `hub` | Top 10 contacts by network hub score. |
| `all` | Gold-tier, gold-referral, top hubs, top ICP, top behavioral, top relationship. Most comprehensive but slowest. |

**Options:**

```bash
node scripts/batch-deep-scan.mjs --criteria referral \
  --min-score 0.5 \        # Minimum score for inclusion
  --max-pages 3 \          # Pages per scan (conservative)
  --max-results 50 \       # Max connections per scan
  --delay 10 \             # Seconds between scans
  --skip 3 \               # Resume after interruption
  --dry-run                # Preview without executing
```

After batch scanning, the script automatically rebuilds the graph, re-scores, and regenerates the report.

### Delta Tracking Workflow

Use delta tracking to monitor how your network changes over time:

1. **Create a snapshot** after each major update:
   ```bash
   node scripts/delta.mjs --snapshot
   ```
   The `--rebuild` pipeline mode does this automatically.

2. **Check for changes** before your next session:
   ```bash
   node scripts/delta.mjs --check
   ```

3. **Review the delta report** -- It shows new contacts, removed contacts, tier changes, and recommendations.

4. **Act on recommendations** -- Enrich new contacts, rescore after changes.

### Re-Parsing from Cache

If you change your ICP config (new role patterns, industries, signals) or if the LinkedIn page structure changes, you can re-extract data from the HTML cache without visiting LinkedIn again:

```bash
# Re-extract all cached pages
node scripts/reparse.mjs --all

# Re-extract only profiles
node scripts/reparse.mjs --type profiles

# Check what is cached
node scripts/reparse.mjs --stats
```

After re-parsing, run `--rebuild` to apply the updated data.

---

## 9. Tuning Your Scoring

### How to Review Score Distributions

After building and scoring your graph, review the distributions:

```bash
# Summary with tier counts
node scripts/analyzer.mjs --mode summary

# Check top prospects
node scripts/analyzer.mjs --mode prospects --top 30

# Check top referral partners
node scripts/analyzer.mjs --mode referrals --top 30

# Check behavioral personas
node scripts/analyzer.mjs --mode behavioral --top 30
```

Manually review the top 10 gold contacts. Ask: "Are these actually my best prospects?" If not, your scoring needs adjustment.

### Common Adjustments

#### Too many gold contacts

Your thresholds are too low.

**Before:** `"tiers": { "gold": 0.40, "silver": 0.28, "bronze": 0.15 }`
- Result: 45 gold contacts, many are marginal

**After:** `"tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 }`
- Result: 12 gold contacts, all strong prospects

#### Too few gold contacts

Your thresholds are too high, or ICP patterns are too narrow.

**Before:** `"rolePatterns": { "high": ["CEO"], "medium": ["CTO"], "low": [] }`
- Result: Only 3 contacts match

**After:** `"rolePatterns": { "high": ["CEO", "Founder", "CTO", "President"], "medium": ["VP", "Director", "Head of"], "low": ["Manager", "Lead"] }`
- Result: 25 contacts match across tiers

#### Wrong people flagged as referral partners

Narrow the role patterns in `referral-config.json`.

**Before:** High referral role includes "manager", "director" -- too broad
**After:** Move "manager" and "director" to low tier, keep only "agency", "partner", "advisor", "consultant" in high

#### Buyers showing up as referral partners

The buyer inversion weight is too low.

**Before:** `"buyerInversion": 0.10`
**After:** `"buyerInversion": 0.20` (increase from 0.10 to 0.20, reduce another weight to compensate)

#### Network hubs not getting enough credit

Increase the network hub weight in the Gold Score.

**Before:** `"goldScore": { "icpWeight": 0.35, "networkHubWeight": 0.20, ... }`
**After:** `"goldScore": { "icpWeight": 0.30, "networkHubWeight": 0.30, ... }`

### Weight Tuning Guide

All weight groups must sum to 1.0.

**ICP Fit weights** (`scoring` in `icp-config.json`):

| Weight | Default | Increase if... | Decrease if... |
|--------|---------|----------------|----------------|
| `roleWeight` | 0.35 | Role is the strongest indicator of buyer fit | You sell horizontal products/services where role matters less |
| `industryWeight` | 0.25 | You serve specific verticals | You serve all industries |
| `signalWeight` | 0.25 | Your signals are highly specific and accurate | Your signals are generic |
| `companySizeWeight` | 0.15 | Company size is critical (enterprise-only, SMB-only) | You serve all sizes |

**Gold Score weights** (`goldScore` in `icp-config.json` for v1, `goldScoreV2` in `behavioral-config.json` for v2):

| Weight | v1 Default | v2 Default | Increase if... |
|--------|-----------|-----------|----------------|
| `icpWeight` | 0.35 | 0.30 | You want to prioritize buyer fit over connections |
| `networkHubWeight` | 0.30 | 0.25 | Introductions matter more than direct outreach |
| `relationshipWeight` | 0.25 | 0.20 | Warm relationships are your primary channel |
| `behavioralWeight` | n/a | 0.15 | Active networkers convert better for you |
| `signalBoostWeight` | 0.10 | 0.10 | Intent signals are strong predictors |

**Referral weights** (`weights` in `referral-config.json`):

| Weight | Default | Increase if... |
|--------|---------|----------------|
| `referralRole` | 0.25 | Agency/partner roles are the strongest referral indicator |
| `clientOverlap` | 0.20 | Industry overlap is critical for relevant referrals |
| `networkReach` | 0.20 | Reach matters more than role |
| `amplificationPower` | 0.15 | Content amplification drives your leads |
| `relationshipWarmth` | 0.10 | You only want referrals from warm contacts |
| `buyerInversion` | 0.10 | You need to better separate buyers from referrers |

### Tier Threshold Adjustment

After adjusting weights, rescore and check the distribution:

```bash
node scripts/pipeline.mjs --rescore
```

Aim for these rough distributions as a starting point:

| Tier | Target % | Too many means... | Too few means... |
|------|----------|-------------------|------------------|
| Gold | 5-15% | Thresholds too low | Thresholds too high or ICP too narrow |
| Silver | 15-25% | Consider raising silver threshold | Consider lowering silver threshold |
| Bronze | 25-35% | Normal | ICP may be too broad |
| Watch | 30-50% | Normal | Thresholds may be too low overall |

### Persona Sensitivity Tuning

**Behavioral personas** (edit `behavioral-config.json`):
- Adjust `superConnectorIndex.minTraits` (default: 3) -- lower to detect more super-connectors.
- Adjust `behavioralPersonas.super-connector.minConnections` (default: 500) -- lower if your network has fewer high-connection contacts.
- Adjust `behavioralPersonas.rising-connector.recencyDays` (default: 180) -- lower for stricter recency.

**Referral personas** (edit `referral-config.json`):
- Adjust `personas.white-label-partner.requires.minReferralRole` (default: 0.7) -- lower to include more white-label partners.
- Adjust `personas.warm-introducer.requires.minRelationshipWarmth` (default: 0.5) -- lower to include more warm introducers.
- Adjust `referralTiers` thresholds to change how many contacts appear in each referral tier.

---

## 10. Troubleshooting

### Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Browser not found` | Playwright Chromium not installed | Run `npx playwright install chromium` |
| `Not logged in` | LinkedIn session expired | Launch browser manually, log into LinkedIn, close browser: `node -e "import('playwright').then(p => p.chromium.launchPersistentContext('.browser-data', {headless:false, channel:'chromium'}))"` |
| `No contacts found` | Empty database | Run a search first: `node scripts/search.mjs --niche <niche>`, or seed the DB: `node scripts/db.mjs seed --file <path>` |
| `graph.json not found` | Graph has not been built | Run `node scripts/pipeline.mjs --rebuild` |
| `Config is example template` | ICP config not customized | Run `node scripts/configure.mjs wizard` to customize for your business |
| `referral-scorer failed` | Missing behavioral scores | Run `--rebuild` (not `--referrals` alone) to ensure all upstream scoring completes |
| `Contacts not scored yet` | Scorer needs graph.json | Run graph-builder first, then scorer |
| `Behavioral scores not found` | Behavioral scorer needs Layer 1 | Run scorer.mjs before behavioral-scorer.mjs, or use `--rebuild` |

### LinkedIn Rate Limiting

LinkedIn may temporarily throttle or block automated access. Signs include:
- Empty search results when results should exist
- "No results found" on search pages
- Profile pages showing limited data
- CAPTCHA challenges

**Prevention:**
- Keep `--max-pages` at 3 or lower for searches
- Keep `--delay` at 10+ seconds for batch deep-scans
- The browser runs `headless: false` (visible window) to reduce detection
- `--disable-blink-features=AutomationControlled` is set automatically

**Recovery:**
- Wait 30-60 minutes before trying again
- If persistent, re-establish your LinkedIn session (Step 2 from Getting Started)
- Use `reparse.mjs` to re-extract data from already cached pages without hitting LinkedIn

### Browser Session Issues

**Session expired:** Re-launch the persistent browser and log in again.

**Multiple sessions:** Only one Playwright instance can use `.browser-data/` at a time. Close any open browser instances before running scripts.

**Different browser data directory:** Set the `BROWSER_DATA_DIR` environment variable:
```bash
export BROWSER_DATA_DIR=/path/to/your/browser-data
```

### Missing Data Scenarios

**Contacts exist but have no scores:** Run `node scripts/pipeline.mjs --rebuild`.

**Contacts are not enriched (headline/about missing):** Run `node scripts/enrich.mjs --unenriched-only --max 100`.

**Graph shows few edges/clusters:** You may not have enough contacts. Search for more contacts in different niches, or deep-scan existing contacts to discover 2nd-degree connections.

**Referral analysis shows all passive-referral:** Your referral config role patterns may be too narrow. Review and broaden `roleTiers.high` and `roleTiers.medium` in `referral-config.json`.

**Deep-scan finds no connections:** The target contact may have their connections set to private. Try a different contact.

---

## 11. Script Reference

All scripts are located in `.claude/linkedin-prospector/skills/linkedin-prospector/scripts/`.

### lib.mjs

**Purpose:** Shared utilities used by all other scripts.

**Exports:**
- `launchBrowser()` -- Launches a persistent Playwright Chromium context using `BROWSER_DATA_DIR` (defaults to `.browser-data/`). Returns `{ context, page }`.
- `parseArgs(argv)` -- Parses CLI arguments into a key-value object. Supports `--key value` and `--flag`.
- `NICHE_KEYWORDS` -- Niche-to-keyword mappings loaded from `icp-config.json`, with hardcoded fallback defaults.
- `USER_DATA_DIR` -- Resolved browser data directory path.

### db.mjs

**Purpose:** Contact database management. Both a library (imported by other scripts) and a CLI tool.

**Library exports:**
- `load(dbPath?)` -- Load contacts DB from disk. Creates empty DB if missing.
- `save(db, dbPath?)` -- Save DB, updating `meta.totalContacts` and `meta.lastUpdated`.
- `find(db, filters)` -- Find contacts matching filters: `niche`, `enriched`, `minMutual`, `keywords`.
- `merge(db, newProfiles, searchTerm?)` -- Merge new profiles into DB, deduplicating by profileUrl.

**CLI commands:**

```bash
node scripts/db.mjs stats
node scripts/db.mjs search --niche <niche> [--min-mutual N] [--keywords "k1,k2"] [--enriched true|false]
node scripts/db.mjs export --format csv|json [--niche <niche>]
node scripts/db.mjs prune --older-than 90d
node scripts/db.mjs seed --file <path>
```

### search.mjs

**Purpose:** Searches your 1st-degree LinkedIn connections by niche keywords.

**What it does:**
1. Resolves search terms from `--niche` (via NICHE_KEYWORDS) or `--keywords`
2. Opens LinkedIn search filtered to 1st-degree connections
3. Scrolls through result pages, extracting profile data via DOM queries
4. Caches each search results page as raw HTML
5. Deduplicates results by profileUrl
6. Merges into contacts.json

**Options:**

```bash
node scripts/search.mjs --niche <niche> [--max-pages 3] [--max-results 50] [--json]
node scripts/search.mjs --keywords "k1,k2" [--max-pages 3] [--max-results 50]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--niche <name>` | (required*) | Niche slug from icp-config.json. Comma-separated for multiple. |
| `--keywords "k1,k2"` | (required*) | Raw search keywords. Alternative to `--niche`. |
| `--max-pages <N>` | 3 | Maximum LinkedIn search result pages to scroll per term. |
| `--max-results <N>` | 50 | Maximum total unique results to collect. |
| `--json` | false | Output results as JSON to stdout. |

### enrich.mjs

**Purpose:** Visits individual LinkedIn profile pages to extract detailed data (headline, about, current role/company, connection count, connected-on date).

**Options:**

```bash
node scripts/enrich.mjs --unenriched-only [--max 50]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--unenriched-only` | false | Only enrich contacts that have not been enriched yet. |
| `--max <N>` | 50 | Maximum profiles to enrich in this run. |

Rate-limited with 2-5 second delays between profile visits.

### graph-builder.mjs

**Purpose:** Builds the knowledge graph from `contacts.json`. Creates nodes, edges, clusters, and company aggregations. Writes to `graph.json`.

**What it creates:**
- **Contacts** -- All contacts as graph nodes with their profile data
- **Edges** -- 5 edge types connecting contacts (same company, same cluster, mutual connections, same search terms, discovered-via)
- **Clusters** -- 10 industry/niche clusters based on keyword matching
- **Companies** -- Company aggregations with contact lists

```bash
node scripts/graph-builder.mjs [--verbose]
```

### scorer.mjs

**Purpose:** Layer 1 scoring. Computes ICP fit, network hub, relationship strength, signal boost, Gold Score v1, tier, persona, categories, and tags for every contact. Writes results into `graph.json`.

**Requires:** `graph.json` (from graph-builder.mjs) and `icp-config.json`.

```bash
node scripts/scorer.mjs [--verbose]
```

### behavioral-scorer.mjs

**Purpose:** Layer 2 scoring. Computes 6 behavioral components, behavioral score, behavioral persona, and Gold Score v2 for every contact. Writes results into `graph.json`.

**Requires:** `graph.json` with Layer 1 scores (from scorer.mjs), `behavioral-config.json`, and `icp-config.json`.

```bash
node scripts/behavioral-scorer.mjs [--verbose]
```

### referral-scorer.mjs

**Purpose:** Layer 3 scoring. Computes 6 referral components, referral likelihood, referral tier, and referral persona for every contact. Writes results into `graph.json`.

**Requires:** `graph.json` with Layer 2 scores (from behavioral-scorer.mjs), `referral-config.json`, and `icp-config.json`.

```bash
node scripts/referral-scorer.mjs [--verbose]
```

### analyzer.mjs

**Purpose:** Queries and analyzes the scored graph. Supports 12 analysis modes.

**Requires:** `graph.json` (with scores). `similar` and `semantic` modes also require ruvector and a built vector store.

```bash
node scripts/analyzer.mjs --mode <mode> [--top N] [--icp <profile>] [--persona <type>] [--tier <tier>] [--cluster <id>] [--name "<company>"] [--url <profile-url>] [--query "text"]
```

| Option | Used By | Description |
|--------|---------|-------------|
| `--mode <mode>` | all | Analysis mode: summary, hubs, prospects, recommend, clusters, company, behavioral, visibility, employers, referrals, similar, semantic |
| `--top <N>` | hubs, prospects, behavioral, employers, referrals | Number of results to return (default varies by mode: 10-20) |
| `--icp <profile>` | prospects | Filter by ICP profile slug |
| `--persona <type>` | behavioral, referrals | Filter by persona (e.g., super-connector, white-label-partner) |
| `--tier <tier>` | prospects, referrals | Filter by tier (e.g., gold, gold-referral) |
| `--cluster <id>` | hubs, visibility | Filter by cluster ID |
| `--name "<company>"` | company | Company name to search for |
| `--url <profile-url>` | similar | Target contact's profile URL for similarity search |
| `--query "text"` | semantic | Free-text search query for semantic search |

### vectorize.mjs

**Purpose:** Embedding pipeline. Generates 384-dim semantic embeddings from contact profile text and stores them in the RVF vector store. Requires ruvector.

```bash
node scripts/vectorize.mjs --from-graph [--batch-size 50] [--verbose]
node scripts/vectorize.mjs                                             # from contacts.json
```

| Option | Default | Description |
|--------|---------|-------------|
| `--from-graph` | off | Load from `graph.json` (includes scores in metadata). Recommended. |
| `--batch-size <N>` | 50 | Contacts per embedding batch. |
| `--verbose` | off | Detailed progress logging. |

### rvf-store.mjs

**Purpose:** Central abstraction layer over ruvector's VectorDBWrapper. Library module (not a CLI tool). All ruvector interaction goes through this module.

**Exports:** `isRvfAvailable`, `openStore`, `closeStore`, `queryStore`, `ingestContacts`, `getContact`, `deleteContact`, `storeLength`, `upsertMetadata`, `buildProfileText`, `buildMetadata`, `chunkArray`.

For full API documentation, see [semantic-search-guide.md](semantic-search-guide.md).

### report-generator.mjs

**Purpose:** Generates an interactive HTML dashboard (`data/network-report.html`) from `graph.json`. Includes 3D graph visualization, Chart.js charts, and sortable tables.

```bash
node scripts/report-generator.mjs [--verbose]
```

### pipeline.mjs

**Purpose:** Pipeline orchestrator. Runs multi-step workflows with dependency guards. See [Section 7: Pipeline Reference](#7-pipeline-reference).

```bash
node scripts/pipeline.mjs --full [--niche <name>]
node scripts/pipeline.mjs --rebuild
node scripts/pipeline.mjs --rescore
node scripts/pipeline.mjs --behavioral
node scripts/pipeline.mjs --referrals
node scripts/pipeline.mjs --report
node scripts/pipeline.mjs --deep-scan --url <url>
node scripts/pipeline.mjs --validate
node scripts/pipeline.mjs --reparse
node scripts/pipeline.mjs [--verbose]
```

### delta.mjs

**Purpose:** Snapshot and change detection. Creates point-in-time snapshots of your contact database and compares them to detect additions, removals, and tier changes.

```bash
node scripts/delta.mjs --snapshot     # Create a snapshot
node scripts/delta.mjs --check        # Compare vs. last snapshot
node scripts/delta.mjs --list         # List all snapshots
```

Snapshots are stored in `data/snapshots/` as `snapshot-YYYY-MM-DD.json` and include total contacts, enrichment count, profile URLs, tier summary, and top gold contacts.

### deep-scan.mjs

**Purpose:** Scans a single contact's LinkedIn connection list to discover 2nd-degree contacts.

**What it does:**
1. Navigates to the target's profile page
2. Finds and clicks the connections link (tries multiple selectors, falls back to member URN extraction)
3. Paginates and extracts visible connections (name, title, URL, mutual count, degree)
4. Caches each connections page as raw HTML
5. Stores discovered contacts in `contacts.json` with `degree: 2` and `discoveredVia` metadata
6. Marks the scanned contact as `deepScanned: true`
7. Reports bridge contacts (appearing in multiple scans)

```bash
node scripts/deep-scan.mjs --url <linkedin-url> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--url <url>` | (required) | LinkedIn profile URL of the 1st-degree contact to scan |
| `--max-pages <N>` | 5 | Pages of connections to scrape |
| `--max-results <N>` | 100 | Maximum connections to discover |
| `--depth <N>` | 2 | Store discovered contacts as degree-N |
| `--mutual-only` | false | Only capture connections that are mutual (shared with you) |

### batch-deep-scan.mjs

**Purpose:** Sequentially deep-scans a prioritized list of contacts, then rebuilds the graph and re-scores.

```bash
node scripts/batch-deep-scan.mjs [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--criteria <type>` | gold | Targeting criteria: gold, referral, hub, all |
| `--min-score <N>` | 0 | Minimum score threshold for inclusion (0-1) |
| `--max-pages <N>` | 3 | Pages per scan |
| `--max-results <N>` | 50 | Max connections per scan |
| `--delay <N>` | 10 | Seconds to wait between scans |
| `--dry-run` | false | Show scan list without executing |
| `--skip <N>` | 0 | Skip first N contacts (resume after interruption) |

After all scans complete, automatically runs: graph-builder -> scorer -> behavioral-scorer -> referral-scorer -> report-generator.

### configure.mjs

**Purpose:** ICP configuration management -- validation, template generation, and interactive wizard.

```bash
node scripts/configure.mjs validate                          # Check config validity
node scripts/configure.mjs init                              # Quick template (interactive)
node scripts/configure.mjs wizard                            # Full setup (interactive)
node scripts/configure.mjs generate --json '<config>'        # Non-interactive from JSON
node scripts/configure.mjs generate --profiles '<json>' --niches '<json>'  # Structured args
```

When using Claude Code slash commands, the agent handles configuration conversationally and calls `generate --json` (not `wizard` or `init`, which require interactive stdin).

### reparse.mjs

**Purpose:** Re-extracts data from cached HTML pages without visiting LinkedIn again.

```bash
node scripts/reparse.mjs --all                   # Re-extract everything
node scripts/reparse.mjs --type profiles         # Re-extract profiles only
node scripts/reparse.mjs --type search           # Re-extract search pages only
node scripts/reparse.mjs --url <profile-url>     # Re-extract one specific profile
node scripts/reparse.mjs --stats                 # Show cache statistics
```

Uses a headless Playwright instance to parse HTML (since extraction relies on DOM queries).

### cache.mjs

**Purpose:** HTML cache utility module. Used internally by search.mjs, enrich.mjs, deep-scan.mjs, and reparse.mjs.

**Exports:**
- `saveSearchPage(page, term, pageNum)` -- Cache a search results page
- `saveProfilePage(page, url)` -- Cache a profile page
- `saveConnectionsPage(page, targetUrl, pageNum)` -- Cache a connections list page
- `loadIndex()` -- Load the cache index
- `getCachedHtml(key)` -- Retrieve cached HTML by key

Cache files are stored in `data/cache/` with an `index.json` tracking metadata (type, URL, file path, cached timestamp).

---

## Quick Reference Card

### Slash Commands

```
/linkedin-prospector set up my ICP config
/linkedin-prospector Find me 20 <niche> contacts
/linkedin-prospector Enrich unenriched contacts
/linkedin-prospector How many contacts do I have?
/linkedin-prospector Export my contacts as CSV
/linkedin-prospector Rebuild and score everything

/network-intel give me an overview
/network-intel who are my best hubs?
/network-intel find me prospects
/network-intel who are my best referral partners?
/network-intel what should I focus on next?
/network-intel show me super-connectors
/network-intel content visibility strategy
/network-intel find contacts similar to https://linkedin.com/in/someone
/network-intel who talks about AI transformation?
/network-intel any new connections since last time?
/network-intel generate a report
/network-intel expand my network through referral partners
/network-intel vectorize my contacts
```

### Common Script Sequences

```bash
# Full setup from scratch
node scripts/configure.mjs wizard
node scripts/search.mjs --niche <niche> --max-results 30
node scripts/enrich.mjs --unenriched-only --max 50
node scripts/pipeline.mjs --rebuild
node scripts/pipeline.mjs --report

# After adding new contacts
node scripts/pipeline.mjs --rebuild

# After changing config weights
node scripts/pipeline.mjs --rescore

# After deep-scanning
node scripts/pipeline.mjs --rebuild

# Re-extract from cache after config change
node scripts/reparse.mjs --all
node scripts/pipeline.mjs --rebuild
```

### Data Files

| File | Description |
|------|-------------|
| `data/icp-config.json` | Your ICP configuration (edit this) |
| `data/behavioral-config.json` | Behavioral persona rules |
| `data/referral-config.json` | Referral scoring rules |
| `data/contacts.json` | Contact database (auto-generated) |
| `data/graph.json` | Scored knowledge graph (auto-generated) |
| `data/network-report.html` | Interactive HTML dashboard (auto-generated) |
| `data/network.rvf` | Semantic vector store (auto-generated, requires ruvector) |
| `data/snapshots/` | Delta snapshots (auto-generated) |
| `data/cache/` | Cached HTML pages (auto-generated) |
