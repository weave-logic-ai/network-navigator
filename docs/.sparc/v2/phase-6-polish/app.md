# Phase 6: Polish -- App Domain Plan (Weeks 21-24)

## Objective

Complete the remaining visualization catalog (Recharts and visx), build the full admin panel (scoring management, RVF training, data purge, provider management, selector config), deliver the 4-step import wizard with progressive Claude integration, and implement utility pages (system health, extension management, CSV export). Achieve UI completeness and production-grade polish across all routes.

## Prerequisites (from Phases 1-5)

| Prerequisite | Phase | Verified By |
|---|---|---|
| All primary pages render with real data (Dashboard, Contacts, Contact Detail, Network Graph, Discover, Enrichment) | 3 | Phase 3 gate |
| Recharts installed and operational (NetworkHealthRing, IcpRadarChart, EnrichmentBudgetBars, TierDistributionBar, ScoreHistogram, SkillsWordCloud, ContactGrowthArea, ConnectionStrengthRadar already built) | 3 | Phase 3 gate |
| visx installed and operational (WedgeVisualization, NicheTreemap, IcpComparisonSankey already built) | 3 | Phase 3 gate |
| reagraph network graph operational | 3 | Phase 3 gate |
| shadcn/ui component library configured | 1 | Phase 1 gate |
| SWR data fetching pattern established | 1 | Phase 1 gate |
| Scoring engine operational with weight management | 2 | Phase 2 gate |
| Enrichment waterfall and provider system operational | 2 | Phase 2 gate |
| CSV import pipeline operational | 1 | Phase 1 gate |
| Claude API integration operational (goal/task generation) | 5 | Phase 5 gate |
| Outreach template system operational | 5 | Phase 5 gate |
| Page parser engine operational | 4 | Phase 4 gate |
| Extension capture and task system operational | 4 | Phase 4 gate |
| Admin API endpoints operational (Phase 6 Backend) | 6 | Phase 6 Backend tasks |

---

## Parallel Agent Assignments

| Agent | Role | Tasks | Est. Effort |
|---|---|---|---|
| Agent A1 | Visualizations | ActivityTimelineScatter, OutreachSequenceTree, ScoreDimensionParallelCoordinates, ImportProgressVisualization, EngagementHeatmap | High |
| Agent A2 | Admin Panel | AdminContent layout, ScoringPanel, WeightSliders, RvfTraining, DataPurgePanel, ProviderManagement | High |
| Agent A3 | Import Wizard | ImportWizard 4-step flow, CsvUploader, FieldMapper, ImportProgress with ClusterFormationViz, ImportSummary | High |
| Agent A4 | Utilities | System health dashboard, extension management page, CSV export, contact outreach tab deep link | Medium |
| Agent A5 | Security + Polish | SelectorConfigEditor, security audit of all client-side code, CSP review, loading/empty states audit | Medium |

Agents A1-A5 can all run in parallel. A2 depends on Phase 6 Backend admin API endpoints being available (use mock data initially, switch to real data when endpoints land). A3 depends on CSV import pipeline (Phase 1) and Claude integration (Phase 5).

---

## Detailed Task Checklist

### Task A1-1: ActivityTimelineScatter -- Post Frequency Over Time

**File**: `app/src/components/visualizations/ActivityTimelineScatter.tsx`
**Tests**: `tests/components/visualizations/ActivityTimelineScatter.test.tsx`

**Description**: Recharts scatter plot showing post frequency over time with engagement as dot size. Renders on the Contact Detail Activity tab.

**Component Specification**:
```typescript
interface ActivityTimelineScatterProps {
  data: {
    date: string;               // ISO date
    type: 'post' | 'comment' | 'share' | 'reaction' | 'article';
    engagementScore: number;    // 0-100, mapped to dot radius
    title: string | null;
    url: string | null;
  }[];
  dateRange?: { from: string; to: string };
  height?: number;              // default 300
}
```

**Sub-tasks**:
- [ ] Implement scatter plot with Recharts `<ScatterChart>`, `<Scatter>`, `<XAxis>` (date), `<YAxis>` (activity type categorical)
- [ ] Map `engagementScore` to dot radius: `Math.max(4, (engagementScore / 100) * 20)`
- [ ] Color dots by activity type: post=#3B82F6, comment=#10B981, share=#F59E0B, reaction=#EF4444, article=#8B5CF6
- [ ] Add `<Tooltip>` showing date, type, title, engagement score
- [ ] Support date range filtering via `dateRange` prop
- [ ] Add responsive container wrapping
- [ ] Render empty state when data array is empty: "No activity recorded yet"
- [ ] Data source: `GET /api/contacts/[slug]/activity` via SWR
- [ ] Write unit tests: renders with data, empty state, tooltip content, color mapping

**Acceptance Criteria**:
- Scatter plot renders with correct date axis and categorical type axis
- Dot sizes visually distinguish high vs low engagement
- Tooltip shows complete activity details
- Empty state renders gracefully
- Responsive to container width

**BR References**: BR-1011

---

### Task A1-2: OutreachSequenceTree -- Branching Message Sequence

**File**: `app/src/components/visualizations/OutreachSequenceTree.tsx`
**Tests**: `tests/components/visualizations/OutreachSequenceTree.test.tsx`

**Description**: visx hierarchy tree visualization showing branching message sequences in outreach templates. Renders on the `/outreach/templates` route.

**Component Specification**:
```typescript
interface SequenceNode {
  id: string;
  label: string;               // step name
  templateId: string;
  type: 'initial' | 'follow_up' | 'branch' | 'end';
  condition?: string;           // branch condition label
  sentCount: number;
  responseRate: number;         // 0-1
  children?: SequenceNode[];
}

interface OutreachSequenceTreeProps {
  data: SequenceNode;           // root node
  width?: number;
  height?: number;              // default 400
  onNodeClick?: (node: SequenceNode) => void;
}
```

**Sub-tasks**:
- [ ] Implement tree using `@visx/hierarchy` `Tree` component with `@visx/shape` `LinkVertical`
- [ ] Render nodes as rounded rectangles with label, sentCount, and responseRate
- [ ] Color nodes by type: initial=#3B82F6, follow_up=#10B981, branch=#F59E0B, end=#6B7280
- [ ] Show branch condition labels on branch links
- [ ] Scale responseRate to node opacity (higher response rate = more opaque)
- [ ] Add click handler on nodes to navigate to template editor
- [ ] Handle single-node trees (initial outreach only, no branches)
- [ ] Packages: `@visx/hierarchy`, `@visx/shape`, `@visx/group`, `@visx/text`
- [ ] Write unit tests: tree renders with branches, single node, click handler fires, response rate opacity

**Acceptance Criteria**:
- Tree renders with proper hierarchy layout
- Branch conditions are visible on connecting lines
- Node colors match type assignment
- Click navigates to template editor
- Works with deep trees (up to 5 levels)

**BR References**: BR-1017

---

### Task A1-3: ScoreDimensionParallelCoordinates -- Multi-Dimension Score View

**File**: `app/src/components/visualizations/ScoreDimensionParallelCoordinates.tsx`
**Tests**: `tests/components/visualizations/ScoreDimensionParallelCoordinates.test.tsx`

**Description**: visx parallel coordinates chart showing all 9 scoring dimensions for one or more contacts. Used on Contact Detail and Admin scoring preview.

**Component Specification**:
```typescript
interface ScoreProfile {
  contactId: string;
  contactName: string;
  tier: 'gold' | 'silver' | 'bronze' | 'watch';
  dimensions: {
    icp_fit: number;
    network_hub: number;
    relationship_strength: number;
    signal_boost: number;
    skills_relevance: number;
    network_proximity: number;
    behavioral: number;
    content_relevance: number;
    graph_centrality: number;
  };
  compositeScore: number;
}

interface ScoreDimensionParallelCoordinatesProps {
  profiles: ScoreProfile[];       // 1-10 contacts
  highlightId?: string;           // contact to emphasize
  width?: number;
  height?: number;                // default 350
  showLabels?: boolean;           // default true
}
```

**Sub-tasks**:
- [ ] Implement 9 vertical axes using `@visx/axis` with `@visx/scale` linear scales (0-100 each)
- [ ] Draw polylines connecting each contact's dimension values across the axes
- [ ] Color lines by tier: gold=#F59E0B, silver=#9CA3AF, bronze=#D97706, watch=#6B7280
- [ ] Highlight selected contact's line (thicker, full opacity) with others dimmed (0.3 opacity)
- [ ] Add axis labels at top: abbreviated dimension names (ICP, Hub, Rel, Sig, Skill, Prox, Bhv, Cnt, Graph)
- [ ] Add tooltip on hover over any point showing dimension name, raw score, weight, weighted contribution
- [ ] Packages: `@visx/axis`, `@visx/shape`, `@visx/scale`, `@visx/group`, `@visx/tooltip`
- [ ] Write unit tests: renders with single profile, multiple profiles, highlight behavior, tooltip content

**Acceptance Criteria**:
- All 9 dimensions displayed as parallel vertical axes
- Each contact represented as a connected polyline
- Highlighting clearly distinguishes the selected contact
- Tooltip shows dimension details including weight contribution
- Works with 1-10 profiles simultaneously

**BR References**: BR-1018

---

### Task A1-4: ImportProgressVisualization -- Cluster Formation During Import

**File**: `app/src/components/visualizations/ImportProgressVisualization.tsx`
**Tests**: `tests/components/visualizations/ImportProgressVisualization.test.tsx`

**Description**: visx Pack layout visualization showing clusters forming in real-time during CSV import. Renders in the import wizard step 3.

**Component Specification**:
```typescript
interface ImportCluster {
  id: string;
  name: string;                 // auto-generated cluster name
  contactCount: number;
  avgScore: number | null;
  dominantIndustry: string | null;
  children: {
    id: string;
    name: string;
    score: number | null;
  }[];
}

interface ImportProgressVisualizationProps {
  clusters: ImportCluster[];
  totalImported: number;
  totalToImport: number;
  phase: 'importing' | 'clustering' | 'scoring' | 'complete';
  width?: number;
  height?: number;              // default 400
}
```

**Sub-tasks**:
- [ ] Implement circle packing using `@visx/hierarchy` `Pack` layout
- [ ] Outer circles represent clusters, inner circles represent contacts
- [ ] Size outer circles by `contactCount`, inner circles by `score` (or uniform if null)
- [ ] Animate new circles appearing as contacts are imported (CSS transition on radius)
- [ ] Color clusters by `dominantIndustry` using a 12-color palette
- [ ] Show cluster name label in center of each cluster circle using `@visx/text`
- [ ] Display phase indicator: "Importing contacts...", "Detecting clusters...", "Computing scores...", "Complete!"
- [ ] Progress bar overlay showing `totalImported / totalToImport`
- [ ] Packages: `@visx/hierarchy` (Pack), `@visx/shape`, `@visx/text`, `@visx/group`
- [ ] Write unit tests: renders with empty clusters, clusters forming, animation state, phase transitions

**Acceptance Criteria**:
- Circles appear progressively as import progresses
- Cluster groupings are visually clear
- Phase indicator reflects current import state
- Animation is smooth (no layout jumps)
- Works with 1-50 clusters

**BR References**: BR-1019

---

### Task A1-5: EngagementHeatmap -- Day-of-Week x Time-of-Day Activity

**File**: `app/src/components/visualizations/EngagementHeatmap.tsx`
**Tests**: `tests/components/visualizations/EngagementHeatmap.test.tsx`

**Description**: visx heatmap showing activity patterns by day-of-week and time-of-day. Renders on the Contact Detail Activity tab.

**Component Specification**:
```typescript
interface HeatmapCell {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;   // 0=Sunday
  hour: number;                        // 0-23
  count: number;
  avgEngagement: number;               // 0-100
}

interface EngagementHeatmapProps {
  data: HeatmapCell[];
  metric: 'count' | 'engagement';     // which value to visualize
  width?: number;
  height?: number;                     // default 250
  colorScheme?: 'blue' | 'green' | 'orange'; // default 'blue'
}
```

**Sub-tasks**:
- [ ] Implement heatmap using `@visx/heatmap` `HeatmapRect` component
- [ ] X-axis: hours 0-23 (labeled 12am, 1am, ..., 11pm)
- [ ] Y-axis: days Sunday-Saturday
- [ ] Color intensity mapped to selected metric (count or engagement)
- [ ] Color schemes: blue (sequential from #EFF6FF to #1D4ED8), green (#ECFDF5 to #065F46), orange (#FFF7ED to #9A3412)
- [ ] Add tooltip showing: day name, hour range (e.g., "Tuesday 2pm-3pm"), count, avg engagement
- [ ] Handle sparse data: cells with zero activity show as lightest color
- [ ] Package: `@visx/heatmap`, `@visx/scale`, `@visx/tooltip`, `@visx/group`
- [ ] Write unit tests: renders with full data, sparse data, metric toggle, color scheme switching, tooltip content

**Acceptance Criteria**:
- 7x24 grid renders correctly with day and hour labels
- Color intensity accurately reflects the selected metric
- Tooltip shows complete cell details
- Sparse data does not cause layout issues
- Color scheme toggle works without re-mount

**BR References**: BR-1020

---

### Task A2-1: AdminContent -- Main Admin Layout

**File**: `app/src/components/admin/AdminContent.tsx`
**Route**: `app/src/app/admin/layout.tsx`, `app/src/app/admin/page.tsx`
**Tests**: `tests/components/admin/AdminContent.test.tsx`

**Description**: Main admin page layout with tab navigation across admin sections.

**Component Specification**:
```typescript
interface AdminTab {
  id: string;
  label: string;
  icon: LucideIcon;
  route: string;
}

const ADMIN_TABS: AdminTab[] = [
  { id: 'scoring', label: 'Scoring', icon: BarChart3, route: '/admin/scoring' },
  { id: 'data', label: 'Data Management', icon: Database, route: '/admin/data' },
  { id: 'providers', label: 'Providers', icon: Plug, route: '/admin/providers' },
  { id: 'selectors', label: 'Selectors', icon: Code, route: '/admin/selectors' },
  { id: 'health', label: 'System Health', icon: Activity, route: '/admin/health' },
];
```

**Sub-tasks**:
- [ ] Create admin layout with sidebar tab navigation using shadcn/ui `Tabs` or custom vertical tabs
- [ ] Implement route-based tab switching (Next.js App Router nested layouts)
- [ ] Add admin header with "Administration" title and current section subtitle
- [ ] Create admin route files: `/admin/scoring/page.tsx`, `/admin/data/page.tsx`, `/admin/providers/page.tsx`, `/admin/selectors/page.tsx`, `/admin/health/page.tsx`
- [ ] Add admin link to main sidebar navigation (only visible to authenticated users)
- [ ] Write unit tests: tab navigation, route rendering, layout structure

**Acceptance Criteria**:
- Tab navigation switches between admin sections
- URL reflects current admin section
- Layout is consistent across all admin tabs
- Admin link appears in main sidebar

---

### Task A2-2: ScoringPanel -- Weight Management

**File**: `app/src/components/admin/ScoringPanel.tsx`
**Route**: `app/src/app/admin/scoring/page.tsx`
**Tests**: `tests/components/admin/ScoringPanel.test.tsx`

**Description**: Admin panel for managing scoring dimension weights, tier thresholds, and weight profiles. Includes live preview of weight changes on sample contacts.

**Component Specification**:
```typescript
interface ScoringPanelProps {
  // Data fetched via SWR from admin APIs
}

interface WeightState {
  icp_fit: number;
  network_hub: number;
  relationship_strength: number;
  signal_boost: number;
  skills_relevance: number;
  network_proximity: number;
  behavioral: number;
  content_relevance: number;
  graph_centrality: number;
}

interface TierThresholds {
  gold: number;                  // minimum score for gold
  silver: number;                // minimum score for silver
  bronze: number;                // minimum score for bronze
  watch: number;                 // minimum score for watch (usually 0)
}
```

**Sub-tasks**:
- [ ] Implement `WeightSliders` sub-component: 9 range sliders (0.0-1.0, step 0.01) with real-time sum validation
- [ ] Display running sum of weights; show error when sum != 1.0 (tolerance 0.001)
- [ ] Add "Normalize" button that proportionally adjusts all weights to sum to exactly 1.0
- [ ] Add "Reset to defaults" button
- [ ] Implement score preview panel: show 5 sample contacts with current score and projected score after weight change
  - Fetch 5 contacts via `GET /api/admin/scoring/preview?weights=...`
  - Display before/after gold_score and before/after tier for each
  - Highlight contacts whose tier would change (visual delta indicator)
- [ ] Implement named weight profiles:
  - Dropdown to select a saved profile ("Sales-focused", "Networking-focused", custom)
  - "Save as Profile" button with name input
  - "Load Profile" applies weights from selected profile
  - "Delete Profile" with confirmation (cannot delete active profile)
  - Data: `GET /api/admin/scoring/profiles`, `POST /api/admin/scoring/profiles`, `PUT /api/admin/scoring/profiles/:id`, `DELETE /api/admin/scoring/profiles/:id`
- [ ] Implement tier threshold configuration:
  - 4 number inputs for gold/silver/bronze/watch minimums
  - Validation: gold > silver > bronze >= watch >= 0
  - Display tier distribution chart showing how many contacts fall in each tier with current vs new thresholds
- [ ] "Apply Changes" button: `PUT /api/admin/scoring/weights` + `PUT /api/admin/scoring/tiers` + `POST /api/admin/scoring/rescore`
- [ ] Show confirmation dialog before applying: "This will rescore all X contacts. Continue?"
- [ ] Show progress indicator while rescore is running
- [ ] Data source: `GET /api/admin/scoring/weights`, `GET /api/admin/scoring/tiers`
- [ ] Write unit tests: slider sum validation, normalize function, profile save/load, tier validation, preview rendering

**Acceptance Criteria**:
- Weights always sum to 1.0 before saving (validation prevents save otherwise)
- Score preview shows accurate before/after impact
- Tier changes are highlighted visually
- Profile save/load/delete works correctly
- Tier threshold validation prevents invalid configurations
- Rescore triggers successfully after changes

**BR References**: BR-901, BR-405, BR-407, BR-411

---

### Task A2-3: RvfTraining -- Pairwise Comparison Interface

**File**: `app/src/components/admin/RvfTraining.tsx`
**Route**: `app/src/app/admin/scoring/page.tsx` (sub-tab or collapsible section)
**Tests**: `tests/components/admin/RvfTraining.test.tsx`

**Description**: RVF (Relative Value Fit) training interface that presents pairs of contacts and asks the user to indicate which is a better fit. After sufficient training data (>200 comparisons), Bayesian weight learning adjusts scoring weights automatically.

**Component Specification**:
```typescript
interface RvfPair {
  left: {
    id: string;
    name: string;
    company: string | null;
    headline: string | null;
    tier: string;
    goldScore: number;
    topDimensions: { name: string; score: number }[];
  };
  right: {
    // same shape as left
  };
}

interface RvfTrainingProps {
  // Fetched via SWR
}
```

**Sub-tasks**:
- [ ] Implement side-by-side contact card comparison layout
- [ ] Display contact summary: name, company, headline, current tier, current score, top 3 scoring dimensions
- [ ] Three selection buttons: "Left is better fit", "About equal", "Right is better fit"
- [ ] After selection, animate transition to next pair
- [ ] Show training progress counter: "42 of 200 comparisons needed for auto-adjustment"
- [ ] Progress bar: `completedComparisons / 200 * 100`
- [ ] When comparisons >= 200, show "Auto-adjust weights" button that triggers Bayesian learning
- [ ] Display learning results: proposed weight changes with before/after preview
- [ ] Allow user to accept or reject the proposed weights
- [ ] Store comparisons via `POST /api/admin/scoring/rvf-comparison`
- [ ] Fetch random pairs via `GET /api/admin/scoring/rvf-pair` (weighted to diverse tiers/clusters)
- [ ] Write unit tests: pair display, selection handling, progress counter, threshold gate (200), learning trigger

**Acceptance Criteria**:
- Pairs are presented with clear visual comparison
- Selection is recorded and counter increments
- Auto-adjust is gated behind 200 comparison minimum
- Proposed weights can be previewed before acceptance
- Training data persists across sessions

**BR References**: BR-412, BR-406

---

### Task A2-4: DataPurgePanel -- Filter-Based Data Deletion

**File**: `app/src/components/admin/DataPurgePanel.tsx`
**Route**: `app/src/app/admin/data/page.tsx`
**Tests**: `tests/components/admin/DataPurgePanel.test.tsx`

**Description**: Admin interface for bulk contact deletion with comprehensive filtering and safety confirmations.

**Component Specification**:
```typescript
interface PurgeFilters {
  namePattern: string;
  olderThanDays: number | null;
  dateRange: { from: string; to: string } | null;
  tiers: string[];
  clusterIds: string[];
  enrichmentSource: string | null;
  hasNoEnrichment: boolean;
}
```

**Sub-tasks**:
- [ ] Implement filter form with:
  - Name pattern text input with ILIKE explanation ("Use % as wildcard")
  - "Older than X days" number input with "days since last update" label
  - Date range picker (start/end) for created_at
  - Tier multi-select checkboxes (Gold, Silver, Bronze, Watch)
  - Cluster multi-select dropdown
  - Enrichment source dropdown (PDL, Lusha, TheirStack, Apollo, None)
  - "Has no enrichment" checkbox
- [ ] "Preview" button: calls `POST /api/admin/purge` with `mode: 'preview'`
- [ ] Display preview results:
  - Count of matching contacts, edges, enrichments, scores, observations
  - Table of first 10 sample contacts (name, tier, last updated, company)
  - Warning banner: "This action cannot be undone"
- [ ] "Purge X Contacts" button (red, disabled until preview is run)
- [ ] Confirmation modal:
  - Repeat count: "You are about to permanently delete X contacts and all associated data"
  - Type confirmation: require user to type "PURGE" in a text field
  - Two buttons: "Cancel" and "Delete Permanently" (red)
- [ ] Execute purge: `POST /api/admin/purge` with `mode: 'execute'`, `confirm: 'PURGE'`
- [ ] Show completion message with deletion counts
- [ ] Refresh relevant SWR caches after purge
- [ ] Data: `POST /api/admin/purge`
- [ ] Write unit tests: filter form rendering, preview display, confirmation flow, type-to-confirm validation

**Acceptance Criteria**:
- At least one filter must be active before preview is allowed
- Preview shows accurate counts matching what will be deleted
- Confirmation requires typing "PURGE" exactly
- Successful purge shows deletion summary
- SWR caches are invalidated after purge

**BR References**: BR-902

---

### Task A2-5: ProviderManagement -- Enrichment Provider Admin

**File**: `app/src/components/admin/ProviderManagement.tsx`
**Route**: `app/src/app/admin/providers/page.tsx`
**Tests**: `tests/components/admin/ProviderManagement.test.tsx`

**Description**: Admin page for managing enrichment provider configurations, viewing health status, and monitoring costs.

**Component Specification**:
```typescript
interface ProviderConfig {
  id: string;
  name: string;                  // 'pdl' | 'lusha' | 'theirstack' | 'apollo' | 'crunchbase' | 'builtwith'
  displayName: string;
  enabled: boolean;
  apiKey: string;                // masked: '****...last4'
  balance: number | null;
  costPerCredit: number;
  rateLimitPerMinute: number;
  healthStatus: 'active' | 'inactive' | 'error' | 'rate_limited';
  lastSuccess: string | null;
  lastError: string | null;
  totalCalls: number;
  totalCost: number;
  successRate: number;           // 0-1
}
```

**Sub-tasks**:
- [ ] Implement provider card grid (one card per provider, 3-column layout on desktop)
- [ ] Each card shows: provider name, health status badge (green/yellow/red), enabled/disabled toggle
- [ ] API key field: masked display, "Edit" button reveals input field, "Test" button verifies key with provider
- [ ] Balance display (for per-call providers) or subscription status (for subscription providers)
- [ ] Cost-per-credit display and edit
- [ ] Rate limit display and edit
- [ ] Usage stats: total calls, total cost, success rate percentage
- [ ] Last success/error timestamps with relative time ("3 hours ago")
- [ ] Enable/disable toggle: `PUT /api/admin/providers/:id` with `{ enabled: true/false }`
- [ ] "Test Connection" button: `POST /api/admin/providers/:id/test` returns success/error
- [ ] Provider health check refresh button
- [ ] Data source: `GET /api/admin/providers`
- [ ] Write unit tests: card rendering, enable/disable toggle, API key masking, test connection flow

**Acceptance Criteria**:
- All 6 providers displayed with accurate health status
- API keys never shown in full (masked with last 4 characters)
- Enable/disable toggle persists immediately
- Test connection provides clear success/failure feedback
- Usage statistics are accurate and up-to-date

**BR References**: BR-903

---

### Task A2-6: SelectorConfigEditor -- Parser Selector Management

**File**: `app/src/components/admin/SelectorConfigEditor.tsx`
**Route**: `app/src/app/admin/selectors/page.tsx`
**Tests**: `tests/components/admin/SelectorConfigEditor.test.tsx`

**Description**: Admin interface for viewing and editing CSS selector configurations used by the page parser engine. Supports version history and re-parse triggering.

**Component Specification**:
```typescript
interface SelectorConfig {
  id: string;
  pageType: 'profile' | 'search' | 'feed' | 'company';
  version: number;
  selectors: Record<string, string>;   // field name -> CSS selector
  createdAt: string;
  updatedAt: string;
  active: boolean;
}
```

**Sub-tasks**:
- [ ] Implement page type tabs: Profile, Search, Feed, Company
- [ ] For each page type, display current selector config as an editable key-value table
- [ ] Each row: field name (read-only), CSS selector (editable textarea), test result indicator
- [ ] "Test Selectors" button: run selectors against a sample cached page and show match counts
- [ ] Version history sidebar: list previous versions with timestamps, allow reverting
- [ ] "Save New Version" button: creates a new version (does not overwrite), sets as active
- [ ] "Trigger Re-Parse" button: `POST /api/admin/reparse` with `{ pageType, version }`
  - Shows confirmation: "This will re-parse X cached pages of type Y"
  - Progress indicator while re-parse job runs
- [ ] Re-parse job status: `GET /api/admin/reparse-status` polled during active jobs
- [ ] Display re-parse results: contacts updated, fields changed, errors
- [ ] Data source: `GET /api/admin/selectors`, `PUT /api/admin/selectors/:id`, `POST /api/admin/selectors`
- [ ] Write unit tests: selector editing, version save, re-parse trigger, status polling

**Acceptance Criteria**:
- Selectors are editable with syntax highlighting (or monospace font at minimum)
- Testing selectors shows match results against real cached pages
- Version history allows reverting without data loss
- Re-parse job provides progress feedback
- New versions do not break existing parse results

**BR References**: BR-909

---

### Task A3-1: ImportWizard -- 4-Step Import Flow

**Files**:
- `app/src/components/import/ImportWizard.tsx`
- `app/src/components/import/CsvUploader.tsx`
- `app/src/components/import/FieldMapper.tsx`
- `app/src/components/import/ImportProgress.tsx`
- `app/src/components/import/ImportSummary.tsx`
**Route**: `app/src/app/import/page.tsx`
**Tests**: `tests/components/import/ImportWizard.test.tsx`

**Description**: Full 4-step import wizard for CSV files with drag-and-drop upload, intelligent field mapping, real-time cluster formation visualization, and comprehensive summary.

---

### Task A3-1a: Step 1 -- CsvUploader

**File**: `app/src/components/import/CsvUploader.tsx`
**Tests**: `tests/components/import/CsvUploader.test.tsx`

**Component Specification**:
```typescript
interface CsvUploaderProps {
  onFileSelected: (file: File, preview: string[][]) => void;
  onNext: () => void;
}
```

**Sub-tasks**:
- [ ] Implement drag-and-drop zone with shadcn/ui `Card` and visual feedback (dashed border, icon change on drag)
- [ ] "Or click to browse" file picker button
- [ ] Accept only `.csv` files (MIME type and extension validation)
- [ ] LinkedIn export instructions panel:
  - "How to export your LinkedIn connections:"
  - Step-by-step with screenshots: Settings > Data Privacy > Get a copy of your data > Connections
  - Note about 2-line preamble in LinkedIn CSV format
- [ ] Preview first 5 rows of uploaded CSV in a table
- [ ] Detect encoding (UTF-8, UTF-16) and handle BOM
- [ ] File size validation: max 50MB
- [ ] "Next" button (enabled after valid file selected)
- [ ] Write unit tests: file drop, file type validation, preview rendering, size limit

**Acceptance Criteria**:
- Drag-and-drop works with visual feedback
- Invalid file types are rejected with clear error message
- CSV preview shows actual data from the file
- LinkedIn export instructions are clear and complete
- Large file (>50MB) shows warning

**BR References**: BR-101, BR-102

---

### Task A3-1b: Step 2 -- FieldMapper

**File**: `app/src/components/import/FieldMapper.tsx`
**Tests**: `tests/components/import/FieldMapper.test.tsx`

**Component Specification**:
```typescript
interface FieldMapperProps {
  csvHeaders: string[];
  sampleRows: string[][];        // first 3 rows for preview
  onMappingConfirmed: (mapping: Record<string, string>) => void;
  onBack: () => void;
  onNext: () => void;
}

// Standard LinkedIn CSV fields
const LINKEDIN_FIELDS = [
  'firstName', 'lastName', 'emailAddress', 'company',
  'position', 'connectedOn', 'url'
] as const;
```

**Sub-tasks**:
- [ ] Display CSV columns with sample data (first 3 rows) in a mapping table
- [ ] Auto-detect mapping: match CSV headers to known LinkedIn field names (case-insensitive, common variations)
  - "First Name" -> firstName, "Last Name" -> lastName, "Email Address" -> emailAddress
  - "Company" -> company, "Position" -> position, "Connected On" -> connectedOn
  - "URL" | "Profile URL" -> url
- [ ] Editable dropdown per CSV column: select which system field it maps to, or "Skip this column"
- [ ] Highlight unmapped required fields (firstName, lastName are required)
- [ ] Show mapping confidence indicator: green (auto-matched), yellow (guess), red (unmapped required)
- [ ] "Back" and "Next" buttons; Next disabled if required fields unmapped
- [ ] Write unit tests: auto-detection accuracy, manual override, required field validation

**Acceptance Criteria**:
- Auto-detection correctly maps standard LinkedIn CSV headers
- User can override any auto-detected mapping
- Required fields (firstName, lastName) must be mapped before proceeding
- Sample data preview helps user validate mapping choices

**BR References**: BR-103, BR-104

---

### Task A3-1c: Step 3 -- ImportProgress

**File**: `app/src/components/import/ImportProgress.tsx`
**Tests**: `tests/components/import/ImportProgress.test.tsx`

**Component Specification**:
```typescript
interface ImportProgressProps {
  file: File;
  mapping: Record<string, string>;
  onComplete: (result: ImportResult) => void;
  onBack: () => void;
}

interface ImportResult {
  totalRows: number;
  importedContacts: number;
  duplicatesSkipped: number;
  errors: number;
  clusters: ImportCluster[];
  icpsDetected: string[];
  goalsCreated: string[];
}
```

**Sub-tasks**:
- [ ] Initiate import via `POST /api/import` with file and mapping
- [ ] Display progress bar: "Importing contacts... (42 of 150)"
- [ ] Below progress bar, render `ImportProgressVisualization` (visx Pack layout from Task A1-4) showing clusters forming in real-time
- [ ] Progressive Claude questions section (after first batch imported):
  - "I see 42 contacts in AI/ML roles. Is this important to you?" [Yes/No/Skip]
  - "You have 15 contacts at Series A startups. Should I prioritize these?" [Yes/No/Skip]
  - "I notice 8 contacts in your same city. Factor in proximity?" [Yes/No/Skip]
  - Questions are generated by Claude based on imported data patterns
  - Answers feed into ICP/scoring weight adjustment
- [ ] Stream import progress via Server-Sent Events or polling (`GET /api/import/:id/progress`)
- [ ] Phase indicators: "Importing..." -> "Detecting clusters..." -> "Computing scores..." -> "Generating goals..."
- [ ] Error handling: display row-level errors inline without blocking the import
- [ ] Write unit tests: progress updates, cluster visualization integration, Claude question rendering, error display

**Acceptance Criteria**:
- Progress bar updates in real-time as contacts are imported
- Cluster visualization shows clusters forming
- Claude questions appear after initial batch and influence scoring
- Errors are reported per-row without blocking the overall import
- All phases complete and transition to summary

**BR References**: BR-105, BR-106, BR-107, BR-108

---

### Task A3-1d: Step 4 -- ImportSummary

**File**: `app/src/components/import/ImportSummary.tsx`
**Tests**: `tests/components/import/ImportSummary.test.tsx`

**Component Specification**:
```typescript
interface ImportSummaryProps {
  result: ImportResult;
}
```

**Sub-tasks**:
- [ ] Display import statistics in a summary card grid:
  - Contacts imported (with icon)
  - Duplicates skipped (with explanation)
  - Clusters discovered (with list)
  - ICPs identified (with names)
  - Goals created (with titles)
  - Errors encountered (with expand-to-view)
- [ ] CTA buttons:
  - "View Contacts" -> `/contacts` (primary)
  - "Explore Network Graph" -> `/network`
  - "Review Goals" -> `/goals`
  - "Import More Data" -> restart wizard
- [ ] If errors > 0, show expandable error log with row number and error message
- [ ] Celebration animation (subtle confetti or checkmark animation) on successful import
- [ ] Write unit tests: summary card values, CTA button links, error display, zero-error state

**Acceptance Criteria**:
- Summary accurately reflects import results
- CTA buttons navigate to correct routes
- Error details are accessible but not overwhelming
- Celebration only shows on fully successful imports (errors = 0)

**BR References**: BR-109, BR-110, BR-111, BR-112

---

### Task A4-1: System Health Dashboard

**File**: `app/src/components/admin/SystemHealth.tsx`
**Route**: `app/src/app/admin/health/page.tsx`
**Tests**: `tests/components/admin/SystemHealth.test.tsx`

**Description**: Visual dashboard showing real-time system component health.

**Sub-tasks**:
- [ ] Implement health status cards for each component: Database, Extension, each Enrichment Provider, Background Jobs
- [ ] Each card shows: status badge (green/yellow/red), last check time, key metrics
- [ ] Database card: connection pool stats, disk usage bar, latency gauge
- [ ] Extension card: connected/disconnected status, last seen time, active WebSocket count, 24h capture count
- [ ] Provider cards: one per provider with health status, remaining budget, success rate, last error
- [ ] Background jobs card: queue depths for reparse, enrichment, scoring
- [ ] Overall system status banner: "All systems operational" / "Degraded performance" / "System issues detected"
- [ ] Auto-refresh every 30 seconds via SWR with `refreshInterval: 30000`
- [ ] Data source: `GET /api/admin/health`
- [ ] Write unit tests: all-healthy rendering, degraded state, component-level error display

**Acceptance Criteria**:
- Health dashboard loads within 1 second
- Status badges accurately reflect component health
- Auto-refresh keeps data current without manual intervention
- Degraded/unhealthy states are clearly visually distinguished

**BR References**: BR-905

---

### Task A4-2: Extension Management Page

**File**: `app/src/components/admin/ExtensionManagement.tsx`
**Route**: `app/src/app/admin/extension/page.tsx`
**Tests**: `tests/components/admin/ExtensionManagement.test.tsx`

**Description**: Page for managing the Chrome extension connection, viewing sync status, and configuring extension preferences from the app side.

**Sub-tasks**:
- [ ] Extension connection status card: connected/disconnected, last sync time, capture count today
- [ ] Registered tokens table: token ID (masked), created date, last used, revoke button
- [ ] Capture history: last 50 captures with timestamp, URL, page type, parse status
- [ ] Sync preferences: configure which page types to auto-parse, capture retention days
- [ ] "Re-register Extension" button: generates new registration token with QR code / paste-able token
- [ ] WebSocket connection status indicator
- [ ] Data source: various extension-related endpoints
- [ ] Write unit tests: status display, token list, capture history, preferences form

**Acceptance Criteria**:
- Extension status accurately reflects real-time connection state
- Token management allows revoking compromised tokens
- Capture history provides debugging visibility
- Preferences are saved and applied to extension behavior

---

### Task A4-3: CSV Export of Enriched Contacts

**File**: `app/src/app/api/contacts/export/route.ts`
**UI Component**: `app/src/components/contacts/ExportButton.tsx`
**Tests**: `tests/api/contacts-export.test.ts`, `tests/components/contacts/ExportButton.test.tsx`

**Description**: Export enriched contacts as CSV with configurable column selection and filters.

**Sub-tasks**:
- [ ] Implement `GET /api/contacts/export` endpoint returning CSV with `Content-Type: text/csv`
- [ ] Query parameters for filtering: `tier`, `cluster_id`, `niche_id`, `min_score`, `search`
- [ ] Configurable columns via `fields` query parameter (comma-separated):
  - Default: firstName, lastName, email, company, title, tier, goldScore, connectedOn
  - Extended: + phone, headline, about, skills, clusterName, nicheName, pageRank, enrichmentSources
- [ ] Generate CSV with proper escaping (fields containing commas, quotes, newlines)
- [ ] Add BOM for Excel compatibility
- [ ] Set `Content-Disposition: attachment; filename="contacts-export-{date}.csv"`
- [ ] Implement ExportButton component: dropdown with "Export Current View" and "Export All", plus column selection popover
- [ ] Rate limit: max 10 exports per hour
- [ ] Write unit tests: CSV generation, field escaping, filter application, column selection, rate limiting

**Acceptance Criteria**:
- CSV opens correctly in Excel, Google Sheets, and Numbers
- Filters match what is displayed in the contacts table
- Column selection allows customization
- Large exports (5000+ contacts) complete within 10 seconds
- Rate limiting prevents abuse

**BR References**: BR-209

---

### Task A4-4: Contact Outreach Tab Deep Link

**File**: `app/src/app/contacts/[slug]/outreach/page.tsx`
**Tests**: `tests/app/contacts-outreach.test.tsx`

**Description**: Deep-linkable route for the contact outreach tab, enabling direct navigation from extension and task links.

**Sub-tasks**:
- [ ] Create route `app/src/app/contacts/[slug]/outreach/page.tsx`
- [ ] Route renders Contact Detail page with Outreach tab pre-selected
- [ ] Outreach tab shows: current outreach state, template selector, message history, state transitions
- [ ] Handle case where contact has no outreach state (show "Start Outreach" CTA)
- [ ] Integrate with outreach state machine from Phase 5
- [ ] Write unit tests: route rendering, tab pre-selection, no-outreach empty state

**Acceptance Criteria**:
- `/contacts/john-doe/outreach` renders contact detail with outreach tab active
- Extension can link directly to this route for outreach tasks
- Tab content matches what Phase 5 outreach tab renders

---

### Task A5-1: Security Audit of Client-Side Code

**Files**: All `app/src/components/**/*.tsx`, `app/src/app/**/*.tsx`
**Tests**: `tests/security/client-security.test.ts`

**Description**: Comprehensive security review of all client-side code.

**Sub-tasks**:
- [ ] Audit all `dangerouslySetInnerHTML` usage: ensure all HTML is sanitized via DOMPurify before rendering
- [ ] Verify no user input is rendered without escaping (React handles this by default, but check edge cases)
- [ ] Review all `window.location`, `window.open` calls for open redirect vulnerabilities
- [ ] Verify all API calls use relative URLs or validated absolute URLs (no user-controlled URL construction)
- [ ] Check for sensitive data in client-side state: ensure API keys, tokens are not stored in React state or localStorage
- [ ] Verify CSP meta tags in `app/src/app/layout.tsx`: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">`
- [ ] Ensure no inline scripts or eval() calls
- [ ] Review third-party library CSP compatibility (Recharts, visx, reagraph)
- [ ] Write security tests: XSS payload rendering, redirect prevention, CSP compliance

**Acceptance Criteria**:
- Zero dangerouslySetInnerHTML without sanitization
- No open redirect vulnerabilities
- No sensitive data in client-side storage
- CSP headers prevent script injection
- All third-party libraries are CSP-compatible

---

### Task A5-2: Loading and Empty States Audit

**Files**: All page and component files across the app
**Tests**: `tests/components/states.test.tsx`

**Description**: Ensure every page and async component has proper loading states and empty states.

**Sub-tasks**:
- [ ] Audit all pages for loading states: ensure SWR `isLoading` renders a skeleton or spinner
- [ ] Implement consistent loading skeleton components for:
  - Table loading (shimmer rows)
  - Card loading (shimmer rectangles)
  - Chart loading (shimmer chart shape)
  - Detail page loading (shimmer layout)
- [ ] Audit all pages for empty states: ensure empty data renders helpful messages, not blank space
- [ ] Implement consistent empty state components with:
  - Descriptive message ("No contacts found")
  - Suggested action ("Import contacts to get started")
  - Action button linking to the relevant feature
- [ ] Ensure error states show user-friendly messages (not raw error objects)
- [ ] Add error boundaries at route level to catch render errors gracefully
- [ ] Specific empty states needed:
  - No contacts: "Import your LinkedIn connections to get started" -> `/import`
  - No goals: "Let Claude analyze your network and suggest goals" -> `/goals/new`
  - No tasks: "Goals generate tasks automatically. Create a goal first." -> `/goals`
  - No templates: "Create your first outreach template" -> `/outreach/templates/new`
  - No enrichments: "Configure providers to enrich your contacts" -> `/admin/providers`
  - No graph data: "Import contacts to build your network graph" -> `/import`
- [ ] Write unit tests: loading state rendering, empty state rendering, error boundary catches

**Acceptance Criteria**:
- Every async data load shows a loading state
- Every empty data state shows a helpful message with action
- No blank pages or sections when data is empty
- Error boundaries prevent white-screen crashes
- Loading skeletons match the layout of the loaded content

---

## Orchestrator Instructions

### Execution Strategy

1. **Spawn 5 agents** (A1-A5) in parallel at phase start
2. All agents can work independently with mock data while Phase 6 Backend APIs are being built
3. Agent A1 (Visualizations): Focus on completing the remaining 5 charts. Can work entirely independently.
4. Agent A2 (Admin): Start with AdminContent layout, then build sub-panels. Mock admin API responses initially.
5. Agent A3 (Import): Build wizard step-by-step. Import API exists from Phase 1. Claude integration depends on Phase 5.
6. Agent A4 (Utilities): System health and extension management depend on admin APIs (mock initially). CSV export is independent.
7. Agent A5 (Security + Polish): Start with loading/empty states audit (no API dependency). Security audit runs over all completed code.

### Integration Points

When Phase 6 Backend APIs land:
- A2 switches from mock to real admin API data
- A4 switches from mock to real health/extension data
- A1/A3 have no backend dependency changes

### Shared Component Patterns

All new components must follow these patterns:

```typescript
// Standard component with SWR
'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { Skeleton } from '@/components/ui/skeleton';

export function MyComponent() {
  const { data, error, isLoading } = useSWR('/api/endpoint', fetcher);

  if (isLoading) return <MyComponentSkeleton />;
  if (error) return <ErrorState message="Failed to load data" />;
  if (!data || data.length === 0) return <EmptyState message="No data yet" action={{ label: 'Get started', href: '/import' }} />;

  return (/* ... */);
}
```

```typescript
// Visualization component pattern
interface ChartProps {
  data: DataType[];
  width?: number;
  height?: number;
}

export function MyChart({ data, width, height = 300 }: ChartProps) {
  if (!data.length) return <EmptyState message="No data to visualize" />;

  return (
    <ResponsiveContainer width={width || '100%'} height={height}>
      {/* Chart implementation */}
    </ResponsiveContainer>
  );
}
```

### Testing Requirements

For each component, write tests covering:
- Renders correctly with sample data
- Loading state renders skeleton
- Empty state renders helpful message with action
- Error state renders error message
- Interactive elements (buttons, toggles, dropdowns) function correctly
- Responsive layout (mobile and desktop)
- Accessibility: keyboard navigation, ARIA labels

Test files:
- `tests/components/visualizations/ActivityTimelineScatter.test.tsx`
- `tests/components/visualizations/OutreachSequenceTree.test.tsx`
- `tests/components/visualizations/ScoreDimensionParallelCoordinates.test.tsx`
- `tests/components/visualizations/ImportProgressVisualization.test.tsx`
- `tests/components/visualizations/EngagementHeatmap.test.tsx`
- `tests/components/admin/AdminContent.test.tsx`
- `tests/components/admin/ScoringPanel.test.tsx`
- `tests/components/admin/RvfTraining.test.tsx`
- `tests/components/admin/DataPurgePanel.test.tsx`
- `tests/components/admin/ProviderManagement.test.tsx`
- `tests/components/admin/SelectorConfigEditor.test.tsx`
- `tests/components/admin/SystemHealth.test.tsx`
- `tests/components/admin/ExtensionManagement.test.tsx`
- `tests/components/import/ImportWizard.test.tsx`
- `tests/components/import/CsvUploader.test.tsx`
- `tests/components/import/FieldMapper.test.tsx`
- `tests/components/import/ImportProgress.test.tsx`
- `tests/components/import/ImportSummary.test.tsx`
- `tests/components/contacts/ExportButton.test.tsx`
- `tests/api/contacts-export.test.ts`
- `tests/app/contacts-outreach.test.tsx`
- `tests/security/client-security.test.ts`
- `tests/components/states.test.tsx`

---

## Dependencies

### Upstream (required before this work)

| Dependency | Source | Status |
|---|---|---|
| All Phase 3 UI pages operational | Phase 3 App | Must pass Phase 3 gate |
| Recharts and visx installed and configured | Phase 3 App | Must pass Phase 3 gate |
| shadcn/ui component library | Phase 1 App | Must pass Phase 1 gate |
| SWR data fetching | Phase 1 App | Must pass Phase 1 gate |
| CSV import pipeline | Phase 1 Backend | Must pass Phase 1 gate |
| Scoring engine with weight management | Phase 2 Backend | Must pass Phase 2 gate |
| Enrichment waterfall and providers | Phase 2 Backend | Must pass Phase 2 gate |
| Claude API integration | Phase 5 Backend/App | Must pass Phase 5 gate |
| Outreach template system | Phase 5 App | Must pass Phase 5 gate |
| Page parser engine | Phase 4 App | Must pass Phase 4 gate |
| Phase 6 Backend admin APIs | Phase 6 Backend | Concurrent -- mock until available |

### Downstream (blocks these)

| Dependent | Domain | Blocked Tasks |
|---|---|---|
| Extension settings (Agent E1) | Extension | Extension settings link to app admin pages |
| Final integration testing | QA | All UI must be complete for end-to-end testing |

### Mitigation

All app agents begin with mock data matching the response shapes from Phase 6 Backend. When backend endpoints land (expected within first week of phase), agents switch to real API calls. The visualization agent (A1) has no backend dependency -- chart data comes from already-existing Phase 2-5 endpoints. The import wizard (A3) uses the Phase 1 import API and Phase 5 Claude API, both already available.

---

## Gate Criteria

All of the following must pass before Phase 6 App is considered complete:

### Visualizations
- [ ] ActivityTimelineScatter renders on Contact Detail Activity tab with real observation data
- [ ] OutreachSequenceTree renders on /outreach/templates with real sequence data
- [ ] ScoreDimensionParallelCoordinates renders on Contact Detail and Admin with real scoring data
- [ ] ImportProgressVisualization renders during import wizard step 3 with real cluster data
- [ ] EngagementHeatmap renders on Contact Detail Activity tab with real activity data
- [ ] All 5 new visualizations have loading, empty, and error states

### Admin Panel
- [ ] Admin page accessible via sidebar navigation at /admin
- [ ] ScoringPanel: weight sliders sum to 1.0, normalize works, score preview shows before/after
- [ ] ScoringPanel: named profiles save/load/delete correctly
- [ ] ScoringPanel: tier thresholds validate and persist
- [ ] RvfTraining: pairwise comparison interface records selections, progress counter works
- [ ] RvfTraining: auto-adjust gated behind 200 comparison minimum
- [ ] DataPurgePanel: preview shows accurate counts, execute requires typing "PURGE"
- [ ] ProviderManagement: all 6 providers displayed with health status, API key masking works
- [ ] SelectorConfigEditor: selectors editable, version history works, re-parse triggers

### Import Wizard
- [ ] Step 1 (CsvUploader): drag-and-drop works, file validation works, preview shows data
- [ ] Step 2 (FieldMapper): auto-detection maps LinkedIn fields, manual override works
- [ ] Step 3 (ImportProgress): progress bar updates, cluster visualization renders, Claude questions appear
- [ ] Step 4 (ImportSummary): statistics accurate, CTA buttons navigate correctly

### Utilities
- [ ] System health dashboard renders all component statuses with auto-refresh
- [ ] Extension management page shows connection status and token management
- [ ] CSV export downloads valid CSV file with selected columns and filters
- [ ] Contact outreach deep link (/contacts/[slug]/outreach) renders correctly

### Security + Polish
- [ ] Zero dangerouslySetInnerHTML without sanitization across all components
- [ ] CSP meta tags present in layout
- [ ] Every page has loading state (skeleton), empty state (message + action), and error state
- [ ] Error boundaries at route level prevent white-screen crashes

### Quality
- [ ] All component tests pass (`npm test`)
- [ ] No lint errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] All pages load within performance targets (< 500ms initial load, < 200ms subsequent navigation)

### Production Readiness
- [ ] All 20 Recharts + visx + reagraph visualizations render with real data (15 existing + 5 new)
- [ ] Admin panel fully functional with real backend APIs
- [ ] Import wizard completes full flow end-to-end
- [ ] No console errors or warnings in production build
- [ ] Responsive layout works on 1024px+ screens
- [ ] All interactive elements have keyboard navigation support
- [ ] ARIA labels present on all form elements and interactive components
