# Phase 4: Chrome Extension -- Backend Domain Plan

## Objective

Establish the server-side infrastructure that supports the Chrome extension: versioned CSS selector configurations for LinkedIn page parsing, a page cache with automatic version rotation, a WebSocket server for real-time push communication to the extension, and token-based authentication for all extension API endpoints.

---

## Prerequisites (from Phases 1-3)

| Dependency | Phase | Status Required |
|------------|-------|-----------------|
| PostgreSQL running via docker-compose with ruvector-postgres | Phase 1 | Operational |
| `page_cache` table exists in schema (created in Phase 1 DB init) | Phase 1 | Migrated |
| `contacts`, `companies`, `edges` tables populated | Phase 1 | Populated |
| `contact_scores`, `score_dimensions` tables functional | Phase 2 | Operational |
| Enrichment pipeline + budget tracking | Phase 2 | Operational |
| Next.js 15 app running with App Router | Phase 1 | Operational |
| All Phase 3 API endpoints (dashboard, graph, discover) | Phase 3 | Passing gate |

---

## Parallel Agent Assignments

| Agent | Role | Tasks | Estimated Effort |
|-------|------|-------|------------------|
| Agent B1 | Schema Architect | selector_configs table, page_cache rotation trigger verification, migration script | 4-6 hours |
| Agent B2 | WebSocket Engineer | WebSocket server implementation, connection auth, push/receive event system | 8-12 hours |
| Agent B3 | Auth Engineer | Extension token management, auth middleware, config storage | 4-6 hours |

Agents B1 and B3 can run fully in parallel. Agent B2 depends on B3 completing token validation logic (shared auth util).

---

## Detailed Task Checklist

### Task B4-1: Selector Configuration Table (Agent B1)

**BR Refs**: BR-804 (configurable selectors), BR-816 (re-parse on selector update)

**File**: `db/migrations/010-selector-configs.sql`

- [ ] B4-1.1: Create `selector_configs` table

```sql
CREATE TABLE selector_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_type       TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  selectors       JSONB NOT NULL,
  heuristics      JSONB DEFAULT '[]'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT DEFAULT 'system',
  notes           TEXT,
  UNIQUE (page_type, version)
);

CREATE INDEX idx_selector_configs_page_type ON selector_configs (page_type);
CREATE INDEX idx_selector_configs_active ON selector_configs (page_type) WHERE is_active = true;
```

- [ ] B4-1.2: Define TypeScript interfaces for selector config

**File**: `app/src/types/selector-config.ts`

```typescript
export type LinkedInPageType =
  | 'PROFILE'
  | 'PROFILE_ACTIVITY'
  | 'SEARCH_PEOPLE'
  | 'SEARCH_CONTENT'
  | 'FEED'
  | 'COMPANY'
  | 'CONNECTIONS'
  | 'MESSAGES'
  | 'OTHER';

export interface SelectorChain {
  /** Human-readable name for this selector chain */
  name: string;
  /** Ordered list of CSS selectors to try; first match wins */
  selectors: string[];
  /** Attribute to extract (default: textContent) */
  attribute?: string;
  /** Post-processing: 'trim' | 'parseInt' | 'parseConnectionCount' | 'joinArray' */
  transform?: string;
  /** If true, collect all matches (not just first) */
  multiple?: boolean;
}

export interface HeuristicRule {
  /** Field this heuristic extracts */
  field: string;
  /** Regex pattern to match against extracted text */
  pattern: string;
  /** Flags for the regex */
  flags?: string;
  /** Capture group index (default: 1) */
  captureGroup?: number;
  /** Source field to run regex against */
  sourceField: string;
}

export interface SelectorConfig {
  id: string;
  pageType: LinkedInPageType;
  version: number;
  selectors: Record<string, SelectorChain>;
  heuristics: HeuristicRule[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  notes: string | null;
}
```

- [ ] B4-1.3: Seed initial selector configs for all page types

**File**: `db/seeds/010-selector-configs-seed.sql`

Page types to seed with initial V1 selectors:

| Page Type | Key Fields | Priority |
|-----------|-----------|----------|
| PROFILE | name, headline, location, about, experience, education, skills, connections | P0 |
| SEARCH_PEOPLE | result list (name, headline, URL per result) | P0 |
| FEED | post content, author, engagement counts | P1 |
| COMPANY | company name, industry, size, specialties, about | P1 |
| CONNECTIONS | connection list (name, headline, URL, connected date) | P2 |
| MESSAGES | conversation list (participant, last message preview, timestamp) | P2 |

Each seed record must include:
- Minimum 3 fallback selectors per field (LinkedIn DOM changes frequently)
- At least 1 heuristic rule per page type for ambiguous fields
- `version: 1`, `is_active: true`, `created_by: 'system'`

Example PROFILE selectors structure:

```json
{
  "name": {
    "name": "Full Name",
    "selectors": [
      "h1.text-heading-xlarge",
      ".pv-text-details__left-panel h1",
      "[data-anonymize='person-name']",
      ".top-card-layout__title"
    ],
    "transform": "trim"
  },
  "headline": {
    "name": "Headline",
    "selectors": [
      ".text-body-medium.break-words",
      ".pv-text-details__left-panel .text-body-medium",
      "[data-anonymize='headline']"
    ],
    "transform": "trim"
  },
  "location": {
    "name": "Location",
    "selectors": [
      ".text-body-small.inline.t-black--light.break-words",
      ".pv-text-details__left-panel span.text-body-small",
      "[data-anonymize='location']"
    ],
    "transform": "trim"
  },
  "about": {
    "name": "About Section",
    "selectors": [
      "#about ~ div .inline-show-more-text span[aria-hidden='true']",
      ".pv-shared-text-with-see-more span.visually-hidden",
      "section.pv-about-section .pv-about__summary-text"
    ],
    "transform": "trim"
  },
  "experience": {
    "name": "Experience Entries",
    "selectors": [
      "#experience ~ div .pvs-list__paged-list-wrapper > li",
      ".experience-section .pv-profile-section__list-item",
      "#experience + .pvs-list__outer-container li.artdeco-list__item"
    ],
    "multiple": true
  },
  "education": {
    "name": "Education Entries",
    "selectors": [
      "#education ~ div .pvs-list__paged-list-wrapper > li",
      ".education-section .pv-profile-section__list-item"
    ],
    "multiple": true
  },
  "skills": {
    "name": "Skills",
    "selectors": [
      "#skills ~ div .pvs-list__paged-list-wrapper > li span.mr1.t-bold span[aria-hidden='true']",
      ".pv-skill-category-entity__name-text"
    ],
    "multiple": true,
    "transform": "trim"
  },
  "connectionsCount": {
    "name": "Connections Count",
    "selectors": [
      ".pv-top-card--list li:last-child span.t-bold",
      "a[href*='/detail/contact-info'] span.t-bold",
      ".pv-text-details__right-panel span.t-bold"
    ],
    "transform": "parseConnectionCount"
  }
}
```

- [ ] B4-1.4: Create activation trigger (deactivate previous version on insert)

```sql
CREATE OR REPLACE FUNCTION deactivate_previous_selector_config()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE selector_configs
  SET is_active = false, updated_at = now()
  WHERE page_type = NEW.page_type
    AND id != NEW.id
    AND is_active = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_selector_config_activate
  AFTER INSERT ON selector_configs
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION deactivate_previous_selector_config();
```

**Acceptance Criteria**:
- `selector_configs` table exists with proper indexes
- All 6 page types seeded with `version: 1`, `is_active: true`
- Inserting a new active config for the same page_type deactivates the previous one
- TypeScript interfaces compile cleanly and export from `app/src/types/`

---

### Task B4-2: Page Cache Rotation Trigger Verification (Agent B1)

**BR Refs**: BR-803 (5-version cache)

**File**: `db/migrations/001-schema.sql` (verify existing), `db/migrations/011-page-cache-rotation.sql` (if missing)

- [ ] B4-2.1: Verify `page_cache` table schema matches requirements

```sql
-- Expected schema (from Phase 1):
CREATE TABLE IF NOT EXISTS page_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url             TEXT NOT NULL,
  page_type       TEXT NOT NULL,
  html_compressed BYTEA NOT NULL,
  html_size_bytes INTEGER NOT NULL,
  capture_id      UUID,
  extension_version TEXT,
  session_id      TEXT,
  scroll_depth    REAL,
  viewport_height INTEGER,
  document_height INTEGER,
  trigger_mode    TEXT DEFAULT 'manual',
  parsed          BOOLEAN NOT NULL DEFAULT false,
  parsed_at       TIMESTAMPTZ,
  parse_version   INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_cache_url ON page_cache (url);
CREATE INDEX idx_page_cache_url_created ON page_cache (url, created_at DESC);
CREATE INDEX idx_page_cache_unparsed ON page_cache (parsed) WHERE parsed = false;
```

- [ ] B4-2.2: Implement or verify 5-version rotation trigger

```sql
CREATE OR REPLACE FUNCTION rotate_page_cache()
RETURNS TRIGGER AS $$
DECLARE
  cache_count INTEGER;
  oldest_id UUID;
BEGIN
  SELECT count(*) INTO cache_count
  FROM page_cache
  WHERE url = NEW.url;

  IF cache_count > 5 THEN
    SELECT id INTO oldest_id
    FROM page_cache
    WHERE url = NEW.url
    ORDER BY created_at ASC
    LIMIT 1;

    DELETE FROM page_cache WHERE id = oldest_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_page_cache_rotation
  AFTER INSERT ON page_cache
  FOR EACH ROW
  EXECUTE FUNCTION rotate_page_cache();
```

- [ ] B4-2.3: Write integration test for rotation

**File**: `tests/integration/page-cache-rotation.test.ts`

```typescript
// Test: insert 7 rows for same URL, verify only 5 remain
// Test: insert rows for different URLs, verify independent rotation
// Test: oldest row is always the one deleted
// Test: compressed HTML stored correctly (gzip roundtrip)
```

**Acceptance Criteria**:
- `page_cache` table exists with all required columns
- Inserting a 6th record for the same URL deletes the oldest
- Rotation is per-URL (different URLs maintain independent 5-version windows)
- Integration test passes

---

### Task B4-3: WebSocket Server Implementation (Agent B2)

**BR Refs**: BR-812 (real-time push), BR-814 (connection management)

**File**: `app/src/lib/websocket/ws-server.ts`

- [ ] B4-3.1: Install `ws` package

```bash
cd app && npm install ws && npm install -D @types/ws
```

- [ ] B4-3.2: Implement WebSocket server

```typescript
// app/src/lib/websocket/ws-server.ts

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { validateExtensionToken } from '../auth/extension-auth';

export interface WsPushEvent {
  type:
    | 'CAPTURE_CONFIRMED'
    | 'TASK_CREATED'
    | 'TASK_UPDATED'
    | 'GOAL_PROGRESS'
    | 'TEMPLATE_READY'
    | 'ENRICHMENT_COMPLETE'
    | 'SETTINGS_UPDATED'
    | 'PARSE_COMPLETE';
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface WsReceiveEvent {
  type: 'PAGE_NAVIGATED' | 'TASK_VIEWED';
  payload: Record<string, unknown>;
}

export interface AuthenticatedSocket extends WebSocket {
  extensionId: string;
  isAlive: boolean;
  connectedAt: Date;
}

export class ExtensionWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, AuthenticatedSocket> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  init(server: import('http').Server): void;
  handleConnection(ws: AuthenticatedSocket, req: IncomingMessage): void;
  handleMessage(ws: AuthenticatedSocket, data: string): void;
  pushToExtension(extensionId: string, event: WsPushEvent): boolean;
  pushToAll(event: WsPushEvent): void;
  getConnectedClients(): string[];
  shutdown(): void;
}
```

- [ ] B4-3.3: Implement connection authentication via token query parameter

```typescript
// Connection URL format: ws://localhost:3000/ws/extension?token=<extension-token>
// Parse URL, extract token, validate against stored tokens
// Reject with 4001 close code if invalid
// Reject with 4002 close code if token expired
```

- [ ] B4-3.4: Implement heartbeat mechanism

```typescript
// 30-second ping/pong cycle
// Mark dead connections after 2 missed pongs
// Clean up dead connections from clients map
// Log connection/disconnection events
```

- [ ] B4-3.5: Implement push event dispatching

**File**: `app/src/lib/websocket/ws-events.ts`

```typescript
export function createCaptureConfirmedEvent(captureId: string, url: string, pageType: string): WsPushEvent;
export function createTaskCreatedEvent(task: ExtensionTask): WsPushEvent;
export function createTaskUpdatedEvent(taskId: string, status: string): WsPushEvent;
export function createGoalProgressEvent(goalId: string, progress: number): WsPushEvent;
export function createTemplateReadyEvent(contactUrl: string, template: string): WsPushEvent;
export function createEnrichmentCompleteEvent(contactId: string): WsPushEvent;
export function createSettingsUpdatedEvent(settings: ExtensionSettings): WsPushEvent;
export function createParseCompleteEvent(captureId: string, contactId: string | null, fieldsExtracted: number): WsPushEvent;
```

- [ ] B4-3.6: Implement receive event handling

```typescript
// PAGE_NAVIGATED: Log navigation, check for task auto-completion opportunities
// TASK_VIEWED: Mark task as viewed, update task.viewedAt timestamp
```

- [ ] B4-3.7: Integrate WebSocket server with Next.js custom server

**File**: `app/src/server.ts` (custom server entry point)

```typescript
// Next.js App Router does not natively support WebSocket upgrade
// Create custom server.ts that:
//   1. Creates HTTP server
//   2. Attaches Next.js request handler
//   3. Attaches WebSocket server on /ws/extension path
//   4. Handles upgrade requests
```

- [ ] B4-3.8: Write unit tests for WebSocket server

**File**: `tests/unit/websocket/ws-server.test.ts`

```typescript
// Test: connection with valid token succeeds
// Test: connection with invalid token rejects (4001)
// Test: pushToExtension delivers to correct client
// Test: pushToAll delivers to all connected clients
// Test: heartbeat cleans up dead connections
// Test: receive PAGE_NAVIGATED logs correctly
// Test: receive TASK_VIEWED updates timestamp
// Test: getConnectedClients returns accurate list
```

**Acceptance Criteria**:
- WebSocket server starts at `/ws/extension` path
- Only token-authenticated connections are accepted
- All 8 push event types can be dispatched
- Both receive event types are handled
- Heartbeat cleans up stale connections within 60 seconds
- Unit tests pass

---

### Task B4-4: Extension Token Management (Agent B3)

**BR Refs**: BR-810 (registration flow), BR-811 (token security)

**File**: `app/src/lib/auth/extension-auth.ts`

- [ ] B4-4.1: Define token interfaces

```typescript
// app/src/types/extension-auth.ts

export interface ExtensionToken {
  token: string;
  extensionId: string;
  createdAt: string;
  lastUsedAt: string | null;
  userAgent: string | null;
  isRevoked: boolean;
}

export interface TokenValidationResult {
  valid: boolean;
  extensionId?: string;
  error?: 'INVALID_TOKEN' | 'REVOKED_TOKEN' | 'INVALID_ORIGIN';
}

export interface TokenGenerationResult {
  token: string;
  extensionId: string;
  displayToken: string; // First 8 chars for UI display
}
```

- [ ] B4-4.2: Implement token generation

```typescript
// app/src/lib/auth/extension-auth.ts

import crypto from 'crypto';

export function generateExtensionToken(): TokenGenerationResult {
  // Generate 32-byte random token
  // Format: ext_<base64url(32 bytes)>
  // Store in config/extension-tokens.json (gitignored)
  // Return token + extensionId (UUID)
}

export async function validateExtensionToken(token: string): Promise<TokenValidationResult> {
  // Load tokens from config/extension-tokens.json
  // Check token exists and is not revoked
  // Update lastUsedAt timestamp
  // Return validation result
}

export async function revokeExtensionToken(extensionId: string): Promise<boolean> {
  // Mark token as revoked in config file
  // Disconnect any active WebSocket connection for this extensionId
}

export async function listExtensionTokens(): Promise<ExtensionToken[]> {
  // Return all tokens (with token values masked except first 8 chars)
}
```

- [ ] B4-4.3: Create token storage file management

**File**: `app/src/lib/auth/token-store.ts`

```typescript
// Read/write config/extension-tokens.json
// File format:
// {
//   "tokens": [
//     {
//       "token": "ext_abc123...",
//       "extensionId": "uuid",
//       "createdAt": "ISO8601",
//       "lastUsedAt": "ISO8601 | null",
//       "userAgent": "string | null",
//       "isRevoked": false
//     }
//   ]
// }
// Ensure file is created with 600 permissions
// Ensure config/extension-tokens.json is in .gitignore
```

- [ ] B4-4.4: Add `config/extension-tokens.json` to `.gitignore`

**File**: `.gitignore` (append)

```
# Extension tokens (secrets)
config/extension-tokens.json
```

- [ ] B4-4.5: Write unit tests for token management

**File**: `tests/unit/auth/extension-auth.test.ts`

```typescript
// Test: generateExtensionToken returns valid format (ext_ prefix, 44+ chars)
// Test: validateExtensionToken returns valid for known token
// Test: validateExtensionToken returns INVALID_TOKEN for unknown token
// Test: validateExtensionToken returns REVOKED_TOKEN for revoked token
// Test: revokeExtensionToken marks token as revoked
// Test: listExtensionTokens masks token values
// Test: token file created with correct permissions
// Test: concurrent token operations don't corrupt file
```

**Acceptance Criteria**:
- Tokens generated with `ext_` prefix and cryptographically random body
- Token validation works correctly for valid, invalid, and revoked tokens
- Token storage file is gitignored
- Unit tests pass

---

### Task B4-5: Token-Based Auth Middleware (Agent B3)

**BR Refs**: BR-811 (token security), BR-815 (origin validation)

**File**: `app/src/lib/middleware/extension-auth-middleware.ts`

- [ ] B4-5.1: Implement auth middleware for Next.js API routes

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateExtensionToken, TokenValidationResult } from '../auth/extension-auth';

export interface AuthenticatedExtensionRequest extends NextRequest {
  extensionId: string;
}

/**
 * Middleware that validates extension requests.
 * Checks:
 *   1. X-Extension-Token header present and valid
 *   2. Origin header matches chrome-extension:// pattern
 *   3. Token is not revoked
 *
 * Returns 401 with JSON error body on failure.
 */
export async function withExtensionAuth(
  req: NextRequest,
  handler: (req: AuthenticatedExtensionRequest) => Promise<NextResponse>
): Promise<NextResponse>;

/**
 * Validate Origin header for chrome-extension:// requests.
 * Also allows localhost origins for development.
 */
export function validateOrigin(origin: string | null): boolean;
```

- [ ] B4-5.2: Implement origin validation rules

```typescript
// Allowed origins:
//   - chrome-extension://<extension-id>  (production)
//   - http://localhost:3000              (development, if ALLOW_DEV_ORIGIN=true)
//   - null origin                         (rejected)
//
// The extension ID in chrome-extension:// origin is NOT validated against a
// specific value (it changes with every sideload). Only the scheme is checked.
```

- [ ] B4-5.3: Implement rate limiting for extension endpoints

**File**: `app/src/lib/middleware/extension-rate-limiter.ts`

```typescript
// In-memory rate limiter (simple token bucket)
// Limits per extensionId:
//   - /api/extension/capture: 60 requests/minute
//   - /api/extension/tasks: 30 requests/minute
//   - /api/extension/health: 10 requests/minute (called every 30s, so ~2/min expected)
//   - /api/extension/settings: 10 requests/minute
//   - /api/extension/contact/:url: 30 requests/minute
//   - /api/extension/message-render: 20 requests/minute
// Returns 429 with Retry-After header on limit exceeded
```

- [ ] B4-5.4: Create helper to wrap API route handlers

```typescript
// Usage pattern in API routes:
//
// export async function POST(req: NextRequest) {
//   return withExtensionAuth(req, async (authReq) => {
//     // authReq.extensionId is available
//     // ... handler logic
//   });
// }
```

- [ ] B4-5.5: Write middleware tests

**File**: `tests/unit/middleware/extension-auth-middleware.test.ts`

```typescript
// Test: request with valid token and chrome-extension origin passes
// Test: request without X-Extension-Token header returns 401
// Test: request with invalid token returns 401 with INVALID_TOKEN error
// Test: request with revoked token returns 401 with REVOKED_TOKEN error
// Test: request with non-chrome-extension origin returns 401 (except dev)
// Test: request with null origin returns 401
// Test: rate limiter returns 429 after limit exceeded
// Test: rate limiter resets after window expires
// Test: extensionId is injected into authenticated request
```

**Acceptance Criteria**:
- All `/api/extension/*` endpoints require valid `X-Extension-Token` header
- Origin validation accepts `chrome-extension://` scheme
- Rate limiting prevents abuse per extensionId
- 401 responses include structured JSON error bodies
- Middleware tests pass

---

## Orchestrator Instructions

### Execution Order

```
Phase 4 Backend Orchestration:

1. Start Agent B1 and Agent B3 in PARALLEL
   - B1: selector_configs table + page_cache rotation verification
   - B3: Token management + auth middleware

2. When B3 completes token validation (B4-4.2):
   - Start Agent B2: WebSocket server (depends on validateExtensionToken)

3. When B1 completes selector_configs:
   - Signal App domain (Agent A1) that selector configs are ready

4. When B2 completes WebSocket server:
   - Signal Extension domain that WS endpoint is available

5. Run integration tests across all backend tasks
```

### Agent Spawn Configuration

```bash
# Agent B1 - Schema Architect
npx @claude-flow/cli@latest agent spawn -t coder --name phase4-backend-schema \
  --instructions "Implement selector_configs table, seed initial configs for 6 LinkedIn page types, verify page_cache rotation trigger. All SQL in db/migrations/ and db/seeds/. TypeScript interfaces in app/src/types/selector-config.ts."

# Agent B2 - WebSocket Engineer
npx @claude-flow/cli@latest agent spawn -t coder --name phase4-backend-ws \
  --instructions "Implement WebSocket server at /ws/extension using ws library. Handle connection auth via token query parameter. Implement 8 push event types and 2 receive event types. Integrate with Next.js custom server. Tests in tests/unit/websocket/."

# Agent B3 - Auth Engineer
npx @claude-flow/cli@latest agent spawn -t coder --name phase4-backend-auth \
  --instructions "Implement extension token generation, validation, revocation. Token storage in config/extension-tokens.json (gitignored). Auth middleware validating X-Extension-Token header and chrome-extension:// origin. Rate limiting per extensionId. Tests in tests/unit/auth/ and tests/unit/middleware/."
```

---

## Dependencies (Cross-Domain)

### Backend -> App (provides to)

| Artifact | Consumer | Description |
|----------|----------|-------------|
| `selector_configs` table + seed data | App parser engine (A4-3) | Parsers load active selector config by page_type |
| `page_cache` table (verified) | App capture endpoint (A4-1) | Capture endpoint writes compressed HTML here |
| WebSocket server at `/ws/extension` | Extension service worker (E4-2) | Extension connects for real-time push events |
| `validateExtensionToken()` function | App extension API routes (A4-1 through A4-8) | All extension endpoints use this middleware |
| Token generation endpoint support | App register endpoint (A4-5) | Register endpoint calls generateExtensionToken() |

### Backend <- App (receives from)

| Artifact | Provider | Description |
|----------|----------|-------------|
| Parse results (contact upserts) | App parser engine (A4-3) | Parser writes to contacts/companies tables |
| WebSocket push calls | App capture/task handlers (A4-1, A4-2) | App pushes events to extension via WS server |

### Backend <- Extension (receives from)

| Artifact | Provider | Description |
|----------|----------|-------------|
| WebSocket connection | Extension service worker (E4-2) | Extension connects with token for real-time events |
| PAGE_NAVIGATED events | Extension content script (E4-1) | Received via WebSocket for task auto-completion |

---

## Gate Criteria

- [ ] `selector_configs` table exists, has 6 active page type configs, deactivation trigger works
- [ ] `page_cache` rotation trigger deletes 6th+ entry per URL, verified by integration test
- [ ] WebSocket server accepts token-authenticated connections at `/ws/extension`
- [ ] WebSocket server rejects connections with invalid/missing tokens (close code 4001)
- [ ] At least one push event type (CAPTURE_CONFIRMED) successfully delivered to connected client
- [ ] `X-Extension-Token` middleware returns 401 for missing, invalid, and revoked tokens
- [ ] `X-Extension-Token` middleware passes valid tokens and injects `extensionId`
- [ ] Origin validation accepts `chrome-extension://` and rejects other origins
- [ ] Rate limiter returns 429 after exceeding per-endpoint limits
- [ ] All unit and integration tests pass
- [ ] `npm run build` succeeds with no TypeScript errors from new files
- [ ] `npm run lint` passes on all new files

---

## Files Created/Modified Summary

| File | Action | Agent |
|------|--------|-------|
| `db/migrations/010-selector-configs.sql` | Create | B1 |
| `db/seeds/010-selector-configs-seed.sql` | Create | B1 |
| `db/migrations/011-page-cache-rotation.sql` | Create (if missing) | B1 |
| `app/src/types/selector-config.ts` | Create | B1 |
| `app/src/types/extension-auth.ts` | Create | B3 |
| `app/src/lib/auth/extension-auth.ts` | Create | B3 |
| `app/src/lib/auth/token-store.ts` | Create | B3 |
| `app/src/lib/middleware/extension-auth-middleware.ts` | Create | B3 |
| `app/src/lib/middleware/extension-rate-limiter.ts` | Create | B3 |
| `app/src/lib/websocket/ws-server.ts` | Create | B2 |
| `app/src/lib/websocket/ws-events.ts` | Create | B2 |
| `app/src/server.ts` | Create | B2 |
| `.gitignore` | Modify | B3 |
| `tests/integration/page-cache-rotation.test.ts` | Create | B1 |
| `tests/unit/websocket/ws-server.test.ts` | Create | B2 |
| `tests/unit/auth/extension-auth.test.ts` | Create | B3 |
| `tests/unit/middleware/extension-auth-middleware.test.ts` | Create | B3 |
