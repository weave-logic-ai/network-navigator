# Contact Intelligence — ICP Fit, ECC Gauges, and Profile Enhancement

**Status**: Design Document
**Date**: 2026-03-24

---

## Overview

The contact detail page needs to evolve from a data display to an **intelligence dashboard** that tells the user:
1. How well this contact fits their ICP (and which ICP)
2. How complete their understanding of this contact is
3. What the relationship status looks like
4. What work remains to develop this contact
5. Who else they know in common

---

## 1. ICP Fit Scoring — Transparency & Control

### Current Problem
The ICP Fit Scorer (`scorers/icp-fit.ts`) uses criteria from `icp_profiles` but the user can't see WHICH ICP was used or HOW the score was computed. The first active ICP profile is silently applied to all contacts.

### Solution: Three ICP Modes

#### A. Natural ICP (Auto-detected from network)

When a user's LinkedIn export is imported, the system analyzes the owner profile + network composition to auto-generate a "Natural ICP" — the profile that naturally fits the user's existing network.

```
Owner Profile Analysis:
  - headline keywords → target industries
  - positions history → role patterns
  - skills → signal keywords
  - network composition (title distributions) → company size sweet spot

Auto-generated ICP stored as:
  icp_profiles.name = "Natural ICP (auto-detected)"
  icp_profiles.source = "system"
  icp_profiles.criteria = {
    roles: [top 5 roles from network by frequency],
    industries: [top 5 industries from network],
    signals: [owner's skills + headline keywords],
    companySizeRanges: [most common range in network],
  }
```

This runs automatically during import (in `runImportPipeline` after `seedTaxonomyIfEmpty`). The Natural ICP becomes the default scoring ICP.

#### B. User-configured ICP (Settings page)

`/profile` or `/settings` page gets an "Active ICP" selector:
- Dropdown of all ICP profiles
- The selected ICP is used for all scoring runs
- Stored as a user preference (owner_profiles.metadata.activeIcpId)
- Can be "Natural ICP" or any manually created ICP

#### C. Discovery ICP (Contextual)

On the Discover page, when the user selects a niche + ICP from the dropdowns:
- The People panel and wedge chart use THAT ICP's criteria for real-time matching
- This is already partially working via the contacts API `icpId` filter
- The score shown is contextual — not the stored score, but a live fit calculation against the selected ICP

### ICP Fit Breakdown on Contact Profile

The Scores tab should show:

```
ICP Fit Score: 0.72 / 1.0
Scored against: "Vertical SaaS Founders" ICP

Criteria Breakdown:
  ✓ Role Match: CEO (matched "CEO" in criteria)        0.9
  ✓ Industry Match: SaaS (matched "SaaS")              1.0
  ✗ Company Size: Unknown (no data)                     0.0
  ✓ Signals: "scaling", "hiring" found in headline      0.6
  ✓ Location: San Francisco (matched "San Francisco")   1.0
  ✗ Min Connections: 150 (below 200 threshold)          0.0
```

Each criterion shows: matched/unmatched, what matched, the raw value.

---

## 2. ECC Intelligence Gauges

Five gauges that map the ECC dimensional framework to user-facing contact intelligence. Each is computed from existing data, not new ML models.

### DCTE — Data Completeness & Trust Evaluation

**What it shows**: How complete is our picture of this contact? What fields are populated vs missing?

**Gauge type**: Horizontal progress bar with segment fills

**Computation**:
```typescript
interface DCTEScore {
  overall: number;       // 0-1 weighted completeness
  segments: {
    identity: number;    // name, headline, title, company (weight: 0.25)
    contact: number;     // email, phone, linkedin_url (weight: 0.15)
    context: number;     // about, location, skills, tags (weight: 0.20)
    enrichment: number;  // company industry, size, enrichment history (weight: 0.15)
    scoring: number;     // has composite_score, has embeddings (weight: 0.15)
    network: number;     // edges, mutual connections, cluster membership (weight: 0.10)
  };
  missingFields: string[];  // What's still needed
  suggestion: string;       // "Enrich to fill company data" or "Add tags for better classification"
}
```

**Weight merged vs active**: Completed enrichment fields count more than raw imports. A field that was enriched (merged from provider) scores higher than one from CSV import, because enriched data is verified.

**Display**: Segmented progress bar — each segment fills independently. Overall % shown. Below: list of top 3 missing fields as actionable items.

### DTSE — Decision & Task Strategy Engine

**What it shows**: What goals/tasks exist for this contact? What's the strategy?

**Gauge type**: Status panel with action items

**Computation**: Query goals + tasks where `contact_id = this contact`:
```typescript
interface DTSEStatus {
  activeGoals: Array<{ id: string; title: string; progress: number }>;
  pendingTasks: Array<{ id: string; title: string; taskType: string; priority: number }>;
  completedTasks: number;
  suggestedActions: string[];  // From goal engine checks for this contact
  beliefs: {
    likelyBuyer: boolean;       // persona === 'buyer'
    warmLead: boolean;          // persona === 'warm-lead'
    hubConnector: boolean;      // persona === 'hub'
    referralSource: boolean;    // referralPersona !== null
  };
  nextBestAction: string;       // Single recommended action
}
```

**Display**: Card with active goals (with progress bars), pending tasks (clickable), and a "Next Best Action" badge.

### RSTE — Relationship Strength & Trust Evaluation

**What it shows**: How strong and coherent is the relationship?

**Gauge type**: Radial gauge (0-100)

**Computation**:
```typescript
interface RSTEScore {
  overall: number;          // 0-100 relationship coherence
  components: {
    connectionAge: number;  // Days since connected, normalized
    messageFrequency: number; // Messages per month
    messageRecency: number;  // Days since last message
    endorsementsMutual: number; // Bidirectional endorsements
    recommendations: number;   // Given or received
    sharedConnections: number; // Mutual connections count
    interactionDepth: number;  // Total touchpoints
  };
  status: 'strong' | 'warm' | 'cooling' | 'dormant' | 'new' | 'unknown';
  trend: 'improving' | 'stable' | 'declining';
}
```

**Display**: Circular gauge with color (green=strong, yellow=warm, orange=cooling, red=dormant). Below: trend arrow and status label.

### EMOT — Interest Gauge

**What it shows**: How interested/engaged is this contact likely to be? Based on behavioral signals.

**Gauge type**: Vertical thermometer (cold → hot)

**Computation**:
```typescript
interface EMOTScore {
  temperature: number;     // 0-100 interest level
  signals: {
    profileActivity: number;    // Posting frequency
    contentEngagement: number;  // Avg engagement on their posts
    responseRate: number;       // How quickly they respond to messages
    connectionAcceptance: number; // Did they accept our invite?
    endorsementGiven: number;   // Did they endorse us?
    contentAlignment: number;   // Do their topics match our offerings?
  };
  label: 'hot' | 'warm' | 'lukewarm' | 'cold' | 'unknown';
}
```

**Display**: Thermometer gauge with temperature label. Red=hot (highly interested), blue=cold.

### SCEN — Scenario Completeness

**What it shows**: Second eye on data completeness — specifically, do we have enough data to make confident decisions about this contact?

**Gauge type**: Confidence meter with letter grade

**Computation**:
```typescript
interface SCENScore {
  confidence: number;      // 0-1 overall confidence in our assessment
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: {
    dataPoints: number;    // Total non-null fields
    scoringDimensions: number; // How many scoring dimensions had data
    enrichmentSources: number; // How many enrichment providers contributed
    edgeCount: number;     // Network connections
    embeddingExists: boolean; // Has vector embedding
    recentActivity: boolean;  // Any interaction in 30 days
  };
  gaps: string[];          // "No email", "No company size", "No recent messages"
  recommendation: string;  // "Enrich via PDL to improve confidence" or "Data sufficient for outreach"
}
```

**Display**: Letter grade badge (A-F) with confidence percentage. Expandable section shows gaps and recommendation.

---

## 3. Contact Detail Page Redesign

### Radar Chart for Dimension Profile

Replace the `DimensionParallel` line chart with a **radar chart** showing all 9 scoring dimensions:

```
Dimensions on radar axes:
  - ICP Fit
  - Network Hub
  - Relationship Strength
  - Signal Boost
  - Skills Relevance
  - Network Proximity
  - Behavioral
  - Content Relevance
  - Graph Centrality
```

Each axis: 0-1 range, filled polygon with the contact's dimension scores. Optionally overlay the "ideal" profile (all 1.0) as a faint outline.

**Implementation**: Use recharts `RadarChart` (already in dependencies) or visx polar coordinates.

### New Layout

```
┌─────────────────────────────────────────────────────────┐
│ Header: Name | Tier Badge | Score | Enrich | Tags       │
│ Subtitle: Headline | Location | LinkedIn | Degree       │
├─────────────────────────────────────────────────────────┤
│ Tab: Overview | Network | Scores | Enrichment | Activity│
│                                                         │
│ OVERVIEW TAB:                                           │
│ ┌──────────────────┬───────────────────────────────────┐ │
│ │ ECC Gauges       │ Radar Chart (9 dimensions)        │ │
│ │ ┌─ DCTE ████░░┐  │ [Radar polygon with 9 axes]       │ │
│ │ │  72% complete│  │                                   │ │
│ │ ├─ RSTE  ◔    ┤  │ ICP Fit: 0.72 (Vertical SaaS)    │ │
│ │ │  warm       │  │ [Criteria breakdown list]          │ │
│ │ ├─ EMOT 🌡️    ┤  │                                   │ │
│ │ │  lukewarm   │  │                                   │ │
│ │ ├─ SCEN  B    ┤  │                                   │ │
│ │ │  78% conf   │  │                                   │ │
│ │ └─────────────┘  │                                   │ │
│ ├──────────────────┼───────────────────────────────────┤ │
│ │ DTSE: Goals/Tasks│ About & Contact Info              │ │
│ │ • Goal: Grow HC  │ Bio text                          │ │
│ │   ▸ Task: Message │ Email | Phone | Company          │ │
│ │ • Next: Re-engage│ Tags: [tag] [tag] [+ Add]         │ │
│ └──────────────────┴───────────────────────────────────┘ │
│                                                         │
│ NETWORK TAB:                                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Mutual Connections (12)                             │ │
│ │ [Name] [Name] [Name] ...                           │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 2nd Degree (via this contact): 45 reachable         │ │
│ │ [Name] [Name] ...                                   │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 3rd Degree: 120 reachable                           │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Tags Enhancement

- Tags shown as editable badges in the header area
- Click "+" to add a tag (autocomplete from existing tags in network)
- Click "×" on a tag to remove it
- Tags save instantly via `PUT /api/contacts/:id`

### Goals & Tasks on Profile

- DTSE section shows all goals where any task has `contact_id = this contact`
- Shows pending tasks with action buttons (Start, Complete, Skip)
- "Next Best Action" recommendation based on goal engine analysis

### Mutual & Extended Network

**Mutual contacts query** (new):
```sql
-- Contacts connected to BOTH the owner and this contact
SELECT c2.id, c2.full_name, c2.title, c2.current_company
FROM edges e1
JOIN edges e2 ON e2.target_contact_id = e1.target_contact_id
JOIN contacts c2 ON c2.id = e1.target_contact_id
WHERE e1.source_contact_id = $owner_id
  AND e2.source_contact_id = $contact_id
  AND e1.edge_type = 'CONNECTED_TO'
  AND e2.edge_type = 'CONNECTED_TO'
```

**2nd degree** (contacts connected to this contact but not to owner):
```sql
SELECT c2.id, c2.full_name, c2.title
FROM edges e
JOIN contacts c2 ON c2.id = e.target_contact_id
WHERE e.source_contact_id = $contact_id
  AND e.edge_type = 'CONNECTED_TO'
  AND c2.id NOT IN (
    SELECT e2.target_contact_id FROM edges e2
    WHERE e2.source_contact_id = $owner_id
  )
```

---

## 4. Implementation Phases

### Phase 1: Radar Chart + ICP Transparency (1 day)
- Replace DimensionParallel with RadarChart on Scores tab
- Add ICP Fit criteria breakdown (which ICP, which criteria matched)
- Show which ICP was used for scoring

### Phase 2: ECC Gauges (1-2 days)
- Compute DCTE, RSTE, EMOT, SCEN from existing data
- Build gauge components (progress bar, radial, thermometer, grade)
- Add to Overview tab on contact page

### Phase 3: DTSE + Tags + Goals (1 day)
- Query and display goals/tasks for contact
- Tag editing with autocomplete
- "Next Best Action" from goal engine

### Phase 4: Network Tab Enhancement (1 day)
- Mutual contacts query + display
- 2nd/3rd degree reachable contacts
- Link to ego network graph view

### Phase 5: Natural ICP Auto-detection (1 day)
- Analyze owner profile on import
- Auto-generate Natural ICP from network composition
- Store as system ICP, set as default

### Phase 6: Output to User Profile (1 day)
- Aggregate ECC scores across all contacts into owner profile summary
- Dashboard widgets: network health, relationship strength distribution
- Profile page: "Your network at a glance" with aggregate DCTE/RSTE/EMOT/SCEN
