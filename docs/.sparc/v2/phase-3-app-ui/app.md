# Phase 3: App UI -- App Domain Plan (Weeks 9-12)

## Objective

Build all primary application pages with real data integration. This is the heaviest phase for the App domain. It transforms the skeleton shell from Phase 1 and the basic displays from Phase 2 into a fully functional UI with dashboard, contact detail (5 tabs), network graph (reagraph), discover page (visx wedge + Recharts), enrichment management, and a command palette. Every component connects to live API data via SWR.

## Prerequisites (from Phases 1-2)

| Prerequisite | Phase | Verified By |
|---|---|---|
| Next.js 15 project with App Router operational | 1 | Phase 1 gate |
| shadcn/ui + Tailwind CSS 4 configured | 1 | Phase 1 gate |
| Sidebar navigation working | 1 | Phase 1 gate |
| SWR data fetching setup | 1 | Phase 1 gate |
| Contacts table page rendering | 1 | Phase 1 gate |
| Score display + tier badges in contacts table | 2 | Phase 2 gate |
| Score math popover (basic version) | 2 | Phase 2 gate |
| Basic enrichment page layout | 2 | Phase 2 gate |
| ICP/niche list view | 2 | Phase 2 gate |
| All Phase 3 backend APIs available (or mock data matching response shapes) | 3 Backend | Phase 3 backend delivery |

### Library Dependencies (install at phase start)

```bash
npm install reagraph @reagraph/core          # 3D/2D network graph
npm install @visx/shape @visx/scale @visx/group @visx/gradient @visx/tooltip  # visx for wedge
npm install recharts                         # already installed if Phase 2 app used it
npm install cmdk                             # command palette (Cmd+K)
```

---

## Parallel Agent Assignments

| Agent | Focus Area | Components | Est. Effort |
|---|---|---|---|
| A1 | Dashboard | 7 dashboard components + API integration | Large |
| A2 | Contact Detail | ContactLayout + 8 sub-components (5 tabs + score card + header + popover) | Large |
| A3 | Network Graph | reagraph integration + GraphControls + ClusterSidebar + PathFinder + EgoNetwork | Large |
| A4 | Discover Page | DiscoverContent + NicheCard + WedgeViz + IcpBuilder + comparison charts | Large |
| A5 | Enrichment Page | EnrichmentContent + ProviderCard + BatchEnrichment + coverage chart + history | Medium |
| A6 | Utilities | CommandPalette + 7 standalone Recharts visualizations | Medium |

All 6 agents can start in parallel. Agents A1-A5 should begin with mock data and switch to real API data as backend endpoints become available. Agent A6 has no backend dependency (visualizations receive data via props).

---

## Detailed Task Checklist

---

### Agent A1: Dashboard (route: `/`)

**Directory**: `app/src/components/dashboard/`
**Page**: `app/src/app/(main)/page.tsx`
**API Hook**: `app/src/hooks/useDashboard.ts`

#### Task A1-0: Dashboard SWR Hook

**File**: `app/src/hooks/useDashboard.ts`

```typescript
import useSWR from 'swr';
import type { DashboardData } from '@/types/dashboard';

export function useDashboard() {
  return useSWR<DashboardData>('/api/dashboard', fetcher, {
    refreshInterval: 30_000,   // 30s polling
    revalidateOnFocus: true,
    dedupingInterval: 10_000,
  });
}
```

**Sub-tasks**:
- [ ] Create `useDashboard` hook with 30s SWR polling
- [ ] Create `DashboardData` type import from `@/types/dashboard`
- [ ] Add loading/error states
- [ ] Add optimistic update support for task completion

**Acceptance Criteria**:
- Hook returns `{ data, error, isLoading, mutate }`
- Polls every 30 seconds
- Deduplicates requests within 10s window

---

#### Task A1-1: GoalFocusBanner

**File**: `app/src/components/dashboard/GoalFocusBanner.tsx`

**Props**:
```typescript
interface GoalFocusBannerProps {
  goals: {
    id: string;
    title: string;
    progress: number;
    targetDate: string;
    taskCount: number;
    completedTaskCount: number;
  }[];
}
```

**Sub-tasks**:
- [ ] Render top 3 goals as horizontal cards
- [ ] Each goal card shows: title, progress bar (shadcn Progress), task fraction (e.g., "3/7 tasks"), target date with days-remaining badge
- [ ] Progress bar color: green (>66%), amber (33-66%), red (<33%)
- [ ] Empty state: "No goals set. Goals will be generated when Claude analyzes your network." with muted styling
- [ ] Click navigates to `/goals/:id` (future route; use `<Link>` now)
- [ ] Responsive: stack vertically on mobile, 3-column on desktop

**Acceptance Criteria**:
- Renders 0-3 goals correctly
- Progress bars animate on data change
- Colors match progress thresholds
- Accessible: progress bars have `aria-valuenow`, `aria-valuemin`, `aria-valuemax`

**BR References**: BR-708

---

#### Task A1-2: ExtensionStatusBadge

**File**: `app/src/components/dashboard/ExtensionStatusBadge.tsx`

**Props**:
```typescript
interface ExtensionStatusBadgeProps {
  status: 'green' | 'amber' | 'red';
  connected: boolean;
  lastSeen: string | null;
  captureCount24h: number;
}
```

**Sub-tasks**:
- [ ] Render as a small status indicator card in the dashboard header area
- [ ] Green dot + "Connected" when status is green
- [ ] Amber dot + "Idle" (connected but no captures in 4h) when status is amber
- [ ] Red dot + "Disconnected" when status is red
- [ ] Show last seen timestamp as relative time ("2 hours ago")
- [ ] Show 24h capture count
- [ ] Tooltip with full details on hover

**Acceptance Criteria**:
- Correct color mapping for all 3 states
- Relative time updates reactively
- Tooltip is accessible (keyboard focusable)

**BR References**: Extension status display (no specific BR; supports dashboard context)

---

#### Task A1-3: NetworkHealthRing

**File**: `app/src/components/dashboard/NetworkHealthRing.tsx`

**Props**:
```typescript
interface NetworkHealthRingProps {
  total: number;
  enriched: number;
  baseOnly: number;
  unscored: number;
}
```

**Sub-tasks**:
- [ ] Render Recharts `PieChart` as a donut (inner radius 60%, outer radius 80%)
- [ ] Three segments: Enriched (green `#22C55E`), Base Only (blue `#3B82F6`), Unscored (gray `#9CA3AF`)
- [ ] Center text showing total contact count with "Contacts" label beneath
- [ ] Legend below with counts and percentages
- [ ] Animate on mount with `animationBegin={0}` and `animationDuration={800}`
- [ ] Handle zero state: show empty ring with "No contacts imported" message

**Acceptance Criteria**:
- Donut segments sum to 100%
- Center count matches total
- Animation is smooth, no layout shift
- Responsive: scales down to 200px min width

**BR References**: BR-1001

---

#### Task A1-4: TaskQueueWidget

**File**: `app/src/components/dashboard/TaskQueueWidget.tsx`

**Props**:
```typescript
interface TaskQueueWidgetProps {
  tasks: {
    id: string;
    title: string;
    category: 'capture' | 'enrich' | 'review' | 'outreach' | 'analyze';
    priority: number;
    contactId: string | null;
    contactName: string | null;
    createdAt: string;
  }[];
  onCompleteTask?: (taskId: string) => void;
}
```

**Sub-tasks**:
- [ ] Render as a scrollable checklist (max height 400px)
- [ ] Category icons: capture (Camera), enrich (Sparkles), review (Eye), outreach (Send), analyze (Brain) -- use Lucide icons from shadcn
- [ ] Category colors: capture (#8B5CF6), enrich (#F59E0B), review (#3B82F6), outreach (#22C55E), analyze (#EC4899)
- [ ] Each task row: icon, title, contact name (if linked, as clickable link), relative time, checkbox
- [ ] Checkbox triggers `onCompleteTask` callback with optimistic UI (strike-through + fade)
- [ ] Priority sorting: highest first (pre-sorted from API)
- [ ] Show count badge in header: "Tasks (10)"
- [ ] Empty state: "All caught up! No pending tasks."
- [ ] "View All" link to `/tasks` at bottom

**Acceptance Criteria**:
- Tasks render in priority order
- Category icons and colors are correct
- Checkbox completion has optimistic UI feedback
- Scrolls smoothly with overflow
- Contact names link to `/contacts/:slug`

**BR References**: BR-703, BR-704

---

#### Task A1-5: DiscoveryFeed

**File**: `app/src/components/dashboard/DiscoveryFeed.tsx`

**Props**:
```typescript
interface DiscoveryFeedProps {
  items: {
    id: string;
    type: 'new_gold' | 'cluster_shift' | 'score_change' | 'enrichment_complete' | 'warm_intro_found' | 'icp_match';
    title: string;
    description: string;
    contactId: string | null;
    contactName: string | null;
    timestamp: string;
    actionLabel: string | null;
    actionUrl: string | null;
  }[];
}
```

**Sub-tasks**:
- [ ] Render as a chronological feed (newest first), scrollable (max height 500px)
- [ ] Type icons: new_gold (Star), cluster_shift (GitBranch), score_change (TrendingUp), enrichment_complete (Database), warm_intro_found (Users), icp_match (Target) -- Lucide icons
- [ ] Type-specific accent colors for left border
- [ ] Each item: icon, title (bold), description (muted), timestamp (relative), optional action button
- [ ] Action button navigates to `actionUrl` with label `actionLabel`
- [ ] Contact names are clickable links to `/contacts/:slug`
- [ ] Empty state: "No discoveries yet. Insights will appear as your network grows."
- [ ] New items animate in with a subtle slide-down

**Acceptance Criteria**:
- Feed renders chronologically
- Type icons and colors are distinct
- Action buttons navigate correctly
- Empty state renders gracefully
- Max 20 items displayed (API-limited)

**BR References**: BR-709

---

#### Task A1-6: IcpRadarChart

**File**: `app/src/components/dashboard/IcpRadarChart.tsx`

**Props**:
```typescript
interface IcpRadarChartProps {
  profiles: {
    profileName: string;
    dimensions: {
      axis: string;
      value: number;
    }[];
  }[];
}
```

**Sub-tasks**:
- [ ] Render Recharts `RadarChart` with `PolarGrid`, `PolarAngleAxis`, `PolarRadiusAxis`
- [ ] Overlay up to 3 ICP profiles on same chart with distinct colors and 30% opacity fill
- [ ] Colors: Profile 1 (#8B5CF6), Profile 2 (#3B82F6), Profile 3 (#22C55E)
- [ ] Legend below chart showing profile names with color dots
- [ ] Axis labels from dimension names (e.g., "ICP Fit", "Network Hub", "Signal Boost")
- [ ] Scale 0-100 on radius axis (show at 25, 50, 75, 100)
- [ ] Tooltip on hover showing exact values per profile for that axis
- [ ] Empty state: "No ICP profiles detected yet."
- [ ] Responsive: min width 300px, scales up to 500px

**Acceptance Criteria**:
- Radar chart renders with correct axis labels
- Multiple profiles overlay without obscuring each other
- Tooltip shows per-profile values
- Chart is readable at 300px width

**BR References**: BR-1002

---

#### Task A1-7: EnrichmentBudgetBars

**File**: `app/src/components/dashboard/EnrichmentBudgetBars.tsx`

**Props**:
```typescript
interface EnrichmentBudgetBarsProps {
  budgets: {
    provider: string;
    used: number;
    limit: number;
    unit: 'credits' | 'dollars';
  }[];
}
```

**Sub-tasks**:
- [ ] Render as horizontal progress bars, one per provider
- [ ] Each bar: provider name (left), usage bar (center), "used/limit unit" label (right)
- [ ] Bar colors: green (<50%), amber (50-80%), red (>80%)
- [ ] Provider-specific icons or logos if available; fallback to generic Database icon
- [ ] Sort by usage percentage descending
- [ ] Empty state: "No enrichment providers configured."
- [ ] Warning icon on bars > 80% usage

**Acceptance Criteria**:
- Bars accurately reflect used/limit ratios
- Color thresholds are correct
- Warning appears at >80%
- Labels show correct units (credits vs dollars)

**BR References**: BR-1003

---

#### Task A1-8: Dashboard Page Assembly

**File**: `app/src/app/(main)/page.tsx`

**Sub-tasks**:
- [ ] Import `useDashboard` hook
- [ ] Layout: 2-column grid on desktop, single column on mobile
  - Row 1: GoalFocusBanner (full width) + ExtensionStatusBadge (top-right corner)
  - Row 2 left: NetworkHealthRing + IcpRadarChart (stacked)
  - Row 2 right: TaskQueueWidget
  - Row 3 left: DiscoveryFeed
  - Row 3 right: EnrichmentBudgetBars
- [ ] Loading skeleton: use shadcn `Skeleton` components matching each widget shape
- [ ] Error state: banner with retry button
- [ ] Page title: "Dashboard" in breadcrumb

**Acceptance Criteria**:
- Dashboard loads with all 7 widgets populated from API
- Loading state shows skeletons (no layout shift)
- Error state allows retry
- Responsive layout works at 320px, 768px, 1024px, 1440px breakpoints

---

### Agent A2: Contact Detail (route: `/contacts/[slug]`)

**Directory**: `app/src/components/contacts/`
**Page**: `app/src/app/(main)/contacts/[slug]/page.tsx`
**API Hook**: `app/src/hooks/useContact.ts`

#### Task A2-0: Contact SWR Hooks

**File**: `app/src/hooks/useContact.ts`

**Sub-tasks**:
- [ ] `useContact(slug)` -- fetches contact by slug from `GET /api/contacts/:slug`
- [ ] `useContactEdges(id)` -- fetches from `GET /api/contacts/:id/edges`
- [ ] `useContactWarmIntros(id)` -- fetches from `GET /api/contacts/:id/warm-intros`
- [ ] `useContactObservations(id)` -- fetches from `GET /api/contacts/:id/observations`
- [ ] `useSimilarContacts(id)` -- fetches from `GET /api/contacts/similar/:id`
- [ ] All hooks use SWR with `revalidateOnFocus: true`

**Acceptance Criteria**:
- Each hook returns `{ data, error, isLoading }`
- Hooks do not fetch when `id` or `slug` is undefined (conditional fetching)

---

#### Task A2-1: ContactLayout

**File**: `app/src/components/contacts/ContactLayout.tsx`

**Props**:
```typescript
interface ContactLayoutProps {
  contact: Contact;
  children: React.ReactNode;
}
```

**Sub-tasks**:
- [ ] Full-width layout with ContactHeader at top
- [ ] Tab bar below header using shadcn `Tabs` component
- [ ] Tabs: Profile, Network, Outreach, Enrichment, Activity
- [ ] Tab content area renders `children` (active tab component)
- [ ] Breadcrumb: Dashboard > Contacts > {contact name}
- [ ] Back button to `/contacts`

**Acceptance Criteria**:
- Tabs switch without page reload (client-side)
- Active tab is visually indicated
- Breadcrumb is navigable
- Layout does not shift when switching tabs

---

#### Task A2-2: ContactHeader

**File**: `app/src/components/contacts/ContactHeader.tsx`

**Props**:
```typescript
interface ContactHeaderProps {
  contact: {
    id: string;
    slug: string;
    firstName: string;
    lastName: string;
    headline: string | null;
    title: string | null;
    company: string | null;
    location: string | null;
    avatarUrl: string | null;
    tier: 'gold' | 'silver' | 'bronze' | 'watch';
    goldScore: number | null;
    connectedAt: string | null;
  };
  onEnrich?: () => void;
  onAddToOutreach?: () => void;
}
```

**Sub-tasks**:
- [ ] Avatar (100px, rounded, fallback to initials on colored background)
- [ ] Name (h1), headline (muted), title @ company, location with MapPin icon
- [ ] Tier badge: colored pill (Gold #F59E0B, Silver #9CA3AF, Bronze #D97706, Watch #6B7280)
- [ ] ContactScoreCard inlined to the right of the header
- [ ] Action buttons: "Enrich" (Sparkles icon), "Add to Outreach" (Send icon), more (...) dropdown
- [ ] Connected since date (relative, e.g., "Connected 2 years ago")

**Acceptance Criteria**:
- All contact fields render (null fields are hidden, not shown as "null")
- Avatar fallback works correctly
- Tier badge color is correct
- Actions are clickable

**BR References**: BR-201

---

#### Task A2-3: ContactScoreCard

**File**: `app/src/components/contacts/ContactScoreCard.tsx`

**Props**:
```typescript
interface ContactScoreCardProps {
  goldScore: number | null;
  tier: 'gold' | 'silver' | 'bronze' | 'watch';
  dimensions?: {
    name: string;
    score: number;
    weight: number;
    contribution: number;
  }[];
}
```

**Sub-tasks**:
- [ ] Large score display: number (48px font), tier label, colored background matching tier
- [ ] Score ring: circular progress indicator (shadcn or custom SVG) showing score as percentage of 100
- [ ] Hover triggers `ScoreMathPopover` showing full breakdown
- [ ] Null score state: "Not scored" with muted styling
- [ ] Score change indicator: up/down arrow if score changed recently (optional, data permitting)

**Acceptance Criteria**:
- Score renders prominently
- Hover reveals full math breakdown
- Null state is handled gracefully
- Score ring animates on mount

**BR References**: BR-202

---

#### Task A2-4: ScoreMathPopover

**File**: `app/src/components/contacts/ScoreMathPopover.tsx`

**Props**:
```typescript
interface ScoreMathPopoverProps {
  goldScore: number;
  tier: string;
  dimensions: {
    name: string;
    rawScore: number;       // 0-100
    weight: number;         // 0-1
    contribution: number;   // rawScore * weight
  }[];
  tierThresholds: {
    gold: number;
    silver: number;
    bronze: number;
  };
}
```

**Sub-tasks**:
- [ ] Render as shadcn `Popover` (or `HoverCard` for hover trigger)
- [ ] Header: "Score Breakdown" with total score
- [ ] Table of dimensions: Name | Raw Score | Weight | Contribution
- [ ] Each dimension row has a small progress bar for raw score
- [ ] Sum row at bottom showing total (should equal goldScore)
- [ ] Tier thresholds displayed: "Gold >= 75, Silver >= 50, Bronze >= 25"
- [ ] Formula explanation text: "Gold Score = SUM(dimension_score * weight)"

**Acceptance Criteria**:
- All 9 dimensions listed (even if some are 0)
- Contributions sum to the displayed gold score (within rounding)
- Tier thresholds are accurate
- Popover positions correctly (no overflow off screen)

**BR References**: BR-202

---

#### Task A2-5: ContactProfileTab

**File**: `app/src/components/contacts/tabs/ContactProfileTab.tsx`

**Props**:
```typescript
interface ContactProfileTabProps {
  contact: {
    about: string | null;
    headline: string | null;
    experience: {
      title: string;
      company: string;
      startDate: string | null;
      endDate: string | null;
      current: boolean;
      description: string | null;
    }[];
    education: {
      school: string;
      degree: string | null;
      field: string | null;
      startYear: number | null;
      endYear: number | null;
    }[];
    skills: string[];
    tags: string[];
    clusters: { id: string; name: string }[];
    personas: string[];
  };
}
```

**Sub-tasks**:
- [ ] "About" section: rendered markdown-safe text with expand/collapse if > 300 chars
- [ ] Experience timeline: vertical timeline with company logos (fallback icon), title, dates, description
- [ ] Education section: school, degree, field, years
- [ ] Skills: tag cloud using shadcn `Badge` components, max 20 shown with "+N more" expand
- [ ] Tags: editable tag list (add/remove tags via API)
- [ ] Clusters: clickable badges linking to `/network?cluster=:id`
- [ ] Personas: displayed as colored pills (structural + behavioral personas)
- [ ] Empty sections hidden entirely (not shown with "No data")

**Acceptance Criteria**:
- All non-null sections render correctly
- Experience is in reverse chronological order
- Skills tags are visually scannable
- Cluster links navigate correctly
- Tags are editable inline

**BR References**: BR-203

---

#### Task A2-6: ContactNetworkTab

**File**: `app/src/components/contacts/tabs/ContactNetworkTab.tsx`

**Props**:
```typescript
interface ContactNetworkTabProps {
  contactId: string;
  edges: ContactEdgesResponse;
  similarContacts: SimilarContactsResponse;
  warmIntros: WarmIntroResponse;
}
```

**Sub-tasks**:
- [ ] "Connections" section: list of connected contacts with edge type badge, weight indicator, linked names
- [ ] Group connections by edge type (Recommendations, Endorsements, Direct Connections, Same Company)
- [ ] "Same Company" section: contacts at the same company, sorted by score
- [ ] "Similar Contacts" section: grid of similar contacts (from vector similarity) with similarity percentage badge
- [ ] "Warm Intros" section: for each warm intro path, show intermediary -> target with edge types
- [ ] EgoNetwork mini-graph: small reagraph RadialLayout showing this contact as center with first-degree connections (see Agent A3 task A3-5)
- [ ] Each contact name links to their detail page

**Acceptance Criteria**:
- All edge types are displayed with correct grouping
- Similar contacts show similarity scores
- Warm intro paths are understandable (intermediary clearly identified)
- Empty sections are hidden
- Links navigate to correct contact pages

**BR References**: BR-205, BR-207, BR-208

---

#### Task A2-7: ContactOutreachTab

**File**: `app/src/components/contacts/tabs/ContactOutreachTab.tsx`

**Props**:
```typescript
interface ContactOutreachTabProps {
  contactId: string;
  outreachState: {
    currentState: 'not_started' | 'researching' | 'drafting' | 'sent' | 'followed_up' | 'responded' | 'meeting_scheduled' | 'closed';
    stateHistory: {
      state: string;
      enteredAt: string;
      note: string | null;
    }[];
  } | null;
  notes: {
    id: string;
    content: string;
    createdAt: string;
  }[];
  messageHistory: {
    id: string;
    templateName: string | null;
    content: string;
    sentAt: string | null;
    channel: 'linkedin' | 'email' | 'other';
    status: 'draft' | 'sent' | 'delivered' | 'read' | 'replied';
  }[];
}
```

**Sub-tasks**:
- [ ] State machine visualization: horizontal step indicator showing all states, current state highlighted
- [ ] State transition buttons: "Move to next state" with state-specific labels
- [ ] Notes section: chronological list with add-note form (textarea + submit)
- [ ] Message history: list of sent/draft messages with template name, channel badge, status badge
- [ ] "Not started" state: CTA to begin outreach sequence
- [ ] State history: expandable timeline showing when each transition occurred

**Acceptance Criteria**:
- State machine shows current position clearly
- State transitions update optimistically
- Notes can be added inline
- Message history is chronological
- All states are reachable from the UI

**BR References**: BR-604

---

#### Task A2-8: ContactEnrichmentTab

**File**: `app/src/components/contacts/tabs/ContactEnrichmentTab.tsx`

**Props**:
```typescript
interface ContactEnrichmentTabProps {
  contactId: string;
  enrichments: {
    provider: string;
    enrichedAt: string;
    fieldsUpdated: string[];
    confidence: number;
    data: Record<string, unknown>;
  }[];
  fieldAttribution: {
    field: string;
    value: string | null;
    source: string;
    confidence: number;
    enrichedAt: string;
  }[];
}
```

**Sub-tasks**:
- [ ] Per-source attribution table: field name, current value, source provider, confidence badge, date
- [ ] Group by provider with expandable sections
- [ ] Confidence indicator: high (>0.8 green), medium (0.5-0.8 amber), low (<0.5 red)
- [ ] "Enrich Now" button per provider to trigger single-contact enrichment
- [ ] Last enrichment timestamp per provider
- [ ] Empty state: "No enrichment data. Click 'Enrich' to fetch data from providers."

**Acceptance Criteria**:
- All enriched fields show source attribution
- Confidence levels are color-coded
- Multiple sources for same field show all with timestamps
- Enrich button triggers API call

**BR References**: BR-204

---

#### Task A2-9: ContactActivityTab

**File**: `app/src/components/contacts/tabs/ContactActivityTab.tsx`

**Props**:
```typescript
interface ContactActivityTabProps {
  contactId: string;
  observations: ObservationsResponse;
}
```

**Sub-tasks**:
- [ ] Activity summary card: total observations, last active date, dominant topics, activity frequency badge
- [ ] Observation feed: chronological list of behavioral observations
- [ ] Type icons per observation type (post, comment, share, reaction, article, endorsement_given, job_change, profile_update)
- [ ] Sentiment indicator: colored dot (positive green, neutral gray, negative red)
- [ ] Topic tags on each observation
- [ ] "Load more" pagination (50 at a time)
- [ ] Filter by observation type (multi-select dropdown)
- [ ] Empty state: "No activity observed yet. Activity will appear as the extension captures LinkedIn interactions."

**Acceptance Criteria**:
- Observations render chronologically
- Sentiment indicators are correct
- Filtering works across all types
- Pagination loads more without losing scroll position

**BR References**: BR-410

---

#### Task A2-10: Contact Detail Page Assembly

**File**: `app/src/app/(main)/contacts/[slug]/page.tsx`

**Sub-tasks**:
- [ ] Fetch contact data by slug
- [ ] Render ContactLayout with ContactHeader
- [ ] Tab routing: use URL search params or client-side state for active tab
- [ ] Each tab lazy-loads its data (SWR hooks fetch on tab activation)
- [ ] 404 page if contact slug not found
- [ ] Loading skeleton per tab

**Acceptance Criteria**:
- Page renders with all tabs functional
- Tab switching is instant (no full page reload)
- Data fetches are deferred per tab (not all at once)
- 404 renders for invalid slugs

---

### Agent A3: Network Graph (route: `/network`)

**Directory**: `app/src/components/network/`
**Page**: `app/src/app/(main)/network/page.tsx`
**API Hook**: `app/src/hooks/useGraph.ts`

#### Task A3-0: Graph SWR Hooks

**File**: `app/src/hooks/useGraph.ts`

**Sub-tasks**:
- [ ] `useGraphData(filters)` -- fetches from `GET /api/graph/data` with query params
- [ ] `useGraphClusters()` -- fetches from `GET /api/graph/clusters`
- [ ] `useGraphPath(from, to)` -- fetches from `GET /api/graph/path/:from/:to` (conditional)
- [ ] `useGraphStats()` -- fetches from `GET /api/graph/stats`

**Acceptance Criteria**:
- Hooks support filter parameters
- Path hook only fetches when both `from` and `to` are set

---

#### Task A3-1: NetworkGraph (reagraph wrapper)

**File**: `app/src/components/network/NetworkGraph.tsx`

**Props**:
```typescript
interface NetworkGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: '2d-force' | '3d-force' | 'radial' | 'hierarchical';
  colorBy: 'tier' | 'cluster' | 'score' | 'company';
  sizeBy: 'score' | 'pagerank' | 'degree' | 'uniform';
  edgeFilter: string[];     // edge types to show
  showClusterHulls: boolean;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onNodeHover: (nodeId: string | null) => void;
}
```

**Sub-tasks**:
- [ ] Wrap reagraph `GraphCanvas` component
- [ ] Configure force-directed layout as default (2D)
- [ ] Support layout switching (2D force, 3D force, radial, hierarchical)
- [ ] Node coloring based on `colorBy` prop:
  - tier: gold (#F59E0B), silver (#9CA3AF), bronze (#D97706), watch (#6B7280)
  - cluster: assign distinct colors from palette per cluster_id
  - score: gradient from red (low) to green (high)
  - company: assign distinct colors per company
- [ ] Node sizing based on `sizeBy` prop (normalize values to 10-50 range)
- [ ] Edge filtering: only show edges matching `edgeFilter` types
- [ ] Cluster hulls: convex hull overlays when `showClusterHulls` is true (use reagraph cluster feature or custom SVG overlay)
- [ ] Click handler: select node, highlight its edges, dim others
- [ ] Hover handler: show tooltip with contact name, tier, score, company
- [ ] Zoom controls: zoom in, zoom out, fit to screen, reset
- [ ] Performance: use WebGL rendering for > 200 nodes

**Acceptance Criteria**:
- Graph renders 500 nodes smoothly (>30fps)
- Layout switching animates transitions
- Node colors match selected colorBy mode
- Edge filtering hides/shows edges correctly
- Click selects node and highlights connections
- Zoom controls work

**BR References**: BR-1021, BR-1022

---

#### Task A3-2: GraphControls

**File**: `app/src/components/network/GraphControls.tsx`

**Props**:
```typescript
interface GraphControlsProps {
  layout: string;
  colorBy: string;
  sizeBy: string;
  edgeFilter: string[];
  showClusterHulls: boolean;
  onLayoutChange: (layout: string) => void;
  onColorByChange: (colorBy: string) => void;
  onSizeByChange: (sizeBy: string) => void;
  onEdgeFilterChange: (types: string[]) => void;
  onClusterHullsChange: (show: boolean) => void;
  onPathFinderOpen: () => void;
  stats: NetworkStatsResponse | null;
}
```

**Sub-tasks**:
- [ ] Collapsible panel on the left side of the graph
- [ ] Layout selector: dropdown with 4 options (2D Force, 3D Force, Radial, Hierarchical)
- [ ] Color by selector: dropdown with 4 options
- [ ] Size by selector: dropdown with 4 options
- [ ] Edge type filter: multi-select checkboxes for each edge type
- [ ] Cluster hulls toggle: switch
- [ ] "Find Path" button opens PathFinder dialog
- [ ] Network stats section: node count, edge count, density, avg degree (from `stats` prop)
- [ ] "Reset" button to restore defaults

**Acceptance Criteria**:
- All controls update the graph in real time
- Controls are usable on both desktop and tablet
- Stats display accurately
- Reset restores all defaults

**BR References**: BR-510

---

#### Task A3-3: ClusterSidebar

**File**: `app/src/components/network/ClusterSidebar.tsx`

**Props**:
```typescript
interface ClusterSidebarProps {
  clusters: ClusterInfo[];
  selectedClusterId: string | null;
  onClusterSelect: (clusterId: string | null) => void;
  onClusterFocus: (clusterId: string) => void;
}
```

**Sub-tasks**:
- [ ] Right-side collapsible panel
- [ ] List of clusters, each showing: name, contact count, gold% badge, top 3 contacts (avatar + name)
- [ ] Click cluster: filter graph to show only that cluster's nodes
- [ ] Double-click cluster: zoom/focus graph on that cluster
- [ ] "Show All" button to clear cluster filter
- [ ] Gold% color coding: green (>30%), amber (15-30%), red (<15%)
- [ ] Dominant company and skills shown per cluster
- [ ] Sortable: by count, gold%, avg score

**Acceptance Criteria**:
- Cluster selection filters the graph
- Gold percentages are accurate
- Top contacts are clickable (navigate to contact detail)
- Sort options work correctly

**BR References**: BR-511

---

#### Task A3-4: PathFinder

**File**: `app/src/components/network/PathFinder.tsx`

**Props**:
```typescript
interface PathFinderProps {
  open: boolean;
  onClose: () => void;
  onPathFound: (path: PathResponse) => void;
}
```

**Sub-tasks**:
- [ ] Modal/dialog with two contact search inputs (From, To)
- [ ] Each input uses the `GET /api/contacts/search` endpoint for autocomplete
- [ ] "Find Path" button triggers `GET /api/graph/path/:from/:to`
- [ ] Result display: step-by-step path with contact cards and edge type labels
- [ ] "Highlight in Graph" button calls `onPathFound` to highlight the path nodes/edges on the graph
- [ ] "No path found" state with explanation
- [ ] Loading state during path computation

**Acceptance Criteria**:
- Contact search autocomplete works with debounced input
- Path result is displayed clearly
- "Highlight in Graph" highlights the path and dims other nodes
- No-path state is informative

**BR References**: BR-1024

---

#### Task A3-5: EgoNetwork

**File**: `app/src/components/network/EgoNetwork.tsx`

**Props**:
```typescript
interface EgoNetworkProps {
  contactId: string;
  edges: ContactEdgesResponse;
  size?: { width: number; height: number };
}
```

**Sub-tasks**:
- [ ] Small, self-contained reagraph instance using radial layout
- [ ] Center node is the focus contact (larger, highlighted)
- [ ] First-degree connections arranged radially around center
- [ ] Node color by tier, size by score
- [ ] Click on peripheral node navigates to that contact
- [ ] Tooltip on hover with name, tier, score
- [ ] Default size: 400x400, configurable via props
- [ ] Used on the Contact Detail Network tab (Agent A2 task A2-6)

**Acceptance Criteria**:
- Radial layout with center node prominently displayed
- Peripheral nodes are correctly positioned
- Interactions (click, hover) work
- Performance acceptable with up to 50 peripheral nodes

**BR References**: BR-1025

---

#### Task A3-6: Network Page Assembly

**File**: `app/src/app/(main)/network/page.tsx`

**Sub-tasks**:
- [ ] Full-screen layout: GraphControls (left), NetworkGraph (center, flex-grow), ClusterSidebar (right)
- [ ] State management for all graph controls (layout, colorBy, sizeBy, edgeFilter, clusterHulls)
- [ ] Path finder modal state
- [ ] Selected node state (updates URL search params for deep linking)
- [ ] Loading skeleton for graph
- [ ] Fetch graph data, clusters, and stats on mount
- [ ] Panel collapse/expand toggles

**Acceptance Criteria**:
- Full-screen graph with sidebars renders correctly
- All control interactions update the graph
- Deep linking to a selected node works via URL params
- Page is responsive (sidebars collapse to overlays on mobile)

---

### Agent A4: Discover Page (route: `/discover`)

**Directory**: `app/src/components/discover/`
**Page**: `app/src/app/(main)/discover/page.tsx`

#### Task A4-1: DiscoverContent

**File**: `app/src/components/discover/DiscoverContent.tsx`

**Sub-tasks**:
- [ ] Main page layout with NicheSwitcher at top
- [ ] When "All Niches" selected: show NicheCard grid + NicheComparisonChart + IcpTreemap
- [ ] When specific niche selected: show WedgeVisualization + niche detail + contacts in that niche
- [ ] Section headers with counts and descriptions

**Acceptance Criteria**:
- Niche switching updates all content sections
- Layout is responsive (grid collapses on mobile)

---

#### Task A4-2: NicheSwitcher

**File**: `app/src/components/discover/NicheSwitcher.tsx`

**Props**:
```typescript
interface NicheSwitcherProps {
  niches: { id: string; name: string; contactCount: number }[];
  selectedNicheId: string | null;   // null = "All Niches"
  onNicheChange: (nicheId: string | null) => void;
}
```

**Sub-tasks**:
- [ ] Dropdown select (shadcn `Select`) with "All Niches" default option
- [ ] Each option shows niche name + contact count badge
- [ ] Keyboard navigable
- [ ] Persists selection in URL search params

**Acceptance Criteria**:
- Dropdown renders all niches plus "All" option
- Selection updates URL and triggers content change

---

#### Task A4-3: NicheCard

**File**: `app/src/components/discover/NicheCard.tsx`

**Props**:
```typescript
interface NicheCardProps {
  niche: {
    id: string;
    name: string;
    description: string | null;
    contactCount: number;
    goldCount: number;
    goldPercentage: number;
    avgScore: number;
    dominantTraits: string[];
    topContacts: { id: string; slug: string; name: string; tier: string }[];
  };
  onSelect: (nicheId: string) => void;
  onViewContacts: (nicheId: string) => void;
}
```

**Sub-tasks**:
- [ ] Card layout with niche name as title
- [ ] Key metrics: contact count, gold count, gold%, avg score
- [ ] Gold% bar with color coding (green >30%, amber 15-30%, red <15%)
- [ ] Dominant traits as tag pills (top 5)
- [ ] Top 3 contacts as small avatar + name links
- [ ] "View Contacts" button linking to contacts table filtered by niche
- [ ] "Select" button to switch niche context
- [ ] Card border color accent based on gold%

**Acceptance Criteria**:
- All metrics display accurately
- Top contacts link to contact detail pages
- "View Contacts" applies correct filter
- Cards are visually distinct in grid layout

---

#### Task A4-4: WedgeVisualization

**File**: `app/src/components/discover/WedgeVisualization.tsx`

**Props**:
```typescript
interface WedgeVisualizationProps {
  wedges: WedgeMetric[];
  selectedNicheId: string | null;
  onWedgeClick: (nicheId: string) => void;
}
```

**Sub-tasks**:
- [ ] Use visx (`@visx/shape`, `@visx/scale`, `@visx/group`) to render a 3D-perspective wedge model
- [ ] Each niche is a wedge segment:
  - **Radius** (x-axis): proportional to contact count (normalized 0-1)
  - **Arc** (angular width): proportional to gold concentration (total gold in niche / total gold)
  - **Height** (z-axis/color intensity): proportional to average gold_score
- [ ] Render as a polar area chart with variable radius and arc width
- [ ] Color each wedge with distinct niche color
- [ ] Hover tooltip: niche name, contact count, gold count, avg score
- [ ] Click selects niche (outline/highlight effect)
- [ ] Selected niche (from props) is highlighted
- [ ] Legend mapping wedge dimensions to data meaning
- [ ] Responsive: scales from 300px to 800px width

**Acceptance Criteria**:
- Wedge dimensions accurately represent the data (radius = count, arc = gold concentration, height = avg score)
- Tooltips show correct data
- Click interaction works
- Visual is readable with up to 12 niches
- Legend explains the 3 dimensions

**BR References**: BR-1016

---

#### Task A4-5: NicheComparisonChart

**File**: `app/src/components/discover/NicheComparisonChart.tsx`

**Props**:
```typescript
interface NicheComparisonChartProps {
  niches: {
    name: string;
    contactCount: number;
    goldCount: number;
    avgScore: number;
    goldPercentage: number;
  }[];
}
```

**Sub-tasks**:
- [ ] Recharts `BarChart` with grouped bars per niche
- [ ] Groups: Contact Count, Gold Count, Avg Score (normalized to same scale)
- [ ] Each metric uses a distinct color
- [ ] X-axis: niche names (truncated if long)
- [ ] Y-axis: dual scale (count on left, score on right)
- [ ] Tooltip on hover with exact values
- [ ] Responsive with horizontal scrolling if > 8 niches

**Acceptance Criteria**:
- Bars accurately represent data
- Dual axes are labeled correctly
- Readable with 3-12 niches
- Tooltip shows all three metrics

**BR References**: BR-1007

---

#### Task A4-6: IcpTreemap

**File**: `app/src/components/discover/IcpTreemap.tsx`

**Props**:
```typescript
interface IcpTreemapProps {
  data: {
    name: string;           // ICP/niche name
    children: {
      name: string;         // contact name
      value: number;        // gold_score
      tier: string;
    }[];
  }[];
}
```

**Sub-tasks**:
- [ ] Recharts `Treemap` with contacts grouped by ICP/niche
- [ ] Cell size proportional to gold_score
- [ ] Cell color by tier
- [ ] Nested treemap: outer groups are niches, inner cells are contacts
- [ ] Tooltip showing contact name, score, tier, niche
- [ ] Click on contact cell navigates to contact detail
- [ ] Responsive: min height 400px

**Acceptance Criteria**:
- Treemap accurately sizes cells by score
- Colors match tier assignments
- Niche groupings are visually distinct
- Tooltip and click interactions work

**BR References**: BR-1012

---

#### Task A4-7: IcpBuilder

**File**: `app/src/components/discover/IcpBuilder.tsx`

**Sub-tasks**:
- [ ] Multi-step wizard (shadcn `Dialog` or dedicated page section):
  - Step 1: Name + description
  - Step 2: Define dimension weights (sliders for each of 9 scoring dimensions, must sum to 1.0)
  - Step 3: Set trait filters (skills, industries, companies, titles -- multi-select)
  - Step 4: Preview matching contacts with estimated gold count
  - Step 5: Save ICP profile
- [ ] Real-time preview: as weights/filters change, show estimated match count
- [ ] Weight normalization: auto-normalize if sliders exceed 1.0
- [ ] Save triggers `POST /api/icp-profiles` (API from Phase 2)
- [ ] Edit mode: pre-fill wizard with existing ICP data

**Acceptance Criteria**:
- Wizard navigates forward/back without data loss
- Weights always sum to 1.0 (auto-normalize)
- Preview shows realistic contact count
- Save persists the ICP profile
- Edit mode loads existing data correctly

**BR References**: BR-417

---

#### Task A4-8: Discover Page Assembly

**File**: `app/src/app/(main)/discover/page.tsx`

**Sub-tasks**:
- [ ] Fetch niches, wedge data, and ICP profiles on mount
- [ ] NicheSwitcher controls page context
- [ ] "All Niches" view: NicheCard grid (3-column) + NicheComparisonChart + IcpTreemap
- [ ] Single niche view: WedgeVisualization + niche detail + contact list filtered to niche
- [ ] "Create ICP" button opens IcpBuilder
- [ ] Loading skeletons per section

**Acceptance Criteria**:
- Page renders all sections with real data
- Niche switching works without full page reload
- ICP builder is accessible from the page

---

### Agent A5: Enrichment Page (route: `/enrichment`)

**Directory**: `app/src/components/enrichment/`
**Page**: `app/src/app/(main)/enrichment/page.tsx`

#### Task A5-1: EnrichmentContent

**File**: `app/src/components/enrichment/EnrichmentContent.tsx`

**Sub-tasks**:
- [ ] Main layout with sections: Provider Status, Batch Enrichment, Coverage Chart, Enrichment History
- [ ] Header with total budget summary (used/total across all providers)
- [ ] Tabbed or single-page layout

**Acceptance Criteria**:
- All sections render with data
- Layout is scannable at a glance

---

#### Task A5-2: ProviderCard

**File**: `app/src/components/enrichment/ProviderCard.tsx`

**Props**:
```typescript
interface ProviderCardProps {
  provider: {
    name: string;
    slug: string;
    enabled: boolean;
    configured: boolean;
    creditsUsed: number;
    creditsLimit: number;
    creditsUnit: 'credits' | 'dollars';
    fieldsProvided: string[];
    avgResponseTime: number;    // ms
    successRate: number;        // 0-100
    lastUsed: string | null;
  };
  onConfigure: (providerSlug: string) => void;
  onToggle: (providerSlug: string, enabled: boolean) => void;
}
```

**Sub-tasks**:
- [ ] Card with provider name, enabled/disabled toggle, status indicator (green/gray)
- [ ] Usage bar: credits used / limit with color coding
- [ ] Fields provided list (e.g., "email, phone, company details, social links")
- [ ] Performance stats: avg response time, success rate
- [ ] "Configure" button opens settings dialog (API key, rate limits)
- [ ] Last used timestamp
- [ ] Disabled state: grayed out with "Not Configured" badge

**Acceptance Criteria**:
- Toggle enables/disables provider via API
- Usage bar colors match thresholds
- Fields list is accurate per provider
- Configure opens dialog with existing settings pre-filled

**BR References**: BR-308

---

#### Task A5-3: BatchEnrichment

**File**: `app/src/components/enrichment/BatchEnrichment.tsx`

**Props**:
```typescript
interface BatchEnrichmentProps {
  clusters: { id: string; name: string; contactCount: number }[];
  tiers: { name: string; count: number }[];
  providers: { slug: string; name: string; creditCost: number }[];
  onEnrich: (config: BatchEnrichConfig) => void;
}

interface BatchEnrichConfig {
  filter: {
    clusterId?: string;
    tier?: string;
    unenrichedOnly: boolean;
  };
  providers: string[];
  estimatedContacts: number;
  estimatedCost: number;
}
```

**Sub-tasks**:
- [ ] Filter selection: by cluster (dropdown), by tier (checkboxes), "unenriched only" toggle
- [ ] Provider selection: checkboxes for each enabled provider
- [ ] CostPreview component (inline): estimated contacts * credit cost per provider
- [ ] "Enrich Batch" button with confirmation dialog showing cost estimate
- [ ] Real-time count update as filters change
- [ ] Progress indicator after batch starts (polling or WebSocket)
- [ ] Disable button if budget would be exceeded

**Acceptance Criteria**:
- Filter changes update estimated count in real time
- Cost preview is accurate (matches actual cost within 10%)
- Confirmation dialog shows clear cost breakdown
- Budget exceeded state prevents enrichment
- Progress shows after batch starts

**BR References**: BR-303, BR-304

---

#### Task A5-4: EnrichmentHistory

**File**: `app/src/components/enrichment/EnrichmentHistory.tsx`

**Props**:
```typescript
interface EnrichmentHistoryProps {
  batches: {
    id: string;
    provider: string;
    contactCount: number;
    fieldsUpdated: number;
    cost: number;
    costUnit: string;
    startedAt: string;
    completedAt: string | null;
    status: 'running' | 'completed' | 'failed' | 'partial';
    successCount: number;
    failureCount: number;
  }[];
}
```

**Sub-tasks**:
- [ ] Table view (shadcn `Table`) with columns: Date, Provider, Contacts, Fields Updated, Cost, Status, Success Rate
- [ ] Status badge: running (blue pulse), completed (green), failed (red), partial (amber)
- [ ] Sortable by date (default), cost, contact count
- [ ] Expandable row showing error details for failed/partial batches
- [ ] Pagination (20 per page)

**Acceptance Criteria**:
- Table renders batch history accurately
- Status badges are correct
- Sorting and pagination work
- Error details are accessible

**BR References**: BR-309

---

#### Task A5-5: EnrichmentCoverageChart

**File**: `app/src/components/enrichment/EnrichmentCoverageChart.tsx`

**Props**:
```typescript
interface EnrichmentCoverageChartProps {
  data: {
    date: string;
    emailCoverage: number;     // 0-100
    phoneCoverage: number;
    companyCoverage: number;
    socialCoverage: number;
    overallCoverage: number;
  }[];
}
```

**Sub-tasks**:
- [ ] Recharts `AreaChart` with stacked areas showing coverage growth over time
- [ ] Lines for each coverage type (email, phone, company, social) + overall
- [ ] X-axis: date, Y-axis: coverage percentage (0-100%)
- [ ] Distinct colors per coverage type
- [ ] Tooltip on hover with exact percentages
- [ ] Time range selector: 7d, 30d, 90d, all

**Acceptance Criteria**:
- Chart accurately shows coverage trends
- Stacked areas are readable (not obscuring each other)
- Time range selector filters data correctly
- Tooltip shows all coverage types

**BR References**: BR-1008

---

#### Task A5-6: BackgroundAgentStatus

**File**: `app/src/components/enrichment/BackgroundAgentStatus.tsx`

**Props**:
```typescript
interface BackgroundAgentStatusProps {
  agent: {
    running: boolean;
    currentProvider: string | null;
    processedCount: number;
    queuedCount: number;
    rate: number;              // contacts per minute
    budgetRemaining: number;
    budgetUnit: string;
    lastError: string | null;
    startedAt: string | null;
  };
  onPause: () => void;
  onResume: () => void;
}
```

**Sub-tasks**:
- [ ] Status card: running (green pulse) / paused (amber) / stopped (gray)
- [ ] Current activity: "Enriching via {provider}: {processed}/{queued}"
- [ ] Rate display: "{N} contacts/minute"
- [ ] Budget remaining bar
- [ ] Pause/Resume button
- [ ] Last error display (if any)
- [ ] Auto-refresh every 5 seconds when running

**Acceptance Criteria**:
- Status accurately reflects agent state
- Pause/Resume toggles agent via API
- Rate and counts update in real time
- Error display is clear and actionable

**BR References**: BR-307

---

#### Task A5-7: Enrichment Page Assembly

**File**: `app/src/app/(main)/enrichment/page.tsx`

**Sub-tasks**:
- [ ] Layout: ProviderCards (grid, 2-3 columns) at top, BatchEnrichment + BackgroundAgentStatus side by side, EnrichmentCoverageChart, EnrichmentHistory table at bottom
- [ ] Fetch provider, budget, batch, and coverage data on mount
- [ ] Loading skeletons
- [ ] Page title: "Enrichment" in breadcrumb

**Acceptance Criteria**:
- All sections render with real data
- Layout is responsive
- Actions (configure, toggle, enrich) work end-to-end

---

### Agent A6: Utilities -- Command Palette + Standalone Visualizations

#### Task A6-1: CommandPalette

**File**: `app/src/components/ui/CommandPalette.tsx`

**Sub-tasks**:
- [ ] Use `cmdk` library for the command palette modal
- [ ] Trigger: Cmd+K (Mac) / Ctrl+K (Windows)
- [ ] Search categories: Contacts, Clusters/Niches, Tasks, Goals, Actions
- [ ] Contact search: uses `GET /api/contacts/search` with debounced input (300ms)
- [ ] Actions: "Import CSV", "Enrich All", "View Network", "Create ICP" (static list)
- [ ] Each result: icon + label + subtitle + keyboard shortcut (if applicable)
- [ ] Navigate to result on Enter or click
- [ ] Recent searches stored in localStorage (last 5)
- [ ] Empty state: "No results found. Try a different search."
- [ ] Register global keyboard listener in root layout

**Global Registration** -- `app/src/app/(main)/layout.tsx`:
- [ ] Add `<CommandPalette />` to the layout (rendered once, controlled via state)
- [ ] Add keyboard event listener for Cmd+K / Ctrl+K

**Acceptance Criteria**:
- Opens on Cmd+K / Ctrl+K
- Contact search returns relevant results with debounce
- Navigation works for all result types
- Recent searches persist across sessions
- Closes on Escape or outside click

**BR References**: BR-211

---

#### Task A6-2: TierDistributionPie

**File**: `app/src/components/charts/TierDistributionPie.tsx`

**Props**:
```typescript
interface TierDistributionPieProps {
  data: {
    tier: 'gold' | 'silver' | 'bronze' | 'watch';
    count: number;
  }[];
}
```

**Sub-tasks**:
- [ ] Recharts `PieChart` with 4 segments for tiers
- [ ] Colors: Gold (#F59E0B), Silver (#9CA3AF), Bronze (#D97706), Watch (#6B7280)
- [ ] Labels show count and percentage
- [ ] Legend below
- [ ] Used on dashboard and contacts page

**Acceptance Criteria**: Accurate tier counts, correct colors, responsive

**BR References**: BR-1005

---

#### Task A6-3: GoldConcentrationBars

**File**: `app/src/components/charts/GoldConcentrationBars.tsx`

**Props**:
```typescript
interface GoldConcentrationBarsProps {
  data: {
    nicheName: string;
    goldPercentage: number;
    goldCount: number;
    totalCount: number;
  }[];
}
```

**Sub-tasks**:
- [ ] Recharts `BarChart` horizontal bars showing gold% per niche
- [ ] Sorted by gold% descending
- [ ] Bar color gradient from red (0%) to green (50%+)
- [ ] Label on bar showing exact percentage and count

**Acceptance Criteria**: Bars sorted correctly, colors match, labels readable

**BR References**: BR-1006

---

#### Task A6-4: ScoreBreakdownBar

**File**: `app/src/components/charts/ScoreBreakdownBar.tsx`

**Props**:
```typescript
interface ScoreBreakdownBarProps {
  dimensions: {
    name: string;
    contribution: number;   // weighted score for this dimension
    color: string;
  }[];
  totalScore: number;
}
```

**Sub-tasks**:
- [ ] Recharts stacked `BarChart` (single horizontal bar) showing each dimension's contribution
- [ ] Each segment colored distinctly
- [ ] Tooltip showing dimension name and contribution
- [ ] Total score label at end of bar

**Acceptance Criteria**: Segments sum to total score, colors are distinct, tooltip works

**BR References**: BR-1004

---

#### Task A6-5: GoalProgressBars

**File**: `app/src/components/charts/GoalProgressBars.tsx`

**Props**:
```typescript
interface GoalProgressBarsProps {
  goals: {
    id: string;
    title: string;
    progress: number;
    targetDate: string;
  }[];
}
```

**Sub-tasks**:
- [ ] Vertical list of progress bars, one per goal
- [ ] Each bar: goal title, progress bar, percentage, target date
- [ ] Color: green (>66%), amber (33-66%), red (<33%)
- [ ] Overdue indicator if target date has passed and progress < 100%

**Acceptance Criteria**: Progress bars accurate, overdue styling distinct, responsive

**BR References**: BR-1010

---

#### Task A6-6: ScoringWeightDistribution

**File**: `app/src/components/charts/ScoringWeightDistribution.tsx`

**Props**:
```typescript
interface ScoringWeightDistributionProps {
  weights: {
    dimension: string;
    weight: number;         // 0-1
  }[];
}
```

**Sub-tasks**:
- [ ] Recharts `PieChart` showing weight allocation across scoring dimensions
- [ ] Each segment labeled with dimension name and weight percentage
- [ ] Colors from a 9-color palette (one per dimension)

**Acceptance Criteria**: Weights sum to 100%, labels readable, colors distinct

**BR References**: BR-1013

---

#### Task A6-7: ScoreImpactPreviewLine

**File**: `app/src/components/charts/ScoreImpactPreviewLine.tsx`

**Props**:
```typescript
interface ScoreImpactPreviewLineProps {
  contacts: {
    name: string;
    currentScore: number;
    previewScore: number;
  }[];
  changeDescription: string;
}
```

**Sub-tasks**:
- [ ] Recharts `LineChart` with two lines: "Current Score" and "Preview Score"
- [ ] X-axis: contacts (sorted by current score)
- [ ] Y-axis: score (0-100)
- [ ] Shaded area between lines showing impact
- [ ] Positive impact (green shade), negative impact (red shade)
- [ ] Title showing `changeDescription`

**Acceptance Criteria**: Before/after lines render correctly, impact shading is visible, responsive

**BR References**: BR-1014

---

#### Task A6-8: EnrichmentCostBreakdownPie

**File**: `app/src/components/charts/EnrichmentCostBreakdownPie.tsx`

**Props**:
```typescript
interface EnrichmentCostBreakdownPieProps {
  data: {
    provider: string;
    cost: number;
    unit: string;
    percentage: number;
  }[];
  totalCost: number;
  totalUnit: string;
}
```

**Sub-tasks**:
- [ ] Recharts `PieChart` showing spend by provider
- [ ] Center text: total cost with unit
- [ ] Provider name + cost in legend
- [ ] Distinct colors per provider

**Acceptance Criteria**: Percentages sum to 100%, total is accurate, responsive

**BR References**: BR-1015

---

## Orchestrator Instructions

### Execution Strategy

1. **Spawn all 6 agents in parallel** at phase start
2. Agents A1-A5 begin with mock data matching the backend response shapes defined in `phase-3-app-ui/backend.md`
3. Within the first 2-3 days, backend agents deliver real endpoints; App agents switch from mocks to real APIs
4. Agent A6 has no backend dependency (all visualizations receive data via props)
5. Agent A3 depends on Agent A2's EgoNetwork component being available for the Contact Detail Network tab -- but A3 can build EgoNetwork independently and A2 can integrate it later

### Mock Data Strategy

Each agent should create a mock data file for development:

```
app/src/mocks/
  dashboard.mock.ts
  contact.mock.ts
  graph.mock.ts
  discover.mock.ts
  enrichment.mock.ts
```

Mock files export factory functions matching API response shapes. SWR hooks should support a `useMock` flag (controlled by environment variable `NEXT_PUBLIC_USE_MOCKS=true`).

### Testing Requirements

For each component, write tests covering:
- Renders with full data
- Renders with empty/null data (graceful degradation)
- User interactions (clicks, hovers, form submissions)
- Loading states
- Error states
- Accessibility (keyboard navigation, ARIA labels)

Test files mirror component paths:
```
tests/components/dashboard/GoalFocusBanner.test.tsx
tests/components/dashboard/NetworkHealthRing.test.tsx
tests/components/contacts/ContactHeader.test.tsx
tests/components/contacts/tabs/ContactProfileTab.test.tsx
tests/components/network/NetworkGraph.test.tsx
tests/components/discover/WedgeVisualization.test.tsx
tests/components/enrichment/ProviderCard.test.tsx
tests/components/charts/TierDistributionPie.test.tsx
tests/components/ui/CommandPalette.test.tsx
... (one test file per component)
```

### Shared Component Conventions

All components must follow these conventions:
- Export as named export (not default)
- Props interface exported alongside component
- Use `forwardRef` where DOM ref access is needed
- Use shadcn/ui primitives (Button, Card, Badge, Dialog, Popover, Select, Input, Table, Tabs, Skeleton)
- Use Lucide React for icons (already included with shadcn)
- Use `cn()` utility for conditional class merging
- Tailwind CSS for all styling (no CSS modules)
- SWR for all data fetching (no `useEffect` + `fetch`)
- `"use client"` directive on all interactive components

### Performance Targets

| Page | Target | Metric |
|---|---|---|
| Dashboard | < 500ms | Time to interactive |
| Contact Detail | < 300ms | Tab switch time |
| Network Graph | > 30fps | Frame rate with 500 nodes |
| Discover Page | < 400ms | Time to interactive |
| Enrichment Page | < 300ms | Time to interactive |
| Command Palette | < 100ms | Open + first results |

---

## Dependencies

### Upstream (required before this work)

| Dependency | Source | Status |
|---|---|---|
| Next.js project with shadcn/ui | Phase 1 App | Must pass Phase 1 gate |
| SWR configured | Phase 1 App | Must pass Phase 1 gate |
| Sidebar navigation | Phase 1 App | Must pass Phase 1 gate |
| Score display + tier badges | Phase 2 App | Must pass Phase 2 gate |
| Phase 3 backend APIs | Phase 3 Backend | Deliver within first 2-3 days |

### Cross-Agent Dependencies (within Phase 3 App)

| Dependency | Provider Agent | Consumer Agent | Notes |
|---|---|---|---|
| EgoNetwork component | A3 | A2 | A2 renders EgoNetwork on Contact Network tab |
| Chart components | A6 | A1, A4, A5 | Standalone charts used across pages |
| CommandPalette | A6 | Layout | Mounted once in root layout |

### Downstream (blocks these)

| Dependent | Phase | Blocked Tasks |
|---|---|---|
| Extension capture display | Phase 4 App | Needs dashboard + contact detail to display captured data |
| Goals/Tasks UI | Phase 5 App | Needs dashboard TaskQueueWidget + GoalFocusBanner patterns |
| Outreach pipeline | Phase 5 App | Needs ContactOutreachTab as foundation |
| Admin scoring panel | Phase 6 App | Needs ScoreMathPopover and weight distribution patterns |

---

## Gate Criteria

All of the following must pass before Phase 3 App is considered complete:

### Dashboard
- [ ] Dashboard loads at `/` with all 7 widgets rendering real data
- [ ] GoalFocusBanner shows goals (or empty state) with progress bars
- [ ] NetworkHealthRing donut displays correct contact distribution
- [ ] TaskQueueWidget shows prioritized tasks with category icons
- [ ] DiscoveryFeed renders chronological insights
- [ ] IcpRadarChart overlays ICP profiles with correct axis labels
- [ ] EnrichmentBudgetBars show per-provider usage
- [ ] Dashboard SWR polls every 30 seconds

### Contact Detail
- [ ] Contact detail page renders at `/contacts/:slug` with header and tabs
- [ ] Profile tab shows about, experience, skills, tags, clusters
- [ ] Network tab shows connections, same-company, similar contacts, warm intros
- [ ] Outreach tab shows state machine, notes, message history
- [ ] Enrichment tab shows per-source data attribution
- [ ] Activity tab shows behavioral observations with filters
- [ ] Score card hover reveals full math breakdown in popover

### Network Graph
- [ ] Network graph renders at `/network` with reagraph (2D force-directed)
- [ ] Graph controls change layout, coloring, sizing, edge filtering
- [ ] Cluster sidebar shows clusters with gold% and top contacts
- [ ] Path finder finds and highlights shortest path between two nodes
- [ ] Graph renders 500 nodes at >30fps

### Discover Page
- [ ] Discover page renders at `/discover` with niche cards
- [ ] Niche switcher changes page context
- [ ] Wedge visualization renders with correct radius/arc/height mapping
- [ ] ICP comparison chart and treemap render
- [ ] ICP builder wizard creates new ICP profiles

### Enrichment Page
- [ ] Enrichment page renders at `/enrichment` with provider cards
- [ ] Batch enrichment shows cost preview and triggers enrichment
- [ ] Coverage chart shows enrichment growth over time
- [ ] Background agent status displays and pause/resume works

### Utilities
- [ ] Command palette opens on Cmd+K, searches contacts, navigates correctly
- [ ] All 7 standalone chart components render with sample data
- [ ] All charts are responsive (min 300px width)

### Cross-Cutting
- [ ] All pages have loading skeletons (no layout shift)
- [ ] All pages handle error states with retry options
- [ ] No TypeScript errors (`tsc --noEmit`)
- [ ] No lint errors (`npm run lint`)
- [ ] All component tests pass (`npm test`)
- [ ] Performance targets met (measured via React DevTools Profiler)
