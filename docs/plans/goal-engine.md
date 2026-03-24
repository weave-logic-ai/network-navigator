# Goal Engine — Network Growth Intelligence System

**Status**: Design Document
**Date**: 2026-03-24
**Drives**: Automated goal creation, contextual task suggestion, network growth strategy

---

## Overview

The Goal Engine is a lightweight intelligence layer that runs on every user interaction ("tick"). It observes the user's current context (which page, which niche/ICP is selected, what contacts are visible) and uses the 5 scoring engines to identify opportunities for network growth. When an opportunity is found, it creates a Goal and surfaces it as a toast notification that the user can accept or reject.

The engine is **fast** — it does lookups, not computation. Scoring is pre-computed; the engine reads scores and identifies gaps, patterns, and opportunities.

---

## Architecture

### Tick Model

Every meaningful user action triggers a "tick" — a lightweight function call that:

1. Reads the **current context** (page, selected niche/ICP/offering, visible contacts)
2. Runs 2-3 **context-aware checks** relevant to where the user is
3. Runs 1-2 **random background checks** from a rotating pool
4. If a check produces a goal candidate, checks **deduplication** (no duplicate active goals)
5. If novel, creates the goal and returns it for toast display

```
User Action (click/navigate)
  → GoalEngine.tick(context)
    → contextChecks(context)     // 2-3 checks based on where user is
    → backgroundChecks()          // 1-2 random checks from the pool
    → dedup(candidates)           // Filter already-active goals
    → createGoals(novel)          // Insert into DB
    → return newGoals[]           // For toast display
```

### Context Object

```typescript
interface TickContext {
  page: 'discover' | 'contacts' | 'dashboard' | 'tasks' | 'network' | 'outreach';
  selectedNicheId?: string;
  selectedIcpId?: string;
  selectedOfferingIds?: string[];
  viewingContactId?: string;
  visibleContactIds?: string[];  // Contacts currently rendered in a list
  searchQuery?: string;
}
```

### Response

```typescript
interface TickResult {
  newGoals: GoalCandidate[];   // Goals to show as toasts
  errors?: string[];           // Embedding/index errors to surface
}

interface GoalCandidate {
  title: string;
  description: string;
  goalType: string;
  priority: number;
  targetMetric: string;
  targetValue: number;
  currentValue: number;
  source: 'system';
  metadata: {
    engine: string;          // Which engine produced this
    checkType: string;       // Which check found it
    context: object;         // Snapshot of context when found
    suggestedTasks: SuggestedTask[];
  };
}

interface SuggestedTask {
  title: string;
  description: string;
  taskType: string;
  priority: number;
  url?: string;              // LinkedIn search URL, profile URL, etc.
  contactId?: string;
}
```

---

## The 5 Engines → Goal Checks

Each scoring engine contributes a set of checks. Checks are fast lookups — they query pre-computed scores, counts, and indexes.

### Engine 1: ICP Fit → Coverage Gap Checks

**What it knows**: Which contacts match ICP criteria, how many per niche.

| Check | Trigger Context | Goal Produced |
|-------|----------------|---------------|
| `niche-coverage-gap` | User views a niche with <10 matching contacts | "Grow [Niche] — only [N] contacts match your criteria" |
| `icp-zero-matches` | User selects an ICP with 0 matches | "No contacts match [ICP] — create a LinkedIn search to find them" |
| `icp-concentration` | >80% of an ICP's matches are in one company | "Diversify [ICP] — 80% at [Company], explore other orgs" |
| `unaddressed-network` | >90% of network is unaddressed | "Most of your network is untapped — review niche keywords" |

**Suggested tasks**:
- LinkedIn People Search URL pre-filled with ICP role + industry keywords
- "Review and refine [ICP] criteria" task
- "Tag [N] unscored contacts for scoring" task

### Engine 2: Network Hub → Connector Leverage Checks

**What it knows**: PageRank, betweenness centrality, connection counts.

| Check | Trigger Context | Goal Produced |
|-------|----------------|---------------|
| `hub-unexplored` | User views a high-hub contact who has no 2nd-degree exploration | "Explore [Hub]'s network — likely gateway to [N] [Niche] contacts" |
| `bridge-opportunity` | Contact bridges two niches with no overlap | "[Bridge] connects [Niche A] and [Niche B] — explore for cross-sell" |
| `hub-dormant` | High-hub contact with no recent messages | "Re-engage [Hub] — top connector, dormant for [N] days" |

**Suggested tasks**:
- "Browse [Hub]'s connections on LinkedIn" (with URL to their connections page)
- "Send catch-up message to [Hub]"
- "Create 2nd-degree search list from [Hub]'s network"

### Engine 3: Relationship Strength → Engagement Checks

**What it knows**: Message count, recency, endorsements given/received, recommendation status.

| Check | Trigger Context | Goal Produced |
|-------|----------------|---------------|
| `warm-lead-cooling` | Gold-tier contact with declining interaction | "Re-engage [Contact] — warm lead cooling off (last contact [N] days)" |
| `strong-no-outreach` | High relationship score but never in an outreach campaign | "Activate [Contact] — strong relationship, never reached out" |
| `one-sided-relationship` | User endorsed/recommended contact but not reciprocated | "[Contact] hasn't reciprocated — send a direct message" |
| `new-connection-window` | Contact connected in last 7 days | "Welcome [Contact] — new connection, optimal outreach window" |

**Suggested tasks**:
- "Send personalized message to [Contact]"
- "Endorse [Contact]'s top skill on LinkedIn"
- "Add [Contact] to [Campaign]"

### Engine 4: Signal Boost → Opportunity Detection Checks

**What it knows**: Headline keywords, title changes, hiring signals, content activity.

| Check | Trigger Context | Goal Produced |
|-------|----------------|---------------|
| `role-change-detected` | Contact's title changed recently (new import vs old) | "[Contact] is now [New Title] at [Company] — outreach window" |
| `hiring-signal` | Contact's company has hiring keywords in job posts | "[Company] is hiring engineers — [Contact] may need CTO help" |
| `content-engagement` | Contact posting about topics matching your offerings | "[Contact] posting about [Topic] — engage and position" |

**Suggested tasks**:
- "Congratulate [Contact] on new role"
- "Comment on [Contact]'s latest post about [Topic]"
- "Research [Company]'s hiring patterns"

### Engine 5: Content/Skills Relevance → Alignment Checks

**What it knows**: Skill overlap, content topic similarity, about section analysis.

| Check | Trigger Context | Goal Produced |
|-------|----------------|---------------|
| `skill-cluster-gap` | Niche has contacts with skills you don't connect to | "Skill gap in [Niche]: [Skill] cluster has [N] contacts, none connected" |
| `offering-alignment` | Contact's skills/needs match an offering perfectly | "[Contact] is ideal for [Offering] — skills align 90%" |

**Suggested tasks**:
- "Create content about [Skill/Topic] to attract [Niche]"
- "Prepare [Offering] pitch for [Contact]"

---

## Background Checks (Random Pool)

On each tick, 1-2 of these are selected randomly. They don't depend on current context.

| Check | What It Does | Goal If Found |
|-------|-------------|---------------|
| `stale-scores` | Are >20% of contacts unscored or scored >30 days ago? | "Rescore network — [N] contacts have stale scores" |
| `embedding-health` | Are embeddings missing for >10% of contacts? | "Rebuild embeddings — [N] contacts missing" |
| `orphan-contacts` | Contacts with no niche/ICP match and no tags | "Classify [N] orphan contacts — add tags or update niches" |
| `goal-stale` | Active goals with no task progress in 7+ days | "Stalled goal: [Goal] — review or cancel" |
| `niche-imbalance` | One niche has 10x contacts vs another | "Niche imbalance — [Big Niche] has [N]x more than [Small Niche]" |
| `scoring-drift` | Average network score trending down | "Network quality declining — review recent additions" |

---

## Goal Lifecycle

```
┌──────────┐     ┌──────────┐     ┌───────────┐     ┌───────────┐
│ Suggested │ ──→ │ Accepted │ ──→ │ In-Progress│ ──→ │ Completed │
└──────────┘     └──────────┘     └───────────┘     └───────────┘
      │                                                    │
      ▼                                                    ▼
┌──────────┐                                        ┌───────────┐
│ Rejected │                                        │ Cancelled │
└──────────┘                                        └───────────┘
```

1. **Suggested**: Engine creates the goal, toast appears
2. **Accepted**: User clicks "Accept" on toast → goal becomes active, suggested tasks are created
3. **Rejected**: User clicks "Dismiss" → goal logged as rejected. The engine learns: this `checkType` + `context` pattern should be suppressed for future ticks
4. **In-Progress**: At least one task has been started
5. **Completed**: All tasks done or target_value reached
6. **Cancelled**: User manually cancels

### Rejection Learning

The engine requires **3 rejections** of the same check type + context within 30 days before suppressing. A single dismissal won't prevent the goal from reappearing — the user needs to consistently reject it to train the system.

When a user rejects a goal, we store:

```typescript
{
  goalType: string;
  checkType: string;
  contextSnapshot: object;  // What niche/ICP was selected
  rejectedAt: Date;
}
```

Before suggesting a goal, the engine checks: "Has this exact `checkType` been rejected in the last 30 days for this same context?" If yes, skip it. Over time, the engine learns which types of goals the user finds valuable vs noisy.

Storage: `goal_rejections` table or `metadata` JSONB on a goal with `status = 'rejected'`.

---

## Implementation Plan

### Phase 1: Core Engine (API + Toast)

**Files to create:**

| File | Purpose |
|------|---------|
| `lib/goals/engine.ts` | Main tick function, check runner, dedup |
| `lib/goals/checks/icp-checks.ts` | ICP fit engine checks |
| `lib/goals/checks/hub-checks.ts` | Network hub engine checks |
| `lib/goals/checks/relationship-checks.ts` | Relationship strength checks |
| `lib/goals/checks/signal-checks.ts` | Signal boost checks |
| `lib/goals/checks/background-checks.ts` | Background/health checks |
| `app/api/goals/tick/route.ts` | POST endpoint: receives context, returns new goals |
| `components/goals/goal-toast.tsx` | Toast component with Accept/Reject buttons |
| `hooks/use-goal-engine.ts` | React hook that calls tick on navigation/interaction |

**API contract:**

```
POST /api/goals/tick
Body: { context: TickContext }
Response: { newGoals: GoalCandidate[], errors: string[] }
```

**React hook:**

```typescript
function useGoalEngine() {
  // Calls POST /api/goals/tick on:
  // - Page navigation (via Next.js router events)
  // - Niche/ICP dropdown change
  // - Contact click
  // Debounced to max 1 tick per 3 seconds
  // Shows toast for each new goal
  // Provides acceptGoal(id) and rejectGoal(id) callbacks
}
```

Mounted in the app layout so it runs on every page.

### Phase 2: Smart Tasks

- When a goal is accepted, auto-create its `suggestedTasks`
- Tasks include pre-built LinkedIn search URLs with encoded ICP criteria
- "Explore 2nd degree" tasks link to the browser extension's search flow
- Task completion updates goal `current_value`

### Phase 3: Learning Loop

- Track rejection patterns
- Weight goal checks by acceptance rate
- Suppress low-acceptance checks
- Surface high-acceptance checks more frequently
- Weekly digest: "Your network grew by [N] in [Niche] this week"

---

## Performance Considerations

The engine must be fast — it runs on every click.

| Component | Target Latency | Strategy |
|-----------|---------------|----------|
| Context checks | <50ms total | Pre-computed scores, indexed lookups |
| Background checks | <30ms total | Random sampling, cached counts |
| Dedup | <10ms | In-memory Set of active goal hashes |
| Total tick | <100ms | Parallel queries where possible |

**Caching**: The engine caches niche/ICP counts and embedding health stats in-memory for 60 seconds. Background checks refresh cache on miss.

**Query pattern**: All checks use indexed columns (contact_id, icp_profile_id, tier, status) with `LIMIT 1` or `EXISTS` — never full table scans.

---

## Error Surfacing

The tick also checks for system health issues:

| Error | Detection | User Action |
|-------|-----------|-------------|
| Missing embeddings | `count(id) FROM profile_embeddings` < 80% of contacts | Toast: "Embeddings incomplete — go to Admin > Reindex" |
| Stale scores | >50% of scores older than 30 days | Toast: "Scores are stale — run Rescore All" |
| No ICP profiles | 0 active ICPs | Toast: "Create an ICP profile to start discovering contacts" |
| No niches | 0 niches with contacts | Toast: "Your niches aren't matching anyone — review keywords" |

These show as warning toasts (yellow), distinct from goal toasts (blue/purple).

---

## Integration Points

### With Discover Page
- Tick fires when niche/ICP dropdown changes
- Goals like "Grow [Niche]" link directly to the Discover page with that niche pre-selected
- "Explore 2nd degree" tasks open the browser extension's search mode

### With Contacts Page
- Tick fires when viewing a specific contact
- Goals like "Re-engage [Contact]" link to their profile page
- Contact tooltip shows active goals/tasks for that contact

### With Scoring Pipeline
- After a scoring run completes, a tick fires with context `{ page: 'scoring' }`
- The engine checks for tier changes, new gold contacts, persona assignments
- Goals like "Reach out to new Gold contact [Name]" are created

### With Import Pipeline
- After import completes, a tick fires with context `{ page: 'import' }`
- Background checks run: embedding health, niche coverage, unscored contacts
- Goals like "Score [N] new contacts" and "Rebuild embeddings" are created

### With Browser Extension
- When the extension captures a LinkedIn page, a tick fires
- Signal checks run against the captured profile
- Goals like "This contact matches [ICP] — save and score" are created

---

## Example Tick Walkthrough

**User is on Discover page, selects "Digital Health Startups" niche:**

```
Tick context: { page: 'discover', selectedNicheId: '...' }

Context check 1: niche-coverage-gap
  → Query: SELECT member_count FROM niche_profiles WHERE id = ?
  → Result: 3 contacts
  → Candidate: "Grow Digital Health Startups — only 3 contacts"
  → Dedup: No existing active goal with this checkType + nicheId
  → CREATE GOAL ✓

Context check 2: icp-zero-matches
  → Query: SELECT count FROM wedge ICPs WHERE nicheId = ?
  → Result: 1 ICP, "Health Tech Founders", 1 match
  → No goal (ICP has matches)

Background check (random): embedding-health
  → Cache hit: 5839/6200 = 94% → healthy, no goal

Result: 1 new goal → Toast: "Grow Digital Health Startups — only 3 contacts match"
  Accept → Creates tasks:
    1. "Search LinkedIn for HIPAA + CEO/Founder in Digital Health" (with URL)
    2. "Review Digital Health Startups niche keywords for better coverage"
    3. "Explore 2nd-degree connections of [Top Hub in Healthcare]"
```

---

## Data Model Additions

### New table: `goal_rejections` (or use goals table with status='rejected')

```sql
-- Option A: Separate tracking table
CREATE TABLE goal_check_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_type TEXT NOT NULL,
  goal_type TEXT NOT NULL,
  context_hash TEXT NOT NULL,  -- hash of relevant context for dedup
  accepted BOOLEAN NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gcf_check_context ON goal_check_feedback(check_type, context_hash, created_at DESC);
```

### Goals table update

Add `status = 'suggested'` and `status = 'rejected'` to the allowed statuses. The existing goals schema already supports this — just needs the engine to use it.

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Goal acceptance rate | >40% | accepted / (accepted + rejected) |
| Goals → completed tasks | >60% | completed tasks / total tasks from goals |
| Network growth per week | +5-10 contacts in target niches | Niche member_count delta |
| Time to first outreach | <48 hours from goal creation | Task completed_at - goal created_at |
| Engine latency | <100ms p95 | Server-side timing |
