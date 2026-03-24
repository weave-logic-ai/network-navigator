# Network Graph & Contact Intelligence Sprint Plan

**Status**: Implementation Plan
**Date**: 2026-03-24
**Scope**: Network graph rebuild, contact page redesign, ICP transparency, ECC gauges

---

## Sprint Overview

Two workstreams running in parallel:

| Workstream | Phases | Outcome |
|-----------|--------|---------|
| **A. Network Graph Rebuild** | 4 phases | 6,200-node graph with spectral communities, taxonomy view, knowledge graph |
| **B. Contact Intelligence** | 6 phases | Radar chart, 5 ECC gauges, ICP breakdown, mutual contacts, tags |

---

## Workstream A: Network Graph Rebuild

### Current State
- Reagraph WebGL capped at 300 nodes (5% of network)
- 157K edges — 82% synthetic noise (`mutual-proximity`)
- Node.js-computed metrics (5-10 sec)
- Community detection = company-name grouping (not topology-based)
- No niche/ICP graph view, no conversation graph, no knowledge graph

### Target State
- Sigma.js rendering 6,200+ nodes at 60fps
- ~2,500 real relationship edges (noise removed)
- RuVector native graph engine for all computation (<100ms)
- Spectral clustering for real communities
- 4 graph views: Contact Network, Taxonomy, Conversation, Knowledge

---

### Phase A1: RuVector Graph Engine + Edge Cleanup (1-2 days)

**Files to create/modify:**

| File | Action |
|------|--------|
| `lib/graph/ruvector-sync.ts` | NEW: Sync edges table → RuVector named graph |
| `lib/graph/metrics.ts` | REWRITE: Use `ruvector_graph_pagerank()` + `ruvector_graph_centrality()` instead of Node.js |
| `lib/graph/communities.ts` | REWRITE: Use `ruvector_spectral_cluster()` instead of company grouping |
| `app/api/graph/compute/route.ts` | UPDATE: Call RuVector functions instead of Node.js |

**Tasks:**

1. Create `contacts` named graph in RuVector
2. Sync function: insert contacts as nodes (with tier, niche, pagerank as properties)
3. Insert ONLY real edges: `CONNECTED_TO` (917), `MESSAGED` (304), `same-company` (1,163), `INVITED_BY` (116), endorsements, recommendations — ~2,500 total
4. Replace `computeAllMetrics()` with:
   ```sql
   SELECT ruvector_graph_pagerank('contacts', 0.85, 0.001);
   SELECT ruvector_graph_centrality('contacts', 'betweenness');
   ```
5. Replace `detectCommunities()` with `ruvector_spectral_cluster()`
6. Store results in existing `graph_metrics` + `clusters` tables
7. Add compound index: `CREATE INDEX idx_edges_target_type ON edges(target_contact_id, edge_type)`

**Verification:**
- `ruvector_graph_stats('contacts')` shows correct node/edge count
- PageRank computation < 200ms
- Communities are topology-based (not just company names)

---

### Phase A2: Sigma.js Visualization (2-3 days)

**Dependencies to install:** `sigma`, `graphology`, `graphology-layout-forceatlas2`, `graphology-layout`, `@sigma/react`

**Files to create/modify:**

| File | Action |
|------|--------|
| `components/network/sigma-graph.tsx` | NEW: Sigma.js graph component |
| `components/network/graph-search.tsx` | NEW: Search bar → highlight + zoom to node |
| `components/network/ego-panel.tsx` | NEW: Ego network isolation view |
| `app/api/graph/sigma-data/route.ts` | NEW: Sigma-formatted graph data with server-side filtering |
| `app/api/graph/ego/[contactId]/route.ts` | NEW: Ego network subgraph |
| `app/(app)/network/page.tsx` | UPDATE: Add Sigma tab alongside existing Reagraph |

**API: `GET /api/graph/sigma-data`**
```
Query params: limit, nicheId, icpId, edgeTypes, minPagerank
Response: {
  nodes: [{ key, attributes: { label, x, y, size, color, tier, niche, pagerank } }],
  edges: [{ key, source, target, attributes: { type, weight } }],
  stats: { totalNodes, loadedNodes, communities }
}
```

**Features:**
- ForceAtlas2 layout (web worker — non-blocking)
- WebGL renderer with viewport culling
- Node coloring: tier, niche, ICP fit, PageRank heatmap
- Node sizing: connections, PageRank, composite score
- Edge type filtering checkboxes
- Click node → ContactTooltip popover
- Double-click → ego network isolation
- Search bar → highlight + zoom
- Niche/ICP filter integration from Discover page

**Progressive loading:**
- Initial: top 500 nodes by PageRank + their direct edges
- On zoom: fetch additional nodes visible in viewport
- On ego click: fetch 2nd degree neighbors on demand

---

### Phase A3: Taxonomy & Conversation Graphs (1-2 days)

**Files to create:**

| File | Action |
|------|--------|
| `components/network/taxonomy-graph.tsx` | NEW: D3/visx radial tree or Sankey |
| `components/network/conversation-graph.tsx` | NEW: Message flow visualization |
| `app/api/graph/taxonomy/route.ts` | NEW: Industry→Niche→ICP hierarchy with counts |
| `app/api/graph/conversations/route.ts` | NEW: Message edges with temporal data |

**Taxonomy Graph:**
- Industries as outer ring, niches as middle, ICPs as inner
- Node size = contact count in that segment
- Edge thickness = flow of contacts through hierarchy
- Click to drill into segment contacts
- Implementation: visx radial tree (< 100 nodes, doesn't need Sigma)

**Conversation Graph:**
- 304 MESSAGED edges — small, focused view
- Node size = total messages exchanged
- Edge color = recency (green→yellow→red)
- Optional: timeline scrubber to animate message history

---

### Phase A4: Knowledge Graph — Dual Engine (2-3 days)

**Files to create:**

| File | Action |
|------|--------|
| `lib/graph/knowledge-local.ts` | NEW: Local entity extraction + co-occurrence graph |
| `lib/graph/knowledge-infranodus.ts` | NEW: InfraNodus integration with taxonomy-aware input prep |
| `lib/graph/knowledge-engine.ts` | NEW: Engine selector (try InfraNodus → fallback local) |
| `app/api/graph/knowledge/route.ts` | NEW: On-demand knowledge graph generation |
| `components/network/knowledge-graph.tsx` | NEW: Entity graph visualization |
| `data/db/init/032-knowledge-schema.sql` | NEW: knowledge_snapshots table |

**Local engine pipeline:**
```
Contact profiles → entity extraction (ROLE, SKILL, INDUSTRY, TECH, COMPANY)
  → co-occurrence edges (entities in same profile)
  → store in RuVector "knowledge" graph
  → spectral clustering on entity graph
  → betweenness centrality → find bridge entities
  → output: clusters, bridges, gaps
```

**InfraNodus integration (when available):**
- Structured per-niche input with `[[entity]]` markup
- `extractEntitiesOnly` mode for ontology
- Entity normalization before sending
- 7-day cache with smart invalidation

**Fallback:** Local engine always works. InfraNodus enhances quality when available.

---

## Workstream B: Contact Intelligence

### Current State
- Basic contact detail page with 5 tabs (Profile, Network, Scores, Enrichment, Activity)
- Parallel line chart for dimension profile
- ICP used for scoring is invisible to user
- No mutual contacts shown, no tags editing, no goals/tasks on profile

### Target State
- Radar chart for scoring dimensions
- 5 ECC gauges (DCTE, DTSE, RSTE, EMOT, SCEN)
- ICP criteria breakdown with transparency
- Editable tags, goals/tasks panel, mutual contacts, 2nd/3rd degree

---

### Phase B1: Radar Chart + ICP Transparency (1 day)

**Files to create/modify:**

| File | Action |
|------|--------|
| `components/contacts/dimension-radar.tsx` | NEW: recharts RadarChart for 9 dimensions |
| `app/api/contacts/[id]/icp-breakdown/route.ts` | NEW: Which ICP, which criteria matched |
| `app/(app)/contacts/[id]/page.tsx` | UPDATE: Replace DimensionParallel with radar |

**Radar Chart:**
- 9 axes: ICP Fit, Network Hub, Relationship Strength, Signal Boost, Skills Relevance, Network Proximity, Behavioral, Content Relevance, Graph Centrality
- Each 0-1 range, filled polygon
- Faint outline showing "ideal" profile

**ICP Breakdown:**
- Show which ICP was used (name + link)
- Per-criterion: matched/unmatched, what matched, raw value
- Option to re-score against a different ICP

---

### Phase B2: ECC Gauges (1-2 days)

**Files to create:**

| File | Action |
|------|--------|
| `lib/ecc/gauges.ts` | NEW: Compute all 5 ECC gauge scores from existing data |
| `components/contacts/dcte-gauge.tsx` | NEW: Data completeness progress bar |
| `components/contacts/rste-gauge.tsx` | NEW: Relationship radial gauge |
| `components/contacts/emot-gauge.tsx` | NEW: Interest thermometer |
| `components/contacts/scen-gauge.tsx` | NEW: Confidence grade badge |
| `components/contacts/dtse-panel.tsx` | NEW: Goals/tasks/strategy panel |
| `app/api/contacts/[id]/gauges/route.ts` | NEW: All gauge scores for a contact |

**Computation sources (all existing data, no new ML):**

| Gauge | Data Sources |
|-------|-------------|
| DCTE | Non-null field count, enrichment history, scoring status, embedding exists |
| DTSE | Goals + tasks with this contact_id, persona, referral signals |
| RSTE | Message stats, edge count, endorsements, connection age, interaction recency |
| EMOT | Behavioral observations, posting frequency, content engagement, response patterns |
| SCEN | Total data points, scoring dimensions with data, enrichment source count, edge count |

---

### Phase B3: DTSE + Tags + Goals (1 day)

**Files to modify:**

| File | Action |
|------|--------|
| `app/(app)/contacts/[id]/page.tsx` | UPDATE: Add DTSE panel, tag editor, goals section |
| `app/api/contacts/[id]/route.ts` | UPDATE: Support tag PATCH |
| `app/api/contacts/[id]/goals/route.ts` | NEW: Goals/tasks for this contact |

**Tag editing:**
- Badges with "×" remove, "+" add with autocomplete
- `PATCH /api/contacts/:id { tags: [...] }` saves instantly

**Goals/Tasks panel:**
- Query: `SELECT * FROM goals g JOIN tasks t ON t.goal_id = g.id WHERE t.contact_id = $1`
- Plus standalone tasks: `SELECT * FROM tasks WHERE contact_id = $1 AND goal_id IS NULL`
- Show with status badges, action buttons (Start, Complete, Skip)
- "Next Best Action" recommendation

---

### Phase B4: Network Tab Enhancement (1 day)

**Files to create/modify:**

| File | Action |
|------|--------|
| `app/api/contacts/[id]/network/route.ts` | NEW: Mutual contacts, 2nd/3rd degree |
| `app/(app)/contacts/[id]/page.tsx` | UPDATE: Network tab with contact lists |

**Mutual contacts query:**
```sql
-- Contacts connected to BOTH owner and this contact
SELECT DISTINCT c2.id, c2.full_name, c2.title, c2.current_company
FROM edges e1
JOIN edges e2 ON e2.target_contact_id = e1.target_contact_id
JOIN contacts c2 ON c2.id = e1.target_contact_id
WHERE e1.source_contact_id = $owner_id
  AND e2.source_contact_id = $contact_id
  AND e1.edge_type IN ('CONNECTED_TO','same-company')
  AND e2.edge_type IN ('CONNECTED_TO','same-company')
  AND c2.id != $owner_id AND c2.id != $contact_id
```

**2nd degree** (their connections we don't have):
```sql
SELECT c2.id, c2.full_name, c2.title
FROM edges e
JOIN contacts c2 ON c2.id = e.target_contact_id
WHERE e.source_contact_id = $contact_id
  AND NOT EXISTS (SELECT 1 FROM edges e2 WHERE e2.source_contact_id = $owner_id AND e2.target_contact_id = c2.id)
  AND c2.id != $owner_id
LIMIT 50
```

**Display:**
- "Mutual Connections (N)" — clickable list with ContactTooltip on hover
- "2nd Degree via [Name] (N)" — expandable list
- "View in Network Graph" button → opens ego network in graph view

---

### Phase B5: Natural ICP Auto-detection (1 day)

The Natural ICP is **heavily weighted toward the owner's profile** (60%) with network composition as secondary signal (40%). This reflects the fact that your profile is what you intentionally present — it's the strongest signal of who you serve.

**Files to create/modify:**

| File | Action |
|------|--------|
| `lib/scoring/natural-icp.ts` | NEW: Analyze owner profile (60%) + network (40%) → generate ICP |
| `lib/import/pipeline.ts` | UPDATE: Call natural ICP generation after import |
| `app/(app)/profile/page.tsx` | UPDATE: Show Natural ICP + "Active ICP" selector |

**Algorithm:**
```
Owner Profile Analysis (60% weight):
  1. headline → extract industry keywords, role targets ("Helping [X]"), service signals
  2. positions history → industries worked in, company sizes, role expertise
  3. skills array → technical signals, domain expertise indicators
  4. summary/about → positioning language, pain points addressed
  5. endorsements received → what your network values about you
  6. recommendations received → themes in social proof

Network Analysis (40% weight):
  1. Top 10 title patterns by frequency → roles you attract
  2. Top 5 industries by contact count → industries you're embedded in
  3. Most common company size range → your natural market
  4. Niche membership distribution → which niches you already serve

Weighted merge:
  - roles = profile-derived targets (60%) + network top roles (40%)
  - industries = profile industry signals (60%) + network industry distribution (40%)
  - signals = owner skills + headline keywords (profile is 100% here)
  - companySizeRanges = blended from positions history + network

Output: icp_profiles with source='natural', name='Natural ICP (auto-detected)'
```

The Natural ICP answers: **"Based on who you are and who already surrounds you, this is the buyer profile you naturally attract."** The Desired ICP (Phase C1) then lets you set where you WANT to go, and the gap between them drives strategy.

---

### Phase B6: Output to User Profile (1 day)

**Aggregate ECC scores across network into owner profile dashboard:**

| Metric | Aggregation | Display |
|--------|------------|---------|
| Network DCTE | Average completeness across all contacts | "Your network is 68% complete" |
| Relationship Health | Distribution of RSTE scores | Pie: strong/warm/cooling/dormant |
| Interest Distribution | EMOT temperature histogram | "42 hot, 89 warm, 340 cold" |
| Assessment Confidence | SCEN grade distribution | "A: 12%, B: 34%, C: 40%, D: 14%" |
| Coverage | Contacts matched to niches / total | "32% of network addressed" |

**Stored in:** `owner_profiles.metadata.networkHealth` — refreshed on reindex.

---

## Priority Order

| # | Phase | Est. | Depends On | Value |
|---|-------|------|-----------|-------|
| 1 | B1: Radar + ICP transparency | 1d | — | High: users can see why contacts scored as they did |
| 2 | A1: RuVector graph engine | 1-2d | — | High: unblocks all graph improvements |
| 3 | B2: ECC gauges | 1-2d | — | High: contact intelligence visible |
| 4 | A2: Sigma.js visualization | 2-3d | A1 | High: graph becomes usable |
| 5 | B3: DTSE + tags + goals | 1d | — | Medium: actionable contact profiles |
| 6 | B4: Network tab (mutual contacts) | 1d | — | Medium: relationship discovery |
| 7 | A3: Taxonomy + conversation graphs | 1-2d | A1 | Medium: new graph views |
| 8 | B5: Natural ICP (owner profile weighted) | 1d | — | Medium: auto-configured scoring |
| 9 | C1: Desired ICP selector on profile page | 1d | B5 | High: user sets target niche/ICP/offering |
| 10 | C2: Gap analysis engine | 1-2d | B5, C1 | High: strategic gap between natural and desired |
| 11 | C3: Profile optimization suggestions | 1d | C2 | High: actionable tasks from gap analysis |
| 12 | C4: Discover page defaults from desired ICP | 0.5d | C1 | Medium: pre-select saved niche/ICP |
| 13 | A3: Taxonomy + conversation graphs | 1-2d | A1 | Medium: new graph views |
| 14 | A4: Knowledge graph | 2-3d | A1 | Medium: semantic network analysis |
| 15 | B6: User profile aggregation | 1d | B2 | Low: dashboard rollup |

**Total estimate**: ~16-20 days across all workstreams.

---

## Workstream C: ICP Alignment Engine

### Concept

Two ICP profiles drive strategy:
- **Natural ICP** (60% owner profile, 40% network composition) = "Who your network already looks like"
- **Desired ICP** (user-selected niche/ICP/offering on profile page) = "Who you want to attract"

The **gap** between them drives profile optimization, content strategy, and network growth suggestions.

### Phase C1: Desired ICP Selector on Profile Page (1 day)

**Files to create/modify:**

| File | Action |
|------|--------|
| `components/profile/desired-icp-selector.tsx` | NEW: Reuse niche/ICP/offering dropdowns from Discover |
| `app/api/profile/desired-icp/route.ts` | NEW: GET/POST desired ICP config |
| `app/(app)/profile/page.tsx` | UPDATE: Add ICP Alignment section |

**UX**: Same niche/ICP/offering selectors from Discover page, but with "Save as Default" button and "Show on Discover" checkbox. When saved:
- Stored in `owner_profiles.metadata.desiredIcpConfig`
- Creates/updates an `icp_profiles` row with `source = 'desired'`
- If `isDefault = true`, Discover page pre-selects this niche/ICP

### Phase C2: Gap Analysis Engine (1-2 days)

**Files to create:**

| File | Action |
|------|--------|
| `lib/scoring/icp-gap-analysis.ts` | NEW: Compare Natural vs Desired ICP |
| `app/api/profile/gap-analysis/route.ts` | NEW: Return gap analysis with suggestions |
| `components/profile/icp-alignment.tsx` | NEW: Alignment score + gap visualization |

**Gap detection**:
- Missing industry keywords in headline/about/skills
- Missing role language (e.g., "Helping [X]" not present)
- Niche keywords absent from profile
- Low contact count in desired niche vs target
- Company size mismatch between your history and desired ICP

**Alignment score**: 0-100% — weighted combination of keyword overlap, niche coverage, and signal presence.

### Phase C3: Profile Optimization Suggestions (1 day)

**Files to create:**

| File | Action |
|------|--------|
| `components/profile/gap-suggestions.tsx` | NEW: Suggestion cards with "Create Task" buttons |

**Suggestion types**:

| Type | Example | Task Created |
|------|---------|-------------|
| Profile Update | "Add 'e-commerce' to your headline" | Task: "Update LinkedIn headline" with suggested text |
| Content Strategy | "Post about headless commerce" | Task: "Write post about [topic]" with talking points |
| Skill Addition | "Add 'Shopify Plus' to skills" | Task: "Update LinkedIn skills section" |
| Network Growth | "Connect with 15 more D2C operators" | Task with LinkedIn search URL |
| Engagement | "Comment on 3 e-commerce posts this week" | Task: "Engage with [niche] content" |

Each suggestion shows **impact** (high/medium/low) and **effort** (quick/moderate/significant). Clicking "Create Task" converts it to a goal task.

### Phase C4: Discover Page Defaults (0.5 days)

When a Desired ICP is saved with `isDefault = true`:
- Discover page loads and pre-selects that niche/ICP in the dropdowns
- Wedge chart highlights the desired niche's wedge
- Goal engine uses desired ICP for context-aware checks

---

## Browser Extension Issues (Resolved)

### Problem 1: SEARCH_PEOPLE captures parse but don't import contacts
**Fixed**: Added `upsertContactsFromSearch()` in `contact-upsert.ts`, wired into `parse-engine.ts`. Also fixed column name bugs (`company` → `current_company`, etc.). Added fallback href-pattern extraction for LinkedIn's obfuscated CSS classes.

**Result**: 3 existing captures re-parsed → 48 contacts imported (28 new, 20 updated).

### Problem 2: Network exploration stops after page 1
**Fixed**: Capture endpoint now creates follow-up task for next page (up to 10 pages max). Only completes ONE task per capture (was completing all matching). Follow-up tasks inherit goal_id.

### Remaining: Browser-side auto-pagination
Not implemented (requires careful browser control). Current approach: server creates the task, user manually navigates to next page, extension captures it. The task URL is pre-populated with the correct page number.

---

## Full Plan Reference Documents

| Document | Location |
|----------|----------|
| This sprint plan | `docs/plans/network-and-contacts-sprint.md` |
| ICP Alignment Engine (detailed) | `docs/plans/icp-alignment-engine.md` |
| Graph Architecture (detailed) | `docs/plans/graph-architecture.md` |
| Contact Intelligence (detailed) | `docs/plans/contact-intelligence.md` |
| Goal Engine (detailed) | `docs/plans/goal-engine.md` |
