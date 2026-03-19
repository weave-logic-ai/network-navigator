# Configuration Guide

This guide covers how to set up NetworkNav's ICP (Ideal Customer Profile) configuration, niches, and offerings -- the core of how contacts are scored, tiered, and searched.

## Overview

In v2, all configuration is stored in PostgreSQL and managed through REST APIs. There are no local JSON files. Three entity types drive the system:

| Entity | API | Purpose |
|--------|-----|---------|
| ICP Profiles | `POST /api/icps` | Define ideal buyer criteria (roles, industries, signals, company size) |
| Niches | `POST /api/niches` | Search keyword groups for finding contacts |
| Offerings | `POST /api/offerings` | Your services/products (one per business line) |

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

The agent walks you through a conversation about your business, then creates the configuration via API calls. See [Agent Configuration Flow](#agent-configuration-flow) below.

### Method 2: Non-interactive CLI

```bash
node scripts/configure.mjs generate --json '{...full config JSON...}'
```

This calls the v2 APIs to create each ICP, niche, and offering.

### Method 3: Direct API calls

Use `curl` or any HTTP client to call the APIs directly (see [API Reference](#api-reference) below).

### Validation

Verify the current configuration:

```bash
node scripts/configure.mjs validate
```

This calls `GET /api/icps`, `GET /api/niches`, and `GET /api/offerings`, then reports counts and warns about missing configuration.

---

## Agent Configuration Flow

When a user asks to configure their ICP, the agent conducts a structured conversation. Here is the complete flow:

### Step 1: Ask about their business

> "What services do you offer? For example: AI consulting, fractional CTO, custom development, training, automation assessment."

The user's answer determines how many **offerings** and **ICP profiles** to create. Each service = one offering + one or more ICP profiles.

**Example answer:** "I do AI consulting and fractional CTO work"
**Result:** Two offerings and two ICP profiles: `ai-consulting` and `fractional-cto`

### Step 2: For each service, ask about target buyers

> "For **[service name]**, who are your ideal buyers? List the job titles/roles, starting with the highest-priority ones."

Map their answers to the ICP `criteria.roles` array. All roles go into a single list -- the scoring engine handles weighting by seniority internally.

**Example answer:** "CEOs, CTOs, and Founders are my main buyers. VPs and Directors are influencers. Engineering Managers are sometimes involved."
**Result:**
```json
"criteria": {
  "roles": ["CEO", "CTO", "Founder", "Co-Founder", "VP", "Vice President", "Director", "Head of", "Engineering Manager", "Manager", "Lead"]
}
```

**Important:** Use partial-match keywords, not exact titles. "VP" matches "VP Engineering", "VP Product", etc. "Head of" matches "Head of Engineering", "Head of AI", etc.

### Step 3: Ask about target industries

> "What industries are your ideal customers in?"

Map to `criteria.industries` array.

**Example answer:** "SaaS companies, ecommerce brands, and startups"
**Result:** `["saas", "software", "ecommerce", "e-commerce", "startup", "digital commerce"]`

**Tip:** Include synonyms and variations. LinkedIn profiles use inconsistent terminology.

### Step 4: Ask about buying signals

> "What keywords in someone's profile would signal they might need **[service name]**? Think about problems they'd mention, initiatives they'd be working on, or technologies they'd reference."

Map to `criteria.signals` array.

**Example answer:** "People talking about AI adoption, digital transformation, or scaling their tech team"
**Result:** `["ai", "artificial intelligence", "digital transformation", "scaling", "modernization", "automation", "machine learning"]`

### Step 5: Ask about company size (optional)

> "What's the ideal company size range for **[service name]**? (employee count)"

Map to `criteria.companySizeRanges`. Default: `["11-50", "51-200", "201-500"]`.

### Step 6: Ask about search niches

> "What keywords should I use when searching for potential contacts? These map to search terms used by the browser extension."

Each niche = a named group of search keywords.

**Example answer:** "Search for AI-related people with 'AI', 'artificial intelligence', 'machine learning'. Also search ecommerce with 'ecommerce', 'DTC', 'Shopify'."

### Step 7: Assemble and call APIs

For each ICP profile, call:

```bash
POST /api/icps
{
  "name": "AI Consulting",
  "description": "Leaders exploring AI for their business",
  "criteria": {
    "roles": ["CEO", "CTO", "Founder"],
    "industries": ["saas", "ecommerce", "fintech"],
    "signals": ["ai", "automation", "digital transformation"],
    "companySizeRanges": ["11-50", "51-200", "201-500"]
  }
}
```

For each niche, call:

```bash
POST /api/niches
{
  "name": "AI Leaders",
  "keywords": ["AI", "artificial intelligence", "machine learning", "AI adoption"],
  "industry": "technology"
}
```

For each offering, call:

```bash
POST /api/offerings
{
  "name": "AI Consulting",
  "description": "Strategic AI consulting for mid-market companies"
}
```

Alternatively, bundle everything into one `configure.mjs generate` call:

```bash
node scripts/configure.mjs generate --json '{
  "profiles": {
    "ai-consulting": {
      "name": "AI Consulting",
      "description": "Leaders exploring AI",
      "criteria": { "roles": ["CEO","CTO"], "industries": ["saas"], "signals": ["ai"] }
    }
  },
  "niches": {
    "ai": { "name": "AI Leaders", "keywords": ["AI", "machine learning"] }
  },
  "offerings": [
    { "name": "AI Consulting", "description": "Strategic AI consulting" }
  ]
}'
```

Then validate:

```bash
node scripts/configure.mjs validate
```

### Step 8: Confirm to user

Report back:
- Number of ICP profiles created and their names
- Number of niches defined
- Number of offerings created
- Suggest next step: "You're set! Use the browser extension to capture LinkedIn profiles, or import from your connections export."

---

## API Reference

### POST /api/icps

Creates an ICP profile. Returns the created profile with its generated `id`.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable profile name |
| `description` | string | No | Who this profile targets |
| `criteria` | object | Yes | Matching criteria (see below) |
| `is_active` | boolean | No | Whether this profile is active (default: true) |

**Criteria object:**

| Field | Type | Description |
|-------|------|-------------|
| `roles` | string[] | Role keywords to match against contact titles |
| `industries` | string[] | Industry keywords to match against profile text |
| `signals` | string[] | Buying intent keywords to match against headline/about |
| `companySizeRanges` | string[] | Employee count ranges (e.g., "11-50", "201-500") |
| `locations` | string[] | Geographic keywords (optional) |
| `minConnections` | number | Minimum connection count (optional) |

**Response:** `{ "data": { "id": "...", "name": "...", "criteria": {...}, ... } }`

### POST /api/niches

Creates a niche. Returns the created niche with its generated `id`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Niche name |
| `description` | string | No | Niche description |
| `industry` | string | No | Industry category |
| `keywords` | string[] | No | Search keywords for this niche |

### POST /api/offerings

Creates an offering. Returns the created offering with its generated `id`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Offering name |
| `description` | string | No | Offering description |

### GET /api/icps

Lists all ICP profiles. Returns `{ "data": [...] }`.

### GET /api/scoring/weights

Lists all weight profiles. Returns `{ "data": [...] }`.

### PUT /api/scoring/weights

Updates or creates a weight profile. Weights must sum to 1.0.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Profile name |
| `weights` | object | Yes | Dimension name to weight mapping |
| `description` | string | No | Profile description |
| `isDefault` | boolean | No | Set as default weight profile |

---

## Scoring Weights

Scoring weights are managed via the API, not local JSON files. The 9 composite scoring dimensions each have a configurable weight:

| Dimension | Default Weight | What It Measures |
|-----------|---------------|------------------|
| `icp_fit` | 0.20 | How well the contact matches your ICP criteria |
| `network_hub` | 0.15 | Connection count, cluster breadth, connector role |
| `relationship_strength` | 0.15 | Mutual connections, recency, proximity |
| `signal_boost` | 0.10 | High-intent keywords in headline/about |
| `skills_relevance` | 0.10 | Overlap between contact skills and ICP signals |
| `network_proximity` | 0.05 | Graph distance and shared network paths |
| `behavioral` | 0.10 | Activity level, engagement signals, connection power |
| `content_relevance` | 0.10 | Content topics, posting frequency, engagement |
| `graph_centrality` | 0.05 | PageRank, betweenness, degree centrality |

Weights must sum to 1.0. Update them via:

```bash
PUT /api/scoring/weights
{
  "name": "default",
  "weights": {
    "icp_fit": 0.20,
    "network_hub": 0.15,
    "relationship_strength": 0.15,
    "signal_boost": 0.10,
    "skills_relevance": 0.10,
    "network_proximity": 0.05,
    "behavioral": 0.10,
    "content_relevance": 0.10,
    "graph_centrality": 0.05
  }
}
```

### Tier Thresholds

Contacts are classified into tiers based on their composite score:

| Tier | Default Threshold | Meaning |
|------|-------------------|---------|
| Gold | >= 0.55 | High-priority prospects |
| Silver | >= 0.40 | Worth pursuing |
| Bronze | >= 0.28 | Keep on radar |
| Watch | < 0.28 | Not a current fit |

---

## Examples

### Solo AI Consultant

```bash
POST /api/offerings
{ "name": "AI Consulting", "description": "Strategic AI consulting for mid-market companies" }

POST /api/icps
{
  "name": "AI Consulting",
  "description": "Leaders exploring AI for their business",
  "criteria": {
    "roles": ["CEO", "CTO", "Founder", "Chief Digital", "VP", "Director", "Head of", "Manager", "Lead"],
    "industries": ["saas", "ecommerce", "fintech", "healthcare", "manufacturing"],
    "signals": ["ai", "artificial intelligence", "automation", "digital transformation", "machine learning"],
    "companySizeRanges": ["11-50", "51-200", "201-500"]
  }
}

POST /api/niches
{ "name": "AI", "keywords": ["AI", "artificial intelligence", "machine learning", "AI adoption"] }

POST /api/niches
{ "name": "SaaS", "keywords": ["SaaS", "software platform", "cloud"] }

POST /api/niches
{ "name": "Ecommerce", "keywords": ["ecommerce", "e-commerce", "DTC", "Shopify"] }
```

### Multi-Service Agency

Create multiple ICP profiles -- one per service:

```bash
POST /api/icps
{
  "name": "Web Development",
  "description": "Companies needing web development services",
  "criteria": {
    "roles": ["CTO", "VP Engineering", "Director Engineering", "Head of Product"],
    "industries": ["saas", "ecommerce", "fintech"],
    "signals": ["redesign", "new website", "web platform", "migration"]
  }
}

POST /api/icps
{
  "name": "SEO Services",
  "description": "Marketing leaders needing SEO",
  "criteria": {
    "roles": ["CMO", "VP Marketing", "Director Marketing", "Head of Growth"],
    "industries": ["ecommerce", "saas", "media", "publishing"],
    "signals": ["organic traffic", "SEO", "search ranking", "content strategy"]
  }
}

POST /api/icps
{
  "name": "Branding & Design",
  "description": "Companies going through brand evolution",
  "criteria": {
    "roles": ["CEO", "CMO", "VP Marketing", "Brand Director"],
    "industries": ["consumer goods", "hospitality", "fashion", "food and beverage"],
    "signals": ["rebranding", "brand refresh", "brand identity", "visual identity"]
  }
}
```

The scoring engine evaluates each contact against all active ICP profiles and uses the best-fit score.
