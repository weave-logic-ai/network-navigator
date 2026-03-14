# Phase 3: App UI -- Backend Domain Plan (Weeks 9-12)

## Objective

Deliver the API endpoints required by the Phase 3 UI build. Phase 3 backend work is lightweight compared to App: it adds aggregate/read endpoints that compose data already produced by Phase 2 (scoring, enrichment, graph, ICP/niche). No new core logic is introduced; the focus is query composition, response shaping, and performance.

## Prerequisites (from Phases 1-2)

| Prerequisite | Phase | Verified By |
|---|---|---|
| PostgreSQL schema: all core tables (contacts, companies, edges, clusters, scores, enrichments) | 1 | Phase 1 gate |
| `enriched_contacts` materialized view | 2 | Phase 2 backend task |
| Scoring pipeline operational (contact_scores, score_dimensions populated) | 2 | Phase 2 gate |
| Graph analytics computed (PageRank, betweenness, communities) | 2 | Phase 2 gate |
| ICP/niche profiles and wedge_metrics populated | 2 | Phase 2 gate |
| Enrichment budget tracking tables populated | 2 | Phase 2 gate |
| Warm intro path finding via `ruvector_graph_shortest_path()` | 2 | Phase 2 gate |
| Hybrid search via `ruvector_hybrid_search()` and profile_embeddings with HNSW | 1-2 | Phase 2 gate |
| Goal and task tables exist (structure only; populated in Phase 5) | 1 | Phase 1 schema |

---

## Parallel Agent Assignments

| Agent | Role | Endpoints | Est. Effort |
|---|---|---|---|
| Agent B1 | Dashboard + Search APIs | `GET /api/dashboard`, `GET /api/contacts/search`, `GET /api/contacts/similar/:id` | Medium |
| Agent B2 | Graph + Contact Detail APIs | `GET /api/graph/data`, `GET /api/graph/clusters`, `GET /api/graph/path/:from/:to`, `GET /api/graph/stats`, `GET /api/contacts/:id/edges`, `GET /api/contacts/:id/warm-intros`, `GET /api/contacts/:id/observations`, `GET /api/discover/wedge` | Medium |

Both agents can run fully in parallel; there are no cross-dependencies between the two groups.

---

## Detailed Task Checklist

### Task B1-1: GET /api/dashboard -- Aggregate Dashboard Endpoint

**File**: `app/src/app/api/dashboard/route.ts`
**Types**: `app/src/types/dashboard.ts`

**Description**: Single aggregate endpoint returning all data the Dashboard page needs in one round-trip. This avoids N+1 fetches from the client.

**Response Shape** (`DashboardData`):
```typescript
interface DashboardData {
  goals: {
    id: string;
    title: string;
    progress: number;       // 0-100
    targetDate: string;     // ISO date
    taskCount: number;
    completedTaskCount: number;
  }[];                      // top 3 by priority
  extensionStatus: {
    connected: boolean;
    lastSeen: string | null; // ISO timestamp
    captureCount24h: number;
    status: 'green' | 'amber' | 'red';
  };
  networkHealth: {
    total: number;
    enriched: number;
    baseOnly: number;
    unscored: number;
  };
  pendingTasks: {
    id: string;
    title: string;
    category: 'capture' | 'enrich' | 'review' | 'outreach' | 'analyze';
    priority: number;       // 1-5
    contactId: string | null;
    contactName: string | null;
    createdAt: string;
  }[];                      // top 10 by priority
  discoveryFeed: {
    id: string;
    type: 'new_gold' | 'cluster_shift' | 'score_change' | 'enrichment_complete' | 'warm_intro_found' | 'icp_match';
    title: string;
    description: string;
    contactId: string | null;
    contactName: string | null;
    timestamp: string;
    actionLabel: string | null;
    actionUrl: string | null;
  }[];                      // last 20
  icpRadar: {
    profileName: string;
    dimensions: {
      axis: string;         // dimension label
      value: number;        // 0-100
    }[];
  }[];                      // top 3 ICP profiles
  enrichmentBudget: {
    provider: string;
    used: number;
    limit: number;
    unit: 'credits' | 'dollars';
  }[];
}
```

**Sub-tasks**:
- [ ] Define `DashboardData` interface in `app/src/types/dashboard.ts`
- [ ] Implement SQL query for top 3 goals with task counts (from `goals` + `tasks` tables; return empty array if none exist yet)
- [ ] Implement extension status query (from `extension_sessions` or fallback to `{ connected: false, status: 'red' }`)
- [ ] Implement network health query: `SELECT COUNT(*) FILTER (WHERE enrichment_count > 0) AS enriched, COUNT(*) FILTER (WHERE enrichment_count = 0 AND gold_score IS NOT NULL) AS base_only, COUNT(*) FILTER (WHERE gold_score IS NULL) AS unscored, COUNT(*) AS total FROM contacts`
- [ ] Implement pending tasks query: top 10 from `tasks` ordered by priority DESC, status = 'pending'
- [ ] Implement discovery feed query: last 20 from `discovery_events` ordered by timestamp DESC (create table if not exists; Phase 5 populates it; return empty for now)
- [ ] Implement ICP radar query: top 3 niche profiles with their scoring dimension weights normalized to 0-100
- [ ] Implement enrichment budget query: aggregate from `enrichment_budget` table per provider
- [ ] Compose all sub-queries into single handler with `Promise.all()` for parallel DB execution
- [ ] Add response caching header: `Cache-Control: private, max-age=15` (SWR will revalidate at 30s)

**Acceptance Criteria**:
- Endpoint returns 200 with complete `DashboardData` shape even when tables are empty (graceful nulls/empty arrays)
- Response time < 200ms with 1000 contacts
- All numeric fields are actual numbers, not strings
- Dates are ISO 8601 strings

**BR References**: BR-708 (goal focus), BR-1001 (network health), BR-703 (task queue), BR-704 (task priority), BR-709 (discovery feed), BR-1002 (ICP radar), BR-1003 (enrichment budget)

---

### Task B1-2: GET /api/contacts/search -- Hybrid Search Endpoint

**File**: `app/src/app/api/contacts/search/route.ts`
**Types**: `app/src/types/search.ts`

**Description**: Hybrid search combining vector similarity (via `profile_embeddings` + HNSW) and BM25 text search via `ruvector_hybrid_search()`. Powers the Command Palette and contact search across the app.

**Query Parameters**:
```
q: string             // search query (required, min 2 chars)
limit: number         // default 20, max 100
offset: number        // default 0
tier: string[]        // filter by tier (gold, silver, bronze, watch)
cluster_id: string    // filter by cluster
niche_id: string      // filter by niche/ICP
sort: string          // 'relevance' (default) | 'score' | 'name' | 'updated'
```

**Response Shape** (`SearchResult`):
```typescript
interface ContactSearchResult {
  id: string;
  slug: string;
  firstName: string;
  lastName: string;
  headline: string | null;
  company: string | null;
  title: string | null;
  tier: 'gold' | 'silver' | 'bronze' | 'watch';
  goldScore: number | null;
  avatarUrl: string | null;
  relevanceScore: number;   // hybrid search score
}

interface SearchResponse {
  results: ContactSearchResult[];
  total: number;
  query: string;
  took: number;             // ms
}
```

**Sub-tasks**:
- [ ] Define `SearchResponse` and `ContactSearchResult` interfaces
- [ ] Implement hybrid search using `ruvector_hybrid_search()` with query embedding + BM25 on `first_name || ' ' || last_name || ' ' || COALESCE(headline, '') || ' ' || COALESCE(company_name, '')`
- [ ] Add tier/cluster/niche filters as WHERE clause additions
- [ ] Add sort parameter handling (relevance uses hybrid score; score uses gold_score DESC)
- [ ] Add pagination with limit/offset
- [ ] Validate query parameter (min 2 chars, max 200 chars, sanitize SQL injection)
- [ ] Return timing info in `took` field
- [ ] Add index hint for performance: ensure `idx_contacts_search_text` GIN index exists

**Acceptance Criteria**:
- Returns relevant results for name, company, headline, and skill searches
- Hybrid scoring ranks exact name matches above semantic-only matches
- Response time < 100ms for typical queries with 5000 contacts
- Empty query returns 400 error
- SQL injection attempts return 400

**BR References**: BR-211 (command palette search), BR-207 (similar contacts)

---

### Task B1-3: GET /api/contacts/similar/:id -- Vector Similarity Search

**File**: `app/src/app/api/contacts/similar/[id]/route.ts`

**Description**: Find contacts similar to a given contact using cosine similarity on `profile_embeddings` via HNSW index.

**Response Shape**:
```typescript
interface SimilarContactsResponse {
  contact: { id: string; name: string };
  similar: {
    id: string;
    slug: string;
    firstName: string;
    lastName: string;
    headline: string | null;
    company: string | null;
    tier: 'gold' | 'silver' | 'bronze' | 'watch';
    goldScore: number | null;
    similarity: number;     // 0-1 cosine similarity
  }[];
}
```

**Sub-tasks**:
- [ ] Fetch the source contact's embedding from `profile_embeddings`
- [ ] Execute HNSW nearest-neighbor search: `SELECT * FROM ruvector_search('profile_embeddings', $embedding, 20)` excluding the source contact
- [ ] Join results with `contacts` table for display fields
- [ ] Return 404 if source contact not found or has no embedding
- [ ] Add `limit` query parameter (default 10, max 50)

**Acceptance Criteria**:
- Returns contacts ordered by descending similarity
- Similarity scores are between 0 and 1
- Response time < 50ms with HNSW index
- 404 for non-existent contact ID

**BR References**: BR-208 (similar contacts grid on contact detail)

---

### Task B2-1: GET /api/graph/data -- Full Graph Data Endpoint

**File**: `app/src/app/api/graph/data/route.ts`
**Types**: `app/src/types/graph.ts`

**Description**: Returns full graph data (nodes + edges) formatted for reagraph's GraphCanvas component.

**Query Parameters**:
```
cluster_id: string    // optional: filter to single cluster
tier: string[]        // optional: filter by tier
min_score: number     // optional: minimum gold_score
limit: number         // max nodes (default 500, max 2000)
```

**Response Shape** (`GraphData`):
```typescript
interface GraphNode {
  id: string;
  label: string;           // firstName + lastName
  fill: string;            // hex color based on tier
  size: number;            // based on gold_score (10-50)
  data: {
    slug: string;
    tier: 'gold' | 'silver' | 'bronze' | 'watch';
    goldScore: number | null;
    company: string | null;
    clusterId: string | null;
    clusterName: string | null;
    pageRank: number | null;
  };
}

interface GraphEdge {
  id: string;
  source: string;          // contact ID
  target: string;          // contact ID
  label: string;           // edge type
  size: number;            // edge weight (1-5)
  data: {
    type: 'connection' | 'same_company' | 'endorsement' | 'recommendation' | 'shared_group' | 'interaction';
    weight: number;
    createdAt: string;
  };
}

interface GraphDataResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    totalNodes: number;
    totalEdges: number;
    filteredNodes: number;
    filteredEdges: number;
    clusters: number;
  };
}
```

**Sub-tasks**:
- [ ] Define `GraphNode`, `GraphEdge`, `GraphDataResponse` interfaces in `app/src/types/graph.ts`
- [ ] Query contacts with optional filters, limited to `limit` parameter (order by gold_score DESC to keep highest-value nodes)
- [ ] Map tier to fill color: gold -> `#F59E0B`, silver -> `#9CA3AF`, bronze -> `#D97706`, watch -> `#6B7280`
- [ ] Map gold_score to node size: `Math.max(10, Math.min(50, (goldScore / 100) * 50))`
- [ ] Query edges where both source and target are in the filtered node set
- [ ] Map edge type to weight: recommendation=5, endorsement=4, connection=3, same_company=2, shared_group=1
- [ ] Include metadata counts for UI display
- [ ] Add response streaming for large graphs (> 1000 nodes)

**Acceptance Criteria**:
- Returns valid reagraph-compatible node/edge format
- Node colors match tier assignment
- Edge filtering correctly excludes edges to/from excluded nodes
- Response time < 500ms for 500 nodes
- Limit parameter prevents unbounded result sets

**BR References**: BR-1021 (force-directed graph), BR-1022 (cluster view), BR-510 (graph controls)

---

### Task B2-2: GET /api/graph/clusters -- Cluster Metadata

**File**: `app/src/app/api/graph/clusters/route.ts`

**Response Shape**:
```typescript
interface ClusterInfo {
  id: string;
  name: string;
  description: string | null;
  contactCount: number;
  goldCount: number;
  goldPercentage: number;
  topContacts: {
    id: string;
    slug: string;
    name: string;
    goldScore: number;
    tier: string;
  }[];                      // top 5 by gold_score
  avgScore: number;
  dominantCompany: string | null;
  dominantSkills: string[];
}

interface ClustersResponse {
  clusters: ClusterInfo[];
  total: number;
}
```

**Sub-tasks**:
- [ ] Query `clusters` table joined with `contacts` for aggregate stats
- [ ] Compute gold count and percentage per cluster
- [ ] Fetch top 5 contacts per cluster by gold_score (use lateral join or window function)
- [ ] Determine dominant company (mode of company_name within cluster)
- [ ] Determine dominant skills (top 5 skills by frequency within cluster)
- [ ] Order clusters by gold_percentage DESC

**Acceptance Criteria**:
- Returns all clusters with accurate counts
- Gold percentage is a float 0-100
- Top contacts are ordered by gold_score DESC
- Response time < 200ms

**BR References**: BR-511 (cluster sidebar)

---

### Task B2-3: GET /api/graph/path/:from/:to -- Shortest Path

**File**: `app/src/app/api/graph/path/[from]/[to]/route.ts`

**Response Shape**:
```typescript
interface PathResponse {
  from: { id: string; name: string };
  to: { id: string; name: string };
  path: {
    contactId: string;
    slug: string;
    name: string;
    tier: string;
    goldScore: number | null;
  }[];                      // ordered from -> to inclusive
  edges: {
    source: string;
    target: string;
    type: string;
    weight: number;
  }[];
  pathLength: number;
  found: boolean;
}
```

**Sub-tasks**:
- [ ] Call `ruvector_graph_shortest_path()` with from/to contact IDs
- [ ] Enrich path node IDs with contact display data (name, tier, score)
- [ ] Include edge metadata for each hop
- [ ] Return `{ found: false, path: [], edges: [], pathLength: 0 }` when no path exists
- [ ] Validate both contact IDs exist; return 404 if either missing
- [ ] Limit max path length to 6 hops (return not found if longer)

**Acceptance Criteria**:
- Returns correct shortest path between two connected contacts
- Path includes both endpoints
- Returns `found: false` gracefully for disconnected contacts
- Response time < 100ms

**BR References**: BR-1024 (path finder)

---

### Task B2-4: GET /api/graph/stats -- Network Statistics

**File**: `app/src/app/api/graph/stats/route.ts`

**Response Shape**:
```typescript
interface NetworkStatsResponse {
  nodeCount: number;
  edgeCount: number;
  density: number;          // edges / (nodes * (nodes-1) / 2)
  avgDegree: number;
  maxDegree: number;
  clusterCount: number;
  avgClusteringCoeff: number;
  components: number;       // connected components
  avgPathLength: number | null;
  tierDistribution: {
    gold: number;
    silver: number;
    bronze: number;
    watch: number;
  };
}
```

**Sub-tasks**:
- [ ] Count nodes: `SELECT COUNT(*) FROM contacts`
- [ ] Count edges: `SELECT COUNT(*) FROM edges`
- [ ] Compute density from node and edge counts
- [ ] Compute average and max degree: `SELECT AVG(degree), MAX(degree) FROM (SELECT COUNT(*) as degree FROM edges GROUP BY source_id UNION ALL SELECT COUNT(*) FROM edges GROUP BY target_id)`
- [ ] Count clusters: `SELECT COUNT(DISTINCT cluster_id) FROM contacts WHERE cluster_id IS NOT NULL`
- [ ] Compute tier distribution: `SELECT tier, COUNT(*) FROM contacts GROUP BY tier`
- [ ] Cache result for 60 seconds (these are expensive aggregate queries)

**Acceptance Criteria**:
- All numeric values are correct and consistent
- Density is between 0 and 1
- Response time < 300ms with caching
- Works correctly with empty graph (all zeros)

**BR References**: BR-510 (graph controls display network stats)

---

### Task B2-5: GET /api/discover/wedge -- Wedge Metrics for Visualization

**File**: `app/src/app/api/discover/wedge/route.ts`

**Query Parameters**:
```
niche_id: string      // optional: filter to specific niche
```

**Response Shape**:
```typescript
interface WedgeMetric {
  nicheId: string;
  nicheName: string;
  radius: number;           // 0-1, normalized contact count
  arc: number;              // 0-360, gold concentration degrees
  height: number;           // 0-1, normalized avg gold_score
  contactCount: number;
  goldCount: number;
  avgScore: number;
  color: string;            // assigned hex color
}

interface WedgeResponse {
  wedges: WedgeMetric[];
  total: number;
}
```

**Sub-tasks**:
- [ ] Query `wedge_metrics` materialized view or compute from `niche_profiles` + `contacts`
- [ ] Normalize radius: `contactCount / maxContactCount` across all niches
- [ ] Compute arc: `(goldCount / totalGold) * 360` degrees
- [ ] Normalize height: `avgScore / 100`
- [ ] Assign colors from a predefined palette (12 distinct colors)
- [ ] Support `niche_id` filter for single-niche detail view

**Acceptance Criteria**:
- Wedge metrics sum correctly (arcs sum to ~360 when all niches included)
- Radius and height are between 0 and 1
- Colors are distinct and accessible
- Response time < 100ms

**BR References**: BR-1016 (wedge visualization)

---

### Task B2-6: GET /api/contacts/:id/edges -- Contact Edges

**File**: `app/src/app/api/contacts/[id]/edges/route.ts`

**Response Shape**:
```typescript
interface ContactEdgesResponse {
  contactId: string;
  edges: {
    id: string;
    connectedContactId: string;
    connectedContactSlug: string;
    connectedContactName: string;
    connectedContactTier: string;
    connectedContactScore: number | null;
    edgeType: 'connection' | 'same_company' | 'endorsement' | 'recommendation' | 'shared_group' | 'interaction';
    weight: number;
    createdAt: string;
    metadata: Record<string, unknown> | null;
  }[];
  totalEdges: number;
}
```

**Sub-tasks**:
- [ ] Query edges where `source_id = :id OR target_id = :id`
- [ ] Join with contacts to get the "other" contact's display data
- [ ] Order by weight DESC, then by type priority
- [ ] Validate contact ID; return 404 if not found

**Acceptance Criteria**:
- Returns all edges for a contact regardless of direction
- Connected contact data is fully populated
- Response time < 50ms

**BR References**: BR-205 (contact network tab)

---

### Task B2-7: GET /api/contacts/:id/warm-intros -- Warm Introduction Paths

**File**: `app/src/app/api/contacts/[id]/warm-intros/route.ts`

**Response Shape**:
```typescript
interface WarmIntroResponse {
  contactId: string;
  contactName: string;
  intros: {
    intermediary: {
      id: string;
      slug: string;
      name: string;
      tier: string;
      goldScore: number | null;
      relationship: string;  // edge type to you
    };
    target: {
      id: string;
      slug: string;
      name: string;
      tier: string;
      goldScore: number | null;
    };
    pathLength: number;
    strength: number;         // min edge weight along path
  }[];
}
```

**Sub-tasks**:
- [ ] Find all 2-hop paths from the user's direct connections to the target contact
- [ ] Rank by path strength (minimum edge weight along path)
- [ ] Limit to top 10 warm intro paths
- [ ] Include intermediary contact data for display
- [ ] Return empty array if no warm intros exist (direct connection or isolated)

**Acceptance Criteria**:
- Returns intermediaries sorted by path strength
- Path length is always 2 for warm intros
- Response time < 200ms

**BR References**: BR-207 (warm intro paths on contact detail)

---

### Task B2-8: GET /api/contacts/:id/observations -- Behavioral Observations

**File**: `app/src/app/api/contacts/[id]/observations/route.ts`

**Response Shape**:
```typescript
interface ObservationsResponse {
  contactId: string;
  observations: {
    id: string;
    type: 'post' | 'comment' | 'share' | 'reaction' | 'article' | 'endorsement_given' | 'job_change' | 'profile_update';
    content: string | null;
    url: string | null;
    capturedAt: string;
    sentiment: 'positive' | 'neutral' | 'negative' | null;
    topics: string[];
    source: 'extension' | 'enrichment' | 'import';
  }[];
  activitySummary: {
    totalObservations: number;
    lastActivityDate: string | null;
    dominantTopics: string[];
    avgSentiment: number | null;   // -1 to 1
    activityFrequency: 'high' | 'medium' | 'low' | 'inactive';
  };
}
```

**Sub-tasks**:
- [ ] Query `behavioral_observations` table for the contact, ordered by `captured_at` DESC
- [ ] Compute activity summary from observations
- [ ] Determine activity frequency: high (>10/month), medium (3-10/month), low (1-2/month), inactive (0 in last 60 days)
- [ ] Extract dominant topics (top 5 by frequency)
- [ ] Compute average sentiment
- [ ] Paginate observations: `limit` (default 50) and `offset` query params

**Acceptance Criteria**:
- Returns observations in reverse chronological order
- Activity summary accurately reflects observation data
- Returns empty results gracefully when no observations exist
- Response time < 100ms

**BR References**: BR-410 (contact activity tab)

---

## Orchestrator Instructions

### Execution Strategy

1. **Spawn 2 agents** (B1 and B2) in parallel at phase start
2. Both agents work independently -- there are no cross-dependencies between the two task groups
3. Each agent should:
   a. Read the prerequisite schema/tables before writing queries
   b. Create type definitions first (`app/src/types/dashboard.ts`, `app/src/types/graph.ts`, `app/src/types/search.ts`)
   c. Implement endpoints with input validation, error handling, and proper HTTP status codes
   d. Write unit tests for each endpoint in `tests/api/`
   e. Run `npm test` and `npm run lint` after implementation

### Shared Patterns

All endpoints must follow these patterns:

```typescript
// Standard error handling wrapper
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    // ... implementation
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] endpoint error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

```typescript
// Standard query parameter parsing
const { searchParams } = new URL(request.url);
const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
const offset = parseInt(searchParams.get('offset') || '0');
```

### Testing Requirements

For each endpoint, write tests covering:
- Successful response with populated data
- Successful response with empty data (graceful degradation)
- Invalid parameters (400 responses)
- Non-existent resources (404 responses)
- Response shape validation (all fields present, correct types)

Test files:
- `tests/api/dashboard.test.ts`
- `tests/api/contacts-search.test.ts`
- `tests/api/contacts-similar.test.ts`
- `tests/api/graph-data.test.ts`
- `tests/api/graph-clusters.test.ts`
- `tests/api/graph-path.test.ts`
- `tests/api/graph-stats.test.ts`
- `tests/api/discover-wedge.test.ts`
- `tests/api/contacts-edges.test.ts`
- `tests/api/contacts-warm-intros.test.ts`
- `tests/api/contacts-observations.test.ts`

---

## Dependencies

### Upstream (required before this work)

| Dependency | Source | Status |
|---|---|---|
| All Phase 2 backend APIs operational | Phase 2 Backend | Must pass Phase 2 gate |
| Materialized views refreshed | Phase 2 Backend | Must pass Phase 2 gate |
| HNSW indexes built on profile_embeddings | Phase 1-2 Backend | Must pass Phase 2 gate |

### Downstream (blocks these)

| Dependent | Domain | Blocked Tasks |
|---|---|---|
| Dashboard page (Agent A1) | App | Cannot fetch dashboard data without `GET /api/dashboard` |
| Contact Detail (Agent A2) | App | Cannot render Network/Activity tabs without edges/observations endpoints |
| Network Graph (Agent A3) | App | Cannot render graph without `GET /api/graph/data` |
| Discover Page (Agent A4) | App | Cannot render wedge without `GET /api/discover/wedge` |
| Command Palette (Agent A6) | App | Cannot search without `GET /api/contacts/search` |

### Mitigation

App agents should begin work immediately using **mock data** that matches the response shapes defined above. Backend agents must deliver endpoints within the first 2-3 days of the phase so App agents can switch from mocks to real data mid-sprint.

---

## Gate Criteria

All of the following must pass before Phase 3 Backend is considered complete:

- [ ] `GET /api/dashboard` returns complete `DashboardData` with real data (or graceful empty state)
- [ ] `GET /api/contacts/search?q=<term>` returns relevant hybrid search results
- [ ] `GET /api/contacts/similar/:id` returns vector-similar contacts
- [ ] `GET /api/graph/data` returns reagraph-compatible nodes and edges
- [ ] `GET /api/graph/clusters` returns cluster metadata with gold percentages
- [ ] `GET /api/graph/path/:from/:to` returns shortest path between connected contacts
- [ ] `GET /api/graph/stats` returns accurate network statistics
- [ ] `GET /api/discover/wedge` returns wedge metrics for all niches
- [ ] `GET /api/contacts/:id/edges` returns all edges for a contact
- [ ] `GET /api/contacts/:id/warm-intros` returns warm introduction paths
- [ ] `GET /api/contacts/:id/observations` returns behavioral observations
- [ ] All endpoints return proper 400/404 for invalid inputs
- [ ] All endpoints respond within performance targets (specified per-task above)
- [ ] All endpoint tests pass (`npm test -- tests/api/`)
- [ ] No lint errors (`npm run lint`)
