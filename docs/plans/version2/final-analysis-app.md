# V2 Final Analysis: App Stream

## 1. App Architecture Overview

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 15 (App Router) | Server/client rendering, API routes, file-based routing |
| UI Library | shadcn/ui + Tailwind CSS 4 | Component primitives, theming, responsive design |
| 2D Charts | Recharts | Standard charts: bar, line, area, pie, radar, scatter, treemap, funnel, sankey |
| Custom Viz | visx (Airbnb) | 3D wedge model, branching sequence trees, custom scoring visualizations |
| Graph Viz | reagraph | Network graphs (2D/3D WebGL), cluster views, path visualization |
| Data Fetching | SWR | Stale-while-revalidate caching, polling, optimistic updates |
| State Management | React Context + SWR | Global state (tasks, extension, enrichment) + server state |
| AI Integration | Claude API (via Next.js API routes) | Task generation, ICP discovery, message personalization, scoring |
| Icons | Lucide React | Consistent icon set matching shadcn/ui |

### Claude Integration Points

Claude is the primary actor in V2 (80%+ of effort per product owner). The AI agent integrates at these points:

1. **CSV Import** -- Analyzes imported data, generates initial clusters, asks progressive questions to refine ICP/niche definitions
2. **Task Generation** -- Creates goals with associated tasks, auto-populates the task queue based on network state
3. **ICP Discovery** -- Identifies natural ICPs from data clustering, proposes new ICPs as goals with tasks
4. **Message Personalization** -- Fills templates using contact data + enrichment + behavioral signals, adjusts tone and detail
5. **Scoring Analysis** -- Explains scoring math on hover, provides narrative scoring rationale
6. **Content Analysis** -- Batch processing of captured posts/activity for topic extraction, pain points, engagement style
7. **Network Intelligence** -- Identifies gaps, super hubs, warm intro paths, wedge expansion opportunities

### Data Fetching Strategy

```
SWR Polling Intervals:
  Dashboard:         30s refresh
  Tasks/Goals:       10s refresh (frequent state changes)
  Extension Status:  5s poll
  Contacts Table:    60s refresh
  Network Graph:     On-demand only (CPU intensive)
  Enrichment Budget: 30s refresh
```

### Component Loading Strategy

```
SSR (Critical Path):  Layout, Navigation, Dashboard KPIs, Page shells
Client-side:          Charts, Task Queue, Extension Status indicators
Lazy-loaded:          Network Graph (reagraph), Template Editor, Import Wizard
On-demand:            Contact Detail tabs, Admin scoring panel, Wedge visualization
```

---

## 2. Navigation & Page Structure

### V1 to V2 Navigation Migration

```
V1 PRIMARY                  V2 PRIMARY
  Dashboard (/)        -->    Dashboard (/)
  Network (/network)   -->    Network (/network)
  Contacts (/contacts) -->    Contacts (/contacts)
  ICP & Niches (/icp)  -->    Discover (/discover)     [renamed]
  Outreach (/outreach)  -->   Outreach (/outreach)

V1 SYSTEM                   V2 SECONDARY
  Actions (/actions)    -->   [REMOVED - replaced by Tasks]
  Operations (/ops)     -->   [REMOVED - scraping deprecated]
  Configuration (/config) --> Admin (/admin)            [expanded]

                             V2 NEW PAGES
                              Goals & Tasks (/tasks)
                              Enrichment (/enrichment)
                              Extension (/extension)
```

### Revised Sidebar Navigation

File: `app/src/components/layout/sidebar-nav.tsx`

```typescript
const primaryNav: NavItem[] = [
  { title: "Dashboard",  href: "/",            icon: LayoutDashboard },
  { title: "Contacts",   href: "/contacts",    icon: Users,     badge: "count" },
  { title: "Network",    href: "/network",     icon: Network },
  { title: "Discover",   href: "/discover",    icon: Compass,   badge: "clusters" },
  { title: "Enrichment", href: "/enrichment",  icon: Sparkles,  badge: "pending" },
  { title: "Outreach",   href: "/outreach",    icon: Send,      badge: "ready" },
];

const secondaryNav: NavItem[] = [
  { title: "Goals & Tasks", href: "/tasks",     icon: Target,     badge: "count" },
  { title: "Extension",     href: "/extension", icon: Plug,       badge: "status" },
  { title: "Admin",         href: "/admin",     icon: Settings },
];
```

Badge indicators per nav item:
- **Contacts**: Total count (e.g., "842")
- **Discover**: New cluster count (e.g., "3 new")
- **Enrichment**: Pending batch count (e.g., "5 pending")
- **Outreach**: Messages ready to send (e.g., "2 ready")
- **Goals & Tasks**: Active task count (e.g., "4 todo")
- **Extension**: Connection status indicator (green dot / amber dot / red dot)

### Full Page Hierarchy

```
/                           Dashboard (command center)
/contacts                   Contact table/card list
/contacts/[slug]            Contact detail (tabbed)
/contacts/[slug]/outreach   Contact outreach history (deep link)
/network                    Network graph (reagraph)
/discover                   ICP & Niche discovery
/discover/[nicheId]         Niche detail view
/enrichment                 Enrichment hub (providers, batches, budget)
/outreach                   Template management + outreach pipeline
/outreach/templates         Template library editor
/tasks                      Goals & Tasks management (full page)
/extension                  Extension hub (status, sync, preferences)
/admin                      Admin panel (scoring, data, settings)
/admin/scoring              Scoring weight tuning + RVF training
/admin/providers            API key management + provider configuration
/admin/data                 Data purge tool + export
/import                     CSV import wizard (accessed via CTA, not nav)
```

### Command Palette

Component: `<CommandPalette />`
Trigger: `Cmd+K` / `Ctrl+K`
Searches across: contacts, clusters/niches, tasks, goals, and actions (import, enrich, export).

---

## 3. Dashboard Redesign

Route: `/`
Component: `app/src/components/dashboard/dashboard-content.tsx` (rewrite)
API Endpoint: `GET /api/dashboard`

### Layout Structure

```
+------------------------------------------------------------------+
| Row 1: Goal Focus Banner + Extension Status                       |
| +---------------------------------------------+ +--------------+ |
| | Top 3 Goals (count + name)                   | | Ext: Online  | |
| | 1. "Explore AI/ML cluster" (3/8 tasks done) | | Sync: 2m ago | |
| | 2. "Enrich FinTech leads" (1/4 tasks done)   | +--------------+ |
| | 3. "Outreach to Gold contacts" (0/5 done)    |                  |
| +---------------------------------------------+                  |
+------------------------------------------------------------------+
| Row 2: Network Health Ring + Task Queue                           |
| +---------------------+ +--------------------------------------+ |
| | [Ring Chart]         | | Pending Tasks (4)                    | |
| | Enriched: 142 (28%) | | [ ] Visit J. Chen's profile          | |
| | Base only: 340 (68%)| | [ ] Enrich "DevOps" cluster ($2.64)  | |
| | Unscored:  18 (4%)  | | [ ] Review 3 new Gold contacts       | |
| +---------------------+ | [ ] Draft outreach for S. Kim        | |
|                          +--------------------------------------+ |
+------------------------------------------------------------------+
| Row 3: Discovery Feed                                             |
| +----------------------------------------------------------------+|
| | [Cluster] New cluster: 8 contacts share DevOps+B traits  2h   ||
| | [Enrich]  5 emails found in "FinTech Leaders"            4h   ||
| | [Signal]  Activity: S. Kim posted about AI budgets        6h   ||
| +----------------------------------------------------------------+|
+------------------------------------------------------------------+
| Row 4: ICP Radar + Enrichment Budget                              |
| +---------------------+ +--------------------------------------+ |
| | [Radar Chart]        | | Monthly Enrichment Budget            | |
| | Top 3 ICP profiles   | | PDL:    [====------] $12 / $98      | |
| | overlaid on radar    | | Apollo: [=---------] $4 / $49       | |
| |                      | | Lusha:  [====------] 8 / 40 credits | |
| +---------------------+ +--------------------------------------+ |
+------------------------------------------------------------------+
```

### Dashboard API Response Shape

```typescript
// GET /api/dashboard
interface DashboardData {
  goals: {
    id: string;
    name: string;
    totalTasks: number;
    completedTasks: number;
    priority: number;
  }[];  // top 3 by priority
  extensionStatus: {
    connected: boolean;
    lastSync: string | null;
  };
  networkHealth: {
    enriched: number;
    baseOnly: number;
    unscored: number;
    total: number;
  };
  pendingTasks: {
    id: string;
    category: "explore" | "enrich" | "engage" | "analyze";
    title: string;
    estimatedCost: number | null;
    priority: "high" | "medium" | "low";
    goalId: string;
  }[];
  discoveryFeed: {
    id: string;
    type: "cluster" | "enrichment" | "activity" | "icp";
    message: string;
    timestamp: string;
    actions: { label: string; href: string }[];
  }[];
  icpRadar: {
    icpName: string;
    dimensions: { axis: string; value: number }[];
  }[];  // top 3 ICPs
  enrichmentBudget: {
    provider: string;
    used: number;
    limit: number;
    unit: "dollars" | "credits";
  }[];
  lastSync: string | null;
}
```

### Dashboard Components

| Component | Props | Purpose |
|-----------|-------|---------|
| `<GoalFocusBanner />` | `goals[]` | Shows top 3 goals with progress bars |
| `<ExtensionStatusBadge />` | `connected, lastSync` | Green/amber/red connection indicator |
| `<NetworkHealthRing />` | `enriched, baseOnly, unscored` | Recharts PieChart (donut) showing data maturity |
| `<TaskQueueWidget />` | `tasks[]` | Prioritized checklist with category icons/colors |
| `<DiscoveryFeed />` | `items[]` | Chronological AI insight stream with action buttons |
| `<IcpRadarChart />` | `icpData[]` | Recharts RadarChart overlaying top 3 ICP profiles |
| `<EnrichmentBudgetBars />` | `providers[]` | Per-provider horizontal progress bars |

---

## 4. Contact Management

### Contact Table

Route: `/contacts`
Component: `<ContactsTable />`
API Endpoint: `GET /api/contacts?page=1&limit=50&sort=goldScore&order=desc&tier=gold&cluster=ai-ml`

V2 reduces visible columns from 11 to 7 with a detail drawer for secondary data:

| Column | Data | Hover Detail |
|--------|------|--------------|
| Name | Full name + avatar placeholder | Full preview card: title, company, tier, top scores, cluster |
| Title / Company | Combined column | Company details: industry, size, tech stack (if enriched) |
| Score | Gold score (0-100) | **Full scoring math breakdown** -- all 7 sub-scores with weights, formula, and current values |
| ICP Fit | Percentage match | Which ICP, why matched, key matching dimensions |
| Tier | Gold/Silver/Bronze/Watch badge | Tier description + thresholds |
| Enrichment | Status icon (none/partial/full) | What data sources have been applied, last enriched date |
| Outreach | State label (planned/sent/engaged/etc.) | Last action date, next step in sequence |

Scoring math on hover (per product owner -- "expose it all"):

```
+------------------------------------------+
| GOLD SCORE: 87                            |
|------------------------------------------|
| ICP Fit:          92 x 0.25 = 23.0       |
| Network Hub:      78 x 0.15 = 11.7       |
| Relationship:     65 x 0.15 =  9.75      |
| Signal Boost:     88 x 0.10 =  8.8       |
| Skills Relevance: 91 x 0.10 =  9.1       |
| Behavioral:       72 x 0.15 = 10.8       |
| Network Prox:     85 x 0.10 =  8.5       |
|------------------------------------------|
| Weighted Total:            81.65 -> 87    |
| (normalized to 0-100 scale)               |
| [Edit Weights in Admin]                   |
+------------------------------------------+
```

### Contact Detail

Route: `/contacts/[slug]`
Component: `<ContactDetail />`
API Endpoints:
- `GET /api/contacts/[slug]` -- core contact data + scores
- `GET /api/contacts/[slug]/enrichment` -- enrichment history + source attribution
- `GET /api/contacts/[slug]/outreach` -- outreach state + notes
- `GET /api/contacts/[slug]/activity` -- behavioral observations (posts, engagement)
- `GET /api/contacts/[slug]/similar` -- similar contacts from vector search
- `GET /api/contacts/[slug]/network` -- edges, mutual connections, company contacts

Tab-based composition replacing V1 monolithic layout:

```typescript
<ContactLayout slug={slug}>
  <ContactHeader />       {/* Name, tier, title, company, location, actions */}
  <ContactScoreCard />    {/* Gold score highlight + hover for full math */}
  <Tabs defaultValue="profile">
    <TabsTrigger value="profile">Profile</TabsTrigger>
    <TabsTrigger value="network">Network</TabsTrigger>
    <TabsTrigger value="outreach">Outreach</TabsTrigger>
    <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
    <TabsTrigger value="activity">Activity</TabsTrigger>
  </Tabs>
</ContactLayout>
```

**Profile Tab**: About, headline, experience, skills, tags, clusters
**Network Tab**: Top connections with edge type badges, same-company contacts, account penetration grid, similar contacts grid
**Outreach Tab**: State machine (V1 carried forward), notes timeline, message history, template selector
**Enrichment Tab**: Per-source data attribution ("PDL says X, Apollo says Y"), enrichment timeline, available providers, enrich action with cost
**Activity Tab**: Captured posts, engagement patterns, content themes, behavioral scores

---

## 5. ICP & Niche System

Route: `/discover`
Component: `<DiscoverContent />`
API Endpoints:
- `GET /api/discover/niches` -- all niches with contact counts, gold concentration
- `GET /api/discover/icps` -- all ICP profiles (natural + custom)
- `GET /api/discover/wedge` -- wedge model data (radius, arc, height per contact)
- `POST /api/discover/icps` -- create custom ICP profile
- `PUT /api/discover/icps/[id]` -- edit ICP profile
- `POST /api/discover/niches/switch` -- switch active niche profile

### Niche/ICP Conceptual Model

Per the product owner:
- **Niche** = breadth of offering (arc length of wedge). Filter mechanism. A niche can accommodate multiple ICPs.
- **ICP** = depth of market (height of wedge). A profile of a customer type. An ICP may fit into more than one niche.
- **Penetration** = radius of wedge. How deep the user has penetrated into a given niche/ICP combination.

Users can:
1. View **naturally discovered** ICPs/niches (from HDBSCAN clustering)
2. **Switch** between niche profiles to change the active filter
3. Enter **power user mode** to define custom ICPs or niches
4. Each contact is a point in the wedge, positioned by its niche membership (arc), ICP depth (height), and relationship strength (radius)

### Discover Page Layout

```
+------------------------------------------------------------------+
| Discover                                [Power User Mode toggle]  |
+------------------------------------------------------------------+
| Active Niche: [AI/ML Infrastructure v]  | ICPs: 3 active          |
+------------------------------------------------------------------+
| Summary Stats Row                                                 |
| Total Niches: 5 | Classified: 842 | Unclassified: 18 | Avg Gold% |
+------------------------------------------------------------------+
| 3D Wedge Visualization (visx)        | Niche/ICP Selector Panel   |
| [interactive 3D wedge model]         | [ ] AI/ML (142 contacts)   |
|  - Each contact = point in wedge     | [ ] FinTech (89 contacts)  |
|  - Rotate/zoom                       | [ ] DevOps (56 contacts)   |
|  - Color by ICP or tier              | [+ Create Custom ICP]      |
|  - Click contact = detail            |                            |
+--------------------------------------+----------------------------+
| Natural Niches Grid (2-3 col)                                     |
| +--------------------+ +--------------------+ +------------------+|
| | AI/ML Leaders      | | FinTech Founders   | | DevOps SRE      ||
| | 42 contacts        | | 28 contacts        | | 56 contacts     ||
| | Gold: 8 (19%)      | | Gold: 5 (18%)      | | Gold: 3 (5%)    ||
| | [===gold bar====]  | | [===gold bar====]  | | [=gold bar=]    ||
| | Top traits:        | | Top traits:        | | Top traits:     ||
| |  VP+, Series B+,   | |  CEO, Seed-A,      | |  SRE/DevOps,    ||
| |  TF/PyTorch stack  | |  Payments/Lending   | |  K8s, >100 eng  ||
| | [Explore] [Enrich] | | [Explore] [Enrich] | | [Explore]       ||
| +--------------------+ +--------------------+ +------------------+|
+------------------------------------------------------------------+
| Cross-Niche Comparison Table (Recharts grouped bar)               |
+------------------------------------------------------------------+
```

### Power User ICP Builder

Component: `<IcpBuilder />`
Route: `/discover/builder`

A guided form (wizard-style) where the user works with Claude to define a custom ICP:
1. Name the ICP
2. Select dimensions: industry, company size, funding stage, title seniority, tech stack, location
3. Set thresholds per dimension (sliders)
4. Claude suggests missing dimensions or adjustments
5. Preview: "X contacts match this ICP" with sample list
6. Save and activate

---

## 6. Goals & Tasks System

Route: `/tasks`
Component: `<TasksContent />`
API Endpoints:
- `GET /api/goals` -- all goals with task counts
- `GET /api/goals/[id]/tasks` -- tasks under a goal
- `POST /api/goals` -- create goal (Claude or user)
- `PUT /api/goals/[id]` -- edit goal
- `DELETE /api/goals/[id]` -- reject/remove goal
- `POST /api/tasks` -- create task
- `PUT /api/tasks/[id]` -- edit task, mark complete, reject
- `POST /api/tasks/[id]/reject` -- reject a Claude-generated task

### Goal/Task Hierarchy

```
Goal: "Explore AI/ML Leaders cluster"
  |-- Task: Visit James C.'s profile (explore, high priority)
  |-- Task: Visit Sarah K.'s profile (explore, high priority)
  |-- Task: Enrich AI/ML cluster ($2.64) (enrich, medium)
  |-- Task: Review new Gold contacts (analyze, medium)
  |-- Task: Draft outreach to top 3 (engage, low -- locked until enrichment)

Goal: "Expand into FinTech niche"
  |-- Task: Define FinTech ICP criteria (analyze, high)
  |-- Task: Find super hubs outside LinkedIn (explore, medium)
  |-- Task: Enrich FinTech cluster ($4.80) (enrich, medium)
```

### How Claude Creates Goals/Tasks

1. On CSV import, Claude analyzes clusters and creates initial goals (e.g., "Explore your largest cluster")
2. When a new ICP cluster is detected, Claude creates a goal with a link to the app for exploration
3. After enrichment completes, Claude creates "Review" and "Outreach" tasks for newly scored contacts
4. User can **reject** any goal or task (soft delete, Claude learns from rejections)
5. User can **edit** goal names, task descriptions, priorities, and ordering
6. Tasks surface in extension as a guided list (80% of extension is goals/tasks per product owner)

### Tasks Page Layout

```
+------------------------------------------------------------------+
| Goals & Tasks                              [+ New Goal] [Filters] |
+------------------------------------------------------------------+
| Goal: "Explore AI/ML Leaders" (3/8 done)        [Edit] [Reject]  |
| Progress: [=====---------] 37%                                    |
| +--------------------------------------------------------------+ |
| | [compass] Visit James C.'s profile               HIGH   [Do] | |
| | [compass] Visit Sarah K.'s profile               HIGH   [Do] | |
| | [sparkle] Enrich cluster ($2.64)                  MED   [Do] | |
| | [chart]   Review 3 new Gold contacts              MED   [Do] | |
| | [send]    Draft outreach (locked)                 LOW    ---  | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Goal: "Expand into FinTech" (1/3 done)           [Edit] [Reject] |
| Progress: [====-----------] 33%                                   |
| +--------------------------------------------------------------+ |
| | [chart]   Define FinTech ICP criteria             HIGH   [Do] | |
| | [compass] Find super hubs outside LinkedIn        MED    ---  | |
| | [sparkle] Enrich FinTech cluster ($4.80)          MED    ---  | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Task Categories (Visual Treatment)

| Category | Icon | Color Token | Action Target |
|----------|------|-------------|---------------|
| Explore | Compass | `--task-explore` (blue) | Extension: clickable LinkedIn link |
| Enrich | Sparkle | `--task-enrich` (purple) | App: provider selector + cost preview |
| Engage | Send | `--task-engage` (green) | App: template + clipboard |
| Analyze | BarChart | `--task-analyze` (amber) | App: links to relevant view |

---

## 7. Outreach & Templates

Route: `/outreach`
Component: `<OutreachContent />`
API Endpoints:
- `GET /api/outreach/pipeline` -- contacts by outreach state
- `GET /api/outreach/templates` -- all message templates
- `POST /api/outreach/templates` -- create template
- `PUT /api/outreach/templates/[id]` -- edit template
- `POST /api/outreach/generate` -- Claude generates personalized message from template + contact data
- `PUT /api/contacts/[slug]/outreach` -- transition outreach state

### Branching Sequence Model

Based on `docs/plans/messages_templates.md`, the outreach flow uses a **timed, branching, configurable** sequence:

```
Day 0: Initial Message
  |
  +-- [Response received] --> Day 0: Follow-up (schedule call)
  |                            |
  |                            +-- [Call scheduled] --> Engaged
  |                            +-- [No response Day 3] --> Final check-in
  |
  +-- [No response] --> Day 1: Follow-up #1
                          |
                          +-- [Response received] --> Schedule call flow
                          +-- [No response] --> Day 3: Follow-up #2
                                                 |
                                                 +-- [Response] --> Schedule call
                                                 +-- [No response] --> Deferred
```

### Template Variables

Templates use merge variables that Claude fills from contact data:

| Variable | Source | Example |
|----------|--------|---------|
| `{{firstName}}` | Contact record | "James" |
| `{{topic}}` | Activity analysis (Claude) | "AI budget planning" |
| `{{userContext}}` | User profile / offering | "enterprise AI adoption" |
| `{{schedulingLink}}` | User configuration | Calendar booking URL |
| `{{yourName}}` | User configuration | User's name |
| `{{emailSignature}}` | User configuration | Full signature block |
| `{{mutualConnection}}` | Graph data | "Sarah Kim" |
| `{{sharedInterest}}` | Content analysis (Claude) | "containerized ML pipelines" |
| `{{companyNews}}` | Enrichment data | "recent Series B" |

### Template Editor

Component: `<TemplateEditor />`
Route: `/outreach/templates`

```
+------------------------------------------------------------------+
| Templates                                    [+ New Template]      |
+------------------------------------------------------------------+
| Template Library                | Editor                          |
| +----------------------------+ | +------------------------------+|
| | Warm Introduction          | | | Subject: {{subject}}         ||
| | First Follow-up            | | |                              ||
| | Second Follow-up           | | | Hey {{firstName}} -          ||
| | Scheduling Response        | | |                              ||
| | [+ Add Template]           | | | {{body}}                     ||
| +----------------------------+ | |                              ||
|                                 | | {{yourName}}                 ||
|                                 | | {{emailSignature}}           ||
|                                 | +------------------------------+|
|                                 |                                 |
|                                 | Variables:                      |
|                                 |  subject: [editable]            |
|                                 |  body: [editable, multi-line]   |
|                                 |                                 |
|                                 | Sequence Config:                |
|                                 |  Position: Day 0 / Day 1 / Day3|
|                                 |  Branch:  Response / No-Response|
|                                 |                                 |
|                                 | [Save] [Preview with Contact]  |
+------------------------------------------------------------------+
```

### Message Generation Flow

1. User selects contact (from task or outreach pipeline)
2. App shows template picker with recommended template based on outreach state
3. Claude fills template using contact enrichment data + behavioral signals + graph context
4. User reviews rendered message in preview pane
5. User can edit any variable or the full text
6. User clicks "Copy to Clipboard"
7. Outreach state transitions to next stage
8. **NO auto-send** -- clipboard delivery only (per product owner)

### Outreach Pipeline View

Component: `<OutreachPipeline />`

Kanban-style board showing contacts grouped by outreach state:

```
| Planned | Sent | Pending Response | Responded | Engaged | Converted |
| (12)    | (5)  | (3)              | (2)       | (1)     | (0)       |
```

Each card shows: name, tier badge, days in current state, next action suggestion.

---

## 8. Enrichment Management

Route: `/enrichment`
Component: `<EnrichmentContent />`
API Endpoints:
- `GET /api/enrichment/providers` -- configured providers with balances
- `GET /api/enrichment/budget` -- monthly spend by provider
- `GET /api/enrichment/batches` -- batch enrichment history
- `POST /api/enrichment/providers/[id]/configure` -- set API key + limits
- `POST /api/enrichment/enrich` -- enrich contact(s) with specified provider
- `POST /api/enrichment/batch` -- batch enrichment for cluster/filter
- `GET /api/enrichment/agent/status` -- background enrichment agent status

### Enrichment Page Layout

```
+------------------------------------------------------------------+
| Enrichment Hub                                                    |
+------------------------------------------------------------------+
| Provider Status Cards (3-4 column grid)                           |
| +---------------+ +---------------+ +---------------+ +---------+|
| | PDL           | | Apollo        | | Lusha         | | More... ||
| | [Connected]   | | [Connected]   | | [Free Tier]   | |         ||
| | 350 credits   | | 30k cred/yr   | | 40/mo free    | | Clay    ||
| | Used: 12/$98  | | Used: 4/$49   | | Used: 8/40    | | Crunch  ||
| | [Configure]   | | [Configure]   | | [Configure]   | | BuiltW  ||
| +---------------+ +---------------+ +---------------+ +---------+|
+------------------------------------------------------------------+
| Monthly Budget Overview (Recharts stacked bar)                    |
| [=====PDL====][=Apollo=][=Lusha=]----------- $16 / $200 budget   |
+------------------------------------------------------------------+
| Background Enrichment Agent                                       |
| Status: [Active] | Rate: 10 contacts/hour | Budget: $5/day       |
| Strategy: Gold-tier contacts first | [Pause] [Configure]         |
+------------------------------------------------------------------+
| Batch Enrichment                                                  |
| [Select Cluster v] [Select Provider v] [Preview Cost] [Enrich]   |
| Est: 12 contacts x $0.22/ea = $2.64 (PDL)                       |
+------------------------------------------------------------------+
| Enrichment History (Table)                                        |
| Date     | Provider | Contacts | Cost   | New Data               |
| Mar 12   | PDL      | 12       | $2.64  | 8 emails, 4 phones     |
| Mar 11   | Apollo   | 5        | $0.50  | 3 emails, 2 intents    |
+------------------------------------------------------------------+
```

### Enrichment Modes

1. **Individual**: From contact detail enrichment tab, select provider, see cost, enrich one contact
2. **Batch**: From enrichment page, select cluster or filter, select provider, preview cost, enrich batch
3. **Background Agent**: Configurable autonomous agent that enriches contacts based on priority (gold-tier first), with daily budget cap and rate limit. Driven by Claude agent.

### Provider Configuration

Component: `<ProviderConfig />`
Route: `/admin/providers`

Per provider: API key input (masked), balance display, rate limits, cost-per-credit, enable/disable toggle.

---

## 9. Network Graph

Route: `/network`
Component: `<NetworkContent />` wrapping `<NetworkGraph />`
API Endpoints:
- `GET /api/network/graph` -- nodes + edges for reagraph
- `GET /api/network/clusters` -- cluster metadata
- `GET /api/network/paths?from=[id]&to=[id]` -- shortest path between contacts
- `GET /api/network/stats` -- node/edge counts, density, centrality metrics

### reagraph Integration

V2 replaces the V1 custom canvas force-directed graph with reagraph (WebGL, 2D/3D support):

```typescript
import { GraphCanvas, GraphNode, GraphEdge } from 'reagraph';

<GraphCanvas
  nodes={nodes}
  edges={edges}
  layoutType="forceDirected2d"  // or "forceDirected3d" for large graphs
  clusterAttribute="cluster"
  sizingType="attribute"
  sizingAttribute="goldScore"
  colorType="attribute"
  colorAttribute="tier"
  onNodeClick={(node) => router.push(`/contacts/${node.id}`)}
  onClusterClick={(cluster) => setSelectedCluster(cluster)}
/>
```

### Graph Controls Panel

Carried forward from V1 with enhancements:

| Control | Options | V1 Status |
|---------|---------|-----------|
| Layout | Force 2D, Force 3D, Cluster-grouped, Radial, Circular, Concentric | Enhanced (3D new) |
| Color by | Tier, Cluster, ICP, Persona, Degree | Enhanced (ICP new) |
| Size by | Gold Score, Connections, Tier, Uniform | Same |
| Edge filter | Edge type toggles, weight threshold, opacity | Same |
| Cluster hulls | Toggle convex hull overlays | Same |
| **Path finder** | Select two nodes, show shortest path | **New** |
| **Model selector** | Edge weighting model selection | **New** |

### Cluster Sidebar

When a cluster is selected, a right panel shows:
- Cluster name, contact count, gold concentration
- Top contacts list (sortable by score)
- Cluster-level actions: Enrich All, Create Goal, Export
- Shared traits summary (Claude-generated)

---

## 10. Admin & Scoring Panel

Route: `/admin`
Component: `<AdminContent />`
API Endpoints:
- `GET /api/admin/scoring/weights` -- current scoring weights
- `PUT /api/admin/scoring/weights` -- update weights (triggers full rescore)
- `GET /api/admin/scoring/formula` -- full scoring formula with descriptions
- `POST /api/admin/scoring/train` -- submit RVF training feedback
- `GET /api/admin/data/stats` -- data volume stats
- `POST /api/admin/data/purge` -- purge data matching filter (with confirmation)
- `GET /api/admin/export` -- export enriched contacts as CSV

### Scoring Weight Tuning

Route: `/admin/scoring`
Component: `<ScoringPanel />`

```
+------------------------------------------------------------------+
| Scoring Configuration                                             |
+------------------------------------------------------------------+
| Dimension Weights (must sum to 1.0)                               |
| +--------------------------------------------------------------+ |
| | ICP Fit              [====slider====] 0.25                    | |
| | Network Hub          [===slider===]   0.15                    | |
| | Relationship Strength[===slider===]   0.15                    | |
| | Signal Boost         [==slider==]     0.10                    | |
| | Skills Relevance     [==slider==]     0.10                    | |
| | Behavioral Score     [===slider===]   0.15                    | |
| | Network Proximity    [==slider==]     0.10                    | |
| +--------------------------------------------------------------+ |
| Sum: 1.00 [Valid]                     [Reset to Defaults] [Save] |
+------------------------------------------------------------------+
| Tier Thresholds                                                   |
| Gold:   >= [80] | Silver: >= [60] | Bronze: >= [40] | Watch: <40 |
+------------------------------------------------------------------+
| RVF Training Interface                                            |
| "Help improve your scoring model"                                 |
| Select two contacts and indicate which is a better fit:           |
| [Contact A v]  vs  [Contact B v]  -->  [A is better] [B is better]|
| Training samples submitted: 24                                    |
+------------------------------------------------------------------+
| Score Preview                                                     |
| After weight change, preview impact on 5 sample contacts:         |
| Name        | Current Score | New Score | Change                 |
| James C.    | 87            | 91        | +4                     |
| Sarah K.    | 72            | 68        | -4                     |
| [Apply Changes] [Cancel]                                          |
+------------------------------------------------------------------+
```

### Data Purge Tool

Route: `/admin/data`
Component: `<DataPurgePanel />`

Filters: name pattern, date range, "older than X days", enrichment source, tier, cluster.
Flow: Select filter -> Preview matching contacts (count + sample) -> Warning modal with confirmation -> Purge.
Per product owner: manual, uses warning modals, ensures nothing happens accidentally.

---

## 11. Visualization Catalog

Every graph and chart in the V2 application, with specific library, reference, data source, and purpose.

### Recharts Visualizations (Standard 2D Charts)

| # | Graph Name | Page | Library | Storybook/Example Reference | Data Source (API Endpoint) | Purpose / User Guidance |
|---|-----------|------|---------|----------------------------|--------------------------|------------------------|
| 1 | **Network Health Ring** | Dashboard | Recharts PieChart (donut) | [Two Level Pie Chart](https://recharts.github.io/en-US/examples/TwoLevelPieChart/) | `GET /api/dashboard` `.networkHealth` | Shows data maturity breakdown (enriched / base-only / unscored). Guides user to enrich the "base only" segment. |
| 2 | **ICP Radar Overlay** | Dashboard | Recharts RadarChart | [Simple Radar Chart](https://recharts.github.io/en-US/examples/SimpleRadarChart/) | `GET /api/dashboard` `.icpRadar` | Overlays top 3 ICP profiles on a single radar. Helps user compare ICP shapes and identify which ICP has strongest matches. |
| 3 | **Enrichment Budget Bars** | Dashboard, Enrichment | Recharts BarChart (horizontal) | [Simple Bar Chart](https://recharts.github.io/en-US/examples/SimpleBarChart/) | `GET /api/enrichment/budget` | Per-provider spend vs. limit. Prevents budget overruns; guides provider selection. |
| 4 | **Score Breakdown Bar** | Contact Detail (hover), Contact Table (hover) | Recharts BarChart (horizontal stacked) | [Stacked Bar Chart](https://recharts.github.io/en-US/examples/StackedBarChart/) | `GET /api/contacts/[slug]` `.scores` | Shows weighted contribution of each scoring dimension to final score. Exposes full scoring math. |
| 5 | **Tier Distribution Pie** | Contacts (stats row) | Recharts PieChart | [Simple Pie Chart](https://recharts.github.io/en-US/examples/SimplePieChart/) | `GET /api/contacts/stats` | Gold/Silver/Bronze/Watch distribution. Quick orientation on network quality. |
| 6 | **Gold Concentration Bars** | Discover (niche cards) | Recharts BarChart (horizontal) | [Simple Bar Chart](https://recharts.github.io/en-US/examples/SimpleBarChart/) | `GET /api/discover/niches` | Gold contact percentage per niche. Guides user to highest-value niches. |
| 7 | **Cross-Niche Comparison** | Discover | Recharts BarChart (grouped) | [Bar Chart With Multiple XAxis](https://recharts.github.io/en-US/examples/BarChartWithMultiXAxis/) | `GET /api/discover/niches` | Side-by-side niche comparison across dimensions (size, gold%, avg score, enrichment%). Helps decide which niche to prioritize. |
| 8 | **Enrichment Coverage Area** | Enrichment | Recharts AreaChart (stacked) | [Stacked Area Chart](https://recharts.github.io/en-US/examples/StackedAreaChart/) | `GET /api/enrichment/history` | Enrichment coverage growth over time by provider. Shows enrichment velocity and ROI. |
| 9 | **Outreach Pipeline Funnel** | Outreach | Recharts FunnelChart | [Simple Funnel Chart](https://recharts.github.io/en-US/examples/SimpleFunnelChart/) | `GET /api/outreach/pipeline` | Contacts by stage: planned -> sent -> pending -> responded -> engaged -> converted. Identifies pipeline bottlenecks. |
| 10 | **Goal Progress Bars** | Tasks, Dashboard | Recharts BarChart (horizontal) | [Simple Bar Chart](https://recharts.github.io/en-US/examples/SimpleBarChart/) | `GET /api/goals` | Per-goal completion percentage. Keeps user focused on finishing goals vs. starting new ones. |
| 11 | **Activity Timeline Scatter** | Contact Detail (Activity tab) | Recharts ScatterChart | [Simple Scatter Chart](https://recharts.github.io/en-US/examples/SimpleScatterChart/) | `GET /api/contacts/[slug]/activity` | Post frequency over time with engagement level as dot size. Identifies content patterns and best times to engage. |
| 12 | **ICP Match Treemap** | Discover | Recharts Treemap | [Simple Treemap](https://recharts.github.io/en-US/examples/SimpleTreemap/) | `GET /api/discover/icps` | All contacts grouped by ICP, sized by score. Gives visual sense of ICP landscape; large rectangles = strong ICP fit clusters. |
| 13 | **Scoring Weight Distribution** | Admin (scoring) | Recharts PieChart | [Simple Pie Chart](https://recharts.github.io/en-US/examples/SimplePieChart/) | `GET /api/admin/scoring/weights` | Shows current weight allocation across scoring dimensions. Helps user understand where scoring emphasis lies before tuning. |
| 14 | **Score Impact Preview Line** | Admin (scoring) | Recharts LineChart | [Simple Line Chart](https://recharts.github.io/en-US/examples/SimpleLineChart/) | `POST /api/admin/scoring/preview` | Before/after score comparison for sample contacts when weights change. Prevents unintended scoring shifts. |
| 15 | **Enrichment Cost Breakdown Pie** | Enrichment | Recharts PieChart | [Two Level Pie Chart](https://recharts.github.io/en-US/examples/TwoLevelPieChart/) | `GET /api/enrichment/budget` | Monthly spend by provider as pie chart. Guides budget allocation decisions. |

### visx Visualizations (Custom / Complex)

| # | Graph Name | Page | Library | visx Package / Gallery Reference | Data Source (API Endpoint) | Purpose / User Guidance |
|---|-----------|------|---------|----------------------------------|--------------------------|------------------------|
| 16 | **3D Wedge Model** | Discover | visx (`@visx/shape`, `@visx/group`, `@visx/scale`, `@visx/drag`) | [Radar](https://airbnb.io/visx/gallery) + custom polar projection | `GET /api/discover/wedge` | The signature visualization. Radius = user penetration depth, arc = niche breadth, height = ICP depth. Each contact is a positioned dot. Reveals wedge shape, expansion opportunities, and gaps. |
| 17 | **Outreach Sequence Tree** | Outreach (template editor) | visx (`@visx/hierarchy`, `@visx/shape`) | [Link Types (Tree)](https://airbnb.io/visx/linktypes) | `GET /api/outreach/templates` (sequence config) | Visualizes branching message sequence (Day 0 -> response/no-response -> Day 1 -> Day 3). Helps user understand and configure the outreach flow. |
| 18 | **Score Dimension Parallel Coordinates** | Contact Detail, Admin | visx (`@visx/axis`, `@visx/shape`, `@visx/scale`) | [Axis](https://airbnb.io/visx/axis) + custom parallel coords | `GET /api/contacts/[slug]` (scores) or `GET /api/contacts?limit=20` | Parallel coordinates plot of all 7 scoring dimensions for a contact (or comparing multiple contacts). Reveals scoring profile shape -- where a contact excels vs. where they fall short. |
| 19 | **Import Progress Visualization** | Import Wizard | visx (`@visx/shape`, `@visx/text`, `@visx/group`) | [Pack](https://airbnb.io/visx/pack) | `POST /api/import/analyze` (streaming) | During CSV import, shows clusters forming in real-time as contacts are parsed and grouped. Creates the "a-ha" moment for new users. |
| 20 | **Engagement Heatmap** | Contact Detail (Activity tab) | visx (`@visx/heatmap`) | [Heatmaps](https://airbnb.io/visx/heatmaps) | `GET /api/contacts/[slug]/activity` | Day-of-week x time-of-day heatmap of a contact's posting/engagement activity. Identifies optimal outreach timing windows. |

### reagraph Visualizations (Network Graphs)

| # | Graph Name | Page | Library | Storybook / Feature Reference | Data Source (API Endpoint) | Purpose / User Guidance |
|---|-----------|------|---------|------------------------------|--------------------------|------------------------|
| 21 | **Full Network Graph** | Network | reagraph `GraphCanvas` (force-directed 2D) | [Force Directed 2D](https://storybook.reagraph.dev/) -- Basic story | `GET /api/network/graph` | Primary network view. All contacts as nodes, relationships as edges. Color by tier/cluster/ICP. Click to navigate to contact detail. Core exploration tool. |
| 22 | **3D Network Graph** | Network (toggle) | reagraph `GraphCanvas` (force-directed 3D) | [Force Directed 3D](https://storybook.reagraph.dev/) -- 3D story | `GET /api/network/graph` | For large networks (500+ contacts) where 2D causes overlap. Provides depth dimension for cluster separation. |
| 23 | **Cluster View** | Network (cluster mode), Discover | reagraph with `clusterAttribute` | [Clustering](https://reagraph.dev/docs/advanced/Clustering) | `GET /api/network/graph?cluster=true` | Nodes grouped by cluster with inter-cluster edges. Reveals cluster isolation vs. interconnection. Guides niche prioritization. |
| 24 | **Path Finder** | Network (path mode) | reagraph with edge highlighting | [Selections](https://storybook.reagraph.dev/) -- Selection story | `GET /api/network/paths?from=[id]&to=[id]` | Select two contacts, highlights shortest path between them. Shows warm intro chains and network distance. Directly actionable for outreach strategy. |
| 25 | **Ego Network** | Contact Detail (Network tab) | reagraph `GraphCanvas` (radial) | [Radial Layout](https://storybook.reagraph.dev/) -- Radial story | `GET /api/contacts/[slug]/network` | Single contact at center with 1st-degree connections radiating outward. Shows a contact's local network influence and shared connections. |
| 26 | **ICP Overlay Graph** | Discover | reagraph with custom node coloring | [Custom Nodes](https://storybook.reagraph.dev/) -- Custom story | `GET /api/network/graph?colorBy=icp` | Full network graph colored by ICP membership. Reveals ICP geographic distribution within the network. Multiple ICP colors show overlap zones. |
| 27 | **Company Cluster Graph** | Contact Detail (Network tab) | reagraph `GraphCanvas` (concentric) | [Concentric Layout](https://storybook.reagraph.dev/) -- Concentric story | `GET /api/contacts/[slug]/network` (company subgraph) | Contacts at the same company arranged concentrically by score. Shows account penetration depth. |

---

## 12. Onboarding Flow

Route: `/import`
Component: `<ImportWizard />`
API Endpoints:
- `POST /api/import/upload` -- upload CSV file
- `POST /api/import/parse` -- parse CSV, return field preview
- `POST /api/import/map` -- confirm field mapping
- `POST /api/import/execute` -- execute import with confirmed mapping
- `GET /api/import/status` -- import progress (streaming)
- `POST /api/import/analyze` -- Claude analyzes imported data, generates clusters + questions

### Import Wizard Steps

```
Step 1: Upload
+------------------------------------------------------------------+
| Import Your LinkedIn Network                                      |
|                                                                   |
| +--------------------------------------------------------------+ |
| |                                                                | |
| |          Drag and drop your LinkedIn export CSV here           | |
| |                  or click to browse files                      | |
| |                                                                | |
| |          Supported: Connections.csv from LinkedIn export        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| How to export from LinkedIn:                                      |
| 1. Go to linkedin.com/mypreferences/d/download-my-data           |
| 2. Select "Connections" and request archive                       |
| 3. Download and extract the ZIP file                              |
| 4. Upload Connections.csv here                                    |
+------------------------------------------------------------------+

Step 2: Preview & Field Mapping
+------------------------------------------------------------------+
| CSV Preview (first 5 rows)                                        |
| +--------------------------------------------------------------+ |
| | First Name | Last Name | Title | Company | Connected On | ... | |
| | James      | C.        | VP Eng| TechCo  | 2024-01-15  | ... | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Field Mapping:                                                    |
| CSV Column "First Name"  -> [First Name v]                        |
| CSV Column "Last Name"   -> [Last Name v]                         |
| CSV Column "Position"    -> [Title v]                             |
| CSV Column "Company"     -> [Company v]                           |
| [Auto-detected] [Looks correct] [Edit Mapping]                   |
+------------------------------------------------------------------+

Step 3: Processing + Progressive Questions
+------------------------------------------------------------------+
| Importing 956 contacts...                  [=====>     ] 62%      |
|                                                                   |
| [Cluster forming visualization - visx Pack]                       |
| (circles grouping in real time)                                   |
|                                                                   |
| Claude asks:                                                      |
| "I see 42 contacts in AI/ML engineering roles. Is this an         |
|  area you're actively networking in?"                             |
| [Yes, this is important] [Somewhat] [Not relevant]               |
|                                                                   |
| "28 contacts work at FinTech companies (Series A-B).              |
|  Are you targeting this segment?"                                 |
| [Yes] [Somewhat] [No]                                            |
+------------------------------------------------------------------+

Step 4: Import Summary
+------------------------------------------------------------------+
| Import Complete                                                   |
|                                                                   |
| 956 contacts imported                                             |
| 5 natural clusters discovered                                     |
| 3 potential ICPs identified                                       |
|                                                                   |
| Your Largest Clusters:                                            |
| 1. AI/ML Leaders (42 contacts)                                   |
| 2. FinTech Founders (28 contacts)                                 |
| 3. DevOps/SRE (56 contacts)                                      |
|                                                                   |
| Initial Goals Created:                                            |
| [x] Explore your AI/ML network                                   |
| [x] Define your primary ICP                                       |
| [x] Set up enrichment providers                                   |
|                                                                   |
| [Explore Your Network]    [Set Up Enrichment]                     |
+------------------------------------------------------------------+
```

### Post-Import Behavior

1. Claude auto-generates initial clusters using the imported data
2. Claude asks progressive questions during processing to refine niche/ICP understanding
3. The more data imported and enriched, the more questions Claude surfaces
4. Initial goals and tasks are created automatically
5. User lands on populated dashboard with goals, tasks, and network health indicators
6. If no enrichment providers are configured, a banner prompts setup but the tool remains functional (CSV-only mode)

---

## Appendix A: API Endpoint Summary

| Method | Endpoint | Page(s) Using It |
|--------|----------|-------------------|
| `GET` | `/api/dashboard` | Dashboard |
| `GET` | `/api/contacts` | Contacts table |
| `GET` | `/api/contacts/stats` | Contacts (stats row) |
| `GET` | `/api/contacts/[slug]` | Contact detail |
| `GET` | `/api/contacts/[slug]/enrichment` | Contact detail (enrichment tab) |
| `GET` | `/api/contacts/[slug]/outreach` | Contact detail (outreach tab) |
| `GET` | `/api/contacts/[slug]/activity` | Contact detail (activity tab) |
| `GET` | `/api/contacts/[slug]/similar` | Contact detail (network tab) |
| `GET` | `/api/contacts/[slug]/network` | Contact detail (network tab), ego network graph |
| `PUT` | `/api/contacts/[slug]/outreach` | Outreach state transition |
| `GET` | `/api/network/graph` | Network graph (all variants) |
| `GET` | `/api/network/clusters` | Network cluster sidebar |
| `GET` | `/api/network/paths` | Path finder |
| `GET` | `/api/network/stats` | Network stats bar |
| `GET` | `/api/discover/niches` | Discover page |
| `GET` | `/api/discover/icps` | Discover page, ICP radar |
| `GET` | `/api/discover/wedge` | Wedge visualization |
| `POST` | `/api/discover/icps` | Power user ICP builder |
| `PUT` | `/api/discover/icps/[id]` | Edit ICP |
| `POST` | `/api/discover/niches/switch` | Niche profile switcher |
| `GET` | `/api/enrichment/providers` | Enrichment hub |
| `GET` | `/api/enrichment/budget` | Dashboard, enrichment hub |
| `GET` | `/api/enrichment/batches` | Enrichment history |
| `GET` | `/api/enrichment/history` | Enrichment coverage chart |
| `POST` | `/api/enrichment/providers/[id]/configure` | Admin providers |
| `POST` | `/api/enrichment/enrich` | Contact detail, enrichment hub |
| `POST` | `/api/enrichment/batch` | Batch enrichment |
| `GET` | `/api/enrichment/agent/status` | Background agent status |
| `GET` | `/api/goals` | Tasks page, dashboard |
| `GET` | `/api/goals/[id]/tasks` | Tasks page |
| `POST` | `/api/goals` | Goal creation |
| `PUT` | `/api/goals/[id]` | Goal editing |
| `DELETE` | `/api/goals/[id]` | Goal rejection |
| `POST` | `/api/tasks` | Task creation |
| `PUT` | `/api/tasks/[id]` | Task editing, completion |
| `POST` | `/api/tasks/[id]/reject` | Task rejection |
| `GET` | `/api/outreach/pipeline` | Outreach pipeline, funnel chart |
| `GET` | `/api/outreach/templates` | Template library |
| `POST` | `/api/outreach/templates` | Create template |
| `PUT` | `/api/outreach/templates/[id]` | Edit template |
| `POST` | `/api/outreach/generate` | Message generation (Claude) |
| `GET` | `/api/admin/scoring/weights` | Scoring panel |
| `PUT` | `/api/admin/scoring/weights` | Weight tuning |
| `GET` | `/api/admin/scoring/formula` | Scoring panel |
| `POST` | `/api/admin/scoring/preview` | Score impact preview |
| `POST` | `/api/admin/scoring/train` | RVF training |
| `GET` | `/api/admin/data/stats` | Data management |
| `POST` | `/api/admin/data/purge` | Data purge |
| `GET` | `/api/admin/export` | CSV export |
| `POST` | `/api/import/upload` | Import wizard |
| `POST` | `/api/import/parse` | Import wizard |
| `POST` | `/api/import/map` | Import wizard |
| `POST` | `/api/import/execute` | Import wizard |
| `GET` | `/api/import/status` | Import progress |
| `POST` | `/api/import/analyze` | Import analysis (Claude) |

## Appendix B: Component Inventory

### New Components for V2

```
app/src/components/
  dashboard/
    goal-focus-banner.tsx         GoalFocusBanner
    extension-status-badge.tsx    ExtensionStatusBadge
    network-health-ring.tsx       NetworkHealthRing
    task-queue-widget.tsx         TaskQueueWidget
    discovery-feed.tsx            DiscoveryFeed
    icp-radar-chart.tsx           IcpRadarChart
    enrichment-budget-bars.tsx    EnrichmentBudgetBars

  contacts/
    contact-layout.tsx            ContactLayout (wrapper)
    contact-header.tsx            ContactHeader
    contact-score-card.tsx        ContactScoreCard (with hover math)
    contact-profile-tab.tsx       ContactProfile
    contact-network-tab.tsx       ContactNetwork
    contact-outreach-tab.tsx      ContactOutreach
    contact-enrichment-tab.tsx    ContactEnrichment
    contact-activity-tab.tsx      ContactActivity
    score-math-popover.tsx        ScoreMathPopover

  discover/
    discover-content.tsx          DiscoverContent
    niche-card.tsx                NicheCard
    icp-builder.tsx               IcpBuilder (power user)
    wedge-visualization.tsx       WedgeVisualization (visx)
    niche-comparison-chart.tsx    NicheComparisonChart
    icp-treemap.tsx               IcpTreemap
    niche-switcher.tsx            NicheSwitcher

  enrichment/
    enrichment-content.tsx        EnrichmentContent
    provider-card.tsx             ProviderCard
    provider-config.tsx           ProviderConfig
    batch-enrichment.tsx          BatchEnrichment
    cost-preview.tsx              CostPreview
    enrichment-history.tsx        EnrichmentHistory
    enrichment-coverage-chart.tsx EnrichmentCoverageChart
    background-agent-status.tsx   BackgroundAgentStatus

  outreach/
    outreach-content.tsx          OutreachContent
    outreach-pipeline.tsx         OutreachPipeline (kanban)
    template-editor.tsx           TemplateEditor
    template-picker.tsx           TemplatePicker
    template-preview.tsx          TemplatePreview
    clipboard-button.tsx          ClipboardButton
    sequence-tree.tsx             SequenceTree (visx)
    pipeline-funnel.tsx           PipelineFunnel

  tasks/
    tasks-content.tsx             TasksContent
    goal-card.tsx                 GoalCard
    task-card.tsx                 TaskCard
    task-queue.tsx                TaskQueue

  network/
    network-graph.tsx             NetworkGraph (reagraph wrapper)
    graph-controls.tsx            GraphControls
    cluster-sidebar.tsx           ClusterSidebar
    path-finder.tsx               PathFinder
    ego-network.tsx               EgoNetwork
    model-selector.tsx            ModelSelector

  import/
    import-wizard.tsx             ImportWizard
    csv-uploader.tsx              CsvUploader
    field-mapper.tsx              FieldMapper
    import-progress.tsx           ImportProgress
    import-summary.tsx            ImportSummary
    cluster-formation-viz.tsx     ClusterFormationViz (visx)

  admin/
    admin-content.tsx             AdminContent
    scoring-panel.tsx             ScoringPanel
    weight-sliders.tsx            WeightSliders
    rvf-training.tsx              RvfTraining
    score-preview.tsx             ScorePreview
    data-purge-panel.tsx          DataPurgePanel
    provider-management.tsx       ProviderManagement

  layout/
    sidebar-nav.tsx               SidebarNav (rewrite)
    command-palette.tsx           CommandPalette
    task-badge.tsx                TaskBadge (header counter)
    extension-banner.tsx          ExtensionBanner (install CTA)
```

### V1 Components Retained (with modifications)

```
  contacts/
    contacts-table.tsx            Reduce to 7 columns, add enrichment/outreach columns
    score-bars.tsx                Add hover popover with full scoring math

  network/
    network-content.tsx           Replace canvas with reagraph, add path finder

  layout/
    rate-budget-meter.tsx         Replace with enrichment budget summary
```

### V1 Components Removed

```
  dashboard/
    rate-budget-bar.tsx           Replaced by enrichment budget bars

  operations/
    operations-content.tsx        Scraping deprecated

  actions/
    actions-content.tsx           Replaced by goals/tasks system
```
