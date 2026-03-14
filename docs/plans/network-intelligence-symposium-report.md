# Network Intelligence Symposium Report

## Research Symposium: LinkedIn Network Intelligence System Enhancement

**Date**: March 12, 2026
**Dataset Analyzed**: 5,289 contacts (897 1st-degree, 4,392 2nd-degree), 156,013 edges, 42MB graph
**Committees**: 6 expert committees, 3 parallel research tracks

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Committee 1: Activity/Engagement Score Design](#committee-1-activityengagement-score-design)
3. [Committee 2: Scoring System Review](#committee-2-scoring-system-review)
4. [Committee 3: 3D Network Graph Improvement](#committee-3-3d-network-graph-improvement)
5. [Committee 4: Report Improvements](#committee-4-report-improvements)
6. [Committee 5: Targeted Outreach Plan Design](#committee-5-targeted-outreach-plan-design)
7. [Committee 6: Lead Development Best Practices](#committee-6-lead-development-best-practices)
8. [Consolidated Priority Matrix](#consolidated-priority-matrix)
9. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

The symposium identified critical improvements across the entire LinkedIn Network Intelligence pipeline. The top findings:

1. **The 3D graph is broken by edge density** — 129,749 mutual-proximity edges (83% of all edges) create a hairball. Fix: filter mutual-proximity off by default, tune force parameters.
2. **Signal boost scoring has false positives** — `'ai'` matches inside "sustainable", "domain", "training". Fix: word-boundary regex.
3. **Activity scoring is the highest-value missing dimension** — no awareness of recent LinkedIn posting/engagement about AI/automation topics.
4. **Targeted outreach plan ("mini-CRM")** is a major feature opportunity — intelligence briefs, template-based messaging, response monitoring.
5. **2nd-degree contacts need different treatment** — competing on same tier thresholds with less data; behavioral scorer penalizes missing data.

### Top 10 Highest-ROI Changes

| # | Change | Impact | Effort | Committee |
|---|--------|--------|--------|-----------|
| 1 | Fix signalBoost 'ai' false positives (regex word boundary) | High | Low | C2 |
| 2 | Add edge-type filter checkboxes, mutual-proximity OFF by default | High | Low | C3 |
| 3 | Change graph charge from -40 to -300, type-dependent link distances | High | Low | C3 |
| 4 | Degree-specific tier thresholds (lower for 2nd-degree) | High | Low | C2 |
| 5 | Fix behavioral scorer sparse-data handling (exclude missing, don't default to 0.1) | High | Medium | C2 |
| 6 | Add CSV export buttons to all report tables | High | Low | C4 |
| 7 | Add warm intro paths for degree-2 contacts | High | Medium | C4 |
| 8 | Implement `activity-scanner.mjs` for recent LinkedIn activity | Very High | High | C1 |
| 9 | Build `targeted-plan.mjs` core (intelligence briefs + outreach plans) | Very High | High | C5 |
| 10 | Add "Color by" dropdown (cluster/tier/persona) for graph | Medium | Low | C3 |

---

## Committee 1: Activity/Engagement Score Design

### Problem Statement

The current scoring system relies entirely on static profile data. It has no awareness of whether contacts are actively engaging with AI, automation, or related topics. A contact who posted about AI implementation yesterday is dramatically more valuable than one who mentioned "digital transformation" in their about section three years ago.

### Signals to Track

LinkedIn's public activity feed at `linkedin.com/in/USERNAME/recent-activity/all/` surfaces:

**Tier 1 — Original Content (weight 1.0)**
- Original posts (text, articles, polls, documents)
- Long-form articles, newsletter publications

**Tier 2 — Active Engagement (weight 0.4-0.7)**
- Reposts with commentary (0.7)
- Comments 50+ chars (0.5)
- Plain reposts (0.4)
- Short comments (0.2)
- Reactions/likes (0.15)

**Tier 3 — Passive/Contextual**
- Profile update activity, engagement patterns, creator mode indicators

### Scoring Formula

```javascript
function computeActivityScore(activities, config) {
  const now = Date.now();
  let totalWeightedScore = 0, activityCount = 0, topicRelevanceSum = 0;

  for (const activity of activities) {
    const typeWeight = config.typeWeights[activity.type] || 0.1;
    const recencyMultiplier = computeRecencyDecay(activity.timestamp, now);
    const topicRelevance = computeTopicRelevance(activity.text, config.topicKeywords);
    const engagementBonus = computeEngagementBonus(activity.metrics);

    const activityValue = typeWeight * recencyMultiplier *
      (1 + topicRelevance * 0.5 + engagementBonus * 0.2);
    totalWeightedScore += activityValue;
    topicRelevanceSum += topicRelevance;
    activityCount++;
  }

  const frequencyScore = Math.min(activityCount / 20, 1.0);
  const rawScore = activityCount > 0
    ? (totalWeightedScore / activityCount) * 0.6 +
      frequencyScore * 0.25 +
      Math.min(topicRelevanceSum / activityCount, 1) * 0.15
    : 0;
  return Math.min(rawScore, 1.0);
}
```

### Topic Relevance Keywords (3 tiers)

- **Core (1.0)**: `\bai\b`, `machine learning`, `deep learning`, `llm`, `generative ai`, `automation`, `hyperautomation`, `rpa`, `prompt engineering`, `agentic`, `ai agent`
- **Applied (0.7)**: `digital transformation`, `data science`, `analytics`, `nlp`, `computer vision`, `workflow automation`, `mlops`
- **Ecosystem (0.4)**: `innovation`, `future of work`, `scaling`, `tech stack`, `modernization`, `data-driven`

Critical: Use word-boundary regex (`\bai\b`) to avoid false positives.

### Recency Decay

| Days Ago | Multiplier |
|----------|-----------|
| 0-3 | 1.0 |
| 4-7 | 0.9 |
| 8-14 | 0.75 |
| 15-30 | 0.55 |
| 31-60 | 0.35 |
| 61-90 | 0.20 |
| 90+ | 0.10 |

### Implementation

**New script: `activity-scanner.mjs`**
- Navigates to `linkedin.com/in/USERNAME/recent-activity/all/`
- Scrolls feed (8 scrolls max), extracts activity cards
- Rate limited: 1 page load per contact, 4-6s delay, 50-100 per session
- Scan priority: gold > silver > bronze (skip watch)
- Cache activity data with 7-day TTL

### Data Model Additions (per contact in graph.json)

```json
{
  "activityData": {
    "lastScanned": "2026-03-11T22:00:00.000Z",
    "activityCount": 12,
    "originalPosts": 3, "reposts": 4, "comments": 2, "reactions": 3,
    "lastActivityDate": "2026-03-10T00:00:00.000Z",
    "aiTopicPosts": 5,
    "topHashtags": ["#AI", "#ecommerce", "#automation"],
    "recentActivities": []
  },
  "activityScore": 0.72,
  "activitySignals": {
    "frequencyScore": 0.65, "topicDensity": 0.80,
    "engagementQuality": 0.55, "contentCreationScore": 0.90,
    "recencyScore": 0.85
  }
}
```

### Gold Score V3 Integration

**1st-degree**: `icpFit(0.28) + networkHub(0.22) + relationship(0.17) + activityScore(0.15) + behavioral(0.10) + signalBoost(0.08)`

**2nd-degree**: `icpFit(0.35) + networkHub(0.30) + relationship(0.20) + activityScore(0.08) + behavioral(0.04) + signalBoost(0.03)`

---

## Committee 2: Scoring System Review

### Finding 1: Tier Thresholds Misaligned with Data Distribution

**Current**: gold >= 0.55, silver >= 0.40, bronze >= 0.28
- 1st-degree: mean goldScore 0.275, P90 = 0.412, 10 gold (1.1%)
- 2nd-degree: mean goldScore 0.199, P90 = 0.317, 22 gold (0.5%)

**Recommendation: Degree-specific thresholds**
- 1st-degree: gold >= 0.52, silver >= 0.38, bronze >= 0.26
- 2nd-degree: gold >= 0.48, silver >= 0.35, bronze >= 0.22

Would grow gold pool from 32 to ~50-65 (still ~1%, highly selective).

### Finding 2: Signal Boost is Critically Flawed

**5 problems**:
1. Binary output — 91.1% score 0.0, 4.5% score 0.5, 4.4% score 1.0
2. False positives — 'ai' matches inside "sustainable", "domain", "maintain"
3. Only 4 keywords, missing critical terms
4. No weighting between terms
5. 9.5x differentiation ratio — acts as binary gold switch

**Fix**: Replace with continuous scorer using `\bai\b` regex, tiered keywords, density scoring.

### Finding 3: Skills Data Underutilized

345 contacts have skills data (478 unique clean skills), but skills are **never used in any scorer**.

**Recommendation**: Add `computeSkillsRelevance()` with AI/tech/business skill tiers. Integrate into ICP fit with 11% weight when skills data available.

```javascript
function computeSkillsRelevance(skills) {
  if (!skills || skills.length === 0) return null;
  const skillText = skills.join(' ').toLowerCase();
  const AI_SKILLS = ['ai', 'machine learning', 'deep learning', 'nlp', 'pytorch',
    'tensorflow', 'data science', 'generative ai', 'llm', 'automation', 'rpa'];
  const TECH_SKILLS = ['php', 'javascript', 'python', 'react', 'node.js',
    'aws', 'azure', 'cloud computing', 'devops', 'kubernetes'];
  const BIZ_SKILLS = ['project management', 'agile', 'scrum', 'leadership',
    'business development', 'consulting', 'strategy', 'saas', 'e-commerce'];
  const aiMatches = AI_SKILLS.filter(s => skillText.includes(s)).length;
  const techMatches = TECH_SKILLS.filter(s => skillText.includes(s)).length;
  const bizMatches = BIZ_SKILLS.filter(s => skillText.includes(s)).length;
  return Math.min((aiMatches/3)*0.5 + (techMatches/4)*0.3 + (bizMatches/3)*0.2, 1.0);
}
```

### Finding 4: 2nd-Degree Contacts Need Different Treatment

- 4,392 contacts (83%) compete on same thresholds with less data
- Behavioral scorer defaults to 0.1 for connectionPower and connectionRecency when data missing — this drags scores down
- 169 contacts moved DOWN a tier from V1 to V2 (vs only 85 up)

**Recommendations**:
1. Degree-specific thresholds
2. Data-completeness factor (0.5-1.0 multiplier based on populated fields)
3. Prioritize enrichment of borderline contacts scoring 0.40-0.55

### Finding 5: Network Hub Score Structural Issues

85.5% of contacts have ZERO edges. Edge count component (20% of hub) is effectively 0 for 4,524/5,289 contacts.

**Fix**: Add bridge density component using `discoveredVia` array:
```javascript
const bridgeCount = (contact.discoveredVia || []).length;
const bridgeComponent = cap(bridgeCount / 5) * 0.20;
```

### Finding 6: Behavioral Scoring Sparse Data Problem

86.6% are "passive-network" persona. Root cause: missing `connections` and `connectedTime` defaults to 0.1 instead of being excluded.

**Fix**: When a component has no data, exclude from weighted sum and redistribute weight proportionally among components with data.

### Finding 7: Missing Network Proximity Dimension

A contact discovered via 16 bridges is more proximate than one via 1.

**Recommendation**: Add `computeNetworkProximity`:
- Bridge density (50%): count of discoveredVia entries
- Bridge quality (30%): average goldScore of bridge contacts
- Bridge diversity (20%): how many clusters bridges come from

### Finding 8: Persona Assignment Needs Refinement

68.1% are "referral-partner" (catch-all default). Recommend adding: "warm-lead", "active-influencer", "ecosystem-contact", and renaming default to "network-node".

---

## Committee 3: 3D Network Graph Improvement

### Root Cause Analysis

The "giant clump" has three compounding causes:

1. **mutual-proximity edges dominate (83% of all edges)**: graph-builder creates 129,749 mutual-proximity edges. For top-200 nodes, 7,677 of 12,159 edges (63%) are this type.

2. **Force parameters overwhelmed**: charge -40 is overwhelmed by 60 links/node at strength 0.7 (cumulative pull = 42 per node).

3. **No cluster-aware spatial encoding**: no radial forces, no cluster centering.

### Recommended Fixes

#### 1. Edge Filtering (P0 — lowest effort, highest impact)

Add edge-type filter checkboxes with `mutual-proximity` OFF by default:

```javascript
// Default: only show strong connection types
const EDGE_DEFAULTS = {
  'same-company': true,
  'same-cluster': true,
  'mutual-proximity': false,  // OFF by default
  'discovered-connection': true,
  'shared-connection': true,
};
```

Expected edge reduction: ~12,000 → ~4,500 visible edges.

#### 2. Force Parameter Tuning (P0)

```javascript
chargeForce.strength(-300);  // was -40

// Type-dependent link forces
linkForce.distance(link => {
  if (link.type === 'same-company') return 30;
  if (link.type === 'same-cluster') return 80;
  if (link.type === 'discovered-connection') return 100;
  return 120;
}).strength(link => {
  if (link.type === 'same-company') return 0.9;
  if (link.type === 'same-cluster') return 0.5;
  return 0.2;
});
```

#### 3. Cluster-Based Coloring (P1)

Add "Color by" dropdown: Tier (default), Cluster, Persona, Degree.

```javascript
const CLUSTER_COLORS = [
  '#ff6384','#36a2eb','#ffce56','#4bc0c0','#9966ff',
  '#ff9f40','#c9cbcf','#7bc67e','#e77c8e','#55bae7'
];
```

#### 4. Node Labels (P1)

Show labels only for gold contacts, show on hover for others:
```javascript
.nodeLabel(n => n.name + ' [' + n.tier + ']')
.nodeAutoColorBy(null)
.nodeThreeObject(n => {
  if (n.tier === 'gold') { /* add text sprite */ }
  return false; // default sphere for others
})
```

#### 5. Interactive Features (P2)

- **Cluster isolation**: Click cluster name in dropdown to zoom to that cluster
- **Neighborhood mode**: Double-click node to hide all non-adjacent nodes
- **Path finding**: Select two nodes, highlight shortest path
- **Degree filter**: Checkbox to show/hide 1st vs 2nd degree nodes

#### 6. Alternative Layout Options (P2)

- **2D mode toggle**: Fall back to 2D force layout for simpler visualization
- **Concentric rings**: Gold center, silver ring, bronze outer, watch far outer
- **WebGL fallback**: Canvas-based 2D renderer for mobile/low-spec devices

---

## Committee 4: Report Improvements

### Key Gaps Identified

| Gap | Priority | Status |
|-----|----------|--------|
| Warm introduction paths | P0 | Data exists in `discoveredVia`, not surfaced |
| CSV/PDF export | P0 | No export capability at all |
| Time-series tracking | P1 | No snapshots, no trend visualization |
| Cross-report navigation | P1 | Two separate reports, no linking |
| Mobile support | P2 | Fixed sidebar, WebGL-only graph |
| Geographic heat map | P2 | Location data exists, not visualized |
| Action/outreach tracking | P1 | Pending targeted-plan feature |

### Recommended Additions

#### Warm Intro Paths (P0)

For each degree-2 contact, show which 1st-degree contacts can introduce you, ranked by referral warmth:

```html
<div class="intro-path">
  <span>You</span> → <span class="bridge">Joey Burzynski (gold)</span> → <span>Target Contact</span>
</div>
```

Data source: `discoveredVia` array in graph.json, cross-referenced with bridge contact's `referralSignals.relationshipWarmth`.

#### CSV Export (P0)

Add download buttons to every table section:
```javascript
function downloadCSV(tableId, filename) {
  const table = document.getElementById(tableId);
  const rows = table.querySelectorAll('tr');
  let csv = '';
  rows.forEach(row => {
    const cells = row.querySelectorAll('th, td');
    csv += [...cells].map(c => '"' + c.textContent.replace(/"/g,'""') + '"').join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
```

#### Time-Series Snapshots (P1)

Add `delta.mjs --snapshot` integration to capture score snapshots. New report section showing:
- Tier movement over time (contacts that upgraded/downgraded)
- Gold score trend lines for key contacts
- New contacts added since last snapshot

#### Cross-Report Navigation (P1)

Add navigation links between network-report.html and icp-niche-report.html. Shared sidebar with toggle.

---

## Committee 5: Targeted Outreach Plan Design

### Core Architecture

**New scripts:**
- `targeted-plan.mjs` — Main CLI for plan generation and management
- `outreach-monitor.mjs` — Response monitoring via Playwright
- `template-engine.mjs` — Template rendering with merge fields

**New data files:**
- `outreach-plans.json` — Runtime plan data (separate from graph.json)
- `outreach-templates.yaml` — User-editable message templates
- `outreach-config.json` — Feature configuration

### Intelligence Brief Generation

For a specific contact, auto-generate:
1. Full profile analysis (role, company, industry, skills, interests)
2. Mutual connections analysis — who can introduce you (from `discoveredVia`)
3. Shared interests and talking points (from skills overlap, cluster overlap)
4. Recent activity snapshot (from activity scanner)
5. Company context (other contacts at same company from `companies` index)
6. Receptiveness score (composite of relationship strength, behavioral, recency)

### Template System

User-editable YAML templates with merge fields:

```yaml
connection_requests:
  warm_mutual:
    name: "Warm Introduction via Mutual"
    channel: "linkedin_connection_request"
    max_chars: 300
    template: |
      Hi {{first_name}}, I noticed we're both connected to {{mutual_connection}}.
      {{shared_interest_sentence}} Would love to connect.
  cold_icp:
    name: "Cold ICP Match"
    channel: "linkedin_connection_request"
    max_chars: 300
    template: |
      Hi {{first_name}}, your work in {{industry}} caught my eye.
      {{value_proposition}} Happy to connect.

messages:
  value_add:
    name: "Value-Add Follow Up"
    channel: "linkedin_message"
    template: |
      Hi {{first_name}}, thanks for connecting!
      I came across {{relevant_content}} and thought of your work at {{company}}.
      {{call_to_action}}
```

Merge fields: `{{name}}`, `{{first_name}}`, `{{company}}`, `{{role}}`, `{{mutual_connection}}`, `{{shared_interest}}`, `{{industry}}`, `{{recent_post_topic}}`, `{{value_proposition}}`

### Outreach Lifecycle

```
planned → sent → pending_response → responded → engaged → converted
                                  → no_response → follow_up → ...
                                  → declined → closed_lost
```

### Response Monitoring

`outreach-monitor.mjs` — periodically checks:
- Connection request accepted (notification feed)
- Message reply received (messaging inbox)
- Profile view from target (notification feed)

Rate budget: max 20 monitoring checks per session, 5-8s between checks.

### Data Model

```json
{
  "contactUrl": "https://linkedin.com/in/...",
  "planId": "plan-abc123",
  "createdAt": "2026-03-12T00:00:00Z",
  "brief": { /* intelligence brief data */ },
  "sequence": [
    { "step": 1, "channel": "linkedin_connection_request", "templateId": "warm_mutual",
      "scheduledDate": "2026-03-12", "status": "planned", "renderedMessage": "..." },
    { "step": 2, "channel": "linkedin_message", "templateId": "value_add",
      "scheduledDate": "2026-03-15", "status": "planned" }
  ],
  "lifecycle": { "stage": "planned", "lastAction": null, "nextAction": "2026-03-12" },
  "notes": []
}
```

### CLI Usage

```bash
# Generate plan for a specific contact
node targeted-plan.mjs --contact <url> --generate

# Preview rendered message
node targeted-plan.mjs --contact <url> --preview --step 1

# List all plans due today
node targeted-plan.mjs --due-today

# Monitor responses
node outreach-monitor.mjs --check-all --max-checks 10

# Export for CRM
node targeted-plan.mjs --export csv
```

---

## Committee 6: Lead Development Best Practices

### Lead Scoring Models Assessment

| Model | Applicability | Current Coverage | Gap |
|-------|--------------|------------------|-----|
| **BANT** | Basic | Strong (Authority, Need covered) | Timing dimension needs activity signals |
| **MEDDIC** | Partial | Champion identification strong (referral scorer) | Account penetration opportunity |
| **Predictive** | Future | No feedback loop exists | Track outreach outcomes to tune weights |

### Recommended Enhancements

1. **Account Penetration Score**: `min(1.0, contactsAtCompany / 3)` — having 3+ contacts at a company signals strong account awareness.

2. **Job Change Detection**: Check if role start date is recent. New leaders make changes — very high buying signal.

3. **Bayesian Weight Tuning**: After 50+ plans with tracked outcomes, auto-adjust scoring weights based on observed conversion rates.

### LinkedIn Social Selling Best Practices

**Connection Request Acceptance Rates:**

| Approach | Rate |
|----------|------|
| Personalized with mutual connection | 45-55% |
| Referencing their content | 40-50% |
| Specific value offer | 35-45% |
| Blank (no message) | 25-35% |
| Generic message | 15-25% |

**Optimal Timing**: Tuesday-Wednesday 8-10am recipient's timezone. Worst: Friday afternoon, Monday morning.

**Key Principles:**
- Engage with 2-3 posts before connecting (moves cold → warm)
- Profile view 1-2 days before request = "soft knock" (+10-15% acceptance)
- 300-character limit on connection request notes (hard constraint)
- The 4-1-1 Rule: 4 curated, 1 original, 1 promotional content

### Rate Limiting & Compliance

**Daily Budget Tracker** (recommended):

| Operation | Daily Limit | Delay |
|-----------|-------------|-------|
| Profile visits | 80 | 5-8s |
| Connection requests | 20 | Manual |
| Messages sent | 25 | Manual |
| Search pages | 30 | 8-12s |
| Activity feeds | 20 | 5-8s |

**Critical**: Never automate actual sending of messages/connections. Generate and preview only — human clicks send. This protects the LinkedIn account and keeps outreach personal.

**GDPR**: Implement `--forget <url>` command. Auto-archive closed plans after 180 days. Store `consent_basis` per contact.

### CRM Lead Lifecycle Mapping

```
lead            → Contact exists in graph.json with score
mql             → Gold/Silver tier, icpFit >= 0.5
sal             → Outreach plan created, intelligence brief generated
sql             → Responded positively to outreach
opportunity     → Meeting scheduled
customer        → Converted
evangelist      → Converted AND refers others
```

---

## Consolidated Priority Matrix

| Priority | Change | Committee | Impact | Effort |
|----------|--------|-----------|--------|--------|
| **P0** | Fix signalBoost `\bai\b` regex | C2 | High | Low |
| **P0** | Edge-type filters, mutual-proximity OFF | C3 | High | Low |
| **P0** | Graph charge -40 → -300, type-dependent links | C3 | High | Low |
| **P0** | CSV export buttons on all tables | C4 | High | Low |
| **P1** | Degree-specific tier thresholds | C2 | High | Low |
| **P1** | Behavioral scorer: exclude missing data, don't default 0.1 | C2 | High | Medium |
| **P1** | "Color by" dropdown for graph (cluster/tier/persona) | C3 | Medium | Low |
| **P1** | Warm intro paths in reports | C4 | High | Medium |
| **P1** | Clean skills extraction noise | C2 | Medium | Low |
| **P1** | Replace binary signalBoost with continuous scorer | C2 | High | Medium |
| **P2** | Implement `activity-scanner.mjs` | C1 | Very High | High |
| **P2** | Build `targeted-plan.mjs` core | C5 | Very High | High |
| **P2** | Add networkProximity score | C2 | Medium | Medium |
| **P2** | Add skills relevance to ICP fit | C2 | Medium | Medium |
| **P2** | Time-series snapshot tracking | C4 | Medium | Medium |
| **P2** | Outreach template system | C5 | High | Medium |
| **P3** | Outreach monitor (response detection) | C5 | High | High |
| **P3** | Refine persona taxonomy | C2 | Medium | Low |
| **P3** | Account penetration score | C6 | Medium | Medium |
| **P3** | Daily rate budget tracker | C6 | Medium | Low |
| **P3** | Geographic heat map | C4 | Low | Medium |
| **P3** | Mobile responsive layout | C4 | Low | High |

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
- Fix signalBoost regex (`\bai\b`)
- Add edge-type filter checkboxes, mutual-proximity OFF by default
- Tune graph force parameters (-300 charge, type-dependent links)
- Add CSV export buttons to all report tables
- Add "Color by" dropdown for graph

### Phase 2: Scoring Improvements (3-5 days)
- Implement degree-specific tier thresholds
- Fix behavioral scorer sparse-data handling
- Clean skills extraction and add skills relevance scoring
- Replace binary signalBoost with continuous scorer
- Add networkProximity score dimension
- Add bridge density component to hub score

### Phase 3: Activity & Intelligence (1-2 weeks)
- Build `activity-scanner.mjs` for LinkedIn activity feed extraction
- Implement activity scoring formula
- Integrate activity score into goldScore V3
- Add warm intro paths to reports
- Add time-series snapshot tracking

### Phase 4: Targeted Outreach System (2-3 weeks)
- Build `targeted-plan.mjs` with intelligence brief generation
- Create `outreach-templates.yaml` template system
- Build `template-engine.mjs` for merge field rendering
- Build `outreach-monitor.mjs` for response detection
- Add pipeline dashboard to reports
- Implement daily rate budget tracker

### Phase 5: Optimization (ongoing)
- Bayesian weight tuning from outreach outcomes
- Account-based penetration scoring
- Content library integration
- Persona taxonomy refinement
- Geographic heat map visualization

---

## Key Files Referenced

| File | Purpose |
|------|---------|
| `scorer.mjs` | Layer 1: ICP fit, network hub, relationship, goldScore |
| `behavioral-scorer.mjs` | Layer 2: connection power, recency, super-connector |
| `referral-scorer.mjs` | Layer 3: referral likelihood, partner identification |
| `graph-builder.mjs` | Graph construction (156K edges, cluster creation) |
| `report-generator.mjs` | Network report HTML dashboard (2184 lines) |
| `icp-niche-report.mjs` | ICP & niche discovery report (872 lines) |
| `enrich-graph.mjs` | 2nd-degree profile enrichment |
| `vectorize.mjs` | ONNX embedding pipeline (384-dim, incremental) |
| `icp-config.json` | ICP profiles, tier thresholds, weights |
| `behavioral-config.json` | Behavioral scoring configuration |
| `graph.json` | 42MB primary data store (5,289 contacts, 156K edges) |
