# Phase 1: Foundation -- App Plan

## Objective

Set up the Next.js 15 application shell with App Router, shadcn/ui component library, sidebar navigation, dashboard skeleton, contacts table with SWR data fetching, basic routing for all pages, and an import wizard upload step -- providing the user-facing foundation that consumes backend APIs.

## Prerequisites

- Backend Phase 1 Wave 1 complete (Docker running, database schema deployed)
- Backend API routes for contacts and import available (at least stubs)
- Node.js 20+ installed
- `npm` or `pnpm` package manager

---

## Parallel Agent Assignments

### Agent 1: Setup Engineer

**Scope**: Project scaffolding, dependency installation, Tailwind CSS 4 configuration, shadcn/ui initialization, TypeScript configuration, ESLint/Prettier setup.

**Runs in parallel with**: Nothing initially -- this must complete first as other agents depend on the project structure.

**Output files**:
- `package.json` -- dependencies and scripts
- `tsconfig.json` -- TypeScript configuration
- `next.config.ts` -- Next.js configuration
- `tailwind.config.ts` -- Tailwind CSS 4 configuration
- `postcss.config.mjs` -- PostCSS configuration
- `src/app/globals.css` -- Global styles with Tailwind directives and shadcn/ui CSS variables
- `src/lib/utils.ts` -- cn() utility for class merging (shadcn standard)
- `components.json` -- shadcn/ui configuration
- `.eslintrc.json` -- ESLint configuration
- `.prettierrc` -- Prettier configuration
- `src/app/layout.tsx` -- Root layout with providers
- `src/app/page.tsx` -- Root page (redirects to /dashboard or renders dashboard)

### Agent 2: Layout Engineer

**Scope**: Sidebar navigation component, page routing structure, layout components, theme provider.

**Depends on**: Agent 1 (project scaffolding must exist).

**Output files**:
- `src/components/layout/sidebar-nav.tsx` -- Main sidebar navigation
- `src/components/layout/sidebar-nav-item.tsx` -- Individual nav item component
- `src/components/layout/app-header.tsx` -- Top header bar (breadcrumb, search, user area)
- `src/components/layout/app-shell.tsx` -- Main layout wrapper (sidebar + content area)
- `src/components/layout/page-header.tsx` -- Reusable page header component (title, description, actions)
- `src/components/providers/theme-provider.tsx` -- Dark/light mode provider
- `src/components/providers/swr-provider.tsx` -- SWR configuration provider
- `src/app/(app)/layout.tsx` -- App group layout (wraps sidebar + header)
- `src/app/(app)/dashboard/page.tsx` -- Dashboard skeleton page
- `src/app/(app)/contacts/page.tsx` -- Contacts page (hosts table)
- `src/app/(app)/contacts/[id]/page.tsx` -- Contact detail page (stub)
- `src/app/(app)/network/page.tsx` -- Network graph page (stub)
- `src/app/(app)/discover/page.tsx` -- Discover page (stub)
- `src/app/(app)/enrichment/page.tsx` -- Enrichment page (stub)
- `src/app/(app)/outreach/page.tsx` -- Outreach page (stub)
- `src/app/(app)/tasks/page.tsx` -- Tasks page (stub)
- `src/app/(app)/extension/page.tsx` -- Extension page (stub)
- `src/app/(app)/admin/page.tsx` -- Admin page (stub)
- `src/app/(app)/import/page.tsx` -- Import wizard page

### Agent 3: Contacts Table Engineer

**Scope**: Contacts table component with SWR data fetching, pagination, sorting, filtering, and import wizard upload step.

**Depends on**: Agent 1 (project setup), Agent 2 (page structure), Backend API routes (contacts + import).

**Output files**:
- `src/components/contacts/contacts-table.tsx` -- Main data table component
- `src/components/contacts/contacts-table-columns.tsx` -- Column definitions
- `src/components/contacts/contacts-table-toolbar.tsx` -- Filter/search toolbar
- `src/components/contacts/contacts-table-pagination.tsx` -- Pagination controls
- `src/components/contacts/contact-row.tsx` -- Individual row component (optional, for complex row rendering)
- `src/components/import/import-wizard.tsx` -- Import wizard container
- `src/components/import/upload-step.tsx` -- File upload step
- `src/lib/api/contacts.ts` -- Contact API client functions
- `src/lib/api/import.ts` -- Import API client functions
- `src/lib/hooks/use-contacts.ts` -- SWR hook for contacts data
- `src/lib/hooks/use-import.ts` -- SWR hook for import status polling
- `src/lib/types/contact.ts` -- Contact TypeScript interfaces
- `src/lib/types/import.ts` -- Import TypeScript interfaces
- `src/lib/types/api.ts` -- API response TypeScript interfaces
- `tests/components/contacts-table.test.tsx`
- `tests/hooks/use-contacts.test.ts`

---

## Detailed Task Checklist

### T1: Next.js 15 Project Setup

**Agent**: Setup Engineer
**BR**: BR-201 (App Foundation)
**Parallel**: Must complete first

- [ ] T1.1: Initialize Next.js 15 project with App Router
  ```bash
  npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
  ```
- [ ] T1.2: Verify project structure uses `src/app/` directory with App Router
- [ ] T1.3: Configure `next.config.ts` with:
  - `output: 'standalone'` for Docker deployment
  - `images.remotePatterns` for LinkedIn CDN (media.licdn.com)
  - `experimental.serverActions` enabled (if needed)
- [ ] T1.4: Update `tsconfig.json` paths to use `@/*` alias for `src/*`
- [ ] T1.5: Verify `npm run dev` starts without errors

**Acceptance Criteria**:
- `npm run dev` serves the app at localhost:3000
- TypeScript compilation succeeds with no errors
- App Router directory structure is in place (`src/app/`)

---

### T2: Tailwind CSS 4 Configuration

**Agent**: Setup Engineer
**BR**: BR-201 (UI Foundation)
**Parallel**: After T1

- [ ] T2.1: Verify Tailwind CSS 4 is installed (comes with create-next-app)
- [ ] T2.2: Configure `tailwind.config.ts` with:
  - Content paths for `src/` directory
  - Extended theme colors for tier badges (gold: #F59E0B, silver: #9CA3AF, bronze: #D97706, watch: #6B7280)
  - Extended theme colors for outreach states
  - Font family configuration (Inter or system font stack)
- [ ] T2.3: Configure `globals.css` with:
  - Tailwind directives (`@tailwind base`, `@tailwind components`, `@tailwind utilities`)
  - CSS custom properties for shadcn/ui theming (light and dark mode variables)
  - Base styles (body background, font smoothing)
- [ ] T2.4: Test that Tailwind classes render correctly

**Acceptance Criteria**:
- Tailwind utility classes apply correctly in components
- Custom theme colors are available (e.g., `bg-gold`, `text-tier-silver`)
- Dark mode CSS variables are defined

---

### T3: shadcn/ui Installation and Configuration

**Agent**: Setup Engineer
**BR**: BR-201 (Component Library)
**Parallel**: After T2

- [ ] T3.1: Initialize shadcn/ui
  ```bash
  npx shadcn@latest init
  ```
  - Style: "new-york"
  - Base color: "zinc" or "neutral"
  - CSS variables: yes
- [ ] T3.2: Install core shadcn/ui components needed for Phase 1:
  ```bash
  npx shadcn@latest add button card table input badge
  npx shadcn@latest add dropdown-menu dialog sheet tooltip
  npx shadcn@latest add select separator skeleton
  npx shadcn@latest add navigation-menu scroll-area
  npx shadcn@latest add avatar progress tabs
  ```
- [ ] T3.3: Verify `components.json` configuration is correct
- [ ] T3.4: Verify `src/lib/utils.ts` contains `cn()` function
- [ ] T3.5: Verify shadcn components render correctly with a test page

**Acceptance Criteria**:
- All listed shadcn/ui components are installed in `src/components/ui/`
- Components render correctly with proper styling
- `cn()` utility merges Tailwind classes correctly

---

### T4: SWR Data Fetching Setup

**Agent**: Setup Engineer
**BR**: BR-201 (Data Fetching)
**Parallel**: After T1

- [ ] T4.1: Install SWR: `npm install swr`
- [ ] T4.2: Create SWR global configuration in `src/components/providers/swr-provider.tsx`:
  ```tsx
  const swrConfig = {
    fetcher: (url: string) => fetch(url).then(res => res.json()),
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 5000,
  }
  ```
- [ ] T4.3: Wrap app in SWR provider in root layout
- [ ] T4.4: Create base API client in `src/lib/api/client.ts`:
  - Base URL configuration (from env or relative)
  - Error handling wrapper
  - Response type parsing

**Acceptance Criteria**:
- SWR provider wraps the application
- Default fetcher works with backend API routes
- Error responses are handled gracefully

---

### T5: Root Layout and Providers

**Agent**: Setup Engineer
**File**: `src/app/layout.tsx`
**BR**: BR-201 (App Shell)
**Parallel**: After T3, T4

- [ ] T5.1: Root layout with:
  - HTML lang attribute
  - Font loading (Inter from next/font/google)
  - ThemeProvider for dark/light mode
  - SWRProvider for data fetching
  - Body with global CSS classes
- [ ] T5.2: Metadata configuration (title, description)
- [ ] T5.3: Viewport configuration

**Acceptance Criteria**:
- Root layout renders without hydration errors
- Font loads correctly
- Theme and SWR providers are active

---

### T6: Sidebar Navigation Component

**Agent**: Layout Engineer
**File**: `src/components/layout/sidebar-nav.tsx`
**BR**: BR-201 (Navigation)
**Depends on**: T3 (shadcn components)

- [ ] T6.1: Build sidebar navigation with two sections:
  **Primary Navigation**:
  - Dashboard (Home icon) -- `/dashboard`
  - Contacts (Users icon) -- `/contacts`
  - Network (Share2 icon) -- `/network`
  - Discover (Compass icon) -- `/discover`
  - Enrichment (Database icon) -- `/enrichment`
  - Outreach (Send icon) -- `/outreach`
  - Tasks (CheckSquare icon) -- `/tasks`

  **Secondary Navigation** (bottom section):
  - Extension (Puzzle icon) -- `/extension`
  - Admin (Settings icon) -- `/admin`
  - Import (Upload icon) -- `/import`

- [ ] T6.2: Active route highlighting using `usePathname()`
- [ ] T6.3: Collapsible sidebar (expanded/collapsed state with icon-only mode)
- [ ] T6.4: Sidebar width: 240px expanded, 64px collapsed
- [ ] T6.5: Persist sidebar state in localStorage
- [ ] T6.6: Responsive behavior: sidebar becomes a sheet (drawer) on mobile (<768px)
- [ ] T6.7: Use Lucide React icons for all navigation items
- [ ] T6.8: Keyboard shortcut to toggle sidebar (Cmd+B or Ctrl+B)

**Acceptance Criteria**:
- All navigation items render with correct icons
- Active route is visually highlighted
- Sidebar collapses to icon-only mode
- Mobile view uses a slide-out drawer
- Clicking a nav item navigates to the correct route

---

### T7: App Header Component

**Agent**: Layout Engineer
**File**: `src/components/layout/app-header.tsx`
**BR**: BR-201 (Navigation)
**Depends on**: T3 (shadcn components)

- [ ] T7.1: Top header bar with:
  - Breadcrumb showing current page path
  - Global search input (placeholder, not functional in Phase 1)
  - Placeholder area for user avatar / settings
- [ ] T7.2: Header height: 56px
- [ ] T7.3: Sticky positioning

**Acceptance Criteria**:
- Header renders at top of content area
- Breadcrumb reflects current route
- Header stays visible on scroll

---

### T8: App Shell Layout

**Agent**: Layout Engineer
**File**: `src/components/layout/app-shell.tsx`
**BR**: BR-201 (Layout)
**Depends on**: T6, T7

- [ ] T8.1: Compose sidebar + header + main content area
- [ ] T8.2: Main content area uses remaining viewport width with overflow scroll
- [ ] T8.3: Content area has consistent padding (p-6)
- [ ] T8.4: Sidebar and content area have proper z-index layering

**Acceptance Criteria**:
- Sidebar and header frame the content area correctly
- Content area scrolls independently
- Layout works at all viewport widths (320px to 2560px)

---

### T9: App Group Layout

**Agent**: Layout Engineer
**File**: `src/app/(app)/layout.tsx`
**BR**: BR-201 (Routing)
**Depends on**: T8

- [ ] T9.1: Create route group `(app)` that wraps all authenticated pages
- [ ] T9.2: Render AppShell (sidebar + header + content area)
- [ ] T9.3: Pass `children` into content area slot

**Acceptance Criteria**:
- All pages under `(app)/` render within the sidebar + header layout
- Navigation between pages preserves sidebar state
- Layout does not re-render sidebar/header on page transitions

---

### T10: Page Routing -- All Stub Pages

**Agent**: Layout Engineer
**BR**: BR-201 (Routing)
**Depends on**: T9

- [ ] T10.1: `src/app/(app)/dashboard/page.tsx` -- Dashboard skeleton page
  - Render page header: "Dashboard"
  - Render placeholder card grid (6 cards with Skeleton components)
  - Cards represent future widgets: Goal Focus, Network Health, Task Queue, Discovery Feed, ICP Radar, Budget

- [ ] T10.2: `src/app/(app)/contacts/page.tsx` -- Contacts table page
  - Render page header: "Contacts" with "Import" action button
  - Render ContactsTable component (built by Agent 3)

- [ ] T10.3: `src/app/(app)/contacts/[id]/page.tsx` -- Contact detail stub
  - Render page header with back navigation
  - Render placeholder content: "Contact detail view coming in Phase 3"

- [ ] T10.4: `src/app/(app)/network/page.tsx` -- Network graph stub
  - Page header: "Network Graph"
  - Placeholder: "Network visualization coming in Phase 3"

- [ ] T10.5: `src/app/(app)/discover/page.tsx` -- Discover stub
  - Page header: "Discover"
  - Placeholder: "Niche discovery coming in Phase 3"

- [ ] T10.6: `src/app/(app)/enrichment/page.tsx` -- Enrichment stub
  - Page header: "Enrichment"
  - Placeholder: "Enrichment management coming in Phase 2"

- [ ] T10.7: `src/app/(app)/outreach/page.tsx` -- Outreach stub
  - Page header: "Outreach"
  - Placeholder: "Outreach pipeline coming in Phase 5"

- [ ] T10.8: `src/app/(app)/tasks/page.tsx` -- Tasks stub
  - Page header: "Tasks"
  - Placeholder: "Task management coming in Phase 5"

- [ ] T10.9: `src/app/(app)/extension/page.tsx` -- Extension stub
  - Page header: "Extension"
  - Placeholder: "Extension management coming in Phase 4"

- [ ] T10.10: `src/app/(app)/admin/page.tsx` -- Admin stub
  - Page header: "Admin"
  - Placeholder: "Admin panel coming in Phase 6"

- [ ] T10.11: `src/app/(app)/import/page.tsx` -- Import wizard page
  - Page header: "Import LinkedIn Data"
  - Render ImportWizard component (built by Agent 3)

**Acceptance Criteria**:
- All 11 routes are navigable via sidebar
- Each page renders its header and placeholder content
- No 404 errors when navigating between pages
- Dashboard shows skeleton cards
- Contacts page renders the data table

---

### T11: Page Header Component

**Agent**: Layout Engineer
**File**: `src/components/layout/page-header.tsx`
**BR**: BR-201 (UI Components)
**Depends on**: T3

- [ ] T11.1: Reusable page header with:
  - Title (required)
  - Description (optional)
  - Actions slot (optional, for buttons)
  - Back button (optional, for detail pages)
- [ ] T11.2: Consistent typography (text-2xl font-bold for title)
- [ ] T11.3: Bottom border separator

**Acceptance Criteria**:
- All pages use PageHeader for consistent appearance
- Actions slot accepts any React node
- Back button navigates to previous page using router.back()

---

### T12: TypeScript Type Definitions

**Agent**: Contacts Table Engineer
**Files**: `src/lib/types/contact.ts`, `src/lib/types/import.ts`, `src/lib/types/api.ts`
**BR**: BR-201 (Type Safety)
**Depends on**: Backend schema (T2 from backend plan)

- [ ] T12.1: Define `Contact` interface matching backend schema:
  ```typescript
  interface Contact {
    id: string;
    linkedinUrl: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string | null;
    headline: string | null;
    title: string | null;
    currentCompany: string | null;
    currentCompanyId: string | null;
    location: string | null;
    about: string | null;
    email: string | null;
    phone: string | null;
    connectionsCount: number | null;
    degree: number;
    tags: string[];
    notes: string | null;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
    // Joined fields
    companyName?: string;
    companyIndustry?: string;
    compositeScore?: number | null;
    tier?: string | null;
    persona?: string | null;
    enrichmentStatus?: string;
    outreachState?: string | null;
  }
  ```
- [ ] T12.2: Define `ContactListParams` interface for query parameters
- [ ] T12.3: Define `ImportSession` interface
- [ ] T12.4: Define `ImportFile` interface
- [ ] T12.5: Define `PaginatedResponse<T>` generic interface
- [ ] T12.6: Define `ApiResponse<T>` generic interface
- [ ] T12.7: Define `ApiError` interface

**Acceptance Criteria**:
- All types match the backend API response shapes
- No `any` types in public interfaces
- Types are exported and usable throughout the app

---

### T13: Contact API Client Functions

**Agent**: Contacts Table Engineer
**File**: `src/lib/api/contacts.ts`
**BR**: BR-201 (API Integration)
**Depends on**: T12, T4 (SWR setup)

- [ ] T13.1: `fetchContacts(params: ContactListParams): Promise<PaginatedResponse<Contact>>`
  - Constructs query string from params
  - Calls `GET /api/contacts`
- [ ] T13.2: `fetchContact(id: string): Promise<Contact>`
  - Calls `GET /api/contacts/:id`
- [ ] T13.3: `searchContacts(query: string): Promise<PaginatedResponse<Contact>>`
  - Calls `GET /api/contacts/search?q=query`
- [ ] T13.4: Error handling: throw typed errors for 4xx/5xx responses
- [ ] T13.5: Camel-case transformation from snake_case API responses

**Acceptance Criteria**:
- API functions correctly call backend routes
- Snake-case to camelCase transformation works
- Errors are thrown with useful messages

---

### T14: Import API Client Functions

**Agent**: Contacts Table Engineer
**File**: `src/lib/api/import.ts`
**BR**: BR-101 (Import Integration)
**Depends on**: T12

- [ ] T14.1: `uploadFiles(files: File[]): Promise<{ sessionId: string; files: string[] }>`
  - Constructs FormData with multiple files
  - Calls `POST /api/import/upload`
- [ ] T14.2: `startImport(sessionId: string): Promise<{ sessionId: string; status: string }>`
  - Calls `POST /api/import/csv`
- [ ] T14.3: `fetchImportStatus(sessionId: string): Promise<ImportSession>`
  - Calls `GET /api/import/status/:sessionId`
- [ ] T14.4: `fetchImportHistory(): Promise<PaginatedResponse<ImportSession>>`
  - Calls `GET /api/import/history`

**Acceptance Criteria**:
- File upload sends multipart form data correctly
- Import status polling returns live progress
- All functions handle errors gracefully

---

### T15: SWR Hooks

**Agent**: Contacts Table Engineer
**Files**: `src/lib/hooks/use-contacts.ts`, `src/lib/hooks/use-import.ts`
**BR**: BR-201 (Data Fetching)
**Depends on**: T13, T14

- [ ] T15.1: `useContacts(params)` hook:
  - Uses SWR with `fetchContacts` as fetcher
  - Returns `{ contacts, pagination, isLoading, isError, mutate }`
  - Revalidation interval: 30 seconds
  - Deduplication: 5 seconds
- [ ] T15.2: `useContact(id)` hook:
  - Uses SWR with `fetchContact` as fetcher
  - Returns `{ contact, isLoading, isError }`
- [ ] T15.3: `useImportStatus(sessionId)` hook:
  - Uses SWR with `fetchImportStatus` as fetcher
  - Polling interval: 2 seconds while status is 'processing'
  - Stop polling when status is 'completed' or 'failed'
  - Returns `{ session, isLoading, isError }`
- [ ] T15.4: Unit tests for hook behavior (mock SWR)

**Acceptance Criteria**:
- Contacts hook fetches and caches data
- Import status hook polls during processing, stops when done
- Loading and error states are exposed
- Mutate function allows manual cache invalidation

---

### T16: Contacts Data Table

**Agent**: Contacts Table Engineer
**File**: `src/components/contacts/contacts-table.tsx`
**BR**: BR-201 (Contact List View)
**Depends on**: T15 (hooks), T3 (shadcn Table component)

- [ ] T16.1: Build data table using shadcn Table component
- [ ] T16.2: Define 7 columns:
  | Column | Field | Width | Notes |
  |--------|-------|-------|-------|
  | Name | fullName + avatar placeholder | 200px | Link to contact detail |
  | Title / Company | title + currentCompany | 250px | Two-line cell |
  | Score | compositeScore | 80px | Numeric, right-aligned (placeholder 0 in Phase 1) |
  | ICP Fit | tier | 100px | Badge component (gold/silver/bronze/watch) |
  | Tier | tier | 80px | Color-coded badge |
  | Enrichment | enrichmentStatus | 120px | Badge: pending/enriched |
  | Outreach | outreachState | 120px | Badge: not_started/sent/replied/etc. |

- [ ] T16.3: Column sorting (click header to sort, toggle asc/desc)
  - Sortable columns: Name, Score, Tier, Created
  - Sort state managed locally, passed to API via query params
- [ ] T16.4: Use `useContacts` hook to fetch data
- [ ] T16.5: Show loading skeleton while data is fetching (Skeleton rows)
- [ ] T16.6: Show empty state when no contacts: "No contacts yet. Import your LinkedIn data to get started." with import button
- [ ] T16.7: Row click navigates to `/contacts/:id`

**Acceptance Criteria**:
- Table renders with correct columns
- Sorting changes the sort query parameter and refetches
- Loading state shows skeleton rows
- Empty state shows import prompt
- Clicking a row navigates to contact detail

---

### T17: Contacts Table Toolbar

**Agent**: Contacts Table Engineer
**File**: `src/components/contacts/contacts-table-toolbar.tsx`
**BR**: BR-201 (Filtering)
**Depends on**: T3 (shadcn components)

- [ ] T17.1: Search input for keyword filtering (debounced, 300ms)
- [ ] T17.2: Tier filter dropdown (All, Gold, Silver, Bronze, Watch)
- [ ] T17.3: Enrichment status filter (All, Enriched, Pending)
- [ ] T17.4: Active filter count badge
- [ ] T17.5: "Clear filters" button when any filter is active
- [ ] T17.6: Filters update query params and trigger SWR revalidation

**Acceptance Criteria**:
- Search input filters contacts by keyword with debounce
- Dropdown filters narrow the contact list
- Filter count shows how many filters are active
- Clearing filters resets to default view

---

### T18: Contacts Table Pagination

**Agent**: Contacts Table Engineer
**File**: `src/components/contacts/contacts-table-pagination.tsx`
**BR**: BR-201 (Pagination)
**Depends on**: T15 (pagination data from hook)

- [ ] T18.1: Display "Showing X-Y of Z contacts"
- [ ] T18.2: Page size selector (25, 50, 100)
- [ ] T18.3: Previous / Next buttons
- [ ] T18.4: First / Last page buttons
- [ ] T18.5: Current page indicator
- [ ] T18.6: Disabled state for prev/next at boundaries

**Acceptance Criteria**:
- Pagination controls appear below the table
- Changing page size refetches with new limit
- Page navigation works correctly at boundaries
- Display text is accurate

---

### T19: Tier Badge Component

**Agent**: Contacts Table Engineer
**File**: `src/components/contacts/tier-badge.tsx`
**BR**: BR-401 (Tier Display)
**Depends on**: T3 (shadcn Badge)

- [ ] T19.1: Colored badge component for tiers:
  - Gold: amber background, dark text
  - Silver: gray background, dark text
  - Bronze: orange background, dark text
  - Watch: muted background, muted text
  - Unscored: outline only
- [ ] T19.2: Small size variant for table cells
- [ ] T19.3: Accept `tier` prop as string

**Acceptance Criteria**:
- Each tier has a distinct, accessible color
- Badge is compact enough for table cells
- Null/undefined tier renders as "Unscored"

---

### T20: Import Wizard -- Upload Step

**Agent**: Contacts Table Engineer
**Files**: `src/components/import/import-wizard.tsx`, `src/components/import/upload-step.tsx`
**BR**: BR-101 (Import)
**Depends on**: T14 (import API), T3 (shadcn components)

- [ ] T20.1: Import wizard container with step indicator (Step 1 of 4 -- only Step 1 active in Phase 1)
- [ ] T20.2: Upload step with:
  - Drag-and-drop zone for CSV files
  - File picker button as fallback
  - Accept only `.csv` files
  - Multi-file upload support
  - File list showing selected files with size and remove button
- [ ] T20.3: File type validation (reject non-CSV)
- [ ] T20.4: File size display (human-readable)
- [ ] T20.5: "Upload & Import" button that:
  1. Calls `uploadFiles()` API
  2. Calls `startImport()` API
  3. Switches to progress view
- [ ] T20.6: Progress view during import:
  - Use `useImportStatus` hook to poll progress
  - Show progress bar (processed_files / total_files)
  - Show record counts (new, updated, skipped, errors)
  - Show completion message when done
- [ ] T20.7: Error display if import fails
- [ ] T20.8: "View Contacts" button after successful import (navigates to /contacts)

**Acceptance Criteria**:
- Drag-and-drop accepts CSV files
- File validation rejects non-CSV files
- Upload sends files to backend
- Progress polling shows live import status
- Completion state shows summary with navigation to contacts

---

### T21: Component Loading Strategy

**Agent**: Layout Engineer
**BR**: BR-201 (Performance)
**Depends on**: T10 (all pages created)

- [ ] T21.1: Mark client-side components with `'use client'` directive only where needed:
  - Sidebar navigation (uses hooks for state)
  - Contacts table (uses SWR hooks)
  - Import wizard (uses state + API calls)
  - Theme provider
- [ ] T21.2: Server components for:
  - All page.tsx files (fetch data server-side where possible)
  - Page headers (static content)
  - Layout components
- [ ] T21.3: Dynamic imports with `next/dynamic` for heavy components:
  ```tsx
  const ContactsTable = dynamic(() => import('@/components/contacts/contacts-table'), {
    loading: () => <TableSkeleton />,
  })
  ```
- [ ] T21.4: Create `TableSkeleton` component for loading states

**Acceptance Criteria**:
- Client components are minimized (only where hooks/interactivity needed)
- Server components render on the server without hydration errors
- Heavy components are lazy-loaded with skeleton fallbacks

---

## Orchestrator Instructions

The Phase 1 App Sub-Orchestrator should follow this delegation sequence:

### Wave 1 (Sequential -- foundation must come first)
Launch Agent 1 (Setup Engineer) alone.

- Agent 1 completes T1-T5 (project setup, Tailwind, shadcn, SWR, root layout)

**Checkpoint**: When Agent 1 completes:
- `npm run dev` starts without errors
- shadcn/ui components render correctly
- Root layout renders with providers
- Record result in implementation log

### Wave 2 (Parallel -- depends on Wave 1)
Launch Agent 2 (Layout Engineer) and Agent 3 (Contacts Table Engineer) simultaneously.

- Agent 2 works on T6-T11, T21 (sidebar, header, shell, routing, pages, loading strategy)
- Agent 3 works on T12-T20 (types, API clients, hooks, table, toolbar, pagination, badge, import wizard)

**Note**: Agent 3 may need to wait briefly for Agent 2 to create the page files (T10.2, T10.11) that host the contacts table and import wizard. Coordinate by having Agent 2 prioritize T9 and T10 early.

**Checkpoint**: When both agents complete:
- All 11 routes are navigable
- Sidebar navigation works correctly
- Contacts table renders (with mock data if backend not ready)
- Import wizard upload step works
- Record result in implementation log

### Final Verification
- Navigate through all pages via sidebar
- Verify dashboard skeleton renders 6 cards
- Verify contacts table loads data from API (or shows empty state)
- Verify import wizard accepts files and shows progress
- Verify dark/light mode works
- Verify mobile responsive behavior
- Run `npm run build` to verify no build errors
- Run `npm run lint` to verify no lint errors

---

## Dependencies

### Internal (within App)

```
T1 -> T2, T3, T4 (project setup before config)
T2 -> T3 (Tailwind before shadcn)
T3 -> T6, T7, T11, T16, T17, T18, T19, T20 (shadcn components used everywhere)
T4 -> T15 (SWR setup before hooks)
T5 -> T9 (root layout before app group layout)
T6, T7 -> T8 (sidebar + header before shell)
T8 -> T9 (shell before app group layout)
T9 -> T10 (app layout before pages)
T12 -> T13, T14 (types before API clients)
T13, T14 -> T15 (API clients before hooks)
T15 -> T16 (hooks before table)
T16 -> T17, T18 (table before toolbar/pagination)
```

### External (cross-domain)

- **Depends on Backend**: `GET /api/contacts` for contacts table data
- **Depends on Backend**: `GET /api/health` for health indicator
- **Depends on Backend**: `POST /api/import/upload`, `POST /api/import/csv`, `GET /api/import/status/:sessionId` for import wizard
- **Fallback**: App can render with empty state / skeleton if backend API is not yet available. Use mock data during development if needed.

---

## Gate Criteria

All of the following must pass before Phase 2 begins:

- [ ] `npm run dev` starts without errors at localhost:3000
- [ ] `npm run build` completes without errors
- [ ] `npm run lint` passes with no errors
- [ ] Sidebar navigation renders with all 10 nav items (7 primary + 3 secondary)
- [ ] All 11 routes are navigable without 404 errors
- [ ] Dashboard page renders 6 skeleton cards
- [ ] Contacts table renders with data from `GET /api/contacts` (or empty state if no data)
- [ ] Contacts table pagination works (page size selector, next/prev)
- [ ] Contacts table search input filters results
- [ ] Contacts table tier filter works
- [ ] Import wizard accepts CSV file uploads via drag-and-drop
- [ ] Import wizard shows progress during import processing
- [ ] Import wizard shows completion summary
- [ ] Dark mode toggle works (light/dark themes)
- [ ] Mobile responsive layout works (sidebar collapses to drawer)
- [ ] No TypeScript compilation errors
- [ ] No React hydration mismatches

---

## Estimated Agent Count and Specializations

| Agent | Type | Specialization | Estimated Duration |
|-------|------|---------------|-------------------|
| Agent 1 | Setup Engineer | Next.js, Tailwind, shadcn/ui, TypeScript config | 0.5-1 day |
| Agent 2 | Layout Engineer | Sidebar nav, routing, layouts, page shells | 1-2 days |
| Agent 3 | Contacts Table Engineer | Data tables, SWR hooks, API clients, import wizard | 2-3 days |

**Total agents**: 3
**Parallelism**: Wave 1 (1 agent), Wave 2 (2 agents)
**Critical path**: Agent 1 (setup) -> Agent 3 (contacts table) -- approximately 3-4 days sequential
