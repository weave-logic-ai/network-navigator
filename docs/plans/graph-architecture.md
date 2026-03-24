# Network Graph Architecture — Mini-Symposium & Implementation Plan

**Status**: Design Document
**Date**: 2026-03-24
**Scope**: Contact network graph, niche/ICP taxonomy graph, conversation graph, knowledge graph

---

## Current State Analysis

### What Exists
- **Reagraph** (WebGL/Three.js) visualization, hard-capped at 300 nodes
- **157,405 edges** across 6,201 contacts (82% synthetic `mutual-proximity`, only 1,221 real relationship edges)
- **Node.js-computed metrics**: PageRank, betweenness (50-sample approximation), degree centrality
- **Attribute-based community detection**: Groups by company name / industry — not topology-aware
- **3 layout algorithms**: Force-directed 2D, circular, tree
- **Basic controls**: Color by tier/company/persona, size by score/connections, edge type filter

### What's Broken
| Problem | Root Cause | Impact |
|---------|-----------|--------|
| Only 5% of network visible | Hard-coded 300-node limit | Can't explore full network |
| No meaningful clusters | Attribute grouping, not spectral | "Communities" are just company lists |
| 82% edges are noise | `mutual-proximity` edges dominate | Real relationships invisible |
| Jank on filter changes | Force simulation recalculates every frame, `animated={true}` | Poor UX |
| No niche/ICP graph view | Only contact↔contact edges | Can't see taxonomy structure |
| No conversation view | Message data exists but isn't graphed | Relationship patterns invisible |
| Node.js metric computation | 157K edges loaded into memory | 5-10 second compute, blocks request |

### Key Discovery: RuVector Has a Native Graph Engine

RuVector 0.3.0 includes a **full Cypher-queryable graph engine** running in-database:

```sql
-- Tested and working:
ruvector_create_graph('network')        -- Create named graph
ruvector_add_node('network', labels, properties)  -- Add nodes with labels
ruvector_add_edge('network', src, dst, type, properties)  -- Typed edges
ruvector_cypher('network', 'MATCH (n) RETURN n', '{}')  -- CYPHER QUERIES!
ruvector_graph_pagerank('network', 0.85, 0.001)  -- Native PageRank
ruvector_graph_centrality('network', 'degree')   -- Degree/betweenness
ruvector_shortest_path('network', src, dst, maxDepth)  -- BFS paths
ruvector_spectral_cluster(edges_json, k)  -- Spectral clustering
ruvector_pagerank_personalized(edges, seed, damping, tolerance)  -- PPR
```

This eliminates the need for Node.js metric computation entirely. Graph operations run at database speed with proper indexing.

---

## Architecture Decision: Approach C (Hybrid)

Based on the InfraNodus structural analysis of our options, **Approach C** bridges the most architectural gaps:

**RuVector** (computation) + **Sigma.js/Graphology** (visualization) + **InfraNodus** (knowledge graph analysis)

### Why This Approach

| Layer | Tool | Replaces | Benefit |
|-------|------|----------|---------|
| **Storage & Computation** | RuVector native graph | Node.js metrics, PostgreSQL edges | Cypher queries, native PageRank/centrality/clustering in DB |
| **Visualization** | Sigma.js + Graphology | Reagraph | 10K+ nodes natively, ForceAtlas2, WebGL, viewport virtualization |
| **Knowledge Analysis** | InfraNodus MCP | Nothing (new) | Text network analysis, topical clustering, content gaps |

### What We Keep
- PostgreSQL `edges` table (source of truth, synced to RuVector graph)
- Existing graph DB schema (graph_metrics, clusters, cluster_memberships)
- API route structure (`/api/graph/*`)

### What We Replace
- Reagraph → Sigma.js with `@sigma/react`
- Node.js PageRank/betweenness → `ruvector_graph_pagerank()` / `ruvector_graph_centrality()`
- Company-based clustering → `ruvector_spectral_cluster()`
- 300-node limit → Progressive loading with Sigma.js viewport culling

---

## Graph Types & Their Representations

### 1. Contact Network Graph (Primary)

**Purpose**: Explore your professional network — who connects to whom, through what relationships.

**Data model in RuVector**:
```
Graph: "contacts"
Nodes: contact (labels: [tier, niche, degree])
Edges: CONNECTED_TO, MESSAGED, SAME_COMPANY, ENDORSED, RECOMMENDED
```

**Key differences from current**:
- **Drop synthetic edges**: Remove `mutual-proximity` (129K noise edges). Keep only real relationships: CONNECTED_TO (917), MESSAGED (304), same-company (1,163), invitations (116), endorsements, recommendations
- **Result**: ~2,500 meaningful edges instead of 157K noise — graph becomes readable
- **Progressive loading**: Sigma.js loads visible viewport first, fetches neighbors on zoom/pan
- **Spectral communities**: Real topology-based clusters using `ruvector_spectral_cluster()`

**Views**:
- **Full network**: All 6,200 nodes, colored by tier/niche, sized by PageRank
- **Ego network**: Click a contact → show their 1st and 2nd degree neighbors only
- **Niche-filtered**: Select a niche → highlight matching contacts, dim others
- **ICP overlay**: Select an ICP → color contacts by fit score (green=match, gray=no match)
- **Path finder**: Select two contacts → show shortest path with relationship labels

**Layouts**:
- ForceAtlas2 (default — Sigma.js native, handles 10K nodes)
- Circular by niche/tier
- Hierarchical by degree (1st → 2nd → 3rd)

### 2. Niche/ICP Taxonomy Graph

**Purpose**: Visualize the Industry → Niche → ICP → Offering hierarchy with contact counts as node sizes.

**Data model**:
```
Graph: "taxonomy"
Nodes: industry, niche, icp, offering (different colors/shapes)
Edges: CONTAINS (industry→niche), TARGETS (icp→niche), DELIVERS (offering→icp)
Node size: proportional to matching contact count
```

**Visualization**:
- **Radial tree** or **Sankey diagram** (not force-directed — hierarchy needs structure)
- Industries as outer ring, niches as middle ring, ICPs as inner ring
- Click a node → drill into that segment's contacts
- Edge thickness = number of contacts flowing through that path

**Implementation**: Lighter weight — visx or D3 hierarchical layout, not Sigma.js (Sigma is overkill for <100 taxonomy nodes)

### 3. Conversation Graph

**Purpose**: Understand messaging patterns — who you talk to, how often, response times.

**Data model**:
```
Graph: "conversations"
Nodes: contact (size = message count)
Edges: MESSAGED (weight = message count, properties: { lastMessageAt, avgResponseTime })
```

**Key insight**: Only 304 MESSAGED edges exist. This is a small, dense graph — perfect for a focused view.

**Visualization**:
- Sigma.js or even Reagraph (304 edges is tiny)
- Node size = total messages exchanged
- Edge thickness = message frequency
- Color = recency (green=recent, yellow=cooling, red=dormant)
- Timeline slider: show message activity over time

### 4. Knowledge Graph (via InfraNodus)

**Purpose**: Discover what topics, skills, and industries connect your contacts — semantic relationships beyond direct connections.

**Data flow**:
```
Contact profiles (headlines, titles, about, skills)
  → Concatenate per niche/ICP
  → Send to InfraNodus analyze_text / generate_knowledge_graph
  → Get topical clusters, content gaps, conceptual bridges
  → Display as interactive knowledge map
```

**Use cases**:
- "What skills bridge Healthcare and Fintech in my network?"
- "Where are the content gaps — topics my network talks about but I don't address?"
- "Which contacts are conceptual bridges between unrelated industries?"

**Implementation**: On-demand analysis via InfraNodus MCP tools. Results cached and displayed as a separate "Knowledge" tab on the network page.

---

## Implementation Phases

### Phase 1: Foundation — RuVector Graph Engine + Edge Cleanup (1-2 days)

**Goal**: Move graph computation into the database, clean up edge data.

1. **Sync edges to RuVector graph**
   - Create `contacts` named graph in RuVector
   - Populate from `edges` table, **excluding** `mutual-proximity` and `same-cluster` (synthetic)
   - Add contact properties as node labels (tier, niche, degree)
   - Create sync function that runs after import/scoring

2. **Replace Node.js metrics with RuVector native**
   - `computeAllMetrics()` → `ruvector_graph_pagerank()` + `ruvector_graph_centrality()`
   - Store results in existing `graph_metrics` table
   - 100x faster — runs in DB, not in Node.js memory

3. **Spectral community detection**
   - Replace company-grouping with `ruvector_spectral_cluster()`
   - Use real edge topology to find communities
   - Store in existing `clusters` + `cluster_memberships` tables

4. **New API endpoints**
   - `GET /api/graph/sigma-data` — Returns nodes + edges in Sigma.js format with server-side filtering
   - `GET /api/graph/ego/:contactId` — Ego network (1st + 2nd degree neighbors)
   - `GET /api/graph/path/:source/:target` — Shortest path via RuVector
   - `GET /api/graph/communities` — Spectral clusters with members

### Phase 2: Sigma.js Visualization (2-3 days)

**Goal**: Replace Reagraph with Sigma.js for 10K+ node support.

1. **Install dependencies**
   - `sigma`, `graphology`, `graphology-layout-forceatlas2`, `@sigma/react` (or `react-sigma`)

2. **Build new NetworkGraph component**
   - Graphology data model (directed multigraph)
   - ForceAtlas2 layout (runs in web worker — non-blocking)
   - WebGL renderer with viewport culling (only renders visible nodes)
   - Node coloring: tier, niche, ICP fit, PageRank heatmap
   - Node sizing: connections, PageRank, score
   - Edge filtering: by type (CONNECTED_TO, MESSAGED, etc.)

3. **Interaction features**
   - Click node → show contact tooltip (reuse existing ContactTooltip)
   - Click node → ego network isolation mode
   - Drag to pan, scroll to zoom (Sigma.js native)
   - Search bar → highlight + zoom to node
   - Niche/ICP filter from Discover page → pre-filter graph

4. **Progressive loading**
   - Initial load: top 500 nodes by PageRank + their direct edges
   - On zoom: fetch additional nodes in viewport area
   - On ego click: fetch 2nd degree neighbors on demand

### Phase 3: Taxonomy & Conversation Graphs (1-2 days)

**Goal**: Add niche/ICP hierarchy visualization and conversation patterns.

1. **Taxonomy graph** (new tab on Network page)
   - D3 radial tree or Sankey using visx
   - Industry → Niche → ICP with contact counts
   - Click to drill into that segment

2. **Conversation graph** (new tab)
   - Small graph (304 edges) — can use Sigma.js or simpler
   - Message frequency as edge weight
   - Timeline scrubber for temporal view

### Phase 4: Knowledge Graph — Dual Engine (2-3 days)

**Goal**: Semantic analysis of contact profiles for topic/skill/industry relationship discovery.

Two engines: **InfraNodus** (when available, superior analysis) and **local fallback** (self-contained, always works).

#### 4A. Local Knowledge Graph Engine (no external dependencies)

The local engine builds a co-occurrence knowledge graph from contact profile text using tools already in the stack:

**Entity extraction pipeline**:
```
Contact profiles (title, headline, about, skills, company)
  → Normalize + tokenize (remove stopwords, stem)
  → Extract entity types:
      - ROLE entities: from title patterns ("CEO", "VP Engineering", "Founder")
      - SKILL entities: from skills array + headline keywords
      - INDUSTRY entities: from company industry + headline
      - TECHNOLOGY entities: from skills + about section patterns
      - COMPANY entities: from current_company
  → Build co-occurrence edges: entities that appear in the same contact's profile
  → Weight edges by frequency (how many contacts share both entities)
  → Store in RuVector graph: "knowledge"
  → Run spectral clustering on the entity graph
  → Compute betweenness centrality to find "bridge" entities
```

**What this produces without InfraNodus**:
- **Topical clusters**: Groups of related skills/roles/industries (e.g., "DevOps cluster: Kubernetes, Docker, CI/CD, AWS, SRE")
- **Bridge entities**: Skills/roles that connect otherwise separate clusters (e.g., "data engineering" bridges "Analytics" and "Engineering" clusters)
- **Coverage gaps**: Entity clusters with no contacts (detected via niche keywords vs entity graph)
- **Niche affinity scores**: How well each niche's keywords align with the entity graph topology

**Storage**: Entities as nodes in RuVector `knowledge` graph, co-occurrence as weighted edges. Results cached in `niche_profiles.metadata` and a new `knowledge_snapshots` table.

**Visualization**: Sigma.js rendering of the entity graph (separate from contact graph). Nodes are entities, sized by frequency, colored by type (role=blue, skill=green, industry=orange, tech=purple). Click an entity → see which contacts have it.

#### 4B. InfraNodus Integration (when available, enhanced analysis)

InfraNodus provides superior text network analysis but requires careful input structuring.

**Taxonomy-aware input preparation** (critical for quality results):

```typescript
// BAD: Dump all contacts as one blob
// "CEO at Shopify, VP Engineering at Stripe, Founder of healthcare startup..."
// → InfraNodus sees noise, can't segment

// GOOD: Structured per-niche with [[entity]] markup
function prepareNicheForInfraNodus(nicheId: string): string {
  // 1. Get contacts matching this niche
  // 2. For each contact, build a structured statement:
  //    "[[CEO]] at [[Shopify]] works in [[e-commerce]] with skills in [[Shopify Plus]] [[headless commerce]] [[subscription]]"
  // 3. Separate statements with newlines (InfraNodus treats each line as a statement)
  // 4. Use [[wikilinks]] for entities we want InfraNodus to detect
  // 5. Group by sub-segments within the niche for better clustering
}
```

**Input preparation rules**:
1. **One niche per analysis** — don't mix niches, InfraNodus clusters within a single text
2. **[[Entity markup]]** for all known entities: company names, role titles, skills, technologies
3. **Consistent entity naming** — normalize "VP Eng" / "VP Engineering" / "VP of Engineering" to `[[VP Engineering]]`
4. **Statement separation** — each contact = one line, so InfraNodus builds co-occurrence per-contact
5. **modifyAnalyzedText: "extractEntitiesOnly"** for taxonomy/ontology generation
6. **modifyAnalyzedText: "detectEntities"** for mixed entity + keyword analysis
7. **Include niche context** — prepend niche name and keywords as the first statement to anchor the analysis

**InfraNodus tool selection by use case**:

| Use Case | Tool | Parameters |
|----------|------|-----------|
| Niche topic map | `generate_knowledge_graph` | `modifyAnalyzedText: "extractEntitiesOnly"` |
| Cross-niche bridges | `overlap_between_texts` | Two niche texts as contexts |
| Content gaps | `generate_content_gaps` | Single niche text |
| Skill clusters | `generate_topical_clusters` | Skills-focused text |
| ICP refinement | `generate_research_questions` | ICP criteria as text |
| Niche comparison | `difference_between_texts` | Two niches to compare |

**Caching strategy**: InfraNodus results cached per niche with a 7-day TTL. Cache key = hash of (niche_id + contact_count + last_updated). Invalidated when contacts are added/removed or niche keywords change.

#### 4C. Engine Selection Logic

```typescript
async function generateKnowledgeGraph(nicheId: string): Promise<KnowledgeGraphResult> {
  // Try InfraNodus first (better quality)
  try {
    const infraResult = await generateViaInfraNodus(nicheId);
    return { source: 'infranodus', ...infraResult };
  } catch {
    // Fallback to local engine (always available)
    const localResult = await generateViaLocalEngine(nicheId);
    return { source: 'local', ...localResult };
  }
}
```

The local engine is always the baseline. InfraNodus enhances it when available. Both produce the same output interface (`KnowledgeGraphResult`) so the UI doesn't care which engine ran.

---

## Technical Decisions

### Edge Strategy: Quality Over Quantity

| Current | Proposed | Rationale |
|---------|----------|-----------|
| 157,405 total edges | ~2,500 real edges | Remove synthetic noise |
| 82% mutual-proximity | 0% | These are ML artifacts, not relationships |
| 16% same-cluster | 0% (derived, not stored) | Recompute via spectral clustering |
| All edges equal weight | Weight by interaction depth | MESSAGED > ENDORSED > CONNECTED_TO > SAME_COMPANY |

### Visualization Library Comparison

| Feature | Reagraph (current) | Sigma.js (proposed) | Cytoscape.js |
|---------|-------------------|--------------------|----|
| Max nodes (smooth) | ~300 | 10,000+ | ~3,000 |
| WebGL | Yes (Three.js) | Yes (native) | Plugin |
| ForceAtlas2 | No | Yes (web worker) | Plugin |
| Viewport culling | No | Yes (native) | No |
| Bundle size | 500KB+ (Three.js) | ~150KB | ~400KB |
| React integration | Native | @sigma/react | cytoscape-react |
| Compound nodes | No | No | Yes |
| Large graph perf | Poor | Excellent | Good |

**Decision**: Sigma.js for contact network (10K nodes). Visx/D3 for taxonomy (< 100 nodes). Keep Reagraph as fallback for 3D if needed.

### Computation Location

| Metric | Current (Node.js) | Proposed (RuVector) |
|--------|-------------------|---------------------|
| PageRank | 5-10 sec, memory-heavy | <100ms, in-DB |
| Betweenness | Approximate (50 samples) | Full computation |
| Communities | Company-name grouping | Spectral clustering |
| Shortest path | BFS in memory | `ruvector_shortest_path()` |
| Personalized PR | Not available | `ruvector_pagerank_personalized()` |

---

## API Design

### Graph Data (for Sigma.js)

```
GET /api/graph/sigma-data?limit=500&nicheId=X&icpId=Y&edgeTypes=CONNECTED_TO,MESSAGED
```

Returns:
```json
{
  "nodes": [{ "key": "uuid", "attributes": { "label": "Name", "x": 0, "y": 0, "size": 5, "color": "#eab308", "tier": "gold", "niche": "E-Commerce" } }],
  "edges": [{ "key": "uuid", "source": "uuid", "target": "uuid", "attributes": { "type": "CONNECTED_TO", "weight": 1.0 } }],
  "stats": { "totalNodes": 6201, "loadedNodes": 500, "totalEdges": 2500, "communities": 12 }
}
```

### Ego Network

```
GET /api/graph/ego/:contactId?depth=2
```

Returns subgraph centered on one contact — their 1st and 2nd degree neighbors with all connecting edges.

### Community Detection

```
POST /api/graph/compute-communities
```

Runs `ruvector_spectral_cluster()` on the real-edge graph. Stores results. Returns community summary.

### Knowledge Graph

```
POST /api/graph/knowledge?nicheId=X
```

Sends niche contacts' profiles to InfraNodus. Returns topical clusters, gaps, bridge concepts.

---

## Migration Plan

### Step 1: Non-breaking
- Add Sigma.js components alongside Reagraph
- New "Sigma" tab on Network page (keep "Classic" tab with Reagraph)
- Build RuVector graph sync as a background job

### Step 2: Feature parity
- Add ego network, search, path finder to Sigma view
- Add taxonomy and conversation tabs
- Verify performance with full 6,200 nodes

### Step 3: Cutover
- Make Sigma the default view
- Remove Reagraph dependency (saves 500KB+ bundle)
- Remove synthetic edge types from edges table

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Nodes renderable | 300 | 6,200+ |
| Edge query time | ~100ms | <20ms (RuVector) |
| Metric computation | 5-10 sec | <100ms |
| Community quality | Company lists | Topology-based spectral |
| Graph views | 1 (contact network) | 4 (contact, taxonomy, conversation, knowledge) |
| Time to meaningful insight | Minutes (scroll through 300 nodes) | Seconds (search, filter, ego) |

---

## Schema Additions

### Knowledge Graph Storage

```sql
-- Knowledge snapshots — cached analysis results per niche
CREATE TABLE knowledge_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche_id UUID REFERENCES niche_profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'local',  -- 'local' or 'infranodus'
  clusters JSONB NOT NULL DEFAULT '[]',  -- topical clusters with entities
  bridges JSONB NOT NULL DEFAULT '[]',   -- bridge entities connecting clusters
  gaps JSONB NOT NULL DEFAULT '[]',      -- structural gaps between clusters
  entity_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_knowledge_niche ON knowledge_snapshots(niche_id, created_at DESC);
```

### RuVector Graph Sync

```sql
-- Two named graphs in RuVector:
-- 1. "contacts" — real relationship edges only
-- 2. "knowledge" — entity co-occurrence graph

-- Sync function (called after import, scoring, or on-demand)
-- Pseudocode:
-- DELETE FROM _ruvector_nodes WHERE graph = 'contacts'
-- INSERT nodes FROM contacts (with tier, niche, pagerank as properties)
-- INSERT edges FROM edges WHERE edge_type IN ('CONNECTED_TO','MESSAGED','same-company','INVITED_BY','ENDORSED','RECOMMENDED')
-- RUN ruvector_graph_pagerank('contacts', 0.85, 0.001) → store in graph_metrics
-- RUN ruvector_spectral_cluster(edges_json, k=auto) → store in clusters
```

---

## Dependencies

| Package | Purpose | Install |
|---------|---------|---------|
| `sigma` | WebGL graph renderer | `npm install sigma` |
| `graphology` | Graph data model | `npm install graphology` |
| `graphology-layout-forceatlas2` | ForceAtlas2 in web worker | `npm install graphology-layout-forceatlas2` |
| `@sigma/react` | React wrapper | `npm install @sigma/react` |
| InfraNodus MCP | Knowledge graph analysis | Already connected |
| RuVector graph engine | In-DB computation | Already available (v0.3.0) |
