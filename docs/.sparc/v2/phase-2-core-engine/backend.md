# Phase 2: Core Engine -- Backend Plan

## Objective

Implement the scoring engine, enrichment pipeline, and graph analytics subsystems. By the end of Phase 2, contacts imported in Phase 1 can be scored with a 9-dimension composite score, enriched through a budget-aware provider waterfall, and analyzed via graph centrality and community detection algorithms. All functionality is exposed through Next.js API routes.

## Prerequisites (Phase 1 Deliverables Required)

Before any Phase 2 backend work begins, the following Phase 1 artifacts must exist and pass verification:

| Prerequisite | Source Phase | Verification |
|---|---|---|
| PostgreSQL schema: `contacts`, `companies`, `edges`, `clusters`, `cluster_memberships` | Phase 1 Backend | `SELECT count(*) FROM contacts` returns > 0 |
| PostgreSQL schema: `contact_scores`, `score_dimensions`, `weight_profiles`, `tier_thresholds` | Phase 1 Backend | Tables exist; default weight profile seeded |
| PostgreSQL schema: `person_enrichments`, `company_enrichments`, `budget_periods`, `enrichment_transactions` | Phase 1 Backend | Tables exist with correct columns |
| PostgreSQL schema: `icp_profiles`, `niche_profiles`, `wedge_metrics` | Phase 1 Backend | Tables exist |
| PostgreSQL schema: `content_profiles`, `activity_patterns` | Phase 1 Backend | Tables exist |
| PostgreSQL schema: vector embedding tables with HNSW indexes | Phase 1 Backend | `ruvector_embed()` callable |
| docker-compose running ruvector-postgres + Next.js app | Phase 1 Backend | `docker-compose up` healthy |
| CSV import pipeline operational | Phase 1 Backend | Connections.csv import produces contacts + edges |
| Materialized view `enriched_contacts` exists | Phase 1 Backend | `SELECT * FROM enriched_contacts LIMIT 1` succeeds |
| `GET /api/contacts` returns data | Phase 1 Backend/App | HTTP 200 with contact records |

---

## Parallel Agent Assignments

| Agent | Role | Subsystem | Files | Estimated Effort |
|---|---|---|---|---|
| Agent 1 | Scoring Engineer | Scoring engine: all 9 dimensions, weight manager, composite calc, personas | `src/scoring/**` | Heavy (40%) |
| Agent 2 | Enrichment Engineer | Provider abstraction, PDL/Lusha/TheirStack, waterfall, budget | `src/enrichment/**` | Medium (25%) |
| Agent 3 | Graph Engineer | Graph analytics, Cypher builder, community detection, warm intros | `src/graph/**` | Medium (20%) |
| Agent 4 | ICP Engineer | ICP/niche discovery, contact-to-ICP fit scoring, wedge metrics | `src/icp/**` | Light (10%) |
| Agent 5 | API Developer | All Phase 2 API route handlers | `src/app/api/**` | Light (5%) -- blocked until Agents 1-4 complete core logic |

### Dependency Graph Between Agents

```
Agent 1 (Scoring) ──────────────────────┐
Agent 2 (Enrichment) ───────────────────┤
Agent 3 (Graph) ────────────────────────┼──> Agent 5 (API Routes)
Agent 4 (ICP) ──┬───────────────────────┘
                │
                └── depends on Agent 1 (icp_fit scorer interface)
                └── depends on Agent 3 (graph centrality metrics for graph_centrality scorer)
```

Agent 1 and Agent 3 have a bidirectional data dependency: the `graph_centrality` scorer (Agent 1) needs graph metric values computed by Agent 3. Resolution: Agent 3 exposes a `GraphMetricsService` interface that Agent 1 imports. Agent 3 delivers this interface stub first, then implements.

---

## Detailed Task Checklist

### Subsystem 1: Scoring Engine (Agent 1)

#### Task 1.1: Dimension Router (BR-401, BR-402)

**File**: `src/scoring/dimension-router.ts`

**Description**: Central dispatcher that receives a contact record and routes it to each registered dimension scorer, collecting results.

```typescript
interface DimensionResult {
  dimension: string;
  rawScore: number;       // 0.0 - 1.0
  confidence: number;     // 0.0 - 1.0, how much data was available
  dataPoints: number;     // count of data points used
  details: Record<string, unknown>; // dimension-specific breakdown
}

interface DimensionScorer {
  readonly id: string;
  readonly displayName: string;
  score(contact: Contact, context: ScoringContext): Promise<DimensionResult>;
  requiredFields(): string[];  // fields needed from contact record
}

interface ScoringContext {
  activeIcps: IcpProfile[];
  weightProfile: WeightProfile;
  graphMetrics?: ContactGraphMetrics;
  enrichmentData?: PersonEnrichResult;
}

class DimensionRouter {
  private scorers: Map<string, DimensionScorer> = new Map();
  register(scorer: DimensionScorer): void;
  unregister(dimensionId: string): void;
  async scoreContact(contact: Contact, context: ScoringContext): Promise<DimensionResult[]>;
  async scoreContacts(contacts: Contact[], context: ScoringContext): Promise<Map<string, DimensionResult[]>>;
}
```

**Sub-tasks**:
- [ ] Define `DimensionScorer` interface with `score()`, `requiredFields()`, `id`, `displayName`
- [ ] Define `DimensionResult` interface with `rawScore`, `confidence`, `dataPoints`, `details`
- [ ] Implement `DimensionRouter.register()` and `unregister()`
- [ ] Implement `scoreContact()` that invokes all registered scorers in parallel (`Promise.all`)
- [ ] Implement `scoreContacts()` for batch scoring with configurable concurrency
- [ ] Handle scorer errors gracefully: log error, return `DimensionResult` with `rawScore: 0`, `confidence: 0`
- [ ] Write unit tests: `tests/scoring/dimension-router.test.ts`

**Acceptance Criteria**:
- Router invokes all registered scorers for a given contact
- Failed scorers do not block other scorers
- Batch scoring processes N contacts with bounded concurrency (default 10)

---

#### Task 1.2: ICP Fit Scorer (BR-403, BR-404)

**File**: `src/scoring/dimensions/icp-fit.ts`

**Default Weight**: 0.22

**Description**: Scores how well a contact matches the currently active ICP profile(s). Compares title, industry, company size, seniority, function, and geography against ICP criteria.

**Sub-tasks**:
- [ ] Implement `IcpFitScorer` class implementing `DimensionScorer`
- [ ] Title matching: fuzzy match contact `headline` against ICP `target_titles[]` (Levenshtein distance <= 3 or substring match)
- [ ] Industry matching: exact or category match against ICP `target_industries[]`
- [ ] Company size matching: range check against ICP `company_size_range`
- [ ] Seniority matching: match against ICP `seniority_levels[]`
- [ ] Function matching: match against ICP `job_functions[]`
- [ ] Geography matching: match against ICP `target_geographies[]`
- [ ] Compute weighted sub-score: title (0.30), industry (0.20), seniority (0.20), company_size (0.15), geography (0.10), function (0.05)
- [ ] Multi-ICP: score against each active ICP, return the highest match
- [ ] Populate `details` with per-sub-dimension breakdown
- [ ] Write unit tests: `tests/scoring/dimensions/icp-fit.test.ts`

**Acceptance Criteria**:
- A contact whose title, industry, and seniority match the active ICP scores >= 0.7
- A contact with no matching fields scores 0.0
- `details` object contains `{ titleMatch, industryMatch, seniorityMatch, companySizeMatch, geographyMatch, functionMatch, bestIcpId }`

---

#### Task 1.3: Network Hub Scorer (BR-405)

**File**: `src/scoring/dimensions/network-hub.ts`

**Default Weight**: 0.18

**Description**: Evaluates a contact's position as a network hub based on mutual connections, cluster breadth, and connector index.

**Sub-tasks**:
- [ ] Compute `mutualConnectionCount` from `edges` table (count edges where both endpoints are in our contact set)
- [ ] Compute `clusterBreadth` -- number of distinct clusters the contact bridges (from `cluster_memberships`)
- [ ] Compute `connectorIndex` = `mutualConnectionCount * clusterBreadth / totalEdges` (normalized 0-1)
- [ ] Sub-score weighting: mutualConnections (0.40), clusterBreadth (0.35), connectorIndex (0.25)
- [ ] Normalize mutualConnectionCount using log scale (log2(count + 1) / log2(maxCount + 1))
- [ ] Write unit tests: `tests/scoring/dimensions/network-hub.test.ts`

**Acceptance Criteria**:
- Contact with 50+ mutual connections and 3+ cluster memberships scores >= 0.6
- Contact with 0 mutual connections scores 0.0
- `details` contains `{ mutualConnectionCount, clusterBreadth, connectorIndex }`

---

#### Task 1.4: Relationship Strength Scorer (BR-406)

**File**: `src/scoring/dimensions/relationship-strength.ts`

**Default Weight**: 0.14

**Description**: Measures depth of existing relationship using messaging frequency, endorsements, recommendations, and recency.

**Sub-tasks**:
- [ ] Query `message_stats` for contact: `total_messages`, `last_message_at`
- [ ] Query `edges` for endorsement and recommendation edges
- [ ] Compute `messagingScore`: logarithmic scale of message count, boosted if recent (< 90 days)
- [ ] Compute `endorsementScore`: count of endorsement edges / 10 (cap at 1.0)
- [ ] Compute `recommendationScore`: 0.5 per recommendation edge (cap at 1.0)
- [ ] Compute `recencyScore`: exponential decay from `last_message_at` (1.0 if < 30 days, 0.5 at 90 days, 0.1 at 365 days, 0.0 if never)
- [ ] Sub-score weighting: messaging (0.35), recency (0.30), endorsements (0.20), recommendations (0.15)
- [ ] Write unit tests: `tests/scoring/dimensions/relationship-strength.test.ts`

**Acceptance Criteria**:
- Contact with 20+ messages in last 30 days + endorsements scores >= 0.7
- Contact with zero interaction scores 0.0
- Recency decay is exponential, not linear

---

#### Task 1.5: Signal Boost Scorer (BR-407)

**File**: `src/scoring/dimensions/signal-boost.ts`

**Default Weight**: 0.06

**Description**: Detects keyword signals in headline, about section, and recent posts that indicate relevance.

**Sub-tasks**:
- [ ] Load signal keywords from active ICP `signal_keywords[]`
- [ ] Scan contact `headline` for keyword matches (case-insensitive, word-boundary aware)
- [ ] Scan contact `about` / `summary` for keyword matches
- [ ] Weight headline matches 2x higher than about-section matches
- [ ] Score = min(1.0, (headline_hits * 2 + about_hits) / expected_signals)
- [ ] `expected_signals` derived from ICP signal keyword count (normalized so matching 50% of keywords = 0.5 score)
- [ ] Write unit tests: `tests/scoring/dimensions/signal-boost.test.ts`

**Acceptance Criteria**:
- Contact with 3 of 5 signal keywords in headline scores >= 0.8
- Contact with no keyword matches scores 0.0
- `details` contains `{ headlineHits: string[], aboutHits: string[], totalSignals }`

---

#### Task 1.6: Skills Relevance Scorer (BR-408)

**File**: `src/scoring/dimensions/skills-relevance.ts`

**Default Weight**: 0.08

**Description**: Compares contact's listed skills against ICP target skills.

**Sub-tasks**:
- [ ] Load ICP `target_skills[]` from active ICP
- [ ] Load contact skills from `contact.skills` (JSON array)
- [ ] Compute Jaccard similarity: `|intersection| / |union|`
- [ ] Boost if contact has endorsements for matching skills (1.2x multiplier, cap at 1.0)
- [ ] Handle case where contact has no skills listed: `confidence: 0.0`, `rawScore: 0.0`
- [ ] Write unit tests: `tests/scoring/dimensions/skills-relevance.test.ts`

**Acceptance Criteria**:
- Contact with 80% skill overlap scores >= 0.75
- Contact with no skills returns score 0.0 and confidence 0.0 (triggers null-safe redistribution)

---

#### Task 1.7: Network Proximity Scorer (BR-409)

**File**: `src/scoring/dimensions/network-proximity.ts`

**Default Weight**: 0.06

**Description**: Evaluates bridge quality and diversity of a contact's connections.

**Sub-tasks**:
- [ ] Compute bridge score: does contact connect two otherwise disconnected clusters?
- [ ] Query `cluster_memberships` to find which clusters contact's neighbors belong to
- [ ] Compute `bridgeQuality` = distinct clusters reachable through this contact / total clusters
- [ ] Compute `connectionDiversity` = entropy of neighbor cluster distribution (Shannon entropy, normalized 0-1)
- [ ] Final score = bridgeQuality * 0.6 + connectionDiversity * 0.4
- [ ] Write unit tests: `tests/scoring/dimensions/network-proximity.test.ts`

**Acceptance Criteria**:
- Contact bridging 3+ clusters with even distribution scores >= 0.5
- Contact with all neighbors in one cluster scores low (< 0.2)

---

#### Task 1.8: Behavioral Scorer (BR-410)

**File**: `src/scoring/dimensions/behavioral.ts`

**Default Weight**: 0.06

**Description**: Assesses contact's activity patterns and connection power.

**Sub-tasks**:
- [ ] Query `activity_patterns` for contact (if populated; gracefully handle empty)
- [ ] Compute `activityScore`: based on post frequency, engagement received, connection acceptance rate
- [ ] Compute `connectionPower`: ratio of mutual connections to total connections (if available)
- [ ] Handle missing data gracefully: if no activity_patterns, return `confidence: 0.0`
- [ ] Final score = activityScore * 0.6 + connectionPower * 0.4
- [ ] Write unit tests: `tests/scoring/dimensions/behavioral.test.ts`

**Acceptance Criteria**:
- Active contact (regular posts, high engagement) scores >= 0.5
- Contact with no behavioral data returns confidence 0.0, triggering null-safe redistribution

---

#### Task 1.9: Content Relevance Scorer -- NEW (BR-411)

**File**: `src/scoring/dimensions/content-relevance.ts`

**Default Weight**: 0.10

**Description**: Uses NLP-derived topic/pain alignment from `content_profiles` to score content relevance.

**Sub-tasks**:
- [ ] Query `content_profiles` for contact's extracted topics and pain points
- [ ] Load ICP `target_topics[]` and `pain_points[]`
- [ ] Compute topic overlap: cosine similarity between contact topic vector and ICP topic vector (via `ruvector_embed()` if vectors stored, else Jaccard)
- [ ] Compute pain alignment: keyword matching between contact pain points and ICP pain points
- [ ] Final score = topicOverlap * 0.6 + painAlignment * 0.4
- [ ] Handle missing content_profiles: return `confidence: 0.0`
- [ ] Write unit tests: `tests/scoring/dimensions/content-relevance.test.ts`

**Acceptance Criteria**:
- Contact whose content topics heavily overlap ICP topics scores >= 0.6
- Contact with no content profile returns confidence 0.0

---

#### Task 1.10: Graph Centrality Scorer -- NEW (BR-412)

**File**: `src/scoring/dimensions/graph-centrality.ts`

**Default Weight**: 0.10

**Description**: Combines betweenness centrality, PageRank, and eigenvector centrality from graph analytics.

**Sub-tasks**:
- [ ] Import `GraphMetricsService` from `src/graph/analytics.ts` (Agent 3 dependency)
- [ ] Fetch pre-computed graph metrics for contact: `betweenness`, `pagerank`, `eigenvector`, `degree`
- [ ] Normalize each metric to 0-1 range using min-max normalization across all contacts
- [ ] Sub-score weighting: betweenness (0.35), pagerank (0.35), eigenvector (0.20), degree (0.10)
- [ ] Handle missing graph metrics: return `confidence: 0.0`
- [ ] Write unit tests: `tests/scoring/dimensions/graph-centrality.test.ts`

**Acceptance Criteria**:
- Contact with high betweenness and PageRank scores >= 0.6
- Graph metrics are fetched from pre-computed values, not calculated on-the-fly during scoring
- `details` contains `{ betweenness, pagerank, eigenvector, degree, normalizedValues }`

---

#### Task 1.11: Weight Manager (BR-413, BR-414)

**File**: `src/scoring/weight-manager.ts`

**Description**: Manages weight profiles, null-safe redistribution, and named profile CRUD.

```typescript
interface WeightProfile {
  id: string;
  name: string;
  description?: string;
  weights: Record<string, number>; // dimension_id -> weight, must sum to 1.0
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

class WeightManager {
  async getActiveProfile(): Promise<WeightProfile>;
  async getProfile(id: string): Promise<WeightProfile>;
  async listProfiles(): Promise<WeightProfile[]>;
  async createProfile(name: string, weights: Record<string, number>): Promise<WeightProfile>;
  async updateProfile(id: string, updates: Partial<WeightProfile>): Promise<WeightProfile>;
  async deleteProfile(id: string): Promise<void>;
  async setActiveProfile(id: string): Promise<void>;
  redistributeWeights(
    baseWeights: Record<string, number>,
    nullDimensions: string[]
  ): Record<string, number>;
}
```

**Sub-tasks**:
- [ ] CRUD operations for weight profiles in `weight_profiles` table
- [ ] Validation: weights must sum to 1.0 (tolerance: 0.001)
- [ ] Null-safe redistribution: when a dimension returns `confidence: 0.0`, redistribute its weight proportionally among non-null dimensions
  - Example: if `skills_relevance` (0.08) is null, and remaining weights sum to 0.92, scale each remaining weight by `1 / 0.92`
- [ ] Default profile seeded with the 9 default weights listed above
- [ ] Active profile tracking (only one active at a time)
- [ ] Write unit tests: `tests/scoring/weight-manager.test.ts`

**Acceptance Criteria**:
- `redistributeWeights({a: 0.5, b: 0.3, c: 0.2}, ['c'])` returns `{a: 0.625, b: 0.375}`
- Creating a profile with weights that don't sum to 1.0 throws validation error
- Only one profile can be active at a time

---

#### Task 1.12: Composite Calculator (BR-415, BR-416)

**File**: `src/scoring/composite-calculator.ts`

**Description**: Computes gold_score from dimension results and assigns tiers.

```typescript
interface CompositeResult {
  contactId: string;
  goldScore: number;          // 0-100
  tier: 'gold' | 'silver' | 'bronze' | 'unscored';
  persona: PersonaType;
  behavioralPersona: BehavioralPersonaType;
  dimensions: DimensionResult[];
  effectiveWeights: Record<string, number>; // after null-safe redistribution
  scoredAt: Date;
}

class CompositeCalculator {
  constructor(
    private weightManager: WeightManager,
    private personaClassifier: PersonaClassifier
  );
  async calculate(
    contact: Contact,
    dimensionResults: DimensionResult[]
  ): Promise<CompositeResult>;
  async calculateBatch(
    contacts: Contact[],
    resultsByContact: Map<string, DimensionResult[]>
  ): Promise<CompositeResult[]>;
  assignTier(goldScore: number, contactDegree: number): 'gold' | 'silver' | 'bronze' | 'unscored';
}
```

**Sub-tasks**:
- [ ] Compute `gold_score = sum(dimension.rawScore * effectiveWeight) * 100` (scale to 0-100)
- [ ] Apply null-safe redistribution via `WeightManager.redistributeWeights()` before summing
- [ ] Tier assignment using degree-aware thresholds:
  - Load thresholds from `tier_thresholds` table
  - Default: gold >= 70, silver >= 45, bronze >= 20, unscored < 20
  - Degree-aware: contacts with degree < 3 use relaxed thresholds (gold >= 60, silver >= 35, bronze >= 15)
- [ ] Persist results to `contact_scores` and `score_dimensions` tables
- [ ] Batch calculation with transaction support
- [ ] Write unit tests: `tests/scoring/composite-calculator.test.ts`

**Acceptance Criteria**:
- `gold_score` is correctly computed as weighted sum * 100
- Tier assignment respects degree-aware thresholds
- Results are persisted to `contact_scores` and `score_dimensions`
- Batch of 100 contacts completes in < 5 seconds

---

#### Task 1.13: Persona Classifier (BR-417)

**File**: `src/scoring/persona-classifier.ts`

**Description**: Classifies contacts into business personas and behavioral personas based on score dimensions.

```typescript
type PersonaType =
  | 'buyer'
  | 'warm-lead'
  | 'advisor'
  | 'hub'
  | 'active-influencer'
  | 'ecosystem-contact'
  | 'peer'
  | 'network-node';

type BehavioralPersonaType =
  | 'super-connector'
  | 'content-creator'
  | 'silent-influencer'
  | 'rising-connector'
  | 'data-insufficient'
  | 'passive-network';

class PersonaClassifier {
  classify(dimensions: DimensionResult[]): PersonaType;
  classifyBehavioral(dimensions: DimensionResult[]): BehavioralPersonaType;
}
```

**Sub-tasks**:
- [ ] Business persona classification rules:
  - `buyer`: icp_fit >= 0.7 AND relationship_strength >= 0.4
  - `warm-lead`: icp_fit >= 0.5 AND (relationship_strength >= 0.3 OR network_hub >= 0.5)
  - `advisor`: skills_relevance >= 0.6 AND content_relevance >= 0.5
  - `hub`: network_hub >= 0.7 AND graph_centrality >= 0.5
  - `active-influencer`: behavioral >= 0.6 AND content_relevance >= 0.5 AND network_hub >= 0.4
  - `ecosystem-contact`: icp_fit >= 0.3 AND network_proximity >= 0.4
  - `peer`: skills_relevance >= 0.5 AND relationship_strength >= 0.3
  - `network-node`: fallback / default
- [ ] Behavioral persona classification rules:
  - `super-connector`: network_hub >= 0.8 AND graph_centrality >= 0.6
  - `content-creator`: content_relevance >= 0.7 AND behavioral >= 0.5
  - `silent-influencer`: graph_centrality >= 0.6 AND behavioral < 0.3
  - `rising-connector`: network_hub delta > 0.2 over last 30 days (if historical data available)
  - `data-insufficient`: average confidence across all dimensions < 0.3
  - `passive-network`: fallback / default
- [ ] Priority ordering: evaluate rules top-to-bottom, first match wins
- [ ] Write unit tests: `tests/scoring/persona-classifier.test.ts`

**Acceptance Criteria**:
- Contact with high icp_fit and relationship_strength classified as `buyer`
- Contact with high network_hub and graph_centrality classified as `hub`
- Contact with low data availability classified as `data-insufficient`
- Every contact receives exactly one business persona and one behavioral persona

---

### Subsystem 2: Enrichment Pipeline (Agent 2)

#### Task 2.1: Provider Registry (BR-301, BR-302)

**File**: `src/enrichment/provider-registry.ts`

**Description**: Registry that manages enrichment provider instances and their configuration.

```typescript
interface EnrichmentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly costPerCall: { min: number; max: number; currency: 'USD' };
  readonly supportedFields: string[];
  isConfigured(): boolean;
  isEnabled(): boolean;
  getCreditsRemaining(): Promise<number>;
  enrichPerson(input: PersonEnrichInput): Promise<PersonEnrichResult>;
  enrichCompany(input: CompanyEnrichInput): Promise<CompanyEnrichResult>;
  estimateCost(operation: 'person' | 'company', count: number): CostEstimate;
}

interface PersonEnrichInput {
  firstName?: string;
  lastName?: string;
  linkedinUrl?: string;
  email?: string;
  companyName?: string;
}

interface PersonEnrichResult {
  providerId: string;
  success: boolean;
  email?: string;
  phone?: string;
  workHistory?: WorkHistoryEntry[];
  skills?: string[];
  education?: EducationEntry[];
  socialProfiles?: Record<string, string>;
  rawResponse?: unknown;
  cost: number;
  timestamp: Date;
}

interface CompanyEnrichResult {
  providerId: string;
  success: boolean;
  industry?: string;
  employeeCount?: number;
  revenue?: string;
  techStack?: string[];
  headquarters?: string;
  founded?: number;
  rawResponse?: unknown;
  cost: number;
  timestamp: Date;
}

interface CostEstimate {
  minCost: number;
  maxCost: number;
  currency: 'USD';
  breakdown: { operation: string; count: number; unitCost: number }[];
}

class ProviderRegistry {
  register(provider: EnrichmentProvider): void;
  getProvider(id: string): EnrichmentProvider | undefined;
  getConfiguredProviders(): EnrichmentProvider[];
  getEnabledProviders(): EnrichmentProvider[];
  getAllProviders(): EnrichmentProvider[];
}
```

**Sub-tasks**:
- [ ] Define `EnrichmentProvider` interface with all methods
- [ ] Define `PersonEnrichInput`, `PersonEnrichResult`, `CompanyEnrichResult`, `CostEstimate` interfaces
- [ ] Implement `ProviderRegistry` with register/get/list operations
- [ ] Provider configuration stored in DB (`enrichment_provider_configs` or env vars)
- [ ] Write unit tests: `tests/enrichment/provider-registry.test.ts`

**Acceptance Criteria**:
- Registry correctly tracks configured vs. enabled providers
- `getConfiguredProviders()` only returns providers with valid API keys
- `getEnabledProviders()` only returns providers that are both configured and enabled

---

#### Task 2.2: PDL Provider (BR-303)

**File**: `src/enrichment/providers/pdl.ts`

**Description**: People Data Labs integration. Cost: $0.22-0.28/call. Returns email, phone, work history, skills, education.

**Sub-tasks**:
- [ ] Implement `PdlProvider` class implementing `EnrichmentProvider`
- [ ] `enrichPerson()`: call PDL Person Enrichment API (`POST https://api.peopledatalabs.com/v5/person/enrich`)
- [ ] Map PDL response fields to `PersonEnrichResult` schema
- [ ] Extract work history into `WorkHistoryEntry[]`
- [ ] Extract education into `EducationEntry[]`
- [ ] Extract skills array
- [ ] `enrichCompany()`: call PDL Company Enrichment API
- [ ] `getCreditsRemaining()`: call PDL usage endpoint
- [ ] `estimateCost()`: return $0.22-0.28 per person, $0.10-0.15 per company
- [ ] Handle API errors: rate limits (429), auth errors (401), not found (404)
- [ ] API key loaded from `process.env.PDL_API_KEY`
- [ ] Write unit tests with mocked HTTP: `tests/enrichment/providers/pdl.test.ts`

**Acceptance Criteria**:
- Successful enrichment returns populated `PersonEnrichResult`
- 404 (not found) returns `{ success: false }` without throwing
- Rate limit (429) throws retryable error with `Retry-After` header respected
- Cost tracked accurately in result

---

#### Task 2.3: Lusha Provider (BR-304)

**File**: `src/enrichment/providers/lusha.ts`

**Description**: Lusha integration. Cost: $0.00-0.087/call. Returns verified email and phone.

**Sub-tasks**:
- [ ] Implement `LushaProvider` class implementing `EnrichmentProvider`
- [ ] `enrichPerson()`: call Lusha Person API
- [ ] Map response to `PersonEnrichResult` (primarily email + phone fields)
- [ ] `supportedFields`: `['email', 'phone']`
- [ ] `enrichCompany()`: return `{ success: false }` (Lusha focused on person data)
- [ ] `getCreditsRemaining()`: call Lusha credits endpoint
- [ ] `estimateCost()`: return $0.00-0.087 per person
- [ ] API key loaded from `process.env.LUSHA_API_KEY`
- [ ] Write unit tests with mocked HTTP: `tests/enrichment/providers/lusha.test.ts`

**Acceptance Criteria**:
- Returns verified email and/or phone when available
- Correctly reports limited `supportedFields`
- Free-tier calls (within plan) report $0.00 cost

---

#### Task 2.4: TheirStack Provider (BR-305)

**File**: `src/enrichment/providers/theirstack.ts`

**Description**: TheirStack integration. Cost: $0.03/call. Returns company technology stacks.

**Sub-tasks**:
- [ ] Implement `TheirStackProvider` class implementing `EnrichmentProvider`
- [ ] `enrichPerson()`: return `{ success: false }` (company-only provider)
- [ ] `enrichCompany()`: call TheirStack API with company domain/name
- [ ] Map response to `CompanyEnrichResult.techStack[]`
- [ ] `supportedFields`: `['techStack']`
- [ ] `estimateCost()`: return $0.03 per company
- [ ] API key loaded from `process.env.THEIRSTACK_API_KEY`
- [ ] Write unit tests with mocked HTTP: `tests/enrichment/providers/theirstack.test.ts`

**Acceptance Criteria**:
- Returns `techStack` array for valid company lookup
- `enrichPerson()` returns `{ success: false }` without API call
- Cost is $0.03 per company call

---

#### Task 2.5: Waterfall Engine (BR-306, BR-307)

**File**: `src/enrichment/waterfall.ts`

**Description**: Field-aware waterfall that routes enrichment requests through providers in priority order, stopping when all desired fields are populated.

```typescript
interface WaterfallConfig {
  providerOrder: string[];  // provider IDs in priority order
  desiredFields: string[];  // fields we want to populate
  stopOnComplete: boolean;  // stop when all desired fields are filled
  maxProviders: number;     // max providers to try per contact
}

type ExecutionMode = 'batch' | 'individual' | 'background-drip' | 'selective' | 're-enrichment';

class WaterfallEngine {
  constructor(
    private registry: ProviderRegistry,
    private budgetManager: BudgetManager
  );
  async enrichContact(
    contact: Contact,
    config?: Partial<WaterfallConfig>,
    mode?: ExecutionMode
  ): Promise<EnrichmentResult>;
  async enrichBatch(
    contacts: Contact[],
    config?: Partial<WaterfallConfig>,
    mode?: ExecutionMode
  ): Promise<Map<string, EnrichmentResult>>;
}
```

**Sub-tasks**:
- [ ] Default waterfall order: PDL -> Lusha -> TheirStack (for company)
- [ ] Field-aware routing: only call provider if it supports fields still needed
  - Example: if email already populated, skip Lusha (which only provides email/phone)
- [ ] After each provider call, merge new fields into accumulated result
- [ ] Stop waterfall when all `desiredFields` are populated OR `maxProviders` reached
- [ ] Check budget before each provider call via `BudgetManager`
- [ ] Support execution modes:
  - `individual`: single contact, synchronous
  - `batch`: multiple contacts, bounded concurrency (default 5)
  - `background-drip`: enrich 1 contact every N seconds (configurable)
  - `selective`: only enrich contacts missing specific fields
  - `re-enrichment`: re-enrich contacts whose data is older than N days
- [ ] Record provenance: store each provider's contribution in `person_enrichments` / `company_enrichments`
- [ ] Trigger materialized view refresh after batch completion
- [ ] Write unit tests: `tests/enrichment/waterfall.test.ts`

**Acceptance Criteria**:
- Waterfall skips providers whose supported fields are already populated
- Budget check prevents enrichment when budget is exhausted
- Provenance records which provider supplied which field
- Batch mode respects concurrency limits
- Materialized view `enriched_contacts` refreshed after batch

---

#### Task 2.6: Budget Manager (BR-308, BR-309, BR-310)

**File**: `src/enrichment/budget-manager.ts`

**Description**: Enforces enrichment budget caps, tracks spending, and provides cost estimation.

```typescript
interface BudgetPeriod {
  id: string;
  periodType: 'daily' | 'weekly' | 'monthly';
  budgetCap: number;      // in USD
  currentSpend: number;
  periodStart: Date;
  periodEnd: Date;
  warningThreshold: number; // 0.0 - 1.0, default 0.80
}

class BudgetManager {
  async getCurrentPeriod(): Promise<BudgetPeriod>;
  async checkBudget(estimatedCost: number): Promise<{ allowed: boolean; reason?: string; remaining: number }>;
  async recordTransaction(transaction: EnrichmentTransaction): Promise<void>;
  async getSpendingSummary(periodType?: string): Promise<SpendingSummary>;
  async estimateBatchCost(contacts: Contact[], config: WaterfallConfig): Promise<CostEstimate>;
  async getTransactionHistory(limit?: number, offset?: number): Promise<EnrichmentTransaction[]>;
  async getROI(): Promise<EnrichmentROI>;
}

interface EnrichmentTransaction {
  id: string;
  providerId: string;
  contactId: string;
  operation: 'person' | 'company';
  cost: number;
  fieldsPopulated: string[];
  success: boolean;
  timestamp: Date;
}

interface EnrichmentROI {
  totalSpend: number;
  contactsEnriched: number;
  fieldsPopulated: number;
  costPerContact: number;
  costPerField: number;
}
```

**Sub-tasks**:
- [ ] Load budget period from `budget_periods` table
- [ ] `checkBudget()`: refuse if `currentSpend + estimatedCost > budgetCap`
- [ ] `checkBudget()`: warn (include warning flag) if `currentSpend / budgetCap > warningThreshold`
- [ ] `recordTransaction()`: insert into `enrichment_transactions` and increment `currentSpend`
- [ ] Auto-rollover: create new budget period when current period expires
- [ ] Pre-operation cost estimation for batch operations
- [ ] ROI calculation: total spend / contacts enriched / fields populated
- [ ] Transaction history with pagination
- [ ] Write unit tests: `tests/enrichment/budget-manager.test.ts`

**Acceptance Criteria**:
- Enrichment refused when budget cap reached (returns `{ allowed: false, reason: 'Budget cap reached' }`)
- Warning flag set when spend exceeds 80% of cap
- Transaction records are accurate and queryable
- ROI metrics compute correctly

---

### Subsystem 3: Graph Analytics (Agent 3)

#### Task 3.1: Graph Metrics Service (BR-501, BR-502, BR-503)

**File**: `src/graph/analytics.ts`

**Description**: Computes and stores per-contact graph metrics using ruvector-postgres graph functions.

```typescript
interface ContactGraphMetrics {
  contactId: string;
  betweenness: number;
  pagerank: number;
  eigenvector: number;
  degree: number;
  inDegree: number;
  outDegree: number;
  clusteringCoefficient: number;
  computedAt: Date;
}

class GraphMetricsService {
  async computePageRank(options?: { dampingFactor?: number; iterations?: number }): Promise<void>;
  async computeBetweenness(): Promise<void>;
  async computeEigenvector(): Promise<void>;
  async computeDegreeCentrality(): Promise<void>;
  async computeAll(): Promise<void>;
  async getMetrics(contactId: string): Promise<ContactGraphMetrics | null>;
  async getMetricsBatch(contactIds: string[]): Promise<Map<string, ContactGraphMetrics>>;
  async getTopByMetric(metric: string, limit?: number): Promise<ContactGraphMetrics[]>;
  async recomputeIncremental(affectedContactIds: string[]): Promise<void>;
  async recomputeFull(): Promise<void>;
}
```

**Sub-tasks**:
- [ ] `computePageRank()`: call `ruvector_pagerank()` on edges table, store results
  - Parameters: damping_factor (default 0.85), max_iterations (default 100), convergence_threshold (default 1e-6)
- [ ] `computeBetweenness()`: compute betweenness centrality from edges table
  - Use `ruvector_cypher_query()` or custom SQL for betweenness approximation
- [ ] `computeEigenvector()`: compute eigenvector centrality
- [ ] `computeDegreeCentrality()`: count in-degree, out-degree, total degree per contact
- [ ] `computeAll()`: run all four metrics in sequence, update `contact_graph_metrics` table
- [ ] `getMetrics()`: fetch pre-computed metrics for a single contact
- [ ] `getMetricsBatch()`: fetch metrics for multiple contacts in one query
- [ ] `getTopByMetric()`: return top N contacts by any metric (for leaderboard views)
- [ ] `recomputeIncremental()`: recompute only for contacts within 2-hop neighborhood of affected contacts
- [ ] `recomputeFull()`: full recomputation of all metrics
- [ ] Store results in a `contact_graph_metrics` table (or update existing scoring tables)
- [ ] Write unit tests: `tests/graph/analytics.test.ts`

**Acceptance Criteria**:
- PageRank values sum to approximately 1.0 (within tolerance) across all contacts
- Betweenness values are >= 0.0 for all contacts
- Incremental recomputation is significantly faster than full (< 50% time for small change sets)
- `getMetricsBatch()` returns results in a single DB round-trip

---

#### Task 3.2: Cypher Query Builder (BR-504, BR-505)

**File**: `src/graph/cypher-builder.ts`

**Description**: Constructs Cypher queries for ruvector_cypher_query() calls, supporting common graph patterns.

```typescript
class CypherBuilder {
  static findNeighbors(contactId: string, depth?: number): string;
  static findShortestPath(fromId: string, toId: string): string;
  static findCommonNeighbors(id1: string, id2: string): string;
  static findBridgeNodes(clusterId1: string, clusterId2: string): string;
  static matchPattern(pattern: CypherPattern): string;
}

interface CypherPattern {
  nodeLabels?: string[];
  edgeTypes?: string[];
  properties?: Record<string, unknown>;
  maxDepth?: number;
}
```

**Sub-tasks**:
- [ ] `findNeighbors()`: `MATCH (c:Contact {id: $id})-[*1..N]-(n) RETURN n`
- [ ] `findShortestPath()`: `MATCH path = shortestPath((a:Contact {id: $from})-[*]-(b:Contact {id: $to})) RETURN path`
- [ ] `findCommonNeighbors()`: find contacts connected to both given contacts
- [ ] `findBridgeNodes()`: find contacts that appear in edges between two clusters
- [ ] `matchPattern()`: generic pattern matching with configurable labels, edge types, and properties
- [ ] Parameterize all queries to prevent injection
- [ ] Write unit tests: `tests/graph/cypher-builder.test.ts`

**Acceptance Criteria**:
- All generated queries are parameterized (no string interpolation of user data)
- `findShortestPath()` returns valid Cypher accepted by `ruvector_cypher_query()`
- Query builder handles edge cases: self-loops, disconnected nodes

---

#### Task 3.3: Community Detection (BR-506, BR-507, BR-508)

**File**: `src/graph/community-detection.ts`

**Description**: Detects communities/clusters using spectral clustering and HDBSCAN, stores results.

```typescript
interface CommunityResult {
  clusterId: string;
  memberContactIds: string[];
  size: number;
  density: number;
  label?: string;       // auto-generated label from member attributes
  centroidContactId: string;
}

class CommunityDetector {
  async detectSpectral(options?: { numClusters?: number }): Promise<CommunityResult[]>;
  async detectHDBSCAN(options?: { minClusterSize?: number; minSamples?: number }): Promise<CommunityResult[]>;
  async storeClusters(results: CommunityResult[]): Promise<void>;
  async getClusters(): Promise<CommunityResult[]>;
  async getClusterMembers(clusterId: string): Promise<Contact[]>;
  async labelClusters(clusters: CommunityResult[]): Promise<CommunityResult[]>;
}
```

**Sub-tasks**:
- [ ] `detectSpectral()`: call `ruvector_spectral_cluster()` with adjacency matrix from edges table
  - Accept optional `numClusters` parameter; if not provided, auto-detect optimal K
- [ ] `detectHDBSCAN()`: use HDBSCAN for density-based clustering on embedding vectors
  - Parameters: `minClusterSize` (default 5), `minSamples` (default 3)
- [ ] `storeClusters()`: write results to `clusters` and `cluster_memberships` tables
  - Clear previous cluster assignments before storing new results
- [ ] `getClusters()`: read all clusters with member counts
- [ ] `getClusterMembers()`: read all contacts in a given cluster
- [ ] `labelClusters()`: auto-generate cluster labels based on most common attributes (industry, company, title keywords) among members
- [ ] Write unit tests: `tests/graph/community-detection.test.ts`

**Acceptance Criteria**:
- Spectral clustering produces at least 2 clusters for a connected graph with >= 10 contacts
- HDBSCAN correctly identifies noise points (contacts not assigned to any cluster)
- Cluster labels are human-readable (e.g., "Tech Executives - San Francisco")
- Results persisted to `clusters` and `cluster_memberships` tables

---

#### Task 3.4: Warm Intro Path Finding (BR-509, BR-510)

**File**: `src/graph/warm-intros.ts`

**Description**: Finds warm introduction paths between contacts and ranks them by relationship strength.

```typescript
interface WarmIntroPath {
  fromContactId: string;
  toContactId: string;
  path: Contact[];         // ordered list of contacts in the path
  pathLength: number;
  pathStrength: number;    // minimum relationship_strength along the path
  intermediaries: Contact[]; // contacts in path excluding from and to
}

class WarmIntroService {
  async findPaths(fromId: string, toId: string, options?: {
    maxDepth?: number;     // default 3
    maxPaths?: number;     // default 5
    minStrength?: number;  // minimum relationship strength threshold
  }): Promise<WarmIntroPath[]>;
  async rankPaths(paths: WarmIntroPath[]): Promise<WarmIntroPath[]>;
  async findBestIntroducer(toId: string): Promise<Contact | null>;
}
```

**Sub-tasks**:
- [ ] `findPaths()`: use `ruvector_graph_shortest_path()` for shortest path; also find alternative paths up to `maxDepth`
- [ ] Path strength = minimum `relationship_strength` score along any edge in the path
- [ ] `rankPaths()`: sort by path strength (descending), then by path length (ascending)
- [ ] `findBestIntroducer()`: among all 1-hop contacts connected to the target, find the one with highest relationship_strength to the user
- [ ] Filter paths by `minStrength` threshold
- [ ] Handle disconnected contacts: return empty array
- [ ] Write unit tests: `tests/graph/warm-intros.test.ts`

**Acceptance Criteria**:
- Shortest path between two connected contacts is found correctly
- Path strength is the minimum edge strength along the path (weakest-link principle)
- Disconnected contacts return empty paths, not an error
- `findBestIntroducer()` returns the strongest-relationship intermediary

---

#### Task 3.5: Bridge and Hub Detection (BR-511, BR-512)

**File**: `src/graph/analytics.ts` (added to existing GraphMetricsService)

**Description**: Identifies bridge nodes (connecting disparate clusters) and hub nodes (highly connected).

**Sub-tasks**:
- [ ] `detectBridges()`: find contacts whose removal would increase the number of connected components
  - Approximation: contacts with high betweenness and connections to 2+ clusters
- [ ] `detectHubs()`: find contacts with degree > 2 * median degree AND PageRank > 90th percentile
- [ ] Store bridge/hub flags in contact graph metrics
- [ ] `getBridges(limit?: number)`: return top bridge contacts
- [ ] `getHubs(limit?: number)`: return top hub contacts
- [ ] Write unit tests added to: `tests/graph/analytics.test.ts`

**Acceptance Criteria**:
- Bridge detection correctly identifies contacts bridging distinct clusters
- Hub detection identifies the most connected contacts
- Results consistent with PageRank and betweenness values

---

### Subsystem 4: ICP/Niche Discovery (Agent 4)

#### Task 4.1: ICP Profile Management (BR-413)

**File**: `src/icp/icp-manager.ts`

**Description**: CRUD operations for ICP profiles with discover capabilities.

```typescript
interface IcpProfile {
  id: string;
  name: string;
  description?: string;
  targetTitles: string[];
  targetIndustries: string[];
  companySizeRange: { min: number; max: number };
  seniorityLevels: string[];
  jobFunctions: string[];
  targetGeographies: string[];
  targetSkills: string[];
  signalKeywords: string[];
  targetTopics: string[];
  painPoints: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

class IcpManager {
  async create(profile: Omit<IcpProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<IcpProfile>;
  async update(id: string, updates: Partial<IcpProfile>): Promise<IcpProfile>;
  async delete(id: string): Promise<void>;
  async get(id: string): Promise<IcpProfile>;
  async list(): Promise<IcpProfile[]>;
  async getActive(): Promise<IcpProfile[]>;
  async setActive(id: string, active: boolean): Promise<void>;
  async discover(options?: DiscoverOptions): Promise<IcpSuggestion[]>;
}
```

**Sub-tasks**:
- [ ] CRUD operations for `icp_profiles` table
- [ ] Multiple ICPs can be active simultaneously
- [ ] `discover()`: analyze existing contact base to suggest ICPs (see Task 4.2)
- [ ] Validate profile: at least one of `targetTitles`, `targetIndustries`, or `signalKeywords` must be non-empty
- [ ] Write unit tests: `tests/icp/icp-manager.test.ts`

**Acceptance Criteria**:
- CRUD operations work correctly
- Multiple ICPs can be active
- Empty ICP (no criteria) is rejected with validation error

---

#### Task 4.2: ICP Discovery via HDBSCAN (BR-413, BR-508)

**File**: `src/icp/icp-discovery.ts`

**Description**: Discovers potential ICPs by clustering contacts on embedding vectors and analyzing cluster characteristics.

**Sub-tasks**:
- [ ] Fetch profile embeddings from vector table
- [ ] Run HDBSCAN clustering (via `CommunityDetector.detectHDBSCAN()`)
- [ ] For each cluster, analyze member attributes:
  - Most common titles, industries, company sizes, skills, geographies
  - Compute cluster quality score (cohesion and separation)
- [ ] Generate `IcpSuggestion` with pre-filled fields from cluster analysis
- [ ] Rank suggestions by cluster quality and size
- [ ] Write unit tests: `tests/icp/icp-discovery.test.ts`

**Acceptance Criteria**:
- Discovery produces at least one ICP suggestion for a dataset with >= 50 contacts
- Suggestions include populated `targetTitles`, `targetIndustries`, and `targetSkills`
- Suggestions ranked by cluster quality

---

#### Task 4.3: Niche Profile Management

**File**: `src/icp/niche-manager.ts`

**Description**: Manages niche profiles (broader market segments that may contain multiple ICPs).

**Sub-tasks**:
- [ ] CRUD operations for `niche_profiles` table
- [ ] Associate ICPs with niches (many-to-one relationship)
- [ ] Niche metrics: total contacts, average score, growth rate
- [ ] Write unit tests: `tests/icp/niche-manager.test.ts`

**Acceptance Criteria**:
- Niches can be created, updated, deleted
- ICPs can be associated with niches
- Niche metrics computed correctly

---

#### Task 4.4: Contact-to-ICP Fit Scoring

**File**: `src/icp/fit-scorer.ts`

**Description**: Scores each contact against all active ICPs, tracking best fit and per-ICP scores.

**Sub-tasks**:
- [ ] For each contact, score against every active ICP using the `IcpFitScorer` from Agent 1
- [ ] Store per-ICP fit scores in `contact_icp_scores` (junction table: contact_id, icp_id, fit_score)
- [ ] Track best-fit ICP per contact
- [ ] Batch operation: score all contacts against all active ICPs
- [ ] Write unit tests: `tests/icp/fit-scorer.test.ts`

**Acceptance Criteria**:
- Each contact has a fit score for each active ICP
- Best-fit ICP is correctly identified
- Batch operation processes 500 contacts x 3 ICPs in < 10 seconds

---

#### Task 4.5: Wedge Metrics

**File**: `src/icp/wedge-metrics.ts`

**Description**: Computes wedge metrics -- the penetration and opportunity analysis per ICP/niche.

**Sub-tasks**:
- [ ] `computeWedgeMetrics(icpId: string)`: count of contacts per tier in this ICP, conversion rates, coverage gaps
- [ ] `getWedgeSummary()`: aggregate wedge metrics across all active ICPs
- [ ] Store results in `wedge_metrics` table
- [ ] Write unit tests: `tests/icp/wedge-metrics.test.ts`

**Acceptance Criteria**:
- Wedge metrics show tier distribution per ICP
- Coverage gaps identified (ICP criteria not well-represented in contact base)
- Summary aggregates across all ICPs

---

### Subsystem 5: API Routes (Agent 5)

#### Task 5.1: Scoring API Routes

**Files**:
- `src/app/api/scoring/run/route.ts`
- `src/app/api/scoring/weights/route.ts`
- `src/app/api/scoring/weight-profiles/route.ts`
- `src/app/api/scoring/tiers/route.ts`
- `src/app/api/scoring/distribution/route.ts`

**Sub-tasks**:
- [ ] `POST /api/scoring/run`: trigger scoring for all contacts (or filtered subset via query params)
  - Request body: `{ contactIds?: string[], icpId?: string }`
  - Response: `{ jobId: string, status: 'started', contactCount: number }`
  - Long-running: return immediately with job ID, compute in background
- [ ] `GET /api/scoring/weights`: return active weight profile
- [ ] `PUT /api/scoring/weights`: update active weight profile weights
  - Validate weights sum to 1.0
  - Return updated profile
- [ ] `GET /api/scoring/weight-profiles`: list all weight profiles
- [ ] `POST /api/scoring/weight-profiles`: create new weight profile
- [ ] `GET /api/scoring/tiers`: return tier thresholds
- [ ] `PUT /api/scoring/tiers`: update tier thresholds
- [ ] `GET /api/scoring/distribution`: return score distribution histogram (buckets of 10: 0-10, 10-20, ..., 90-100)
- [ ] Input validation with zod schemas for all endpoints
- [ ] Write integration tests: `tests/api/scoring.test.ts`

**Acceptance Criteria**:
- All endpoints return proper HTTP status codes (200, 201, 400, 404, 500)
- Weight update validates sum-to-one constraint
- Distribution endpoint returns histogram data suitable for chart rendering

---

#### Task 5.2: Enrichment API Routes

**Files**:
- `src/app/api/enrichment/providers/route.ts`
- `src/app/api/enrichment/providers/[id]/route.ts`
- `src/app/api/enrichment/budget/route.ts`
- `src/app/api/enrichment/estimate/route.ts`
- `src/app/api/enrichment/transactions/route.ts`
- `src/app/api/enrichment/roi/route.ts`
- `src/app/api/contacts/[id]/enrich/route.ts`
- `src/app/api/contacts/batch-enrich/route.ts`

**Sub-tasks**:
- [ ] `GET /api/enrichment/providers`: list all providers with status (configured, enabled, credits remaining)
- [ ] `PUT /api/enrichment/providers/:id`: update provider config (enable/disable, set priority)
- [ ] `GET /api/enrichment/budget`: return current budget period with spend data
- [ ] `POST /api/enrichment/estimate`: estimate cost for a batch operation
  - Request body: `{ contactIds: string[], desiredFields: string[] }`
  - Response: `CostEstimate`
- [ ] `GET /api/enrichment/transactions`: paginated transaction history
- [ ] `GET /api/enrichment/roi`: return ROI metrics
- [ ] `POST /api/contacts/:id/enrich`: enrich single contact through waterfall
- [ ] `POST /api/contacts/batch-enrich`: enrich multiple contacts
  - Request body: `{ contactIds: string[], mode: ExecutionMode, desiredFields?: string[] }`
  - Response: `{ jobId: string, status: 'started', estimatedCost: CostEstimate }`
- [ ] Budget check enforced on all enrich endpoints
- [ ] Input validation with zod schemas
- [ ] Write integration tests: `tests/api/enrichment.test.ts`

**Acceptance Criteria**:
- Provider list includes configuration status and credits
- Budget endpoint returns accurate current-period data
- Enrichment refused with 402 status when budget exhausted
- Batch enrichment returns job ID for tracking

---

#### Task 5.3: Graph API Routes

**Files**:
- `src/app/api/graph/data/route.ts`
- `src/app/api/graph/metrics/route.ts`
- `src/app/api/graph/recompute/route.ts`
- `src/app/api/graph/communities/route.ts`
- `src/app/api/graph/bridges/route.ts`
- `src/app/api/graph/path/[from]/[to]/route.ts`

**Sub-tasks**:
- [ ] `GET /api/graph/data`: return nodes + edges for graph visualization
  - Query params: `clusterId`, `tier`, `limit`, `includeEdges`
  - Response: `{ nodes: GraphNode[], edges: GraphEdge[] }`
- [ ] `GET /api/graph/metrics`: return graph metrics for a contact or summary stats
  - Query params: `contactId` (optional), `metric` (optional), `limit`
- [ ] `POST /api/graph/recompute`: trigger full or incremental recomputation
  - Request body: `{ mode: 'full' | 'incremental', contactIds?: string[] }`
- [ ] `GET /api/graph/communities`: list all detected communities with member counts
- [ ] `GET /api/graph/bridges`: list bridge contacts
- [ ] `GET /api/graph/path/:from/:to`: find warm intro paths between two contacts
  - Query params: `maxDepth`, `maxPaths`, `minStrength`
  - Response: `WarmIntroPath[]`
- [ ] Input validation with zod schemas
- [ ] Write integration tests: `tests/api/graph.test.ts`

**Acceptance Criteria**:
- Graph data endpoint returns nodes/edges suitable for reagraph rendering
- Path finding returns ranked warm intro paths
- Recompute endpoint supports both full and incremental modes
- Communities endpoint returns labeled clusters

---

#### Task 5.4: ICP/Niche API Routes

**Files**:
- `src/app/api/niches/route.ts`
- `src/app/api/icps/route.ts`
- `src/app/api/icps/discover/route.ts`
- `src/app/api/wedge/route.ts`

**Sub-tasks**:
- [ ] `GET /api/niches`: list all niche profiles
- [ ] `POST /api/niches`: create niche profile
- [ ] `GET /api/icps`: list all ICP profiles
- [ ] `POST /api/icps`: create ICP profile
- [ ] `PUT /api/icps/:id`: update ICP profile
- [ ] `DELETE /api/icps/:id`: delete ICP profile
- [ ] `POST /api/icps/discover`: trigger ICP discovery via HDBSCAN
  - Response: `{ suggestions: IcpSuggestion[] }`
- [ ] `GET /api/wedge`: return wedge metrics for active ICPs
- [ ] Input validation with zod schemas
- [ ] Write integration tests: `tests/api/icp.test.ts`

**Acceptance Criteria**:
- CRUD operations for ICPs and niches work correctly
- Discover endpoint returns actionable ICP suggestions
- Wedge endpoint returns tier distribution per ICP

---

## Orchestrator Instructions

### Spawn Order

1. **Immediate (parallel)**: Spawn Agents 1, 2, 3, and 4 simultaneously. Agent 1 and Agent 3 must coordinate on the `GraphMetricsService` interface -- Agent 3 should deliver the interface stub within the first hour.
2. **After core logic complete**: Spawn Agent 5 (API routes) once Agents 1-4 have delivered their service classes. Agent 5 can begin with route scaffolding immediately but must not wire up services until they are complete.

### Coordination Points

- **Hour 1**: Agent 3 delivers `GraphMetricsService` interface stub to unblock Agent 1's `graph-centrality` scorer
- **Hour 2**: Agent 1 delivers `IcpFitScorer` interface to unblock Agent 4's contact-to-ICP fit scoring
- **Day 2**: Agents 1-4 deliver completed service classes; Agent 5 begins wiring routes
- **Day 3**: Integration testing across all subsystems

### Testing Strategy

Each agent writes unit tests alongside implementation. After all agents complete:

1. Run all unit tests: `npm test -- --grep "scoring|enrichment|graph|icp"`
2. Run integration tests: `npm test -- --grep "api/"`
3. End-to-end verification: import CSV -> score all -> verify tiers assigned
4. Enrichment dry-run: estimate cost for 10 contacts, verify budget check

### Error Handling Standard

All service methods must:
- Throw typed errors (e.g., `ScoringError`, `EnrichmentError`, `GraphError`, `BudgetExhaustedError`)
- Log errors with structured context (contact ID, operation, provider ID where applicable)
- Never expose raw database errors to API consumers
- Return appropriate HTTP status codes in API routes

---

## Dependencies

### Internal Dependencies (Phase 1)
- Database schema and tables (all `contact_*`, `edge*`, `cluster*`, `enrichment_*`, `icp_*` tables)
- CSV import pipeline (contacts must exist in DB)
- Docker-compose environment running
- Profile embeddings generated via `ruvector_embed()`

### External Dependencies
- ruvector-postgres image with `ruvector_pagerank()`, `ruvector_spectral_cluster()`, `ruvector_graph_shortest_path()`, `ruvector_cypher_query()`, `ruvector_embed()` functions
- PDL API key (for enrichment provider)
- Lusha API key (for enrichment provider)
- TheirStack API key (for enrichment provider)

### NPM Dependencies (to be added in Phase 2)
- `zod` -- input validation for API routes
- `swr` -- already in app dependencies (for frontend)
- No new heavy dependencies; enrichment providers use native `fetch`

---

## Gate Criteria

All of the following must pass before Phase 2 is considered complete:

| # | Criterion | Verification Method |
|---|---|---|
| 1 | Scoring pipeline: import CSV -> score all contacts -> tier assignments appear | Run `POST /api/scoring/run`, then `GET /api/contacts` shows `gold_score` and `tier` populated |
| 2 | All 9 scoring dimensions produce non-zero scores for contacts with sufficient data | Query `score_dimensions` table, verify 9 rows per scored contact |
| 3 | Weight profiles: create, switch, and verify scoring changes | Create custom profile via API, run scoring, verify different tier assignments |
| 4 | Null-safe redistribution: dimension with no data has its weight redistributed | Score a contact with no skills data, verify remaining weights scaled up |
| 5 | Persona classification: every scored contact has business + behavioral persona | Query `contact_scores`, verify `persona` and `behavioral_persona` non-null |
| 6 | At least one enrichment provider enriches a contact successfully | `POST /api/contacts/:id/enrich` returns populated fields |
| 7 | Budget tracking records the enrichment cost | `GET /api/enrichment/budget` shows updated `currentSpend` |
| 8 | Budget enforcement refuses enrichment at cap | Set budget cap to $0.01, attempt enrichment, verify 402 response |
| 9 | Graph metrics computed (PageRank values non-zero) | `GET /api/graph/metrics?metric=pagerank&limit=5` returns non-zero values |
| 10 | At least one community detected | `GET /api/graph/communities` returns >= 1 cluster |
| 11 | Warm intro path returns valid path | `GET /api/graph/path/:from/:to` returns path with intermediaries |
| 12 | ICP CRUD operational | Create, read, update, delete ICP via API |
| 13 | ICP discovery returns suggestions | `POST /api/icps/discover` returns >= 1 suggestion (with >= 50 contacts in DB) |
| 14 | All unit tests pass | `npm test` exits 0 |
| 15 | All API endpoints return valid responses | Integration test suite passes |
| 16 | No TypeScript compilation errors | `npx tsc --noEmit` exits 0 |
| 17 | Lint passes | `npm run lint` exits 0 |
| 18 | Build succeeds | `npm run build` exits 0 |
