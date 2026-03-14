# Phase 5: Intelligence -- Backend Plan (Weeks 17-20)

## Objective

Implement the Claude integration API layer and content analysis pipeline that powers the intelligence features. This phase adds four API route groups (`/api/agent/*`) backed by a multi-depth content analysis engine and activity pattern detector. All Claude calls are cost-tracked through the existing `enrichment_transactions` table using a `claude` provider type.

## Prerequisites (Phases 1-4 Complete)

| Phase | Required Artifact | Status Gate |
|-------|-------------------|-------------|
| 1 | PostgreSQL schema: `contacts`, `companies`, `edges`, `clusters`, `content_profiles`, `activity_patterns`, `enrichment_transactions` tables | Tables exist and accept writes |
| 1 | Docker-compose: ruvector-postgres + Next.js containers running | `docker-compose up` healthy |
| 2 | Scoring engine: `contact_scores`, tier assignments, persona classification | Scoring pipeline produces tiers |
| 2 | Enrichment provider abstraction + budget enforcement | Budget cap logic operational |
| 3 | Dashboard aggregate API, contact detail endpoints | All Phase 3 APIs return data |
| 4 | `page_cache` table with captured HTML, `behavioral_observations` populated from parsed pages | Extension capture -> parse -> observation flow works |
| 4 | WebSocket server at `/ws/extension` operational | Extension receives push events |

## Parallel Agent Assignments

| Agent | Role | Files | Estimated Effort |
|-------|------|-------|------------------|
| Agent B1 | Claude API Routes | `src/agent/routes.ts`, `src/agent/claude-client.ts` | 2-3 days |
| Agent B2 | Content Analysis Pipeline | `src/agent/content-analysis.ts`, `src/agent/prompts.ts` | 3-4 days |
| Agent B3 | Behavioral Processing + Activity Patterns | `src/agent/observation-processor.ts`, `src/agent/activity-patterns.ts` | 2-3 days |

**Parallelism note**: Agents B1, B2, and B3 can run concurrently. B1 depends on B2's `ContentAnalysisService` interface (agree on interface first, implement in parallel). B3 has no cross-dependencies.

---

## Detailed Task Checklist

### Task B5-1: Claude Client Wrapper

**BR Reference**: BR-701 (Claude integration foundation)
**File**: `app/src/agent/claude-client.ts`
**Agent**: B1

- [ ] Create `ClaudeClient` class wrapping `@anthropic-ai/sdk`
  - Constructor accepts `apiKey`, `defaultModel`, `maxTokens`, `temperature`
  - Read `ANTHROPIC_API_KEY` from `process.env`
  - Default model: `claude-sonnet-4-20250514` (cost-effective for analysis tasks)
  - Configurable override to `claude-opus-4-20250514` for deep analysis
- [ ] Implement `analyze(prompt: string, context: object, options?: AnalysisOptions): Promise<AnalysisResult>`
  - Structured output using `tool_use` / JSON mode
  - Retry with exponential backoff (max 3 retries, base 1s)
  - Timeout: 30s for light, 60s for medium, 120s for deep
- [ ] Implement `chat(messages: Message[], systemPrompt: string): Promise<string>`
  - Streaming support via `stream: true` option
  - Conversation history management (last 20 messages)
- [ ] Implement cost tracking integration
  - After each call: record `input_tokens`, `output_tokens`, `model`, `cost_usd`
  - Insert into `enrichment_transactions` with `provider = 'claude'`, `operation_type` = analysis depth
  - Cost calculation: sonnet input $3/MTok, output $15/MTok; opus input $15/MTok, output $75/MTok
- [ ] Implement budget guard
  - Before each call: check remaining Claude budget via `SELECT SUM(cost_usd) FROM enrichment_transactions WHERE provider = 'claude' AND created_at > budget_period_start`
  - Refuse at cap, warn at 80% (consistent with enrichment budget pattern from Phase 2)
  - Budget period: configurable (daily, weekly, monthly) via `budget_config` table

**Acceptance Criteria**:
- ClaudeClient instantiates with env var
- `analyze()` returns structured JSON matching `AnalysisResult` type
- Failed calls retry up to 3 times with backoff
- Each call creates an `enrichment_transactions` row with accurate token/cost data
- Calls refused when budget exceeded, warning logged at 80%

---

### Task B5-2: Claude Agent API Routes

**BR Reference**: BR-701, BR-702, BR-703, BR-704
**File**: `app/src/app/api/agent/analyze/route.ts`, `app/src/app/api/agent/chat/route.ts`, `app/src/app/api/agent/suggestions/route.ts`, `app/src/app/api/agent/execute-task/route.ts`
**Agent**: B1

#### POST /api/agent/analyze

- [ ] Request body schema:
  ```typescript
  interface AnalyzeRequest {
    contact_ids?: string[];        // specific contacts (max 50)
    cluster_id?: string;           // analyze entire cluster
    niche_id?: string;             // analyze niche group
    depth: 'light' | 'medium' | 'deep';
    analysis_types: ('content' | 'scoring' | 'icp' | 'outreach_readiness')[];
  }
  ```
- [ ] Validate request: at least one target (contact_ids, cluster_id, or niche_id)
- [ ] Depth-based processing:
  - **Light** (~$0.003/contact): topic extraction + basic sentiment from `behavioral_observations`
  - **Medium** (~$0.008/contact): topics + pain points + engagement style + posting frequency
  - **Deep** (~$0.015/contact): full profile including content similarity scoring, tone analysis, receptiveness prediction, outreach timing recommendation
- [ ] Batch contacts in groups of 10 for efficient Claude calls (one prompt per batch)
- [ ] Return `202 Accepted` with `job_id` for async processing; results polled via GET
- [ ] Store results in `content_profiles` table (upsert by contact_id)

#### POST /api/agent/chat

- [ ] Request body schema:
  ```typescript
  interface ChatRequest {
    message: string;
    conversation_id?: string;     // continue existing conversation
    context?: {
      contact_ids?: string[];     // focus on specific contacts
      cluster_id?: string;
      view?: 'dashboard' | 'contacts' | 'network' | 'discover';
    };
  }
  ```
- [ ] System prompt construction:
  - Base system prompt: network intelligence assistant role
  - Inject current network summary (total contacts, tier distribution, top clusters)
  - If context.contact_ids: inject those contacts' profiles and scores
  - If context.cluster_id: inject cluster summary and member list
  - If context.view: inject relevant dashboard/page data
- [ ] Conversation storage in `agent_conversations` table (id, messages[], created_at, updated_at)
- [ ] Streaming response via `ReadableStream` (Next.js API route streaming)
- [ ] Rate limit: 20 messages per minute per user

#### GET /api/agent/suggestions

- [ ] Returns Claude's current proactive suggestions based on network state
- [ ] Suggestion generation runs as background job (every 6 hours or on-demand)
- [ ] Response schema:
  ```typescript
  interface SuggestionsResponse {
    suggestions: {
      type: 'goal' | 'insight' | 'warning' | 'opportunity';
      title: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
      related_contacts?: string[];
      related_cluster?: string;
      action?: { type: string; params: Record<string, unknown> };
    }[];
    generated_at: string;
    next_refresh: string;
  }
  ```
- [ ] Cache suggestions in `agent_suggestions` table; return cached until stale

#### POST /api/agent/execute-task

- [ ] Request body schema:
  ```typescript
  interface ExecuteTaskRequest {
    task_type: 'enrich_batch' | 'analyze_cluster' | 'generate_templates' | 'score_refresh' | 'export_contacts';
    params: Record<string, unknown>;
  }
  ```
- [ ] Dispatch to appropriate service based on `task_type`
- [ ] Return `202 Accepted` with `task_id`; poll via `GET /api/tasks/:id`
- [ ] Task execution logged in `task_executions` table

**Acceptance Criteria**:
- POST /api/agent/analyze with `depth: 'light'` and 5 contact_ids returns 202 and populates content_profiles
- POST /api/agent/chat returns streaming response with network-aware context
- GET /api/agent/suggestions returns at least 1 suggestion when contacts exist
- POST /api/agent/execute-task dispatches and tracks task execution
- All endpoints validate input and return 400 on invalid requests
- All endpoints enforce Claude budget limits

---

### Task B5-3: Content Analysis Pipeline

**BR Reference**: BR-701, BR-702
**File**: `app/src/agent/content-analysis.ts`
**Agent**: B2

- [ ] Create `ContentAnalysisService` class
  - Constructor: `(claudeClient: ClaudeClient, db: DatabasePool)`
  - Method: `analyzeContact(contactId: string, depth: AnalysisDepth): Promise<ContentProfile>`
  - Method: `analyzeBatch(contactIds: string[], depth: AnalysisDepth): Promise<ContentProfile[]>`
  - Method: `getAnalysisCost(depth: AnalysisDepth, contactCount: number): CostEstimate`

- [ ] Implement data gathering layer
  - Fetch `behavioral_observations` for contact (posts, comments, reactions, shares)
  - Fetch `contact` profile data (headline, about, skills, experience)
  - Fetch `edges` for mutual connections and graph position
  - Aggregate observation counts and date ranges

- [ ] Implement three analysis depth modes:

  **Light Analysis** (~$0.003/contact, ~500 input tokens):
  - [ ] Extract top 5 topics from post content using frequency + TF-IDF approximation
  - [ ] Basic sentiment classification: positive / neutral / negative / mixed
  - [ ] Posting frequency: daily / weekly / monthly / sporadic / dormant
  - [ ] Output: `{ topics: string[], sentiment: string, posting_frequency: string }`

  **Medium Analysis** (~$0.008/contact, ~1500 input tokens):
  - [ ] Everything from Light, plus:
  - [ ] Pain point extraction from post content and comments
  - [ ] Engagement style classification: thought_leader / commenter / curator / lurker / connector
  - [ ] Content theme trajectory (trending topics over last 90 days)
  - [ ] Output adds: `{ pain_points: string[], engagement_style: string, theme_trajectory: string[] }`

  **Deep Analysis** (~$0.015/contact, ~3000 input tokens):
  - [ ] Everything from Medium, plus:
  - [ ] Content similarity scoring against user's own content (cosine similarity via embeddings)
  - [ ] Tone analysis: formal / conversational / technical / inspirational / provocative
  - [ ] Receptiveness prediction: 0-100 score based on engagement patterns + connection degree
  - [ ] Optimal outreach timing recommendation based on activity patterns
  - [ ] Conversation starter suggestions (3 personalized openers)
  - [ ] Output adds: `{ content_similarity: number, tone: string, receptiveness: number, best_outreach_time: string, conversation_starters: string[] }`

- [ ] Store results in `content_profiles` table:
  ```sql
  INSERT INTO content_profiles (
    contact_id, topics, pain_points, engagement_style,
    posting_frequency, sentiment, sentiment_trajectory,
    tone, receptiveness, content_similarity,
    best_outreach_time, conversation_starters,
    analysis_depth, analyzed_at, observation_count
  ) VALUES ($1, $2, ...)
  ON CONFLICT (contact_id) DO UPDATE SET ...
  ```

**Acceptance Criteria**:
- Light analysis completes in <5s per contact, returns topics + sentiment
- Medium analysis completes in <10s, returns pain_points + engagement_style
- Deep analysis completes in <20s, returns full profile with receptiveness score
- Results persist in content_profiles and survive restart
- Cost per contact matches depth tier estimates within 30% variance
- Batch of 10 contacts processes in parallel (concurrent Claude calls, max 3)

---

### Task B5-4: Claude Prompt Templates

**BR Reference**: BR-701, BR-702
**File**: `app/src/agent/prompts.ts`
**Agent**: B2

- [ ] Create prompt template system with variable interpolation
- [ ] Define analysis prompts for each depth:

  **Light Analysis Prompt**:
  ```
  You are analyzing a LinkedIn contact's content for topic extraction.

  Contact: {{name}} ({{headline}})
  Recent posts (last {{observation_count}} observations):
  {{#each observations}}
  - [{{date}}] {{content_preview}} ({{engagement_type}}: {{likes}} likes, {{comments}} comments)
  {{/each}}

  Return JSON:
  {
    "topics": ["topic1", "topic2", ...],  // max 5, most discussed
    "sentiment": "positive|neutral|negative|mixed",
    "posting_frequency": "daily|weekly|monthly|sporadic|dormant"
  }
  ```

  **Medium Analysis Prompt** (extends light with):
  ```
  Also analyze:
  - Pain points mentioned or implied in their content
  - Their engagement style based on how they interact
  - Trending topic shifts over the observation period

  Additional JSON fields:
  {
    "pain_points": ["pain1", ...],  // max 5, professional challenges
    "engagement_style": "thought_leader|commenter|curator|lurker|connector",
    "theme_trajectory": ["emerging_topic1", ...]  // topics gaining frequency
  }
  ```

  **Deep Analysis Prompt** (extends medium with):
  ```
  User's own content themes: {{user_topics}}
  Contact's connection degree: {{degree}}
  Mutual connections: {{mutual_count}}
  Contact's engagement with user's content: {{direct_engagement_count}}

  Additional JSON fields:
  {
    "content_similarity": 0-100,  // how aligned their content is with user's
    "tone": "formal|conversational|technical|inspirational|provocative",
    "receptiveness": 0-100,  // likelihood to engage with outreach
    "best_outreach_time": "Tuesday morning|...",
    "conversation_starters": ["starter1", "starter2", "starter3"]
  }
  ```

- [ ] Define goal generation prompt (used by app's goal-generator):
  ```
  You are a LinkedIn networking strategist analyzing a professional network.

  Network Summary:
  - Total contacts: {{total_contacts}}
  - Tier distribution: Gold={{gold}}, Silver={{silver}}, Bronze={{bronze}}
  - Top clusters: {{clusters}}
  - Enrichment coverage: {{enriched_pct}}%
  - Average data completeness: {{avg_completeness}}%

  Recent changes:
  {{#each recent_events}}
  - {{event_type}}: {{description}}
  {{/each}}

  Generate 3-5 strategic goals. Each goal should have:
  - A clear objective tied to network growth or relationship deepening
  - 3-8 concrete tasks with types: visit_profile, enrich_contact, send_message, review_icp, analyze_cluster, capture_page
  - Priority scoring rationale

  Return JSON array of goals with nested tasks.
  ```

- [ ] Define suggestion generation prompt
- [ ] Define chat system prompt with network context injection

**Acceptance Criteria**:
- All prompts produce valid JSON when sent to Claude
- Variable interpolation handles missing data gracefully (defaults, omission)
- Prompts stay under model context limits (light: 2K tokens, medium: 4K, deep: 8K including response)
- Goal generation prompt produces actionable, specific goals

---

### Task B5-5: Behavioral Observation Processing

**BR Reference**: BR-701, BR-801
**File**: `app/src/agent/observation-processor.ts`
**Agent**: B3

- [ ] Create `ObservationProcessor` class
  - Method: `processNewObservations(contactId: string): Promise<ProcessingResult>`
  - Method: `aggregateObservations(contactId: string, since?: Date): Promise<AggregatedObservations>`
  - Method: `processCaptureBatch(captureIds: string[]): Promise<void>`

- [ ] Observation aggregation logic:
  - Group observations by type: `post`, `comment`, `reaction`, `share`, `profile_view`
  - Count by type and time period (7d, 30d, 90d, all-time)
  - Extract text content from posts and comments for analysis
  - Track engagement metrics per observation (likes, comments, shares received)

- [ ] Content extraction from observations:
  - Strip HTML tags from captured content
  - Truncate to first 500 chars for analysis (preserve sentence boundaries)
  - Extract mentioned companies, people, hashtags
  - Detect language (English-only analysis for Phase 5; flag non-English for skip)

- [ ] Populate `content_profiles` table (pre-Claude, raw aggregation):
  - `observation_count`: total observations processed
  - `last_observation_at`: most recent observation timestamp
  - `content_volume`: total chars of content produced
  - `engagement_received`: total likes + comments + shares across all posts

- [ ] Trigger content analysis when thresholds met:
  - 5+ observations: trigger light analysis (if not already analyzed)
  - 15+ observations: trigger medium analysis (if still at light)
  - 30+ observations with deep tier: trigger deep analysis
  - Threshold check runs after each batch of observations processed

**Acceptance Criteria**:
- Processor handles 100 observations per contact without timeout
- Aggregation produces correct counts by type and time period
- Content extraction strips HTML and preserves readable text
- Analysis auto-triggers at correct observation thresholds
- Processor is idempotent (re-processing same observations produces same result)

---

### Task B5-6: Activity Pattern Detection

**BR Reference**: BR-701
**File**: `app/src/agent/activity-patterns.ts`
**Agent**: B3

- [ ] Create `ActivityPatternDetector` class
  - Method: `detectPatterns(contactId: string): Promise<ActivityPattern>`
  - Method: `detectBatchPatterns(contactIds: string[]): Promise<ActivityPattern[]>`
  - Method: `classifyActivityLevel(pattern: ActivityPattern): ActivityLevel`

- [ ] Posting schedule inference:
  - Bucket observations by day-of-week (Mon-Sun)
  - Bucket by hour-of-day (0-23)
  - Build 7x24 activity heatmap from observation timestamps
  - Identify peak posting slots (day + hour combinations with >2 std dev above mean)

- [ ] Timezone detection:
  - Cluster posting hours to find primary activity window
  - If 80%+ posts fall within a 10-hour window, infer timezone from midpoint
  - Cross-reference with contact's `location` field for validation
  - Store as IANA timezone string (e.g., `America/New_York`)

- [ ] Activity level classification:
  ```typescript
  type ActivityLevel = 'active' | 'moderate' | 'dormant' | 'unknown';
  // active: 5+ observations in last 7 days
  // moderate: 1-4 observations in last 7 days, or 5+ in last 30 days
  // dormant: 0 observations in last 30 days but has historical data
  // unknown: fewer than 3 total observations
  ```

- [ ] Engagement peak calculation:
  - For each day-of-week: average engagement (likes+comments) per post
  - Identify top 3 engagement windows (day + hour) for optimal outreach timing
  - Store as `engagement_peaks: { day: string, hour: number, avg_engagement: number }[]`

- [ ] Persist to `activity_patterns` table:
  ```sql
  INSERT INTO activity_patterns (
    contact_id, posting_days, posting_hours, timezone,
    activity_level, engagement_peaks, heatmap_data,
    total_observations, analysis_window_days,
    detected_at
  ) VALUES ($1, $2, ...)
  ON CONFLICT (contact_id) DO UPDATE SET ...
  ```

- [ ] Activity pattern change detection:
  - Compare current pattern to previous (if exists)
  - If activity_level changes (e.g., active -> dormant), emit `ACTIVITY_CHANGE` event
  - Events consumed by goal generator to create re-engagement tasks

**Acceptance Criteria**:
- Pattern detection works with as few as 3 observations (marks as `unknown` below 3)
- Timezone detection matches location-based timezone in 80%+ of testable cases
- Engagement peaks correctly identify top 3 time windows
- 7x24 heatmap data is correctly bucketed and stored
- Activity level classification is consistent with defined thresholds
- Pattern change events fire when activity level transitions

---

## Orchestrator Instructions

### Spawn Order

```
[Parallel Spawn - All 3 agents start simultaneously]:
  Agent B1: Claude API Routes (Tasks B5-1, B5-2)
  Agent B2: Content Analysis Pipeline (Tasks B5-3, B5-4)
  Agent B3: Behavioral Processing (Tasks B5-5, B5-6)
```

### Coordination Protocol

1. **Interface Agreement (before coding)**: Agents B1 and B2 must agree on the `ContentAnalysisService` interface before starting implementation. B1 will call B2's service from the `/api/agent/analyze` route.

2. **Shared Types**: All agents create types in `app/src/types/agent.ts`:
   ```typescript
   // Agreed types:
   export type AnalysisDepth = 'light' | 'medium' | 'deep';
   export interface ContentProfile { ... }
   export interface ActivityPattern { ... }
   export interface AnalysisResult { ... }
   export interface CostEstimate { cost_usd: number; tokens_estimated: number; }
   ```

3. **Database Table Verification**: Before writing, each agent confirms target tables exist from Phase 1 schema. If missing, agent creates a migration file in `db/migrations/`.

4. **Testing Checkpoint**: After all agents complete, orchestrator runs:
   ```bash
   npm test -- --grep "agent"
   npm run lint
   ```

### Integration Sequence (after parallel work completes)

1. Wire `ContentAnalysisService` into `/api/agent/analyze` route
2. Wire `ObservationProcessor` trigger into the existing page parser pipeline (Phase 4)
3. Wire `ActivityPatternDetector` into observation processor's post-processing hook
4. End-to-end test: capture page -> parse -> observations -> analysis -> content_profile populated

---

## Dependencies

### Upstream (this phase needs)

| Dependency | Source Phase | Status Check |
|------------|-------------|--------------|
| `behavioral_observations` table populated | Phase 4 | `SELECT COUNT(*) FROM behavioral_observations` > 0 |
| `content_profiles` table exists | Phase 1 | Table exists in schema |
| `activity_patterns` table exists | Phase 1 | Table exists in schema |
| `enrichment_transactions` table with budget logic | Phase 2 | Budget enforcement operational |
| `page_cache` + parser pipeline | Phase 4 | Parsed captures create observations |
| `@anthropic-ai/sdk` npm package | Phase 5 setup | `npm list @anthropic-ai/sdk` |
| `ANTHROPIC_API_KEY` env var | User setup | `.env` file contains key |

### Downstream (other Phase 5 plans need from this)

| Consumer | What They Need | Interface |
|----------|---------------|-----------|
| App: Goal Generator | `ContentAnalysisService.analyzeBatch()` | Import from `src/agent/content-analysis` |
| App: Template Personalization | `ContentProfile` data from DB | Query `content_profiles` table |
| App: Outreach Timing | `ActivityPattern.engagement_peaks` | Query `activity_patterns` table |
| Extension: Template Display | Analysis results via API | `GET /api/agent/suggestions` |

---

## Gate Criteria

- [ ] `POST /api/agent/analyze` with `depth: 'light'` returns 202 and analysis job completes within 30s for 5 contacts
- [ ] `POST /api/agent/analyze` with `depth: 'deep'` returns full `ContentProfile` including receptiveness score
- [ ] `POST /api/agent/chat` streams a response that references actual contact data from the network
- [ ] `GET /api/agent/suggestions` returns at least 1 suggestion when contacts exist with observations
- [ ] `enrichment_transactions` records show accurate Claude API costs for each analysis call
- [ ] Budget cap prevents analysis when Claude spend exceeds configured limit
- [ ] `content_profiles` table populated with topics, sentiment, engagement_style for analyzed contacts
- [ ] `activity_patterns` table populated with timezone, activity_level, engagement_peaks
- [ ] Activity level classification correctly distinguishes active/moderate/dormant contacts
- [ ] All API endpoints return 400 for invalid input with descriptive error messages
- [ ] All API endpoints return 429 when rate limited
- [ ] Unit tests cover all three analysis depths with mocked Claude responses
- [ ] Integration test: observation processor triggers analysis at threshold (5 observations -> light)
