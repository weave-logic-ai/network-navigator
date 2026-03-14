# Phase 2: Core Engine -- App Plan

## Objective

Integrate Phase 2 backend capabilities into the Next.js app frontend. By the end of Phase 2 app work, users can see gold_score and tier badges in the contacts table, inspect the full scoring math via a hover popover, view enrichment provider status, and browse ICP/niche lists. This is a "data display" phase for the app -- full interactive UI (dashboards, detailed pages, graph visualization) comes in Phase 3.

## Prerequisites (Phase 1 App + Phase 2 Backend Deliverables Required)

| Prerequisite | Source | Verification |
|---|---|---|
| Next.js 15 app with App Router running at localhost:3000 | Phase 1 App | `curl http://localhost:3000` returns HTML |
| shadcn/ui + Tailwind CSS 4 configured | Phase 1 App | Components render with correct styles |
| Sidebar navigation operational | Phase 1 App | Sidebar links navigate between pages |
| Contacts table page with basic columns | Phase 1 App | `/contacts` page renders table with data |
| SWR data fetching setup | Phase 1 App | `useSWR` hooks fetch from API routes |
| Scoring API routes operational | Phase 2 Backend | `GET /api/scoring/weights` returns data |
| Enrichment API routes operational | Phase 2 Backend | `GET /api/enrichment/providers` returns data |
| ICP API routes operational | Phase 2 Backend | `GET /api/icps` returns data |
| Graph API routes operational | Phase 2 Backend | `GET /api/graph/metrics` returns data |

---

## Parallel Agent Assignments

| Agent | Role | Focus Area | Files | Estimated Effort |
|---|---|---|---|---|
| Agent 1 | Score UI Developer | Score display in contacts table, score math popover | `src/components/scoring/**`, contacts table updates | Heavy (45%) |
| Agent 2 | Enrichment UI Developer | Enrichment page shell, provider status cards | `src/app/(dashboard)/enrichment/**`, `src/components/enrichment/**` | Medium (30%) |
| Agent 3 | ICP UI Developer | ICP/niche list view, basic ICP switching | `src/app/(dashboard)/icps/**`, `src/components/icp/**` | Light (25%) |

### Dependency Graph

```
Phase 2 Backend (all API routes) ──> Agent 1 (Score UI)
                                 ──> Agent 2 (Enrichment UI)
                                 ──> Agent 3 (ICP UI)

Agent 1 ──> no dependency on Agent 2 or 3
Agent 2 ──> no dependency on Agent 1 or 3
Agent 3 ──> no dependency on Agent 1 or 2
```

All three agents can work fully in parallel once Phase 2 backend APIs are available. Agents may begin work before backend is complete by using mock data / SWR fallback values.

---

## Detailed Task Checklist

### Agent 1: Score UI

#### Task 1.1: SWR Hooks for Scoring (BR-401)

**File**: `src/hooks/use-scoring.ts`

**Description**: SWR hooks for all scoring-related API endpoints.

```typescript
// Hook signatures
function useScoringWeights(): SWRResponse<WeightProfile>;
function useScoringWeightProfiles(): SWRResponse<WeightProfile[]>;
function useScoringTiers(): SWRResponse<TierThresholds>;
function useScoringDistribution(): SWRResponse<DistributionBucket[]>;
function useContactScore(contactId: string): SWRResponse<CompositeResult>;

interface DistributionBucket {
  rangeStart: number;  // 0, 10, 20, ...
  rangeEnd: number;    // 10, 20, 30, ...
  count: number;
  tier: 'gold' | 'silver' | 'bronze' | 'unscored';
}
```

**Sub-tasks**:
- [ ] `useScoringWeights()`: fetches `GET /api/scoring/weights`, returns active weight profile
- [ ] `useScoringWeightProfiles()`: fetches `GET /api/scoring/weight-profiles`, returns all profiles
- [ ] `useScoringTiers()`: fetches `GET /api/scoring/tiers`, returns tier thresholds
- [ ] `useScoringDistribution()`: fetches `GET /api/scoring/distribution`, returns histogram buckets
- [ ] `useContactScore(contactId)`: fetches contact-specific score breakdown
- [ ] `mutateRunScoring()`: POST to `/api/scoring/run`, triggers SWR revalidation
- [ ] All hooks use SWR `revalidateOnFocus: false` to avoid excessive API calls
- [ ] Write unit tests: `tests/hooks/use-scoring.test.ts`

**Acceptance Criteria**:
- Hooks return data, loading, and error states correctly
- Mutation triggers revalidation of dependent hooks
- No unnecessary re-fetches on component re-render

---

#### Task 1.2: Gold Score Column in Contacts Table (BR-401, BR-415)

**File**: `src/components/contacts/columns.tsx` (modify existing)

**Description**: Add a `gold_score` column to the contacts table with gradient coloring and tier badge.

**Sub-tasks**:
- [ ] Add `gold_score` column definition to the existing table column configuration
- [ ] Score cell renderer:
  - Display numeric score (0-100) with 1 decimal place
  - Background gradient: red (0) -> yellow (50) -> green (100) using CSS `linear-gradient`
  - Gradient opacity: 15% background, full color on text
- [ ] Tier badge renderer:
  - Gold tier: amber badge with trophy icon
  - Silver tier: slate badge with medal icon
  - Bronze tier: orange badge with circle icon
  - Unscored: gray badge with dash
- [ ] Column sortable by `gold_score` (descending default)
- [ ] Column filterable by tier (dropdown: All, Gold, Silver, Bronze, Unscored)
- [ ] Handle null scores (contacts not yet scored): show "Not scored" with muted styling
- [ ] Write unit tests: `tests/components/contacts/score-column.test.ts`

**Acceptance Criteria**:
- Score column renders with color gradient reflecting score value
- Tier badge displays correct tier with appropriate icon and color
- Column sorts contacts by score
- Filter by tier works correctly
- Unscored contacts show "Not scored" state

---

#### Task 1.3: Score Math Popover (BR-401, BR-402, BR-416)

**File**: `src/components/scoring/score-math-popover.tsx`

**Description**: A popover component that appears on hover/click over a contact's score, showing the full dimension breakdown with weights.

```typescript
interface ScoreMathPopoverProps {
  contactId: string;
  goldScore: number;
  tier: string;
  trigger: React.ReactNode; // the element that triggers the popover
}
```

**Sub-tasks**:
- [ ] Create `ScoreMathPopover` component using shadcn/ui `Popover`
- [ ] Fetch dimension breakdown via `useContactScore(contactId)` hook
- [ ] Display each dimension as a row:
  - Dimension name (e.g., "ICP Fit")
  - Raw score (0.00 - 1.00) with horizontal bar visualization
  - Weight (e.g., "22%")
  - Effective weight (after null-safe redistribution, if different from base weight)
  - Weighted contribution (rawScore * effectiveWeight, shown as portion of total)
  - Confidence indicator: full dot (>= 0.5), half dot (0.1-0.49), empty dot (< 0.1)
- [ ] Dimensions sorted by weighted contribution (highest first)
- [ ] Total row showing `gold_score` and tier assignment
- [ ] Persona badge showing both business and behavioral persona
- [ ] Visual: stacked bar showing how each dimension contributes to the total
- [ ] Loading state: skeleton loader while fetching
- [ ] Write unit tests: `tests/components/scoring/score-math-popover.test.ts`

**Acceptance Criteria**:
- Popover opens on hover (desktop) or click (touch)
- All 9 dimensions displayed with correct values
- Weighted contributions sum to displayed `gold_score`
- Null-safe redistributed weights shown when applicable
- Stacked bar visually represents each dimension's contribution

---

#### Task 1.4: Score Column Integration with Table (BR-401)

**File**: `src/app/(dashboard)/contacts/page.tsx` (modify existing)

**Description**: Wire up score column and popover into the existing contacts table page.

**Sub-tasks**:
- [ ] Import and register score column in table configuration
- [ ] Wrap score cell with `ScoreMathPopover` as trigger
- [ ] Add "Run Scoring" action button to page header (calls `POST /api/scoring/run`)
- [ ] Show scoring status indicator (last scored timestamp, or "Never scored")
- [ ] Add score distribution mini-chart in page header area (sparkline showing tier distribution)
- [ ] Write integration test: `tests/app/contacts-scoring.test.ts`

**Acceptance Criteria**:
- Contacts table displays score column with popover
- "Run Scoring" button triggers scoring and shows progress
- Score distribution sparkline updates after scoring completes

---

### Agent 2: Enrichment UI

#### Task 2.1: SWR Hooks for Enrichment (BR-301)

**File**: `src/hooks/use-enrichment.ts`

**Description**: SWR hooks for enrichment-related API endpoints.

```typescript
function useEnrichmentProviders(): SWRResponse<EnrichmentProviderStatus[]>;
function useEnrichmentBudget(): SWRResponse<BudgetPeriod>;
function useEnrichmentTransactions(limit?: number): SWRResponse<EnrichmentTransaction[]>;
function useEnrichmentROI(): SWRResponse<EnrichmentROI>;

interface EnrichmentProviderStatus {
  id: string;
  displayName: string;
  configured: boolean;
  enabled: boolean;
  creditsRemaining: number | null;
  costPerCall: { min: number; max: number };
  supportedFields: string[];
  priority: number;
}
```

**Sub-tasks**:
- [ ] `useEnrichmentProviders()`: fetches `GET /api/enrichment/providers`
- [ ] `useEnrichmentBudget()`: fetches `GET /api/enrichment/budget`
- [ ] `useEnrichmentTransactions()`: fetches `GET /api/enrichment/transactions` with pagination
- [ ] `useEnrichmentROI()`: fetches `GET /api/enrichment/roi`
- [ ] `mutateEnrichContact(contactId)`: POST to `/api/contacts/:id/enrich`
- [ ] `mutateEstimateCost(contactIds, fields)`: POST to `/api/enrichment/estimate`
- [ ] Write unit tests: `tests/hooks/use-enrichment.test.ts`

**Acceptance Criteria**:
- All hooks return proper data/loading/error states
- Provider status includes configuration and credit information
- Budget hook returns current period spend data

---

#### Task 2.2: Enrichment Page Layout (BR-301, BR-302)

**File**: `src/app/(dashboard)/enrichment/page.tsx`

**Description**: Basic enrichment management page -- a shell layout for Phase 2 that will be fully built out in Phase 3.

**Sub-tasks**:
- [ ] Create page route at `/enrichment`
- [ ] Add "Enrichment" link to sidebar navigation
- [ ] Page layout with three sections:
  1. **Provider Status** (top) -- grid of provider cards
  2. **Budget Overview** (middle) -- budget period with spend bar
  3. **Recent Transactions** (bottom) -- simple table of last 20 transactions
- [ ] Page header with title "Enrichment" and subtitle showing total contacts enriched
- [ ] Write unit tests: `tests/app/enrichment-page.test.ts`

**Acceptance Criteria**:
- Page renders at `/enrichment` route
- Sidebar navigation includes Enrichment link
- Three sections load data from API (or show empty states)
- Page renders correctly with zero enrichment data

---

#### Task 2.3: Provider Status Cards (BR-302, BR-303, BR-304, BR-305)

**File**: `src/components/enrichment/provider-card.tsx`

**Description**: Card component for each enrichment provider showing its configuration and status.

```typescript
interface ProviderCardProps {
  provider: EnrichmentProviderStatus;
  onToggleEnabled: (id: string, enabled: boolean) => void;
}
```

**Sub-tasks**:
- [ ] Create `ProviderCard` component using shadcn/ui `Card`
- [ ] Display provider name, logo placeholder (icon based on provider ID)
- [ ] Configuration status indicator:
  - Configured + Enabled: green dot, "Active"
  - Configured + Disabled: yellow dot, "Disabled"
  - Not Configured: red dot, "Not configured"
- [ ] Credits remaining display (if available from provider API)
- [ ] Cost per call display (range: "$0.22 - $0.28")
- [ ] Supported fields list (tags: "email", "phone", "work history", etc.)
- [ ] Enable/disable toggle switch
- [ ] Priority badge (1st, 2nd, 3rd in waterfall order)
- [ ] Grid layout: 3 cards per row on desktop, 1 per row on mobile
- [ ] Write unit tests: `tests/components/enrichment/provider-card.test.ts`

**Acceptance Criteria**:
- Card renders provider information correctly for all three states
- Toggle switch calls `onToggleEnabled` handler
- Responsive layout: 3 columns on desktop, 1 on mobile
- Cost displayed with currency formatting

---

#### Task 2.4: Budget Overview Component (BR-308, BR-309)

**File**: `src/components/enrichment/budget-overview.tsx`

**Description**: Component showing current budget period spend vs. cap with visual progress bar.

```typescript
interface BudgetOverviewProps {
  budget: BudgetPeriod;
}
```

**Sub-tasks**:
- [ ] Create `BudgetOverview` component using shadcn/ui `Card` + `Progress`
- [ ] Display current period type (Daily / Weekly / Monthly)
- [ ] Progress bar: `currentSpend / budgetCap` as percentage
  - Green: < 60%
  - Yellow: 60% - 80%
  - Red: > 80%
- [ ] Dollar amount display: "$X.XX / $Y.YY spent"
- [ ] Period date range display: "Mar 1 - Mar 31, 2026"
- [ ] Warning message when > 80% threshold: "Approaching budget limit"
- [ ] Exhausted message when >= 100%: "Budget exhausted -- enrichment paused"
- [ ] Write unit tests: `tests/components/enrichment/budget-overview.test.ts`

**Acceptance Criteria**:
- Progress bar color changes at correct thresholds
- Dollar amounts formatted with 2 decimal places
- Warning message appears at 80%
- Exhausted state clearly communicates that enrichment is blocked

---

#### Task 2.5: Recent Transactions Table (BR-310)

**File**: `src/components/enrichment/transactions-table.tsx`

**Description**: Simple table showing recent enrichment transactions.

**Sub-tasks**:
- [ ] Create `TransactionsTable` component using shadcn/ui `Table`
- [ ] Columns: Date, Contact Name, Provider, Operation, Fields Populated, Cost, Status
- [ ] Date column: relative time ("2 hours ago") with absolute time tooltip
- [ ] Contact Name: link to contact detail page
- [ ] Provider: provider display name with icon
- [ ] Fields Populated: tag chips for each field (e.g., "email", "phone")
- [ ] Cost: "$0.22" with green for success, red for failed
- [ ] Status: check icon for success, X icon for failure
- [ ] Show last 20 transactions (no pagination in Phase 2; full pagination in Phase 3)
- [ ] Empty state: "No enrichment transactions yet"
- [ ] Write unit tests: `tests/components/enrichment/transactions-table.test.ts`

**Acceptance Criteria**:
- Table renders transaction data correctly
- Relative time formatting works
- Empty state shown when no transactions exist
- Cost formatted as currency

---

### Agent 3: ICP UI

#### Task 3.1: SWR Hooks for ICPs (BR-413)

**File**: `src/hooks/use-icps.ts`

**Description**: SWR hooks for ICP and niche API endpoints.

```typescript
function useIcps(): SWRResponse<IcpProfile[]>;
function useIcp(id: string): SWRResponse<IcpProfile>;
function useNiches(): SWRResponse<NicheProfile[]>;
function useWedgeMetrics(): SWRResponse<WedgeMetrics>;

// Mutations
function mutateCreateIcp(profile: Partial<IcpProfile>): Promise<IcpProfile>;
function mutateUpdateIcp(id: string, updates: Partial<IcpProfile>): Promise<IcpProfile>;
function mutateDeleteIcp(id: string): Promise<void>;
function mutateToggleIcpActive(id: string, active: boolean): Promise<void>;
function mutateDiscoverIcps(): Promise<IcpSuggestion[]>;
```

**Sub-tasks**:
- [ ] `useIcps()`: fetches `GET /api/icps`
- [ ] `useIcp(id)`: fetches `GET /api/icps/:id`
- [ ] `useNiches()`: fetches `GET /api/niches`
- [ ] `useWedgeMetrics()`: fetches `GET /api/wedge`
- [ ] Mutation functions for create, update, delete, toggle active
- [ ] `mutateDiscoverIcps()`: POST to `/api/icps/discover`
- [ ] Automatic revalidation after mutations
- [ ] Write unit tests: `tests/hooks/use-icps.test.ts`

**Acceptance Criteria**:
- All hooks return proper data/loading/error states
- Mutations trigger revalidation of ICP list
- Discover mutation returns suggestions array

---

#### Task 3.2: ICP List Page (BR-413)

**File**: `src/app/(dashboard)/icps/page.tsx`

**Description**: Page listing all ICP profiles with active/inactive status and basic management.

**Sub-tasks**:
- [ ] Create page route at `/icps`
- [ ] Add "ICPs" link to sidebar navigation (under a "Strategy" section or similar)
- [ ] Page header with title "Ideal Customer Profiles" and "Create ICP" button
- [ ] ICP cards in a grid layout (2 columns desktop, 1 mobile):
  - ICP name and description
  - Active/inactive badge (green/gray)
  - Key criteria summary: target titles (first 3), target industries (first 3), company size range
  - Contact count: number of contacts matching this ICP
  - Average fit score: mean `icp_fit` score across matched contacts
  - Toggle active/inactive button
  - Edit button (opens simple edit modal -- Phase 2 scope is basic edit only)
  - Delete button with confirmation dialog
- [ ] "Discover ICPs" button that triggers discovery and shows suggestions in a dialog
- [ ] Empty state: "No ICPs defined yet. Create your first ICP or let us discover one from your network."
- [ ] Write unit tests: `tests/app/icps-page.test.ts`

**Acceptance Criteria**:
- Page renders all ICPs as cards in grid layout
- Active/inactive toggle works and updates immediately (optimistic update)
- Delete confirmation prevents accidental deletion
- Empty state renders with actionable message

---

#### Task 3.3: ICP Card Component (BR-413)

**File**: `src/components/icp/icp-card.tsx`

**Description**: Card component for displaying an individual ICP profile.

```typescript
interface IcpCardProps {
  icp: IcpProfile;
  contactCount: number;
  averageFitScore: number;
  onToggleActive: (id: string, active: boolean) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}
```

**Sub-tasks**:
- [ ] Create `IcpCard` component using shadcn/ui `Card`
- [ ] Display ICP name as card title
- [ ] Active badge: green "Active" or gray "Inactive"
- [ ] Criteria tags: up to 3 target titles, industries displayed as tag chips; "+N more" for overflow
- [ ] Company size range: "10 - 500 employees"
- [ ] Stats row: "42 contacts | Avg fit: 0.68"
- [ ] Action buttons: toggle active (switch), edit (pencil icon), delete (trash icon with confirmation)
- [ ] Hover effect: subtle shadow elevation
- [ ] Write unit tests: `tests/components/icp/icp-card.test.ts`

**Acceptance Criteria**:
- Card displays all ICP information in a scannable format
- Criteria tags truncate with "+N more" indicator
- Stats row shows correct count and average
- Actions dispatch correct callbacks

---

#### Task 3.4: ICP Edit Modal (BR-413)

**File**: `src/components/icp/icp-edit-modal.tsx`

**Description**: Modal dialog for creating or editing an ICP profile. Basic form in Phase 2 -- the full "power user ICP builder" comes in Phase 3.

```typescript
interface IcpEditModalProps {
  icp?: IcpProfile;      // undefined for create, populated for edit
  open: boolean;
  onClose: () => void;
  onSave: (profile: Partial<IcpProfile>) => Promise<void>;
}
```

**Sub-tasks**:
- [ ] Create `IcpEditModal` using shadcn/ui `Dialog`
- [ ] Form fields:
  - Name (text input, required)
  - Description (textarea, optional)
  - Target Titles (tag input -- type and press Enter to add tags)
  - Target Industries (tag input)
  - Company Size Range (two number inputs: min, max)
  - Seniority Levels (multi-select: Entry, Mid, Senior, Director, VP, C-Suite)
  - Target Geographies (tag input)
  - Signal Keywords (tag input)
- [ ] Form validation: name required, at least one criteria field populated
- [ ] Save button with loading state
- [ ] Pre-populate form when editing existing ICP
- [ ] Write unit tests: `tests/components/icp/icp-edit-modal.test.ts`

**Acceptance Criteria**:
- Modal opens for both create and edit modes
- Tag input allows adding/removing tags
- Validation prevents saving empty ICP
- Form submits correctly and closes modal on success

---

#### Task 3.5: Niche List Component (BR-508)

**File**: `src/components/icp/niche-list.tsx`

**Description**: Simple list view of niche profiles. Basic display in Phase 2 -- full niche cards with cross-niche comparison come in Phase 3.

**Sub-tasks**:
- [ ] Create `NicheList` component using shadcn/ui `Card` list
- [ ] Each niche item displays:
  - Niche name
  - Contact count
  - Associated ICP count
  - Average score across niche contacts
- [ ] Render as part of the ICPs page (below ICP cards)
- [ ] Section header: "Niches" with count badge
- [ ] Empty state: "No niches detected yet. Run ICP discovery to detect niches."
- [ ] Write unit tests: `tests/components/icp/niche-list.test.ts`

**Acceptance Criteria**:
- Niche list renders below ICP cards on the ICPs page
- Each niche shows name, contact count, and ICP associations
- Empty state displays when no niches exist

---

## Orchestrator Instructions

### Spawn Order

All three agents can be spawned simultaneously since they have no inter-dependencies. However, they all depend on Phase 2 backend API routes being operational.

**Strategy**: Agents should begin work immediately using mock data / SWR fallback values. Define TypeScript interfaces first, build components against mock data, then wire up real API calls once backend is ready.

### Mock Data Approach

Each agent should create a mock data file for development:

- Agent 1: `src/mocks/scoring-data.ts` -- sample scores, dimension breakdowns, weight profiles
- Agent 2: `src/mocks/enrichment-data.ts` -- sample providers, budget, transactions
- Agent 3: `src/mocks/icp-data.ts` -- sample ICPs, niches, wedge metrics

These mocks serve dual purpose: development velocity before backend is ready, and test fixtures for unit tests. Mocks should be conditionally loaded (only in dev/test, never in production).

### Integration Testing

After all agents complete, verify:

1. Contacts table with score column renders with real data from scoring API
2. Score popover shows correct dimension breakdown
3. Enrichment page loads provider data from real API
4. ICP page lists ICPs from real API
5. Navigation between all new pages works via sidebar

### Component Standards

All components must follow these conventions:
- Use shadcn/ui primitives (Card, Table, Dialog, Popover, Badge, Progress, Switch)
- Tailwind CSS 4 for all styling (no inline styles, no CSS modules)
- TypeScript strict mode -- all props typed, no `any`
- Components are server-components by default; add `'use client'` only when needed (hooks, interactivity)
- File naming: `kebab-case.tsx` for components, `use-kebab-case.ts` for hooks

---

## Dependencies

### Internal Dependencies
- Phase 1 App: Next.js project, shadcn/ui, Tailwind, SWR, sidebar, contacts table
- Phase 2 Backend: All scoring, enrichment, graph, and ICP API routes

### NPM Dependencies (already installed or to be added)
- `swr` -- data fetching (should be installed from Phase 1)
- `recharts` -- for score distribution sparkline (should be installed from Phase 1)
- No new NPM dependencies required for Phase 2 app work

---

## Gate Criteria

| # | Criterion | Verification Method |
|---|---|---|
| 1 | Score column visible in contacts table with gradient coloring | Navigate to `/contacts`, verify `gold_score` column renders |
| 2 | Tier badges display correct tier (gold/silver/bronze/unscored) | Verify badge colors match tier assignments from API |
| 3 | Score math popover shows all 9 dimensions | Hover over a scored contact's score, verify popover displays 9 rows |
| 4 | Popover weighted contributions sum to displayed gold_score | Sum dimension contributions in popover, compare to header score |
| 5 | Enrichment page renders at `/enrichment` | Navigate to `/enrichment`, page loads without error |
| 6 | Provider cards show correct status for each provider | Verify PDL/Lusha/TheirStack cards reflect configuration state |
| 7 | Budget overview shows current period spend | Budget progress bar renders with correct percentage |
| 8 | ICP list page renders at `/icps` | Navigate to `/icps`, page loads without error |
| 9 | ICP cards display profile information | At least one ICP card renders with criteria tags and stats |
| 10 | ICP create/edit modal works | Create a new ICP, verify it appears in the list |
| 11 | Sidebar navigation includes Enrichment and ICPs links | Both links present and functional in sidebar |
| 12 | All components render correctly with empty/zero data | Test each page with no scoring data, no enrichment data, no ICPs |
| 13 | No TypeScript compilation errors | `npx tsc --noEmit` exits 0 |
| 14 | All unit tests pass | `npm test` exits 0 |
| 15 | Lint passes | `npm run lint` exits 0 |
