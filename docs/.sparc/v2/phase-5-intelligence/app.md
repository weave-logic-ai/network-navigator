# Phase 5: Intelligence -- App Plan (Weeks 17-20)

## Objective

Build the intelligence layer of the application: Claude-powered goal and task generation, a full Goals & Tasks page, an outreach template system with Claude personalization, an outreach state machine with branching sequences, a pipeline Kanban view, campaign management, and template performance tracking. This is the heaviest phase for the app domain with 10+ major features across 4-5 parallel agents.

## Prerequisites (Phases 1-4 Complete)

| Phase | Required Artifact | Status Gate |
|-------|-------------------|-------------|
| 1 | PostgreSQL schema: `goals`, `tasks`, `campaigns`, `templates`, `outreach_sequences`, `outreach_states`, `outreach_events`, `template_performance` tables | Tables exist and accept writes |
| 1 | CSV import pipeline operational | Contacts populated from import |
| 2 | Scoring engine: tier assignments, persona classification | `contact_scores` populated |
| 2 | Enrichment pipeline with budget tracking | Enrichment data available for contacts |
| 3 | Dashboard, contact detail, network graph, discover pages | All Phase 3 UI renders |
| 3 | SWR data fetching patterns established | `useSWR` hooks in use across app |
| 4 | Extension capture + parse pipeline | `behavioral_observations` populated |
| 4 | WebSocket server for extension push | `/ws/extension` operational |
| 5-BE | Claude API routes operational | `/api/agent/analyze`, `/api/agent/chat` respond |
| 5-BE | `content_profiles` and `activity_patterns` tables populated | Analysis data available |

## Parallel Agent Assignments

| Agent | Role | Primary Files | Estimated Effort |
|-------|------|---------------|------------------|
| Agent A1 | Claude Intelligence | `src/agent/goal-generator.ts`, `src/agent/task-generator.ts`, `src/agent/template-personalizer.ts` | 4-5 days |
| Agent A2 | Tasks UI | `app/src/components/tasks/*`, `app/src/app/tasks/page.tsx` | 3-4 days |
| Agent A3 | Outreach Engine | `src/outreach/template-engine.ts`, `src/outreach/state-machine.ts`, `src/outreach/sequence-engine.ts`, `src/outreach/campaign-manager.ts` | 4-5 days |
| Agent A4 | API Routes | All Phase 5 API route files under `app/src/app/api/` | 3-4 days |
| Agent A5 | Outreach UI + Analytics | `app/src/components/outreach/*`, `app/src/app/outreach/page.tsx` | 4-5 days |

**Parallelism note**: A1 (Claude logic) and A4 (API routes) coordinate on request/response contracts. A2 (Tasks UI) and A5 (Outreach UI) are fully independent. A3 (Outreach Engine) provides the services that A4 wires into routes and A5 renders.

---

## Detailed Task Checklist

### Task A5-1: Goal Generator Service

**BR Reference**: BR-701, BR-702, BR-703
**File**: `app/src/agent/goal-generator.ts`
**Agent**: A1

- [ ] Create `GoalGenerator` class
  - Constructor: `(claudeClient: ClaudeClient, db: DatabasePool)`
  - Method: `generateGoals(trigger: GoalTrigger): Promise<GeneratedGoal[]>`
  - Method: `refreshGoals(): Promise<GeneratedGoal[]>`

- [ ] Implement trigger-based goal generation:

  **After CSV Import** (`trigger: 'post_import'`):
  - [ ] Analyze imported contacts: cluster distribution, industry spread, seniority mix
  - [ ] Identify potential ICP candidates (contacts matching multiple high-value signals)
  - [ ] Generate goal: "Discover your ICPs" with tasks:
    - `review_icp`: Review and refine auto-detected ICP profiles
    - `enrich_contact`: Enrich gold-tier contacts missing email/phone
    - `visit_profile`: Capture profiles for contacts with low data completeness
  - [ ] Generate goal: "Map your network" with tasks:
    - `analyze_cluster`: Run analysis on top 3 clusters
    - `capture_page`: Visit and capture 2nd-degree connections in key clusters

  **After Enrichment Batch** (`trigger: 'post_enrichment'`):
  - [ ] Identify enrichment gaps: contacts with partial data
  - [ ] Generate goal: "Complete gold-tier profiles" with tasks:
    - `enrich_contact`: Target gold contacts missing email (provider-specific)
    - `visit_profile`: Capture profiles for gold contacts with no behavioral data
  - [ ] Generate goal: "Explore new opportunities" with tasks:
    - `enrich_contact`: Enrich high-ICP-fit silver contacts to promote to gold

  **After Scoring Refresh** (`trigger: 'post_scoring'`):
  - [ ] Identify high-value unexplored contacts (high score, low engagement)
  - [ ] Generate goal: "Engage your top prospects" with tasks:
    - `send_message`: Outreach to gold-tier uncontacted contacts
    - `visit_profile`: Research before outreach

  **After Content Analysis** (`trigger: 'post_analysis'`):
  - [ ] Identify outreach-ready contacts (high receptiveness + content alignment)
  - [ ] Generate goal: "Start conversations" with tasks:
    - `send_message`: Using personalized templates based on content analysis
    - `visit_profile`: Engage with their recent content first

  **Ongoing Network Health** (`trigger: 'scheduled'`, every 24h):
  - [ ] Detect dormant connections (no interaction in 90+ days)
  - [ ] Generate goal: "Strengthen weak connections" with tasks:
    - `send_message`: Re-engagement messages
    - `visit_profile`: Check for life/career updates

- [ ] Claude prompt for goal generation:
  ```
  You are a LinkedIn networking strategist. Based on the current network state
  and trigger event, generate strategic goals.

  Network State:
  - Total: {{total}} contacts (Gold: {{gold}}, Silver: {{silver}}, Bronze: {{bronze}})
  - Enrichment: {{enriched_pct}}% enriched, {{missing_email_gold}} gold missing email
  - Content: {{analyzed_pct}}% analyzed, avg receptiveness: {{avg_receptiveness}}
  - Activity: {{active_pct}}% active in last 30d
  - Clusters: {{cluster_summary}}

  Trigger: {{trigger_type}}
  Trigger Details: {{trigger_details}}

  Generate goals as JSON array:
  [
    {
      "name": "Goal name (action-oriented, max 60 chars)",
      "description": "Why this goal matters (1-2 sentences)",
      "category": "discover|enrich|engage|analyze",
      "priority": 1-100,
      "estimated_tasks": 3-8,
      "tasks": [
        {
          "type": "visit_profile|enrich_contact|send_message|review_icp|analyze_cluster|capture_page",
          "title": "Task title",
          "description": "What to do",
          "target_contact_id": "uuid or null",
          "target_cluster_id": "uuid or null",
          "priority": 1-100,
          "estimated_minutes": 1-30,
          "depends_on": ["task_index or null"]
        }
      ]
    }
  ]

  Rules:
  - Max 5 goals per generation
  - Each goal should have 3-8 tasks
  - Tasks should be specific and actionable
  - Priority considers: tier (gold=high), data gaps, timing, ROI
  - Never suggest outreach to contacts without enrichment data
  ```

- [ ] Goal persistence:
  ```sql
  INSERT INTO goals (id, name, description, category, priority, status, source, trigger_type, created_at)
  VALUES ($1, $2, $3, $4, $5, 'proposed', 'claude', $6, NOW())
  ```
  - Status flow: `proposed` -> `accepted` -> `in_progress` -> `completed` / `rejected` / `archived`

- [ ] User interaction flow:
  - Goals created with status `proposed` (user must accept)
  - User can: accept (status -> `accepted`, tasks become actionable), reject (status -> `rejected`), edit (modify name/tasks, then accept)
  - Accepted goals have their tasks created in `tasks` table

**Acceptance Criteria**:
- After CSV import of 100+ contacts, generates 2-4 relevant goals
- Goals include specific tasks with target contacts/clusters
- Each trigger type produces contextually appropriate goals
- Proposed goals are visible but not actionable until accepted
- Edited goals preserve user modifications

---

### Task A5-2: Task Generator and Prioritization

**BR Reference**: BR-704, BR-705, BR-706, BR-707
**File**: `app/src/agent/task-generator.ts`
**Agent**: A1

- [ ] Create `TaskGenerator` class
  - Method: `generateTasksForGoal(goal: Goal): Promise<Task[]>`
  - Method: `prioritizeTasks(tasks: Task[]): Task[]`
  - Method: `getNextTasks(limit: number, filters?: TaskFilters): Promise<Task[]>`

- [ ] Task type definitions:
  ```typescript
  type TaskType =
    | 'visit_profile'      // Navigate to LinkedIn profile and capture
    | 'enrich_contact'     // Trigger enrichment for a contact
    | 'send_message'       // Compose and send outreach message
    | 'review_icp'         // Review and refine ICP profile
    | 'analyze_cluster'    // Run Claude analysis on cluster
    | 'capture_page'       // Generic page capture task
    | 'engage_content'     // Like/comment on contact's post
    | 'request_intro'      // Ask mutual connection for introduction
    | 'update_notes'       // Add manual notes to contact
    | 'export_list';       // Export a filtered contact list

  type TaskCategory = 'explore' | 'enrich' | 'engage' | 'analyze';

  // Category mapping:
  // explore: visit_profile, capture_page
  // enrich: enrich_contact, update_notes, export_list
  // engage: send_message, engage_content, request_intro
  // analyze: review_icp, analyze_cluster
  ```

- [ ] Implement priority scoring algorithm:
  ```typescript
  function calculatePriority(task: Task, contact?: Contact): number {
    let score = task.basePriority || 50;

    // Tier bonus
    if (contact?.tier === 'gold')   score += 40;
    if (contact?.tier === 'silver') score += 20;
    if (contact?.tier === 'bronze') score += 10;

    // Data completeness (lower = more urgent to fill)
    if (contact?.dataCompleteness < 0.5) score += 15;

    // Unblocking bonus (capture_page tasks unlock other tasks)
    if (task.type === 'capture_page') score += 10;

    // Recency bonus (recently connected contacts)
    const daysSinceConnected = daysBetween(contact?.connectedAt, now());
    if (daysSinceConnected < 7)  score += 20;
    if (daysSinceConnected < 30) score += 10;

    // Receptiveness bonus (from content analysis)
    if (contact?.receptiveness > 75) score += 15;

    // Goal priority inheritance (high-priority goal tasks bubble up)
    score += (task.goal?.priority || 50) * 0.2;

    return Math.min(score, 100);
  }
  ```

- [ ] Task dependency locking:
  - Tasks can declare `depends_on: taskId[]`
  - Locked tasks show lock icon + reason ("Waiting for enrichment")
  - Dependency types:
    - `enrich_contact` locks `send_message` (can't outreach without data)
    - `capture_page` locks `analyze_cluster` (need observations first)
    - `visit_profile` locks `engage_content` (need to know their content)
  - When dependency completes, dependent tasks auto-unlock
  - Circular dependency prevention: validate at creation time

- [ ] Task status flow:
  ```
  pending -> ready -> in_progress -> completed
                  \-> skipped
                  \-> deferred (re-enters pending)
  ```
  - `pending`: waiting for dependencies
  - `ready`: all dependencies met, available for action
  - `in_progress`: user has started (or extension is executing)
  - `completed`: task done (manual or auto-detected by extension)
  - `skipped`: user chose to skip
  - `deferred`: pushed to later (re-enters queue with lower priority)

- [ ] Persist tasks:
  ```sql
  INSERT INTO tasks (
    id, goal_id, type, category, title, description,
    target_contact_id, target_cluster_id,
    priority, status, depends_on, locked_reason,
    estimated_minutes, created_at
  ) VALUES (...)
  ```

**Acceptance Criteria**:
- Priority algorithm produces consistent ordering: gold outreach > silver enrich > bronze explore
- Dependency locking prevents `send_message` task from being actionable before `enrich_contact` completes
- Completed dependency auto-unlocks dependent tasks
- `getNextTasks(5)` returns top 5 ready tasks sorted by priority
- Task status transitions follow the defined state flow

---

### Task A5-3: Claude Template Personalizer

**BR Reference**: BR-602, BR-603
**File**: `app/src/agent/template-personalizer.ts`
**Agent**: A1

- [ ] Create `TemplatePersonalizer` class
  - Constructor: `(claudeClient: ClaudeClient, db: DatabasePool)`
  - Method: `renderTemplate(templateId: string, contactId: string): Promise<RenderedMessage>`
  - Method: `suggestTemplate(contactId: string, outreachState?: OutreachState): Promise<TemplateSuggestion>`

- [ ] Template rendering pipeline:
  1. Fetch template body from `templates` table
  2. Fetch contact data: basic info + enrichment + content_profile + graph edges
  3. Build Claude context:
     ```typescript
     interface PersonalizationContext {
       contact: {
         firstName: string;
         lastName: string;
         headline: string;
         currentRole: string;
         currentCompany: string;
         location: string;
         about: string;
         skills: string[];
       };
       enrichment: {
         email?: string;
         phone?: string;
         socialProfiles?: Record<string, string>;
       };
       contentProfile: {
         topics: string[];
         painPoints: string[];
         engagementStyle: string;
         tone: string;
         receptiveness: number;
         conversationStarters: string[];
       };
       graph: {
         mutualConnections: string[];
         sharedInterests: string[];
         commonClusters: string[];
         warmIntroPath?: string[];
       };
       outreach: {
         currentState?: OutreachState;
         previousMessages?: string[];
         daysSinceLastContact?: number;
       };
     }
     ```
  4. Send to Claude with personalization prompt:
     ```
     You are a professional LinkedIn messaging expert. Personalize this template
     for the specific contact using the provided context.

     Template:
     {{template_body}}

     Contact Context:
     {{context_json}}

     Rules:
     - Keep the message under {{max_chars}} characters
     - Use a {{tone}} tone (matching contact's detected communication style)
     - Reference at least one specific detail from their profile or content
     - If mutual connections exist, mention the strongest one naturally
     - If pain points are known, address one that aligns with your value proposition
     - Never be pushy or salesy
     - Output ONLY the personalized message text, no explanation
     ```
  5. Return `RenderedMessage`:
     ```typescript
     interface RenderedMessage {
       text: string;
       charCount: number;
       personalizationScore: number;  // 0-100, how personalized vs generic
       variablesUsed: string[];       // which merge vars were filled
       suggestedSubject?: string;     // for email templates
     }
     ```

- [ ] Template suggestion logic:
  - Given a contact and their outreach state, suggest the best template
  - Consider: contact tier, engagement style, receptiveness, outreach history
  - Return top 3 templates ranked by predicted effectiveness

**Acceptance Criteria**:
- Rendered message contains at least one contact-specific reference (name, company, topic, mutual)
- Message respects character limit (300 for connection request, 2000 for InMail)
- Personalization score > 60 for contacts with content_profile data
- Template suggestion returns relevant templates based on outreach state
- Rendering completes in <5s per message

---

### Task A5-4: Goals & Tasks Page

**BR Reference**: BR-708, BR-709, BR-710
**File**: `app/src/app/tasks/page.tsx`, `app/src/components/tasks/TasksContent.tsx`
**Agent**: A2

- [ ] Create page route at `/tasks` with `TasksContent` as main layout
- [ ] Page layout:
  ```
  +----------------------------------------------------+
  | Goals & Tasks                        [Generate New] |
  +----------------------------------------------------+
  | [Active Goals]  [Proposed]  [Completed]  [All]      |
  +----------------------------------------------------+
  | +-- GoalCard: "Discover your ICPs"  ----+           |
  | | Progress: ████████░░ 6/8 tasks        |           |
  | | Category: Discover  Priority: 92      |           |
  | | [Edit] [Archive]                      |           |
  | +-- TaskCard: Visit John's profile  ----+           |
  | |   [compass] Priority: 88 | Ready      |           |
  | |   [Start] ->                           |           |
  | +-- TaskCard: Enrich Sarah (locked) ----+           |
  | |   [sparkle] Priority: 75 | Locked     |           |
  | |   [lock] Waiting for profile capture   |           |
  | +---------------------------------------+           |
  |                                                     |
  | +-- GoalCard: "Engage top prospects" ---+           |
  | | Progress: ██░░░░░░░░ 1/5 tasks        |           |
  | | ...                                   |           |
  +----------------------------------------------------+
  | Task Queue (all tasks, sorted by priority)          |
  | [Filter: Category v] [Filter: Status v] [Sort v]   |
  | TaskCard | TaskCard | TaskCard | ...                |
  +----------------------------------------------------+
  ```

- [ ] SWR data fetching:
  ```typescript
  const { data: goals } = useSWR('/api/goals?status=accepted,in_progress');
  const { data: proposedGoals } = useSWR('/api/goals?status=proposed');
  const { data: taskQueue } = useSWR('/api/tasks?status=ready&sort=priority&limit=20');
  ```

**Acceptance Criteria**:
- Page renders with real goal and task data
- Tab switching between Active/Proposed/Completed/All works
- Generate New button triggers goal generation and shows proposed goals
- Empty state shows onboarding prompt ("Import contacts to get started")

---

### Task A5-5: GoalCard Component

**BR Reference**: BR-708
**File**: `app/src/components/tasks/GoalCard.tsx`
**Agent**: A2

- [ ] Props interface:
  ```typescript
  interface GoalCardProps {
    goal: Goal;
    tasks: Task[];
    onAccept?: (goalId: string) => void;
    onReject?: (goalId: string) => void;
    onEdit?: (goalId: string) => void;
    onArchive?: (goalId: string) => void;
  }
  ```

- [ ] Visual elements:
  - Goal name (truncated to 60 chars)
  - Category badge with icon and color:
    - Discover: blue, compass icon
    - Enrich: purple, sparkle icon
    - Engage: green, send icon
    - Analyze: amber, bar-chart icon
  - Progress bar: completed tasks / total tasks (shadcn `Progress` component)
  - Priority indicator: high (red dot), medium (yellow), low (gray)
  - Task count: "6/8 tasks completed"
  - Source badge: "Claude" or "Manual"
  - Action buttons:
    - Proposed: [Accept] [Reject] [Edit]
    - Active: [Edit] [Archive]
    - Completed: [Archive]

- [ ] Expand/collapse task list within the card (default: collapsed for 5+ tasks)
- [ ] Proposed goal visual treatment: dashed border, muted colors, "Proposed by Claude" label

**Acceptance Criteria**:
- Card renders all visual elements correctly
- Progress bar fills proportionally to completed tasks
- Accept/Reject actions update goal status via API
- Category colors and icons match specification
- Collapsed state shows task count, expanded shows full task list

---

### Task A5-6: TaskCard Component

**BR Reference**: BR-709
**File**: `app/src/components/tasks/TaskCard.tsx`
**Agent**: A2

- [ ] Props interface:
  ```typescript
  interface TaskCardProps {
    task: Task;
    onStart?: (taskId: string) => void;
    onComplete?: (taskId: string) => void;
    onSkip?: (taskId: string) => void;
    onDefer?: (taskId: string) => void;
    compact?: boolean;  // for queue view
  }
  ```

- [ ] Visual elements:
  - Category icon (matching GoalCard category colors):
    - `visit_profile`, `capture_page` -> compass (blue)
    - `enrich_contact`, `update_notes`, `export_list` -> sparkle (purple)
    - `send_message`, `engage_content`, `request_intro` -> send (green)
    - `review_icp`, `analyze_cluster` -> bar-chart (amber)
  - Task title
  - Priority badge (numeric, colored: >80 red, >50 yellow, else gray)
  - Status indicator:
    - Ready: green dot, "Ready"
    - In Progress: spinning indicator, "In Progress"
    - Locked: lock icon, "Locked: {reason}"
    - Completed: checkmark, "Done"
    - Skipped: skip icon, dimmed
  - Action button (contextual):
    - Ready: [Start] / [Skip] / [Defer]
    - Locked: disabled, shows lock reason tooltip
    - In Progress: [Complete] / [Skip]
  - Target contact name (if applicable), clickable -> contact detail
  - Estimated time badge: "~5 min"

- [ ] Compact mode for queue view (single row, no description)
- [ ] Locked task visual: grayed out, lock icon overlay, tooltip with dependency info

**Acceptance Criteria**:
- Card renders with correct icon and color for each task type
- Locked tasks are visually distinct and non-actionable
- Action buttons trigger correct API mutations
- Compact mode renders as single-line item
- Target contact link navigates to contact detail page

---

### Task A5-7: TaskQueue Component

**BR Reference**: BR-710
**File**: `app/src/components/tasks/TaskQueue.tsx`
**Agent**: A2

- [ ] Filterable, sortable task list across all goals
- [ ] Filters:
  - Category: All / Explore / Enrich / Engage / Analyze
  - Status: All / Ready / In Progress / Locked / Completed
  - Goal: dropdown of active goals
  - Tier: Gold / Silver / Bronze (filters by target contact tier)
- [ ] Sort options: Priority (default), Created Date, Estimated Time, Goal
- [ ] Infinite scroll pagination (20 tasks per page, SWR infinite)
- [ ] Bulk actions: Select multiple -> Complete All / Skip All / Defer All
- [ ] Summary bar: "12 ready, 5 locked, 3 in progress, 8 completed"

**Acceptance Criteria**:
- Filters reduce displayed tasks correctly
- Sort changes ordering immediately (client-side for loaded data)
- Infinite scroll loads more tasks on scroll
- Bulk actions apply to all selected tasks
- Summary bar updates in real-time as tasks change status

---

### Task A5-8: Outreach Template Engine

**BR Reference**: BR-601, BR-602, BR-603
**File**: `app/src/outreach/template-engine.ts`
**Agent**: A3

- [ ] Create `TemplateEngine` class
  - Method: `createTemplate(template: CreateTemplateInput): Promise<Template>`
  - Method: `renderTemplate(templateId: string, contactId: string): Promise<RenderedMessage>`
  - Method: `listTemplates(filters?: TemplateFilters): Promise<Template[]>`
  - Method: `getTemplateSuggestions(contactId: string, state?: OutreachState): Promise<TemplateSuggestion[]>`

- [ ] Template model:
  ```typescript
  interface Template {
    id: string;
    name: string;
    category: TemplateCategory;
    subject?: string;           // for email templates
    body: string;               // with merge variables
    variables: string[];        // auto-extracted from body
    channel: 'linkedin_connection' | 'linkedin_message' | 'email' | 'linkedin_inmail';
    charLimit: number;          // 300 for connection, 2000 for message, etc.
    tags: string[];
    isSystem: boolean;          // built-in vs user-created
    createdAt: string;
    updatedAt: string;
  }

  type TemplateCategory =
    | 'connection-request'
    | 'followup'
    | 'meeting-request'
    | 'value-add'
    | 're-engage'
    | 'warm-intro'
    | 'thank-you'
    | 'congratulations';
  ```

- [ ] Merge variable system:
  - Standard variables: `{{firstName}}`, `{{lastName}}`, `{{headline}}`, `{{currentRole}}`, `{{currentCompany}}`, `{{location}}`
  - Enrichment variables: `{{email}}`, `{{phone}}`
  - Graph variables: `{{mutualConnection}}`, `{{mutualCount}}`, `{{sharedCluster}}`, `{{sharedInterest}}`
  - Content variables: `{{recentTopic}}`, `{{painPoint}}`, `{{conversationStarter}}`
  - Outreach variables: `{{daysSinceLastMessage}}`, `{{previousMessageRef}}`
  - Variable extraction: regex `\{\{(\w+)\}\}` from template body

- [ ] Built-in system templates (seeded on first run):

  **Connection Request** (300 char max):
  ```
  Hi {{firstName}}, I noticed we're both in {{sharedCluster}} and share an
  interest in {{recentTopic}}. {{conversationStarter}} Would love to connect
  and exchange ideas.
  ```

  **Follow-up** (2000 char max):
  ```
  Hi {{firstName}}, thanks for connecting! I saw your recent post about
  {{recentTopic}} and it resonated with me. {{conversationStarter}}

  I work in {{userRole}} at {{userCompany}} and I think there could be
  some interesting overlap. Would you be open to a quick chat?
  ```

  **Meeting Request** / **Value-Add** / **Re-Engage** / **Warm Intro** templates similarly defined.

- [ ] Template rendering pipeline:
  1. Extract merge variables from template body
  2. Resolve each variable against contact data, enrichment, content_profile, graph
  3. For unresolvable variables: pass to Claude for contextual fill
  4. Validate character limit
  5. Return rendered message with metadata

**Acceptance Criteria**:
- 6 system templates seeded on first run
- User can create custom templates with merge variables
- Variables are auto-extracted and displayed in editor
- Rendering fills all resolvable variables from data
- Character limit enforced (truncation with warning, not silent cut)
- Templates queryable by category, channel, tags

---

### Task A5-9: Outreach State Machine

**BR Reference**: BR-604, BR-605
**File**: `app/src/outreach/state-machine.ts`
**Agent**: A3

- [ ] State machine implementation using existing `OutreachState` type from `types/outreach.ts`:
  ```
  State Diagram:

  planned -----> sent -----> pending_response -----> responded -----> engaged -----> converted
     |                            |                      |                |
     |                            v                      v                v
     +-------> deferred <----- declined             declined          declined
                  |                |                    |                 |
                  v                v                    v                 v
               planned        closed_lost          closed_lost       closed_lost
  ```

- [ ] State transition validation:
  ```typescript
  // Uses OUTREACH_TRANSITIONS from types/outreach.ts
  function validateTransition(from: OutreachState, to: OutreachState): boolean {
    return OUTREACH_TRANSITIONS[from]?.includes(to) ?? false;
  }
  ```

- [ ] Create `OutreachStateMachine` class:
  - Method: `transition(contactId: string, campaignId: string, toState: OutreachState, metadata?: TransitionMetadata): Promise<OutreachStateRecord>`
  - Method: `getState(contactId: string, campaignId: string): Promise<OutreachStateRecord>`
  - Method: `getHistory(contactId: string, campaignId: string): Promise<OutreachEvent[]>`
  - Method: `bulkTransition(contactIds: string[], campaignId: string, toState: OutreachState): Promise<BulkResult>`

- [ ] Transition metadata:
  ```typescript
  interface TransitionMetadata {
    template_id?: string;       // which template was used
    message_text?: string;      // actual message sent
    response_text?: string;     // their response (for responded state)
    notes?: string;             // user notes on this transition
    auto?: boolean;             // system-triggered vs manual
    triggered_by?: 'user' | 'sequence' | 'extension';
  }
  ```

- [ ] Event recording:
  ```sql
  INSERT INTO outreach_events (
    id, contact_id, campaign_id, from_state, to_state,
    template_id, message_text, notes, triggered_by, created_at
  ) VALUES (...)
  ```

- [ ] State-dependent behaviors:
  - `planned -> sent`: record template used, message text, timestamp
  - `sent -> pending_response`: auto-transition after configurable delay (default 24h)
  - `pending_response -> responded`: triggered when user marks response received
  - `responded -> engaged`: user marks as engaged (conversation happening)
  - `engaged -> converted`: user marks as converted (meeting booked, deal started)
  - Any -> `declined`: user marks as declined, records reason
  - Any -> `deferred`: user defers, sets re-engage date
  - `deferred -> planned`: auto-transition when re-engage date reached

**Acceptance Criteria**:
- All valid transitions succeed and create event records
- Invalid transitions throw `InvalidTransitionError` with current state and attempted state
- State history is complete and ordered chronologically
- Bulk transition handles partial failures (some succeed, some fail, returns both)
- Auto-transitions (sent -> pending_response) fire on schedule
- Deferred contacts re-enter pipeline on re-engage date

---

### Task A5-10: Outreach Sequence Engine

**BR Reference**: BR-603, BR-604
**File**: `app/src/outreach/sequence-engine.ts`
**Agent**: A3

- [ ] Create `SequenceEngine` class:
  - Method: `createSequence(sequence: CreateSequenceInput): Promise<Sequence>`
  - Method: `enrollContact(contactId: string, sequenceId: string, campaignId: string): Promise<Enrollment>`
  - Method: `processSequenceStep(enrollmentId: string): Promise<SequenceStepResult>`
  - Method: `getNextActions(campaignId: string): Promise<SequenceAction[]>`

- [ ] Sequence model:
  ```typescript
  interface Sequence {
    id: string;
    name: string;
    steps: SequenceStep[];
    campaignId?: string;
    isActive: boolean;
    createdAt: string;
  }

  interface SequenceStep {
    stepNumber: number;
    delayDays: number;           // days to wait before this step
    templateId: string;
    channel: string;
    condition?: SequenceCondition;
    branches?: SequenceBranch[];
  }

  interface SequenceBranch {
    condition: 'response_received' | 'no_response' | 'profile_viewed' | 'content_engaged';
    evaluateAfterDays: number;
    thenGoToStep?: number;       // jump to step N
    thenEndSequence?: boolean;   // or end
  }

  interface SequenceCondition {
    type: 'response_received' | 'no_response' | 'days_elapsed' | 'state_is';
    value: string | number;
  }
  ```

- [ ] Branching sequence tree:
  ```
  Day 0: Initial Outreach (connection-request template)
    |
    +-- [Response within 3 days] --> Day 3: Follow-up (thank-you template) --> END
    |
    +-- [No response after 3 days] --> Day 5: Follow-up #1 (value-add template)
         |
         +-- [Response within 5 days] --> Day 10: Meeting Request --> END
         |
         +-- [No response after 5 days] --> Day 12: Final Follow-up (re-engage template) --> END
  ```

- [ ] Enrollment tracking:
  ```sql
  INSERT INTO sequence_enrollments (
    id, contact_id, sequence_id, campaign_id,
    current_step, status, enrolled_at, next_action_at
  ) VALUES (...)
  ```
  - Status: `active` | `paused` | `completed` | `exited_response` | `exited_declined`

- [ ] Sequence processor (runs on schedule or on-demand):
  - Check all active enrollments where `next_action_at <= NOW()`
  - For each: evaluate branch conditions, determine next step
  - Generate next action (template to send) or complete sequence
  - Push next actions to task queue

**Acceptance Criteria**:
- Multi-step sequences with configurable delays work correctly
- Branch conditions evaluate and route to correct next step
- Enrollment tracks current position in sequence
- Contacts who respond exit the sequence at the response branch
- No-response path continues through follow-up steps
- Sequence processor generates correct next actions on schedule

---

### Task A5-11: Campaign Manager

**BR Reference**: BR-608, BR-609
**File**: `app/src/outreach/campaign-manager.ts`
**Agent**: A3

- [ ] Create `CampaignManager` class:
  - Method: `createCampaign(input: CreateCampaignInput): Promise<Campaign>`
  - Method: `updateCampaign(id: string, updates: Partial<Campaign>): Promise<Campaign>`
  - Method: `getCampaignStats(id: string): Promise<CampaignStats>`
  - Method: `enrollContacts(campaignId: string, contactIds: string[], sequenceId: string): Promise<void>`

- [ ] Campaign model:
  ```typescript
  interface Campaign {
    id: string;
    name: string;
    description: string;
    nicheId?: string;            // associated ICP/niche
    sequenceId?: string;         // default sequence
    status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
    dailyLimit: number;          // max sends per day (default: 25)
    totalLimit: number;          // max total sends (default: 500)
    todaySent: number;
    totalSent: number;
    startDate?: string;
    endDate?: string;
    createdAt: string;
    updatedAt: string;
  }

  interface CampaignStats {
    totalEnrolled: number;
    stateDistribution: Record<OutreachState, number>;
    conversionRate: number;      // converted / total sent
    responseRate: number;        // responded / total sent
    avgTimeToResponse: number;   // hours
    dailySentHistory: { date: string; count: number }[];
  }
  ```

- [ ] Daily limit enforcement:
  - Before each send: check `todaySent < dailyLimit`
  - Reset `todaySent` at midnight (user's timezone or UTC)
  - Before each send: check `totalSent < totalLimit`
  - Refuse send with descriptive error when limit hit

- [ ] Campaign lifecycle:
  - `draft`: configuring, not sending
  - `active`: sends happening, sequence processor active
  - `paused`: sends stopped, enrollments frozen
  - `completed`: all enrollments finished or total limit reached
  - `archived`: hidden from active views

**Acceptance Criteria**:
- Campaign CRUD operations work correctly
- Daily limit prevents exceeding configured max
- Total limit prevents exceeding configured max
- Campaign stats accurately reflect enrollment state distribution
- Pausing a campaign freezes all active sequence enrollments
- Resuming a campaign re-activates frozen enrollments

---

### Task A5-12: Template Performance Tracking

**BR Reference**: BR-607
**File**: `app/src/outreach/performance-tracker.ts`
**Agent**: A5

- [ ] Create `PerformanceTracker` class:
  - Method: `recordOutcome(templateId: string, outcome: OutreachOutcome): Promise<void>`
  - Method: `getTemplatePerformance(templateId: string): Promise<TemplatePerformance>`
  - Method: `getPerformanceByTier(tier: ContactTier): Promise<TierPerformance>`
  - Method: `getTopTemplates(category: TemplateCategory, limit: number): Promise<TemplateRanking[]>`

- [ ] Performance metrics:
  ```typescript
  interface TemplatePerformance {
    templateId: string;
    totalSent: number;
    acceptRate: number;          // (responded + engaged + converted) / sent
    responseRate: number;        // responded / sent
    meetingRate: number;         // converted / sent
    avgTimeToResponse: number;   // hours
    byTier: Record<ContactTier, { sent: number; acceptRate: number }>;
    byPersona: Record<string, { sent: number; acceptRate: number }>;
    trend: { period: string; acceptRate: number }[];  // last 4 weeks
  }
  ```

- [ ] Performance data persistence:
  ```sql
  INSERT INTO template_performance (
    id, template_id, contact_id, campaign_id,
    tier, persona, sent_at, outcome, outcome_at,
    time_to_outcome_hours
  ) VALUES (...)
  ```

- [ ] Performance aggregation (materialized, refreshed hourly):
  ```sql
  CREATE MATERIALIZED VIEW template_performance_agg AS
  SELECT
    template_id,
    COUNT(*) as total_sent,
    COUNT(*) FILTER (WHERE outcome IN ('responded','engaged','converted')) * 100.0 / NULLIF(COUNT(*), 0) as accept_rate,
    COUNT(*) FILTER (WHERE outcome = 'responded') * 100.0 / NULLIF(COUNT(*), 0) as response_rate,
    COUNT(*) FILTER (WHERE outcome = 'converted') * 100.0 / NULLIF(COUNT(*), 0) as meeting_rate,
    AVG(time_to_outcome_hours) FILTER (WHERE outcome IS NOT NULL) as avg_time_to_response
  FROM template_performance
  GROUP BY template_id;
  ```

**Acceptance Criteria**:
- Outcomes recorded for each outreach state transition
- Template performance shows accurate rates after 10+ sends
- By-tier and by-persona breakdowns work correctly
- Top templates query returns ranked results
- Trend data shows week-over-week changes

---

### Task A5-13: Phase 5 API Routes

**BR Reference**: BR-701-710, BR-601-610
**Agent**: A4

All routes in `app/src/app/api/`:

#### Goals API

- [ ] `GET /api/goals` -- List goals with filters
  - File: `app/src/app/api/goals/route.ts`
  - Query params: `status`, `category`, `sort`, `limit`, `offset`
  - Returns: `{ goals: Goal[], total: number }`

- [ ] `POST /api/goals` -- Create goal (manual or from Claude)
  - File: `app/src/app/api/goals/route.ts`
  - Body: `{ name, description, category, priority, tasks?: Task[] }`
  - Returns: `{ goal: Goal }` (status 201)

- [ ] `PATCH /api/goals/:id` -- Update goal (accept, reject, edit, archive)
  - File: `app/src/app/api/goals/[id]/route.ts`
  - Body: `{ status?, name?, description?, priority? }`
  - Accepting a goal creates its tasks in the tasks table

- [ ] `DELETE /api/goals/:id` -- Soft-delete goal (sets status to archived)
  - File: `app/src/app/api/goals/[id]/route.ts`

- [ ] `GET /api/goals/:id/tasks` -- List tasks for a goal
  - File: `app/src/app/api/goals/[id]/tasks/route.ts`
  - Returns: `{ tasks: Task[] }` sorted by priority

#### Tasks API

- [ ] `GET /api/tasks` -- List tasks with filters
  - File: `app/src/app/api/tasks/route.ts`
  - Query params: `status`, `category`, `goal_id`, `tier`, `sort`, `limit`, `offset`
  - Returns: `{ tasks: Task[], total: number }`

- [ ] `PATCH /api/tasks/:id` -- Update task (start, complete, skip, defer)
  - File: `app/src/app/api/tasks/[id]/route.ts`
  - Body: `{ status, notes?, completed_at? }`
  - Completing a task checks and unlocks dependent tasks

- [ ] `GET /api/tasks/extension` -- Tasks formatted for extension display
  - File: `app/src/app/api/tasks/extension/route.ts`
  - Returns tasks with simplified schema for extension popup/panel
  - Includes URL matching pattern for auto-completion

- [ ] `POST /api/tasks/agent-generate` -- Trigger Claude goal/task generation
  - File: `app/src/app/api/tasks/agent-generate/route.ts`
  - Body: `{ trigger: GoalTrigger }`
  - Returns 202 with job_id

#### Outreach API

- [ ] `GET /api/outreach/campaigns` -- List campaigns
  - File: `app/src/app/api/outreach/campaigns/route.ts`

- [ ] `POST /api/outreach/campaigns` -- Create campaign
  - File: `app/src/app/api/outreach/campaigns/route.ts`

- [ ] `PATCH /api/outreach/campaigns/:id` -- Update campaign (pause, resume, archive)
  - File: `app/src/app/api/outreach/campaigns/[id]/route.ts`

- [ ] `GET /api/outreach/templates` -- List templates
  - File: `app/src/app/api/outreach/templates/route.ts`
  - Query params: `category`, `channel`, `is_system`

- [ ] `POST /api/outreach/templates` -- Create template
  - File: `app/src/app/api/outreach/templates/route.ts`

- [ ] `PATCH /api/outreach/templates/:id` -- Update template
  - File: `app/src/app/api/outreach/templates/[id]/route.ts`

- [ ] `GET /api/outreach/sequences` -- List sequences
  - File: `app/src/app/api/outreach/sequences/route.ts`

- [ ] `POST /api/outreach/sequences` -- Create sequence with steps and branches
  - File: `app/src/app/api/outreach/sequences/route.ts`

- [ ] `GET /api/outreach/states` -- Get outreach states for contacts (with campaign filter)
  - File: `app/src/app/api/outreach/states/route.ts`

- [ ] `PATCH /api/outreach/states/:id` -- Transition outreach state
  - File: `app/src/app/api/outreach/states/[id]/route.ts`
  - Body: `{ to_state, metadata? }`

- [ ] `POST /api/outreach/render` -- Render template for contact
  - File: `app/src/app/api/outreach/render/route.ts`
  - Body: `{ template_id, contact_id }`
  - Returns: `{ rendered: RenderedMessage }`

- [ ] `GET /api/outreach/performance` -- Template performance metrics
  - File: `app/src/app/api/outreach/performance/route.ts`
  - Query params: `template_id`, `campaign_id`, `tier`, `period`

- [ ] `GET /api/outreach/next-actions` -- Pending sequence actions
  - File: `app/src/app/api/outreach/next-actions/route.ts`
  - Returns upcoming sequence steps due for action

**Acceptance Criteria**:
- All routes validate input with Zod schemas
- All routes return proper HTTP status codes (200, 201, 202, 400, 404, 500)
- All routes handle errors gracefully with descriptive messages
- Pagination works on all list endpoints
- State transitions are validated before execution
- Render endpoint returns personalized message within 5s

---

### Task A5-14: Outreach Pipeline View (Kanban)

**BR Reference**: BR-606
**File**: `app/src/app/outreach/page.tsx`, `app/src/components/outreach/OutreachContent.tsx`
**Agent**: A5

- [ ] Create page route at `/outreach` with `OutreachContent` as main layout
- [ ] Page layout:
  ```
  +---------------------------------------------------------------------+
  | Outreach Pipeline                    [Campaign: v] [New Campaign]    |
  +---------------------------------------------------------------------+
  | PipelineFunnel (Recharts funnel showing contacts by stage, BR-1009) |
  +---------------------------------------------------------------------+
  | OutreachPipeline (Kanban board)                                      |
  |                                                                     |
  | Planned    | Sent       | Pending    | Responded  | Engaged | Conv. |
  | +--------+ | +--------+ | +--------+ | +--------+ | +------+| +--+ |
  | |Contact | | |Contact | | |Contact | | |Contact | | |      || |  | |
  | |Card    | | |Card    | | |Card    | | |Card    | | |      || |  | |
  | +--------+ | +--------+ | +--------+ | +--------+ | +------+| +--+ |
  | |Contact | | |Contact | |            |            |         |       |
  | |Card    | | +--------+ |            |            |         |       |
  | +--------+ |            |            |            |         |       |
  +---------------------------------------------------------------------+
  ```

- [ ] Kanban columns: Planned | Sent | Pending Response | Responded | Engaged | Converted
  - Each column shows contact count
  - Contact cards show: name, company, tier badge, days in state, template used
  - Click card -> contact detail or outreach detail modal

- [ ] Drag-and-drop state transitions:
  - Drag contact card from one column to next valid state
  - Invalid drops (e.g., Planned -> Converted) show error toast
  - Drop triggers state machine transition with confirmation dialog

- [ ] Pipeline funnel chart (Recharts `Funnel`):
  - Shows: Planned -> Sent -> Pending -> Responded -> Engaged -> Converted
  - Each segment shows count and percentage drop-off
  - Clickable segments filter the Kanban below

- [ ] Campaign filter: dropdown to view pipeline for specific campaign or all

- [ ] SWR data fetching:
  ```typescript
  const { data: states } = useSWR(`/api/outreach/states?campaign_id=${campaignId}`);
  const { data: stats } = useSWR(`/api/outreach/performance?campaign_id=${campaignId}`);
  ```

**Acceptance Criteria**:
- Kanban renders with contacts in correct columns
- Drag-and-drop transitions work for valid state changes
- Invalid transitions show error message
- Funnel chart shows accurate conversion rates
- Campaign filter switches pipeline view
- Contact count per column updates in real-time after transitions

---

### Task A5-15: Template Editor

**BR Reference**: BR-601, BR-602
**File**: `app/src/components/outreach/TemplateEditor.tsx`
**Agent**: A5

- [ ] Rich template editing interface:
  - Template name input
  - Category selector (dropdown with category options)
  - Channel selector (LinkedIn Connection / Message / InMail / Email)
  - Character counter with limit indicator (turns red when exceeded)
  - Template body textarea with:
    - Merge variable insertion toolbar (click to insert `{{variable}}`)
    - Syntax highlighting for merge variables (different color)
    - Live preview panel showing rendered output for a sample contact
  - Tags input (comma-separated)
  - Save / Save As / Delete buttons

- [ ] Variable picker component:
  ```
  +-- Insert Variable -------------------------+
  | Contact: firstName | lastName | headline    |
  | Company: currentRole | currentCompany       |
  | Graph: mutualConnection | sharedInterest    |
  | Content: recentTopic | painPoint            |
  | Outreach: daysSinceLastMessage              |
  +--------------------------------------------+
  ```
  - Clicking a variable inserts it at cursor position
  - Variables shown with descriptions on hover

- [ ] Live preview:
  - Select a sample contact from dropdown
  - Shows rendered template with that contact's data
  - Unresolvable variables shown in red with tooltip

**Acceptance Criteria**:
- Template body supports merge variable insertion via toolbar
- Character counter enforces channel-specific limits
- Live preview renders with real contact data
- Save persists template to database
- Category and channel dropdowns show all options

---

### Task A5-16: Template Preview and Clipboard

**BR Reference**: BR-602, BR-606
**File**: `app/src/components/outreach/TemplatePreview.tsx`, `app/src/components/outreach/ClipboardButton.tsx`
**Agent**: A5

- [ ] `TemplatePreview` component:
  - Shows fully rendered message in read-only styled view
  - Contact info header: name, company, tier badge
  - Template name and category label
  - Character count
  - Personalization score indicator (0-100)
  - Variables used list

- [ ] `ClipboardButton` component:
  - Primary action: copies rendered message to clipboard
  - Uses `navigator.clipboard.writeText()` with fallback:
    ```typescript
    async function copyToClipboard(text: string): Promise<boolean> {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback for restricted contexts
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const result = document.execCommand('copy');
        document.body.removeChild(textarea);
        return result;
      }
    }
    ```
  - Visual feedback: "Copied!" toast with checkmark, reverts after 2s
  - After copy: prompt to mark outreach as "sent" (state transition)

- [ ] `TemplatePicker` component:
  - Shows recommended template based on contact's outreach state
  - Displays available templates: title + first 80 chars preview + Copy button
  - "Next Template" button cycles through alternatives
  - Template suggestions sorted by performance (accept rate) when data available

**Acceptance Criteria**:
- Preview shows complete rendered message with correct formatting
- Clipboard copy works in standard browser context
- Fallback clipboard works in extension popup context
- "Copied!" feedback appears and disappears after 2s
- Template picker shows relevant templates for current outreach state
- Next Template cycles through available options

---

### Task A5-17: Sequence Tree Visualization

**BR Reference**: BR-1017
**File**: `app/src/components/outreach/SequenceTree.tsx`
**Agent**: A5

- [ ] Visx hierarchy tree showing branching sequence:
  ```
  [Day 0: Connection Request]
         |
    +----+----+
    |         |
  [Responded] [No Response]
    |              |
  [Day 3:      [Day 5:
   Thank You]   Follow-up #1]
    |              |
  [END]       +----+----+
              |         |
            [Resp]  [No Resp]
              |         |
            [Day 10: [Day 12:
             Meeting  Final]
             Request]    |
              |        [END]
            [END]
  ```

- [ ] Visual treatment:
  - Nodes: rounded rectangles with template name, channel icon, delay days
  - Edges: lines with condition labels ("Response", "No Response", "3 days")
  - Active step highlighted (for enrolled contacts)
  - Completed steps with checkmark
  - Future steps with dashed border
  - Color coding by branch type: success (green), follow-up (amber), final (red)

- [ ] Interactive:
  - Click node -> view/edit template
  - Hover node -> show template preview
  - Zoom/pan for large sequences
  - Collapse/expand branches

- [ ] visx components used: `@visx/hierarchy` (Tree), `@visx/shape` (LinkVertical), `@visx/zoom`

**Acceptance Criteria**:
- Sequence tree renders branching structure correctly
- Active enrollment step is visually highlighted
- Click on node opens template editor/preview
- Tree handles sequences up to 10 steps with branches
- Zoom and pan work for overflow sequences

---

## Orchestrator Instructions

### Spawn Order

```
[Parallel Spawn - All 5 agents start simultaneously]:
  Agent A1: Claude Intelligence (Tasks A5-1, A5-2, A5-3)
  Agent A2: Tasks UI (Tasks A5-4, A5-5, A5-6, A5-7)
  Agent A3: Outreach Engine (Tasks A5-8, A5-9, A5-10, A5-11)
  Agent A4: API Routes (Task A5-13)
  Agent A5: Outreach UI + Analytics (Tasks A5-12, A5-14, A5-15, A5-16, A5-17)
```

### Coordination Protocol

1. **Interface Agreement (hour 0)**: Agents A1, A3, and A4 agree on:
   - GoalGenerator output shape (A1 produces, A4 exposes via API)
   - TemplateEngine interface (A3 provides, A4 wires to routes, A5 renders)
   - OutreachStateMachine interface (A3 provides, A4 wires, A5 renders Kanban)
   - All shared types go in `app/src/types/agent.ts` and `app/src/types/outreach.ts`

2. **Type-First Development**: All agents create TypeScript interfaces before implementations. Types are committed first to unblock parallel work.

3. **UI Agents (A2, A5) can stub data**: Use mock data initially if APIs are not ready. Replace with SWR hooks once A4 completes routes.

4. **Testing Checkpoint** (after all agents complete):
   ```bash
   npm test -- --grep "goals|tasks|outreach|template|campaign"
   npm run lint
   npm run build
   ```

### Integration Sequence (after parallel work)

1. Wire A1's GoalGenerator into A4's `POST /api/tasks/agent-generate` route
2. Wire A3's TemplateEngine into A4's `POST /api/outreach/render` route
3. Wire A3's OutreachStateMachine into A4's `PATCH /api/outreach/states/:id` route
4. Replace A2's mock data with SWR hooks hitting A4's goals/tasks routes
5. Replace A5's mock data with SWR hooks hitting A4's outreach routes
6. End-to-end test: generate goals -> accept -> complete tasks -> outreach with template -> state transitions through pipeline

---

## Dependencies

### Upstream (this phase needs)

| Dependency | Source | Status Check |
|------------|--------|--------------|
| Backend Claude API routes | Phase 5 Backend | `/api/agent/analyze` returns 200 |
| `content_profiles` populated | Phase 5 Backend | `SELECT COUNT(*) FROM content_profiles` > 0 |
| `activity_patterns` populated | Phase 5 Backend | `SELECT COUNT(*) FROM activity_patterns` > 0 |
| `goals` table schema | Phase 1 | Table exists |
| `tasks` table schema | Phase 1 | Table exists |
| `campaigns` table schema | Phase 1 | Table exists |
| `templates` table schema | Phase 1 | Table exists |
| `outreach_sequences` table schema | Phase 1 | Table exists |
| `outreach_states` table schema | Phase 1 | Table exists |
| `outreach_events` table schema | Phase 1 | Table exists |
| `template_performance` table schema | Phase 1 | Table exists |
| SWR patterns from Phase 3 | Phase 3 | `useSWR` hooks in use |
| shadcn/ui components | Phase 1/3 | Component library available |
| Recharts + visx installed | Phase 3 | npm packages available |
| reagraph for network context | Phase 3 | Package available |

### Downstream (other Phase 5 plans need from this)

| Consumer | What They Need | Interface |
|----------|---------------|-----------|
| Extension: Template Display | `GET /api/outreach/templates` + `POST /api/outreach/render` | API routes |
| Extension: Task List | `GET /api/tasks/extension` | API route |
| Phase 6: Admin Panel | Goal/task management APIs | CRUD routes |
| Phase 6: Remaining Viz | Template performance data | Performance API |

---

## Gate Criteria

- [ ] Claude generates 3+ goals with tasks after CSV import trigger
- [ ] Goals page renders with proposed goals; accept/reject/edit work correctly
- [ ] Task queue shows prioritized tasks with correct ordering (gold > silver > bronze)
- [ ] Locked tasks display lock icon and unlock when dependency completes
- [ ] 6 system templates are seeded and visible in template list
- [ ] Template editor allows creating/editing templates with merge variables
- [ ] Template rendering fills variables with contact-specific data; personalization score > 60
- [ ] Clipboard copy works and shows "Copied!" feedback
- [ ] Outreach state machine transitions validate correctly (invalid transitions rejected)
- [ ] Pipeline Kanban shows contacts in correct columns
- [ ] Drag-and-drop Kanban transitions work for valid state changes
- [ ] Sequence tree renders branching structure with active step highlighted
- [ ] Campaign CRUD works; daily limits enforced
- [ ] Template performance tracking records outcomes and shows accept/response rates
- [ ] Funnel chart (BR-1009) renders with accurate stage counts
- [ ] Sequence tree (BR-1017) renders branching hierarchy
- [ ] All API endpoints validate input and return proper error responses
- [ ] All pages load within 500ms performance target
- [ ] `npm test` passes for all Phase 5 app tests
- [ ] `npm run build` succeeds with no TypeScript errors
