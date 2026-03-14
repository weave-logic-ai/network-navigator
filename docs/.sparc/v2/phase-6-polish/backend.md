# Phase 6: Polish -- Backend Domain Plan (Weeks 21-24)

## Objective

Complete the enrichment provider catalog with Apollo, Crunchbase, and BuiltWith implementations. Deliver the full admin API surface for scoring management, data governance (GDPR erasure, purge), system health, backup/restore, and advanced query capabilities. Harden all API boundaries against injection, XSS, and abuse. Ensure production-grade security posture across every backend endpoint.

## Prerequisites (from Phases 1-5)

| Prerequisite | Phase | Verified By |
|---|---|---|
| Enrichment provider abstraction layer (`EnrichmentProvider` interface) | 2 | Phase 2 gate |
| PDL, Lusha, TheirStack providers operational | 2 | Phase 2 gate |
| Enrichment waterfall with field-aware provider selection | 2 | Phase 2 gate |
| Budget enforcement tables and logic | 2 | Phase 2 gate |
| Scoring engine: all 9 dimensions, weight manager, composite calculator | 2 | Phase 2 gate |
| Tier assignment with degree-aware thresholds | 2 | Phase 2 gate |
| Contact, company, edge, cluster, score tables populated | 1-2 | Phase 2 gate |
| `enriched_contacts` materialized view operational | 2 | Phase 2 gate |
| Page cache table with 5-version rotation | 4 | Phase 4 gate |
| Selector configuration system operational | 4 | Phase 4 gate |
| Token-based auth middleware for extension endpoints | 4 | Phase 4 gate |
| Claude API integration operational | 5 | Phase 5 gate |
| Goal/task tables populated with Claude-generated data | 5 | Phase 5 gate |
| All existing API routes passing tests | 1-5 | All phase gates |

---

## Parallel Agent Assignments

| Agent | Role | Tasks | Est. Effort |
|---|---|---|---|
| Agent B1 | Enrichment Providers | Apollo, Crunchbase, BuiltWith provider implementations | High |
| Agent B2 | Admin APIs | All 10 admin API routes, schema versioning, Cypher interface | High |
| Agent B3 | Security Hardening | Input validation audit, SQL injection prevention, HTML sanitization, token rotation, rate limiting | Medium |

All three agents can run fully in parallel; there are no cross-dependencies between the groups. Agent B3 performs a final audit pass over work produced by B1 and B2 once their endpoints are committed.

---

## Detailed Task Checklist

### Task B1-1: Apollo Provider Implementation

**File**: `src/enrichment/providers/apollo.ts`
**Types**: `src/enrichment/types/apollo.ts`
**Tests**: `tests/enrichment/apollo.test.ts`

**Description**: Implement the Apollo.io enrichment provider for person-level data including email, phone, and buying intent signals. Apollo uses the v1/people/match endpoint for person lookup by name + company + domain.

**Provider Specification**:
```typescript
interface ApolloProviderConfig {
  apiKey: string;
  baseUrl: string;            // https://api.apollo.io
  costPerCall: {
    match: 0.02;              // person match only
    emailReveal: 0.05;        // email reveal
    phoneReveal: 0.10;        // phone reveal
    fullReveal: 0.24;         // email + phone + intent
  };
  matchRate: 0.76;            // ~76% match rate
  rateLimitPerMinute: 100;
  fields: ['email', 'phone', 'title', 'company', 'intent_signals', 'seniority', 'departments'];
}

interface ApolloMatchRequest {
  first_name: string;
  last_name: string;
  organization_name?: string;
  domain?: string;
  linkedin_url?: string;
  reveal_personal_emails?: boolean;
  reveal_phone_number?: boolean;
}

interface ApolloMatchResponse {
  person: {
    id: string;
    first_name: string;
    last_name: string;
    name: string;
    title: string;
    email: string | null;
    email_status: 'verified' | 'guessed' | 'unavailable';
    phone_numbers: { raw_number: string; type: string }[];
    organization: {
      name: string;
      domain: string;
      industry: string;
      estimated_num_employees: number;
    };
    seniority: string;
    departments: string[];
    intent_strength: 'high' | 'medium' | 'low' | null;
    intent_topics: string[];
  } | null;
}
```

**Sub-tasks**:
- [ ] Define `ApolloProviderConfig`, `ApolloMatchRequest`, `ApolloMatchResponse` interfaces in `src/enrichment/types/apollo.ts`
- [ ] Implement `ApolloProvider` class extending `EnrichmentProvider` base interface
- [ ] Implement `match()` method calling `POST /v1/people/match` with first_name, last_name, organization_name, domain, linkedin_url
- [ ] Implement cost calculation based on reveal type requested (match-only vs email vs phone vs full)
- [ ] Map Apollo response fields to normalized enrichment schema (`person_enrichments` table)
- [ ] Handle Apollo-specific error codes: 401 (invalid key), 422 (invalid params), 429 (rate limit)
- [ ] Implement rate limiting: max 100 requests/minute with sliding window
- [ ] Store intent signals (intent_strength, intent_topics) in `enrichment_metadata` JSONB field
- [ ] Map seniority and departments to standardized values
- [ ] Implement `estimateCost(contact, requestedFields)` for budget enforcement
- [ ] Add provider to enrichment waterfall registry with field priority: `['email', 'phone', 'intent_signals']`
- [ ] Write unit tests: successful match, no match (null person), rate limit handling, cost calculation, field mapping

**Acceptance Criteria**:
- Apollo provider integrates with enrichment waterfall without changes to waterfall logic
- Cost tracking records actual cost per call based on reveal type
- Rate limiting prevents > 100 calls/minute
- 76% match rate expectation documented; graceful handling of no-match responses
- Intent signals stored and queryable

**BR References**: BR-308 (provider management), BR-309 (enrichment waterfall)

---

### Task B1-2: Crunchbase Provider Implementation

**File**: `src/enrichment/providers/crunchbase.ts`
**Types**: `src/enrichment/types/crunchbase.ts`
**Tests**: `tests/enrichment/crunchbase.test.ts`

**Description**: Implement the Crunchbase enrichment provider for company-level data including funding, revenue, and investor information. Crunchbase is company-only enrichment; it enriches the `company_enrichments` table, not `person_enrichments`.

**Provider Specification**:
```typescript
interface CrunchbaseProviderConfig {
  apiKey: string;
  baseUrl: string;            // https://api.crunchbase.com
  costModel: 'subscription';  // $99/mo flat rate
  monthlyCost: 99;
  rateLimitPerMinute: 200;
  fields: ['funding_total', 'funding_rounds', 'revenue_range', 'investors', 'founded_on', 'num_employees_enum', 'categories', 'short_description'];
}

interface CrunchbaseOrganizationResponse {
  properties: {
    identifier: { permalink: string; uuid: string };
    short_description: string;
    founded_on: string | null;
    num_employees_enum: string;       // '11-50', '51-100', etc.
    revenue_range: string;            // '$1M-$10M', etc.
    categories: { value: string }[];
    funding_total: { value: number; currency: string } | null;
    last_funding_type: string | null;
    num_funding_rounds: number;
    ipo_status: 'public' | 'private' | 'delisted' | null;
  };
  cards: {
    investors: {
      investor_identifier: { value: string; permalink: string };
      funding_round_identifier: { value: string };
      is_lead_investor: boolean;
    }[];
    funding_rounds: {
      identifier: { uuid: string };
      announced_on: string;
      money_raised: { value: number; currency: string };
      funding_type: string;
      num_investors: number;
      lead_investor_identifiers: { value: string }[];
    }[];
  };
}
```

**Sub-tasks**:
- [ ] Define `CrunchbaseProviderConfig`, `CrunchbaseOrganizationResponse` interfaces in `src/enrichment/types/crunchbase.ts`
- [ ] Implement `CrunchbaseProvider` class extending `EnrichmentProvider` base interface
- [ ] Implement `searchOrganization(companyName, domain?)` calling `GET /api/v4/autocompletes` for fuzzy company match
- [ ] Implement `getOrganization(permalink)` calling `GET /api/v4/entities/organizations/:permalink` with card_ids `investors,funding_rounds`
- [ ] Map Crunchbase response to `company_enrichments` table: funding_total, num_funding_rounds, revenue_range, num_employees_enum, founded_on, ipo_status, categories
- [ ] Store investors array in `company_enrichments.investors` JSONB field
- [ ] Store funding rounds in `company_enrichments.funding_rounds` JSONB field
- [ ] Handle company name ambiguity: use domain match as tiebreaker in autocomplete results
- [ ] Implement cost tracking: subscription model ($99/mo), log each API call but do not debit per-call cost
- [ ] Handle Crunchbase-specific errors: 401 (auth), 404 (org not found), 429 (rate limit), 403 (exceeded plan)
- [ ] Rate limit: max 200 requests/minute
- [ ] Add provider to enrichment waterfall for company-level enrichment with field priority: `['funding_total', 'revenue_range', 'investors']`
- [ ] Write unit tests: successful lookup, company not found, ambiguous company name, rate limit, field mapping

**Acceptance Criteria**:
- Crunchbase enriches company records, not person records
- Funding data populates with correct currency normalization (convert to USD)
- Revenue range stored as enum string for consistent filtering
- Company match uses domain as tiebreaker when available
- Subscription cost model tracked (monthly, not per-call)

**BR References**: BR-308 (provider management), BR-309 (enrichment waterfall)

---

### Task B1-3: BuiltWith Provider Implementation

**File**: `src/enrichment/providers/builtwith.ts`
**Types**: `src/enrichment/types/builtwith.ts`
**Tests**: `tests/enrichment/builtwith.test.ts`

**Description**: Implement the BuiltWith enrichment provider for company-level technographic data. BuiltWith provides comprehensive tech stack information used for technology-based ICP matching and scoring.

**Provider Specification**:
```typescript
interface BuiltWithProviderConfig {
  apiKey: string;
  baseUrl: string;            // https://api.builtwith.com
  costModel: 'subscription';  // $295/mo for comprehensive
  monthlyCost: 295;
  apiVersion: 'v21';
  rateLimitPerMinute: 150;
  fields: ['technologies', 'tech_categories', 'tech_spend', 'first_detected', 'last_detected'];
}

interface BuiltWithLookupResponse {
  Results: {
    Result: {
      Paths: {
        Domain: string;
        SubDomain: string;
        Url: string;
        Technologies: {
          Name: string;
          Tag: string;           // category tag
          Categories: string[];
          FirstDetected: number; // unix timestamp ms
          LastDetected: number;
          IsPremium: string;     // 'yes' | 'no'
        }[];
      }[];
    };
    Meta: {
      CompanyName: string;
      Telephones: string[];
      Emails: string[];
      City: string;
      State: string;
      Country: string;
      Vertical: string;
    };
  }[];
  Errors: { Code: number; Message: string }[];
}
```

**Sub-tasks**:
- [ ] Define `BuiltWithProviderConfig`, `BuiltWithLookupResponse` interfaces in `src/enrichment/types/builtwith.ts`
- [ ] Implement `BuiltWithProvider` class extending `EnrichmentProvider` base interface
- [ ] Implement `lookup(domain)` calling `GET /v21/api.json?KEY=:key&LOOKUP=:domain&NOMETA=no&NOATTR=no`
- [ ] Parse technology list and group by category (Analytics, CMS, E-commerce, Framework, Hosting, CDN, JavaScript, etc.)
- [ ] Store normalized tech stack in `company_enrichments.tech_stack` JSONB field:
  ```json
  {
    "technologies": [{ "name": "React", "category": "JavaScript Frameworks", "firstDetected": "2020-01-15", "lastDetected": "2024-03-01" }],
    "categories": { "JavaScript Frameworks": ["React", "Next.js"], "Analytics": ["Google Analytics", "Mixpanel"] },
    "totalTechCount": 42,
    "premiumTechCount": 8
  }
  ```
- [ ] Compute tech sophistication score (0-100) based on: premium tech count, total tech count, diversity of categories, recency of adoption
- [ ] Handle domain-not-found gracefully (BuiltWith returns empty Results array)
- [ ] Handle BuiltWith-specific errors: error codes in Errors array
- [ ] Implement subscription cost tracking ($295/mo)
- [ ] Rate limit: max 150 requests/minute
- [ ] Add provider to enrichment waterfall for company-level enrichment with field priority: `['technologies', 'tech_categories']`
- [ ] Write unit tests: successful lookup with multiple techs, domain not found, error handling, tech categorization, sophistication score calculation

**Acceptance Criteria**:
- Tech stack data stored in structured JSONB for query and display
- Categories normalized to consistent taxonomy
- Tech sophistication score computed and stored for scoring integration
- Domain lookup handles www vs non-www variants
- Subscription cost model tracked correctly

**BR References**: BR-308 (provider management), BR-309 (enrichment waterfall)

---

### Task B2-1: GET /api/admin/health -- System Health Endpoint

**File**: `app/src/app/api/admin/health/route.ts`
**Types**: `app/src/types/admin.ts`
**Tests**: `tests/api/admin-health.test.ts`

**Description**: Comprehensive health check endpoint returning status of all system components: database connection, extension connectivity, enrichment provider availability, background job status, and resource utilization.

**Response Shape**:
```typescript
interface SystemHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;                    // seconds
  components: {
    database: {
      status: 'up' | 'down';
      latency: number;              // ms for SELECT 1
      connectionPool: {
        total: number;
        active: number;
        idle: number;
        waiting: number;
      };
      diskUsage: {
        totalMB: number;
        usedMB: number;
        percentUsed: number;
      };
    };
    extension: {
      status: 'connected' | 'disconnected' | 'unknown';
      lastSeen: string | null;
      activeWebSockets: number;
    };
    providers: {
      name: string;
      status: 'active' | 'inactive' | 'error' | 'rate_limited';
      lastSuccess: string | null;
      lastError: string | null;
      remainingBudget: number | null;
    }[];
    backgroundJobs: {
      reparseQueue: number;
      enrichmentQueue: number;
      scoringQueue: number;
      lastCompletedJob: string | null;
    };
  };
  version: string;                   // app version from package.json
}
```

**Sub-tasks**:
- [ ] Define `SystemHealthResponse` interface in `app/src/types/admin.ts`
- [ ] Implement DB health check: `SELECT 1` with latency measurement
- [ ] Query connection pool stats from pg pool
- [ ] Query disk usage: `SELECT pg_database_size(current_database())`
- [ ] Query extension status from `extension_sessions` table (last heartbeat)
- [ ] Query active WebSocket connections count
- [ ] Query each enrichment provider status from `enrichment_budget` table (remaining budget, last success/error timestamps)
- [ ] Query background job queue depths from respective tables
- [ ] Compute overall status: healthy (all up), degraded (some warnings), unhealthy (DB down or critical failure)
- [ ] Read version from `package.json`
- [ ] Add `Cache-Control: no-cache` header (health must always be fresh)
- [ ] Write unit tests: all healthy, DB down scenario, provider degraded, extension disconnected

**Acceptance Criteria**:
- Endpoint responds within 500ms even when some components are down
- Uses timeouts on individual checks (2s max per component) to prevent hanging
- Overall status correctly reflects worst-case component status
- Response shape is consistent regardless of component availability

**BR References**: BR-905

---

### Task B2-2: GET /api/admin/stats -- System-Wide Statistics

**File**: `app/src/app/api/admin/stats/route.ts`
**Tests**: `tests/api/admin-stats.test.ts`

**Description**: Aggregate statistics endpoint for the admin dashboard showing counts across all major entities.

**Response Shape**:
```typescript
interface SystemStatsResponse {
  contacts: {
    total: number;
    byTier: { gold: number; silver: number; bronze: number; watch: number };
    enriched: number;
    withEmail: number;
    withPhone: number;
    importedLast7d: number;
    importedLast30d: number;
  };
  companies: {
    total: number;
    withFunding: number;
    withTechStack: number;
  };
  enrichments: {
    totalCalls: number;
    byProvider: { provider: string; calls: number; cost: number; successRate: number }[];
    totalCost: number;
    last7dCost: number;
  };
  scores: {
    avgGoldScore: number;
    medianGoldScore: number;
    scoredContacts: number;
    unscoredContacts: number;
    lastScoringRun: string | null;
  };
  graph: {
    nodes: number;
    edges: number;
    clusters: number;
    avgDegree: number;
  };
  captures: {
    total: number;
    last24h: number;
    last7d: number;
    byPageType: { type: string; count: number }[];
  };
  goals: {
    total: number;
    active: number;
    completed: number;
  };
  tasks: {
    total: number;
    pending: number;
    completed: number;
    overdue: number;
  };
}
```

**Sub-tasks**:
- [ ] Implement contact stats aggregation queries with tier breakdown
- [ ] Implement company stats with funding and tech stack counts
- [ ] Implement enrichment stats: total calls, per-provider breakdown, cost aggregation
- [ ] Implement scoring stats: avg/median gold_score, scored vs unscored counts
- [ ] Implement graph stats: node/edge/cluster counts, average degree
- [ ] Implement capture stats from `page_cache` table with time-window counts
- [ ] Implement goal and task stats from respective tables
- [ ] Use `Promise.all()` for parallel query execution
- [ ] Add `Cache-Control: private, max-age=30` (stats can be slightly stale)
- [ ] Write unit tests: populated data, empty database, partial data

**Acceptance Criteria**:
- All counts are accurate and consistent
- Response time < 500ms with caching
- Works correctly on empty database (all zeros)
- Cost figures match enrichment budget tracking tables

**BR References**: BR-905

---

### Task B2-3: POST /api/admin/purge -- Data Purge Endpoint

**File**: `app/src/app/api/admin/purge/route.ts`
**Types**: `app/src/types/admin.ts` (add `PurgeRequest`, `PurgeResponse`)
**Tests**: `tests/api/admin-purge.test.ts`

**Description**: Admin endpoint for bulk data deletion with filter-based selection. Supports preview mode (dry run) to show what would be deleted before executing.

**Request Shape**:
```typescript
interface PurgeRequest {
  mode: 'preview' | 'execute';
  filters: {
    namePattern?: string;           // ILIKE pattern, e.g., '%test%'
    olderThanDays?: number;         // contacts not updated in X days
    dateRange?: {
      from: string;                 // ISO date
      to: string;                   // ISO date
    };
    tiers?: ('gold' | 'silver' | 'bronze' | 'watch')[];
    clusterIds?: string[];
    enrichmentSource?: string;      // only contacts enriched by this source
    hasNoEnrichment?: boolean;      // contacts with zero enrichments
    importBatchId?: string;         // specific import batch
  };
  confirm?: string;                 // must be 'PURGE' for execute mode
}
```

**Response Shape**:
```typescript
interface PurgeResponse {
  mode: 'preview' | 'execute';
  matchedContacts: number;
  matchedEdges: number;
  matchedEnrichments: number;
  matchedScores: number;
  matchedObservations: number;
  sampleContacts: {
    id: string;
    name: string;
    tier: string;
    lastUpdated: string;
  }[];                              // first 10 matching contacts (preview only)
  executedAt?: string;              // only in execute mode
  duration?: number;                // ms, only in execute mode
}
```

**Sub-tasks**:
- [ ] Define `PurgeRequest` and `PurgeResponse` interfaces in `app/src/types/admin.ts`
- [ ] Implement filter-to-SQL builder with parameterized queries (NO string concatenation)
- [ ] Implement `preview` mode: COUNT matching records across all related tables (contacts, edges, enrichments, scores, observations, embeddings)
- [ ] In preview mode, return first 10 matching contacts as sample
- [ ] Implement `execute` mode: require `confirm === 'PURGE'` field for safety
- [ ] Execute cascading deletes in a transaction:
  1. Delete from `behavioral_observations` WHERE contact_id IN (matched set)
  2. Delete from `person_enrichments` WHERE contact_id IN (matched set)
  3. Delete from `contact_scores` / `score_dimensions` WHERE contact_id IN (matched set)
  4. Delete from `edges` WHERE source_id OR target_id IN (matched set)
  5. Delete from `profile_embeddings` WHERE contact_id IN (matched set)
  6. Delete from `contacts` WHERE id IN (matched set)
- [ ] Log purge operation: who, when, filters used, count deleted
- [ ] Refresh materialized views after purge (`enriched_contacts`)
- [ ] Validate all filter inputs: sanitize namePattern for SQL injection, validate date formats, validate tier values
- [ ] Write unit tests: preview mode accuracy, execute with confirmation, execute without confirmation (reject), cascading delete completeness, empty filter (reject -- must have at least one filter)

**Acceptance Criteria**:
- Preview mode returns accurate counts without modifying data
- Execute mode requires explicit `confirm: 'PURGE'` string
- Cascading deletes leave no orphaned records
- Transaction rolls back on any error during delete sequence
- At least one filter is required (no full-database wipe)
- Operation is logged for audit trail

**BR References**: BR-902

---

### Task B2-4: POST /api/admin/backup -- Database Backup

**File**: `app/src/app/api/admin/backup/route.ts`
**Tests**: `tests/api/admin-backup.test.ts`

**Description**: Trigger a database backup and return the backup metadata. Uses `pg_dump` to create a compressed backup file stored in the configured backup directory.

**Response Shape**:
```typescript
interface BackupResponse {
  id: string;
  filename: string;
  sizeMB: number;
  createdAt: string;
  duration: number;               // ms
  tables: number;
  status: 'completed' | 'failed';
  error?: string;
}
```

**Sub-tasks**:
- [ ] Implement backup trigger using `pg_dump` with `--format=custom --compress=9`
- [ ] Store backup in `/backups/` directory (configurable via env `BACKUP_DIR`)
- [ ] Generate backup filename: `backup-{timestamp}-{short-uuid}.dump`
- [ ] Capture backup metadata: size, duration, table count
- [ ] Store backup metadata record in `admin_backups` table for history
- [ ] Add GET endpoint to list previous backups: `GET /api/admin/backups`
- [ ] Implement backup rotation: keep last 10 backups, delete older ones
- [ ] Handle backup failure gracefully (disk full, permissions, pg_dump not found)
- [ ] Write unit tests: successful backup, backup failure handling, rotation logic

**Acceptance Criteria**:
- Backup file is created and verifiable (can be restored with `pg_restore`)
- Backup history is queryable
- Old backups are automatically rotated
- Backup does not block other database operations (uses `--no-lock` or runs during low activity)

**BR References**: BR-907

---

### Task B2-5: GET /api/admin/schema-version -- Schema Version

**File**: `app/src/app/api/admin/schema-version/route.ts`
**Tests**: `tests/api/admin-schema-version.test.ts`

**Description**: Return the current database schema version and migration history.

**Response Shape**:
```typescript
interface SchemaVersionResponse {
  currentVersion: string;         // e.g., '2.0.4'
  appliedAt: string;              // when the current version was applied
  migrations: {
    version: string;
    name: string;
    appliedAt: string;
    duration: number;             // ms
  }[];
  pendingMigrations: string[];    // versions not yet applied
}
```

**Sub-tasks**:
- [ ] Query `schema_versions` table for current version and migration history
- [ ] Check migration files directory for pending (unapplied) migrations
- [ ] Return complete migration timeline ordered by applied_at
- [ ] Write unit tests: current version retrieval, pending migration detection

**Acceptance Criteria**:
- Accurately reports current schema state
- Detects pending migrations that have not been applied
- Response time < 50ms

**BR References**: BR-904

---

### Task B2-6: POST /api/admin/forget/:contactId -- GDPR Right to Erasure

**File**: `app/src/app/api/admin/forget/[contactId]/route.ts`
**Tests**: `tests/api/admin-forget.test.ts`

**Description**: GDPR Article 17 compliant right-to-erasure endpoint. Permanently deletes all data associated with a contact including enrichments, scores, observations, embeddings, edges, messages, outreach state, and the contact record itself.

**Response Shape**:
```typescript
interface ForgetResponse {
  contactId: string;
  contactName: string;
  deletedRecords: {
    contact: 1;
    enrichments: number;
    scores: number;
    observations: number;
    embeddings: number;
    edges: number;
    messages: number;
    outreachStates: number;
    pageCacheReferences: number;
  };
  completedAt: string;
  auditLogId: string;
}
```

**Sub-tasks**:
- [ ] Validate contactId exists; return 404 if not found
- [ ] Execute cascading delete in a single transaction across all tables:
  1. `person_enrichments` WHERE contact_id = :id
  2. `company_enrichments` WHERE company_id IN (SELECT company_id FROM contacts WHERE id = :id) -- only if no other contacts reference the company
  3. `contact_scores` WHERE contact_id = :id
  4. `score_dimensions` WHERE contact_id = :id
  5. `behavioral_observations` WHERE contact_id = :id
  6. `profile_embeddings` WHERE contact_id = :id
  7. `content_embeddings` WHERE contact_id = :id
  8. `edges` WHERE source_id = :id OR target_id = :id
  9. `messages` WHERE contact_id = :id
  10. `message_stats` WHERE contact_id = :id
  11. `outreach_states` WHERE contact_id = :id
  12. `outreach_events` WHERE contact_id = :id
  13. `task` records WHERE contact_id = :id
  14. `page_cache` references (remove contact_id from parsed_contact_ids array, do not delete the cached page)
  15. `contacts` WHERE id = :id
- [ ] Create audit log entry: `{ action: 'gdpr_forget', contactId, contactName, timestamp, deletedCounts }`
- [ ] Store audit log in `admin_audit_log` table (audit records are retained even after erasure for compliance)
- [ ] Do NOT delete the audit log entry itself (GDPR allows retention of erasure records)
- [ ] Return detailed deletion counts per table
- [ ] Write unit tests: successful erasure with all record types, contact not found, transaction rollback on partial failure, audit log creation

**Acceptance Criteria**:
- All personal data for the contact is permanently deleted
- Company records are preserved if other contacts reference them
- Audit trail records the erasure event (without personal data -- only contactId and timestamp)
- Transaction ensures atomicity -- partial deletion is rolled back
- Response includes counts of deleted records per table for verification

**BR References**: BR-210

---

### Task B2-7: Page Cache Admin Endpoints

**Files**:
- `app/src/app/api/admin/page-cache/route.ts` (GET list)
- `app/src/app/api/admin/page-cache/[id]/route.ts` (DELETE)
**Tests**: `tests/api/admin-page-cache.test.ts`

**Description**: Admin endpoints to view and manage the page cache used by the extension capture system.

**GET /api/admin/page-cache Response Shape**:
```typescript
interface PageCacheListResponse {
  entries: {
    id: string;
    url: string;
    pageType: 'profile' | 'search' | 'feed' | 'company';
    capturedAt: string;
    sizeKB: number;
    version: number;
    parsed: boolean;
    parsedContactId: string | null;
    parsedContactName: string | null;
  }[];
  total: number;
  totalSizeMB: number;
}
```

**Sub-tasks**:
- [ ] Implement GET endpoint with pagination (limit/offset) and filters (pageType, parsed, dateRange)
- [ ] Include size calculation per entry (`LENGTH(html_content)`)
- [ ] Implement DELETE endpoint to remove a specific cache entry
- [ ] Validate cache entry exists before delete; return 404 if not found
- [ ] Write unit tests: list with filters, delete existing, delete non-existent

**Acceptance Criteria**:
- List endpoint supports pagination and filtering
- Size calculation is accurate
- Delete properly removes the cache entry and does not affect related contact records

---

### Task B2-8: POST /api/admin/refresh-views -- Refresh Materialized Views

**File**: `app/src/app/api/admin/refresh-views/route.ts`
**Tests**: `tests/api/admin-refresh-views.test.ts`

**Description**: Trigger a refresh of all materialized views. Used after bulk operations (import, purge, scoring) to ensure dashboard and search data is current.

**Response Shape**:
```typescript
interface RefreshViewsResponse {
  views: {
    name: string;
    refreshed: boolean;
    duration: number;             // ms
    rowCount: number;
    error?: string;
  }[];
  totalDuration: number;
}
```

**Sub-tasks**:
- [ ] Refresh `enriched_contacts` materialized view: `REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_contacts`
- [ ] Refresh any other materialized views (wedge_metrics, etc.)
- [ ] Use `CONCURRENTLY` option to avoid locking reads during refresh
- [ ] Record duration and row count for each view
- [ ] Handle individual view refresh failures without failing the entire operation
- [ ] Write unit tests: successful refresh, partial failure handling

**Acceptance Criteria**:
- All materialized views are refreshed
- `CONCURRENTLY` prevents read blocking
- Individual failures are reported but do not prevent other views from refreshing
- Response includes timing and row counts for monitoring

**BR References**: BR-906

---

### Task B2-9: POST /api/admin/cypher -- Admin Cypher Query Interface

**File**: `app/src/app/api/admin/cypher/route.ts`
**Tests**: `tests/api/admin-cypher.test.ts`

**Description**: Admin-only endpoint for executing Cypher-like graph queries against the ruvector graph engine. Provides direct access to graph analytics for advanced users.

**Request Shape**:
```typescript
interface CypherRequest {
  query: string;                   // Cypher query string
  params?: Record<string, unknown>; // query parameters
  timeout?: number;                // max execution time ms (default 5000, max 30000)
}
```

**Response Shape**:
```typescript
interface CypherResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;           // ms
  warnings: string[];
}
```

**Sub-tasks**:
- [ ] Implement Cypher query execution via ruvector's graph query interface
- [ ] Enforce query timeout (default 5s, max 30s) using `statement_timeout`
- [ ] Restrict to read-only queries: reject queries containing `CREATE`, `DELETE`, `SET`, `MERGE`, `REMOVE`, `DROP` (case-insensitive)
- [ ] Parameterize query execution to prevent injection
- [ ] Log all queries to `admin_audit_log` with query text, execution time, and row count
- [ ] Return structured column/row format for flexible UI rendering
- [ ] Include warnings for slow queries (> 2s) or large result sets (> 1000 rows)
- [ ] Write unit tests: valid query execution, read-only enforcement, timeout enforcement, parameter binding

**Acceptance Criteria**:
- Only read-only Cypher queries are permitted
- Query timeout prevents runaway queries
- All queries are audit-logged
- Parameters are properly bound (no injection)
- Results are structured for easy table rendering in admin UI

**BR References**: BR-908

---

### Task B2-10: Remaining Admin Endpoints

**Files**:
- `app/src/app/api/admin/scoring/weights/route.ts` (GET, PUT)
- `app/src/app/api/admin/scoring/rescore/route.ts` (POST)
- `app/src/app/api/admin/scoring/profiles/route.ts` (GET, POST)
- `app/src/app/api/admin/scoring/profiles/[id]/route.ts` (PUT, DELETE)
- `app/src/app/api/admin/scoring/tiers/route.ts` (GET, PUT)
**Tests**: `tests/api/admin-scoring.test.ts`

**Description**: API endpoints supporting the admin scoring panel. These endpoints manage weight profiles, tier thresholds, and trigger rescoring.

**Sub-tasks**:
- [ ] `GET /api/admin/scoring/weights` -- return current scoring dimension weights
- [ ] `PUT /api/admin/scoring/weights` -- update weights with validation (must sum to 1.0, all >= 0)
- [ ] `POST /api/admin/scoring/rescore` -- trigger full rescore of all contacts (background job)
- [ ] `GET /api/admin/scoring/profiles` -- list named weight profiles ("Sales-focused", "Networking-focused")
- [ ] `POST /api/admin/scoring/profiles` -- create new named weight profile
- [ ] `PUT /api/admin/scoring/profiles/:id` -- update an existing profile
- [ ] `DELETE /api/admin/scoring/profiles/:id` -- delete a profile (prevent deleting the active profile)
- [ ] `GET /api/admin/scoring/tiers` -- return current tier thresholds
- [ ] `PUT /api/admin/scoring/tiers` -- update tier thresholds with validation (gold > silver > bronze > watch >= 0)
- [ ] After weight or tier update, automatically trigger rescore
- [ ] Write unit tests: weight sum validation, tier ordering validation, profile CRUD, rescore trigger

**Acceptance Criteria**:
- Weight updates enforce sum-to-1.0 constraint
- Tier threshold updates enforce ordering constraint
- Rescore triggers background processing (does not block the response)
- Profile CRUD follows standard REST patterns
- Active profile cannot be deleted

**BR References**: BR-901, BR-405, BR-407, BR-411

---

### Task B3-1: Input Validation Audit and Hardening

**Files**: All `app/src/app/api/**/*.ts` route files
**Tests**: `tests/security/input-validation.test.ts`

**Description**: Comprehensive security audit of all API endpoints. Add or strengthen input validation, sanitization, and error handling across the entire API surface.

**Sub-tasks**:
- [ ] Audit all API routes for missing input validation
- [ ] Add Zod schema validation to all POST/PUT endpoints:
  ```typescript
  import { z } from 'zod';
  const schema = z.object({ /* ... */ });
  const result = schema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: result.error.issues }, { status: 400 });
  ```
- [ ] Validate all URL path parameters (contactId format, valid UUIDs)
- [ ] Validate all query parameters (numeric ranges, enum values, string lengths)
- [ ] Ensure all SQL queries use parameterized queries (`$1, $2` syntax, NEVER string interpolation)
- [ ] Audit for any remaining `query()` calls with template literals and convert to parameterized
- [ ] Add request body size limits: 1MB for standard endpoints, 10MB for import/capture endpoints
- [ ] Add Content-Type validation: reject non-JSON bodies on JSON endpoints
- [ ] Write comprehensive validation tests: boundary values, type coercion attacks, oversized payloads, missing required fields

**Acceptance Criteria**:
- Every POST/PUT endpoint uses Zod validation
- Every SQL query uses parameterized queries
- Every URL/query parameter is validated
- Request body size limits enforced
- Invalid inputs return 400 with descriptive error messages
- No SQL injection vectors exist

---

### Task B3-2: HTML Sanitization in Parser Outputs

**Files**:
- `app/src/lib/parsers/*.ts` (all parser files)
- `src/enrichment/providers/*.ts` (all provider files)
**Tests**: `tests/security/sanitization.test.ts`

**Description**: Ensure all data ingested from external sources (LinkedIn HTML, enrichment API responses) is sanitized before storage and display.

**Sub-tasks**:
- [ ] Add HTML entity encoding for all text fields extracted by parsers (name, headline, about, experience)
- [ ] Strip HTML tags from all plain text fields using DOMPurify or sanitize-html
- [ ] Validate and sanitize URLs (ensure they start with http:// or https://, no javascript: URIs)
- [ ] Sanitize enrichment provider response fields before storage
- [ ] Ensure no raw HTML is stored in text columns (only in the page_cache html_content column, which is never rendered directly)
- [ ] Add CSP headers to all API responses: `Content-Security-Policy: default-src 'self'`
- [ ] Write tests with XSS payloads: `<script>alert(1)</script>`, `javascript:alert(1)`, event handlers in attributes

**Acceptance Criteria**:
- No stored XSS vectors in any text field
- All URLs are validated before storage
- CSP headers present on all responses
- XSS payload tests pass (payloads are neutralized)

---

### Task B3-3: Token Rotation Mechanism

**File**: `app/src/lib/auth/token-rotation.ts`
**Tests**: `tests/security/token-rotation.test.ts`

**Description**: Implement token rotation for extension authentication. Tokens should have a configurable TTL and be automatically rotated on each successful authentication.

**Sub-tasks**:
- [ ] Implement token generation: crypto-random 256-bit tokens, base64url encoded
- [ ] Add token TTL: configurable expiry (default 7 days), stored in `extension_tokens` table
- [ ] Implement rotation on use: each successful API call with a valid token returns a new token in the `X-New-Token` response header
- [ ] Client (extension) must use the new token for subsequent requests; old token is invalidated after grace period (5 minutes)
- [ ] Add `POST /api/extension/rotate-token` explicit rotation endpoint
- [ ] Handle token expiry: return 401 with `{ error: 'token_expired', action: 're-register' }`
- [ ] Store token hashes (SHA-256) in database, never store raw tokens
- [ ] Write unit tests: token generation, rotation on use, expiry, grace period, hash storage

**Acceptance Criteria**:
- Tokens are cryptographically random and sufficiently long
- Old tokens become invalid after grace period
- Expired tokens return clear error with re-registration instructions
- Raw tokens are never stored in the database
- Token rotation does not break concurrent requests within grace period

---

### Task B3-4: Rate Limiting on Enrichment Endpoints

**File**: `app/src/middleware/rate-limiter.ts`
**Tests**: `tests/security/rate-limiting.test.ts`

**Description**: Implement rate limiting on enrichment-related endpoints to prevent abuse and runaway costs.

**Sub-tasks**:
- [ ] Implement sliding window rate limiter using PostgreSQL (no external Redis dependency):
  ```sql
  -- Rate limit table
  CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,
    tokens INTEGER NOT NULL,
    last_refill TIMESTAMPTZ NOT NULL,
    max_tokens INTEGER NOT NULL,
    refill_rate INTEGER NOT NULL  -- tokens per second
  );
  ```
- [ ] Apply rate limits per endpoint category:
  - Enrichment endpoints: 10 requests/minute per IP
  - Admin endpoints: 30 requests/minute per IP
  - Search endpoints: 60 requests/minute per IP
  - Extension capture: 120 requests/minute per token
- [ ] Return 429 with `Retry-After` header when rate limit exceeded
- [ ] Include rate limit headers on all responses: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- [ ] Implement IP-based limiting for unauthenticated endpoints, token-based for authenticated
- [ ] Write unit tests: limit enforcement, header accuracy, reset timing, concurrent request handling

**Acceptance Criteria**:
- Rate limits prevent enrichment endpoint abuse
- 429 responses include proper Retry-After header
- Rate limit state persists across app restarts (stored in DB)
- Rate limit headers are present on all responses
- Concurrent requests near the limit boundary are handled correctly (no race conditions)

---

## Orchestrator Instructions

### Execution Strategy

1. **Spawn 3 agents** (B1, B2, B3) in parallel at phase start
2. Agent B1 (Enrichment) works independently on the three provider implementations
3. Agent B2 (Admin) works independently on all admin API routes
4. Agent B3 (Security) begins with the input validation audit and token rotation, then performs a final sweep of B1 and B2 outputs
5. Each agent should:
   a. Read existing provider/admin code patterns before implementing
   b. Follow the established `EnrichmentProvider` interface for B1 tasks
   c. Create type definitions first in `app/src/types/admin.ts` or `src/enrichment/types/`
   d. Implement endpoints with Zod validation, error handling, and proper HTTP status codes
   e. Write unit tests for each endpoint in `tests/`
   f. Run `npm test` and `npm run lint` after implementation

### Shared Patterns

All admin endpoints must follow these patterns:

```typescript
// Admin route with validation
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: result.error.issues },
        { status: 400 }
      );
    }
    // ... implementation with parameterized queries
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Admin API] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

All enrichment providers must follow this pattern:

```typescript
// Provider implementation
import { EnrichmentProvider, EnrichmentResult } from '../types';

export class ApolloProvider implements EnrichmentProvider {
  readonly name = 'apollo';
  readonly fields = ['email', 'phone', 'intent_signals'];
  readonly costModel = 'per_call';

  async enrich(contact: Contact, requestedFields: string[]): Promise<EnrichmentResult> {
    // ... implementation
  }

  async estimateCost(contact: Contact, requestedFields: string[]): Promise<number> {
    // ... cost estimation
  }

  async checkHealth(): Promise<ProviderHealth> {
    // ... health check
  }
}
```

### Testing Requirements

For each endpoint/provider, write tests covering:
- Successful operation with populated data
- Graceful handling of empty/missing data
- Invalid input rejection (400 responses)
- Not-found resources (404 responses)
- Provider-specific error codes
- Rate limit and budget enforcement
- Security: injection attempts, XSS payloads, oversized inputs

Test files:
- `tests/enrichment/apollo.test.ts`
- `tests/enrichment/crunchbase.test.ts`
- `tests/enrichment/builtwith.test.ts`
- `tests/api/admin-health.test.ts`
- `tests/api/admin-stats.test.ts`
- `tests/api/admin-purge.test.ts`
- `tests/api/admin-backup.test.ts`
- `tests/api/admin-schema-version.test.ts`
- `tests/api/admin-forget.test.ts`
- `tests/api/admin-page-cache.test.ts`
- `tests/api/admin-refresh-views.test.ts`
- `tests/api/admin-cypher.test.ts`
- `tests/api/admin-scoring.test.ts`
- `tests/security/input-validation.test.ts`
- `tests/security/sanitization.test.ts`
- `tests/security/token-rotation.test.ts`
- `tests/security/rate-limiting.test.ts`

---

## Dependencies

### Upstream (required before this work)

| Dependency | Source | Status |
|---|---|---|
| Enrichment provider abstraction layer | Phase 2 Backend | Must pass Phase 2 gate |
| PDL, Lusha, TheirStack providers operational | Phase 2 Backend | Must pass Phase 2 gate |
| Enrichment waterfall logic | Phase 2 Backend | Must pass Phase 2 gate |
| Budget enforcement | Phase 2 Backend | Must pass Phase 2 gate |
| Scoring engine operational | Phase 2 Backend | Must pass Phase 2 gate |
| Token-based auth middleware | Phase 4 Backend | Must pass Phase 4 gate |
| Page cache and selector config system | Phase 4 Backend | Must pass Phase 4 gate |
| All core tables populated | Phase 1-5 | All phase gates |
| Materialized views operational | Phase 2 Backend | Must pass Phase 2 gate |
| WebSocket server for extension | Phase 4 Backend | Must pass Phase 4 gate |

### Downstream (blocks these)

| Dependent | Domain | Blocked Tasks |
|---|---|---|
| Admin Panel (Agent A2) | App | ScoringPanel, DataPurgePanel, ProviderManagement need admin APIs |
| System health dashboard (Agent A4) | App | Health page needs `GET /api/admin/health` |
| Provider management page (Agent A2) | App | Provider cards need provider health/status from admin APIs |
| Import wizard (Agent A3) | App | Progressive Claude questions need enrichment providers for context |
| Extension settings (Agent E1) | Extension | Token re-registration needs token rotation endpoint |

### Mitigation

App agents should begin work immediately using mock data that matches the response shapes defined above. Backend agents must deliver admin API endpoints within the first week of the phase so App agents can integrate real data. Enrichment provider implementations can land later as they are used in background processes, not direct UI rendering.

---

## Gate Criteria

All of the following must pass before Phase 6 Backend is considered complete:

### Enrichment Providers
- [ ] Apollo provider enriches a contact with email and/or phone data
- [ ] Crunchbase provider enriches a company with funding and investor data
- [ ] BuiltWith provider enriches a company with technology stack data
- [ ] All three providers integrate with the enrichment waterfall
- [ ] Budget tracking records costs for all three providers
- [ ] Rate limiting prevents exceeding provider API limits

### Admin APIs
- [ ] `GET /api/admin/health` returns accurate system health across all components
- [ ] `GET /api/admin/stats` returns accurate aggregate statistics
- [ ] `POST /api/admin/purge` preview mode returns accurate counts; execute mode deletes with cascading
- [ ] `POST /api/admin/backup` creates a valid backup file
- [ ] `GET /api/admin/schema-version` returns current version and migration history
- [ ] `POST /api/admin/forget/:contactId` completely erases all contact data with audit trail
- [ ] `GET /api/admin/page-cache` lists cache entries with pagination
- [ ] `POST /api/admin/refresh-views` refreshes all materialized views concurrently
- [ ] `POST /api/admin/cypher` executes read-only graph queries with timeout enforcement
- [ ] Scoring admin endpoints (weights, profiles, tiers, rescore) all operational

### Security
- [ ] All POST/PUT endpoints validate input with Zod schemas
- [ ] All SQL queries use parameterized queries (zero string interpolation)
- [ ] HTML sanitization prevents stored XSS in all text fields
- [ ] Token rotation works with grace period for concurrent requests
- [ ] Rate limiting enforced on enrichment, admin, search, and capture endpoints
- [ ] CSP headers present on all API responses
- [ ] Request body size limits enforced

### Quality
- [ ] All endpoint tests pass (`npm test`)
- [ ] No lint errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Response times within performance targets per endpoint
- [ ] No security vulnerabilities in dependency audit (`npm audit`)

### Production Readiness
- [ ] All enrichment provider API keys configurable via environment variables
- [ ] Backup directory configurable and writable
- [ ] Rate limit configuration adjustable without code changes
- [ ] Token TTL configurable via environment variable
- [ ] Admin endpoints protected (authentication verified before access)
- [ ] Audit logging active for all admin operations
- [ ] Error responses never leak internal details (stack traces, SQL queries)
