# Phase 1: Foundation -- Backend Plan

## Objective

Stand up the complete PostgreSQL database schema (30+ tables with vector/graph extensions), Docker infrastructure, a full CSV import pipeline covering all LinkedIn export file types, and baseline CRUD API routes -- forming the data foundation that all subsequent phases build upon.

## Prerequisites

- Docker and Docker Compose installed on host machine
- `ruvnet/ruvector-postgres:latest` image accessible (DockerHub pull)
- Node.js 18+ installed
- LinkedIn CSV data exports available for testing (at minimum: Connections.csv, messages.csv)
- `.env` file with `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB` defined

---

## Parallel Agent Assignments

### Agent 1: Schema Architect

**Scope**: All PostgreSQL DDL -- tables, indexes, triggers, materialized views, functions, extensions, schema versioning.

**Runs in parallel with**: Agent 2 (Docker Engineer) from the start. Agent 3 and Agent 4 depend on Agent 1 completing the schema.

**Output files**:
- `db/init/001-extensions.sql` -- Extension activation
- `db/init/002-core-schema.sql` -- Core tables (contacts, companies, edges, clusters)
- `db/init/003-enrichment-schema.sql` -- Enrichment provenance tables
- `db/init/004-behavioral-schema.sql` -- Behavioral observation tables
- `db/init/005-message-schema.sql` -- Message tables + stats
- `db/init/006-outreach-schema.sql` -- Outreach campaign/template/sequence/state tables
- `db/init/007-scoring-schema.sql` -- Scoring tables
- `db/init/008-icp-niche-schema.sql` -- ICP/niche profile tables + wedge_metrics
- `db/init/009-task-goal-schema.sql` -- Goals and tasks
- `db/init/010-vector-schema.sql` -- Embedding tables with HNSW indexes
- `db/init/011-import-schema.sql` -- Import sessions, files, change_log
- `db/init/012-budget-schema.sql` -- Enrichment providers, budget periods, transactions
- `db/init/013-cache-graph-schema.sql` -- page_cache (with rotation trigger), graph_metrics, selector_configs
- `db/init/014-system-schema.sql` -- schema_versions, enriched_contacts materialized view
- `db/init/015-graph-sync-triggers.sql` -- Graph sync triggers for ruvector-postgres native graph

### Agent 2: Docker Engineer

**Scope**: Docker Compose configuration, Dockerfile for Next.js app, init script orchestration, health checks, volume configuration.

**Runs in parallel with**: Agent 1 from the start.

**Output files**:
- `docker-compose.yml`
- `Dockerfile`
- `.dockerignore`
- `db/init/000-wait-for-extensions.sh` (optional startup script)

### Agent 3: Import Engineer

**Scope**: Multi-CSV import pipeline, company resolution, deduplication, edge construction, embedding generation on import.

**Depends on**: Agent 1 (schema must be complete) and Agent 2 (Docker environment must be runnable).

**Output files**:
- `src/lib/import/csv-parser.ts` -- Generic CSV parsing with preamble detection
- `src/lib/import/connections-importer.ts` -- Connections.csv specific logic
- `src/lib/import/messages-importer.ts` -- messages.csv processing + stats
- `src/lib/import/relationships-importer.ts` -- Invitations, Endorsements, Recommendations
- `src/lib/import/positions-importer.ts` -- Positions.csv (work history)
- `src/lib/import/education-importer.ts` -- Education.csv
- `src/lib/import/skills-importer.ts` -- Skills.csv
- `src/lib/import/company-follows-importer.ts` -- Company Follows.csv
- `src/lib/import/company-resolver.ts` -- Normalize, slugify, fuzzy match, create-or-link
- `src/lib/import/deduplication.ts` -- SHA-256 hash, field-level diff, job change detection
- `src/lib/import/edge-builder.ts` -- Edge construction from all CSV types
- `src/lib/import/embedding-generator.ts` -- Profile embedding via ruvector_embed()
- `src/lib/import/import-session.ts` -- Session tracking, file tracking, change log
- `src/lib/import/pipeline.ts` -- Orchestrates ordered multi-CSV processing
- `src/lib/import/types.ts` -- TypeScript interfaces for import domain
- `tests/import/csv-parser.test.ts`
- `tests/import/connections-importer.test.ts`
- `tests/import/company-resolver.test.ts`
- `tests/import/deduplication.test.ts`
- `tests/import/edge-builder.test.ts`
- `tests/import/pipeline.test.ts`

### Agent 4: API Developer

**Scope**: Next.js API route handlers for contacts CRUD, import endpoints, and basic search.

**Depends on**: Agent 1 (schema) and Agent 3 (import pipeline, for POST /api/import/* routes).

**Output files**:
- `src/app/api/contacts/route.ts` -- GET (list) + POST (create)
- `src/app/api/contacts/[id]/route.ts` -- GET + PATCH + DELETE
- `src/app/api/contacts/search/route.ts` -- GET (keyword search)
- `src/app/api/import/upload/route.ts` -- POST (file upload)
- `src/app/api/import/csv/route.ts` -- POST (trigger CSV processing)
- `src/app/api/import/history/route.ts` -- GET (import sessions)
- `src/app/api/import/status/[sessionId]/route.ts` -- GET (session status)
- `src/lib/db/client.ts` -- PostgreSQL connection pool (pg)
- `src/lib/db/queries/contacts.ts` -- Contact query functions
- `src/lib/db/queries/import.ts` -- Import query functions
- `tests/api/contacts.test.ts`
- `tests/api/import.test.ts`

---

## Detailed Task Checklist

### T1: Database Extensions and Foundation

**Agent**: Schema Architect
**File**: `db/init/001-extensions.sql`
**BR**: BR-101 (Data Import Foundation)
**Parallel**: Can start immediately

- [ ] T1.1: Enable `uuid-ossp` extension for UUID generation
- [ ] T1.2: Enable `pg_trgm` extension for trigram-based fuzzy matching
- [ ] T1.3: Enable `ruvector` extension (provides RUVECTOR type, HNSW indexes, graph functions, embedding functions)
- [ ] T1.4: Enable `fuzzystrmatch` extension for Levenshtein distance calculations
- [ ] T1.5: Create helper function `generate_slug(text)` that lowercases, strips non-alphanumeric, replaces spaces with hyphens
- [ ] T1.6: Create helper function `now_utc()` returning `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`

**Acceptance Criteria**:
- All extensions activate without error on `ruvnet/ruvector-postgres:latest`
- Helper functions are callable: `SELECT generate_slug('Acme Corp')` returns `'acme-corp'`
- `SELECT ruvector_version()` returns a valid version string

---

### T2: Core Tables -- contacts, companies, edges, clusters

**Agent**: Schema Architect
**File**: `db/init/002-core-schema.sql`
**BR**: BR-201 (Contact Management), BR-501 (Network Graph)
**Parallel**: After T1

- [ ] T2.1: `contacts` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  linkedin_url TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  headline TEXT,
  title TEXT,
  current_company TEXT,
  current_company_id UUID REFERENCES companies(id),
  location TEXT,
  about TEXT,
  email TEXT,
  phone TEXT,
  connections_count INTEGER,
  degree INTEGER DEFAULT 1,
  profile_image_url TEXT,
  discovered_via TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  dedup_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T2.2: `companies` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  domain TEXT,
  industry TEXT,
  size_range TEXT,
  linkedin_url TEXT,
  description TEXT,
  headquarters TEXT,
  founded_year INTEGER,
  employee_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T2.3: `edges` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  target_contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  target_company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
    -- CONNECTED_TO, MESSAGED, ENDORSED, RECOMMENDED, INVITED_BY,
    -- WORKS_AT, WORKED_AT, EDUCATED_AT, FOLLOWS_COMPANY
  weight REAL DEFAULT 1.0,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  CONSTRAINT edge_has_target CHECK (target_contact_id IS NOT NULL OR target_company_id IS NOT NULL)
  ```
- [ ] T2.4: `clusters` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  description TEXT,
  algorithm TEXT NOT NULL DEFAULT 'spectral',
  member_count INTEGER DEFAULT 0,
  centroid RUVECTOR(384),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T2.5: `cluster_memberships` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  membership_score REAL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id, cluster_id)
  ```
- [ ] T2.6: Index on `contacts(linkedin_url)` (already UNIQUE)
- [ ] T2.7: Index on `contacts(dedup_hash)`
- [ ] T2.8: GIN index on `contacts(tags)`
- [ ] T2.9: Index on `companies(slug)` (already UNIQUE)
- [ ] T2.10: Index on `edges(source_contact_id)`
- [ ] T2.11: Index on `edges(target_contact_id)`
- [ ] T2.12: Index on `edges(edge_type)`
- [ ] T2.13: `updated_at` trigger on `contacts` and `companies`

**Acceptance Criteria**:
- All tables create without error
- Inserting a contact with a duplicate `linkedin_url` raises a unique constraint violation
- Edges enforce the CHECK constraint (must have either target_contact_id or target_company_id)
- Cascade delete: deleting a contact removes associated edges and cluster memberships

---

### T3: Enrichment Provenance Tables

**Agent**: Schema Architect
**File**: `db/init/003-enrichment-schema.sql`
**BR**: BR-301 (Enrichment Pipeline Foundation)
**Parallel**: After T1, parallel with T2

- [ ] T3.1: `person_enrichments` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT,
  raw_response JSONB,
  enriched_fields TEXT[] DEFAULT '{}',
  confidence REAL,
  cost_cents INTEGER DEFAULT 0,
  enriched_at TIMESTAMPTZ DEFAULT now_utc(),
  expires_at TIMESTAMPTZ,
  UNIQUE(contact_id, provider)
  ```
- [ ] T3.2: `work_history` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  company_name TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT FALSE,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'csv',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T3.3: `education` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  degree TEXT,
  field_of_study TEXT,
  start_date DATE,
  end_date DATE,
  source TEXT NOT NULL DEFAULT 'csv',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T3.4: `company_enrichments` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  raw_response JSONB,
  enriched_fields TEXT[] DEFAULT '{}',
  cost_cents INTEGER DEFAULT 0,
  enriched_at TIMESTAMPTZ DEFAULT now_utc(),
  expires_at TIMESTAMPTZ,
  UNIQUE(company_id, provider)
  ```
- [ ] T3.5: Index on `work_history(contact_id)`
- [ ] T3.6: Index on `work_history(company_id)`
- [ ] T3.7: Index on `education(contact_id)`
- [ ] T3.8: Index on `person_enrichments(contact_id)`

**Acceptance Criteria**:
- Work history links to both contact and company
- Multiple enrichment providers per contact are supported (unique constraint on contact_id + provider)
- Cascade delete from contacts removes all enrichment records

---

### T4: Behavioral Observation Tables

**Agent**: Schema Architect
**File**: `db/init/004-behavioral-schema.sql`
**BR**: BR-202 (Behavioral Profiling Foundation)
**Parallel**: After T1, parallel with T2/T3

- [ ] T4.1: `behavioral_observations` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  observation_type TEXT NOT NULL,
    -- post, comment, reaction, share, article, endorsement_given, recommendation_given
  content TEXT,
  url TEXT,
  observed_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'extension',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T4.2: `content_profiles` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  topics TEXT[] DEFAULT '{}',
  tone TEXT,
  posting_frequency TEXT,
  avg_engagement REAL,
  content_type_distribution JSONB DEFAULT '{}',
  last_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
  ```
- [ ] T4.3: `activity_patterns` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL,
  pattern_data JSONB NOT NULL DEFAULT '{}',
  confidence REAL,
  detected_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id, pattern_type)
  ```
- [ ] T4.4: Indexes on `behavioral_observations(contact_id)` and `behavioral_observations(observation_type)`

**Acceptance Criteria**:
- Behavioral observations can store any observation type with flexible metadata
- Content profiles are 1:1 with contacts
- Activity patterns support multiple pattern types per contact

---

### T5: Message Tables

**Agent**: Schema Architect
**File**: `db/init/005-message-schema.sql`
**BR**: BR-108 (Message Import)
**Parallel**: After T2 (needs contacts)

- [ ] T5.1: `messages` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
  subject TEXT,
  content TEXT NOT NULL,
  conversation_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'csv',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T5.2: `message_stats` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  total_messages INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  received_count INTEGER DEFAULT 0,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  avg_response_time_hours REAL,
  conversation_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
  ```
- [ ] T5.3: Index on `messages(contact_id)`
- [ ] T5.4: Index on `messages(sent_at)`
- [ ] T5.5: Index on `messages(conversation_id)`

**Acceptance Criteria**:
- Messages store full content with direction
- Message stats are 1:1 with contacts (unique constraint)
- Querying all messages for a contact is efficient via index

---

### T6: Outreach State Tables

**Agent**: Schema Architect
**File**: `db/init/006-outreach-schema.sql`
**BR**: BR-601 (Outreach Pipeline Foundation)
**Parallel**: After T2 (needs contacts)

- [ ] T6.1: `outreach_campaigns` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  target_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  response_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T6.2: `outreach_templates` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('initial_outreach', 'follow_up', 'meeting_request', 'referral_ask', 'content_share', 'custom')),
  subject_template TEXT,
  body_template TEXT NOT NULL,
  merge_variables TEXT[] DEFAULT '{}',
  tone TEXT DEFAULT 'professional',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T6.3: `outreach_sequences` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T6.4: `outreach_sequence_steps` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id UUID NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  template_id UUID NOT NULL REFERENCES outreach_templates(id),
  delay_days INTEGER DEFAULT 0,
  condition JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(sequence_id, step_order)
  ```
- [ ] T6.5: `outreach_states` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES outreach_campaigns(id),
  sequence_id UUID REFERENCES outreach_sequences(id),
  current_step INTEGER DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (state IN ('not_started', 'queued', 'sent', 'opened', 'replied', 'accepted', 'declined', 'bounced', 'opted_out')),
  last_action_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id, campaign_id)
  ```
- [ ] T6.6: `outreach_events` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outreach_state_id UUID NOT NULL REFERENCES outreach_states(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T6.7: `template_performance` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES outreach_templates(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  sent_count INTEGER DEFAULT 0,
  open_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  accept_count INTEGER DEFAULT 0,
  avg_response_time_hours REAL,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(template_id, period_start)
  ```
- [ ] T6.8: Indexes on `outreach_states(contact_id)`, `outreach_states(state)`, `outreach_events(outreach_state_id)`

**Acceptance Criteria**:
- Campaign -> Sequence -> Steps -> Template chain is intact with proper foreign keys
- Outreach state transitions are constrained to valid values
- A contact can be in one state per campaign (unique constraint)

---

### T7: Scoring Tables

**Agent**: Schema Architect
**File**: `db/init/007-scoring-schema.sql`
**BR**: BR-401 (Scoring Foundation)
**Parallel**: After T2 (needs contacts)

- [ ] T7.1: `contact_scores` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  composite_score REAL NOT NULL DEFAULT 0,
  tier TEXT CHECK (tier IN ('gold', 'silver', 'bronze', 'watch', 'unscored')),
  persona TEXT,
  behavioral_persona TEXT,
  scored_at TIMESTAMPTZ DEFAULT now_utc(),
  scoring_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
  ```
- [ ] T7.2: `score_dimensions` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_score_id UUID NOT NULL REFERENCES contact_scores(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
    -- icp_fit, network_hub, relationship_strength, signal_boost,
    -- skills_relevance, network_proximity, behavioral, content_relevance, graph_centrality
  raw_value REAL NOT NULL DEFAULT 0,
  weighted_value REAL NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_score_id, dimension)
  ```
- [ ] T7.3: `scoring_weight_profiles` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  weights JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T7.4: `tier_thresholds` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES scoring_weight_profiles(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  min_score REAL NOT NULL,
  max_score REAL,
  degree INTEGER,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(profile_id, tier, degree)
  ```
- [ ] T7.5: Insert default scoring weight profile with standard weights
- [ ] T7.6: Insert default tier thresholds (degree-aware: 1st-degree and 2nd-degree have different thresholds)
- [ ] T7.7: Indexes on `contact_scores(tier)`, `contact_scores(composite_score)`

**Acceptance Criteria**:
- Each contact has exactly one score record (unique constraint)
- Score dimensions are extensible (new dimensions can be added without schema change)
- Default weight profile and tier thresholds are seeded on initialization
- Tier thresholds support degree-aware scoring

---

### T8: ICP/Niche Profile Tables

**Agent**: Schema Architect
**File**: `db/init/008-icp-niche-schema.sql`
**BR**: BR-403 (ICP Fit Scoring), BR-502 (Niche Discovery)
**Parallel**: After T2 (needs contacts)

- [ ] T8.1: `niche_profiles` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  industry TEXT,
  keywords TEXT[] DEFAULT '{}',
  company_size_range TEXT,
  geo_focus TEXT[] DEFAULT '{}',
  member_count INTEGER DEFAULT 0,
  centroid RUVECTOR(384),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T8.2: `icp_profiles` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  criteria JSONB NOT NULL DEFAULT '{}',
  weight_overrides JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T8.3: `contact_icp_fits` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  icp_profile_id UUID NOT NULL REFERENCES icp_profiles(id) ON DELETE CASCADE,
  fit_score REAL NOT NULL DEFAULT 0,
  fit_breakdown JSONB DEFAULT '{}',
  computed_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id, icp_profile_id)
  ```
- [ ] T8.4: `wedge_metrics` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche_id UUID NOT NULL REFERENCES niche_profiles(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,
  metric_value REAL NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT now_utc(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(niche_id, metric_type)
  ```
- [ ] T8.5: Indexes on `contact_icp_fits(contact_id)`, `contact_icp_fits(icp_profile_id)`

**Acceptance Criteria**:
- Multiple ICP profiles can be created and scored against contacts
- Each contact has one fit score per ICP profile (unique constraint)
- Niche profiles store centroids as RUVECTOR for similarity search

---

### T9: Task/Goal Tables

**Agent**: Schema Architect
**File**: `db/init/009-task-goal-schema.sql`
**BR**: BR-701 (Goal/Task System Foundation)
**Parallel**: After T2 (needs contacts)

- [ ] T9.1: `goals` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  goal_type TEXT NOT NULL DEFAULT 'custom',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  priority INTEGER DEFAULT 5,
  target_metric TEXT,
  target_value REAL,
  current_value REAL DEFAULT 0,
  deadline TIMESTAMPTZ,
  source TEXT DEFAULT 'user',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T9.2: `tasks` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL DEFAULT 'manual',
    -- visit_profile, send_message, enrich_contact, review_score, manual, capture_page
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
  priority INTEGER DEFAULT 5,
  url TEXT,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  source TEXT DEFAULT 'system',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T9.3: Indexes on `tasks(goal_id)`, `tasks(contact_id)`, `tasks(status)`

**Acceptance Criteria**:
- Tasks can optionally belong to a goal (nullable FK with SET NULL on delete)
- Tasks can optionally be linked to a contact
- Task types are extensible via the TEXT column
- Goal progress is tracked via target_value / current_value

---

### T10: Vector Embedding Tables

**Agent**: Schema Architect
**File**: `db/init/010-vector-schema.sql`
**BR**: BR-205 (Semantic Search Foundation)
**Parallel**: After T2 (needs contacts and companies)

- [ ] T10.1: `profile_embeddings` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  embedding RUVECTOR(384) NOT NULL,
  source_text TEXT,
  model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
  ```
- [ ] T10.2: `content_embeddings` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_ref TEXT,
  embedding RUVECTOR(384) NOT NULL,
  source_text TEXT,
  model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T10.3: `company_embeddings` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  embedding RUVECTOR(384) NOT NULL,
  source_text TEXT,
  model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(company_id)
  ```
- [ ] T10.4: HNSW index on `profile_embeddings(embedding)` using `ruhnsw`
  ```sql
  CREATE INDEX idx_profile_embeddings_hnsw ON profile_embeddings
    USING ruhnsw (embedding ruvector_cosine_ops)
    WITH (m = 16, ef_construction = 200);
  ```
- [ ] T10.5: HNSW index on `content_embeddings(embedding)` using `ruhnsw`
- [ ] T10.6: HNSW index on `company_embeddings(embedding)` using `ruhnsw`

**Acceptance Criteria**:
- RUVECTOR(384) columns accept 384-dimensional float vectors
- HNSW indexes build successfully
- k-NN query returns results: `SELECT * FROM profile_embeddings ORDER BY embedding <=> $1 LIMIT 10`
- Profile embeddings are 1:1 with contacts (unique constraint)

---

### T11: Import Tracking Tables

**Agent**: Schema Architect
**File**: `db/init/011-import-schema.sql`
**BR**: BR-101 (Import Session Tracking)
**Parallel**: After T1

- [ ] T11.1: `import_sessions` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  total_files INTEGER DEFAULT 0,
  processed_files INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  new_records INTEGER DEFAULT 0,
  updated_records INTEGER DEFAULT 0,
  skipped_records INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T11.2: `import_files` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
    -- connections, messages, invitations, endorsements, recommendations,
    -- positions, education, skills, company_follows, profile
  file_size_bytes INTEGER,
  record_count INTEGER DEFAULT 0,
  processed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T11.3: `import_change_log` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'skipped', 'error')),
  field_changes JSONB DEFAULT '{}',
  old_values JSONB DEFAULT '{}',
  new_values JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T11.4: Indexes on `import_files(session_id)`, `import_change_log(session_id)`, `import_change_log(contact_id)`

**Acceptance Criteria**:
- Import session tracks overall progress (files, records, errors)
- Individual file tracking within a session
- Change log records field-level diffs for every contact touched during import
- Session status transitions are constrained

---

### T12: Budget/Cost Tracking Tables

**Agent**: Schema Architect
**File**: `db/init/012-budget-schema.sql`
**BR**: BR-310 (Budget Enforcement)
**Parallel**: After T1

- [ ] T12.1: `enrichment_providers` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  api_base_url TEXT,
  cost_per_lookup_cents INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_minute INTEGER,
  is_active BOOLEAN DEFAULT FALSE,
  capabilities TEXT[] DEFAULT '{}',
  priority INTEGER DEFAULT 50,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T12.2: `budget_periods` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_type TEXT NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('daily', 'weekly', 'monthly', 'yearly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  budget_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER DEFAULT 0,
  lookup_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(period_type, period_start)
  ```
- [ ] T12.3: `enrichment_transactions` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES enrichment_providers(id),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  budget_period_id UUID REFERENCES budget_periods(id),
  cost_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'cached', 'rate_limited')),
  fields_returned TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T12.4: Insert seed data for known providers (PDL, Lusha, TheirStack, Apollo, Crunchbase, BuiltWith) with `is_active = FALSE`
- [ ] T12.5: Indexes on `enrichment_transactions(provider_id)`, `enrichment_transactions(budget_period_id)`

**Acceptance Criteria**:
- Budget periods track spend with cap enforcement possible at application layer
- All enrichment transactions are recorded with cost
- Providers seeded but inactive by default (require API key configuration to activate)

---

### T13: Cache, Graph Metrics, and Selector Config Tables

**Agent**: Schema Architect
**File**: `db/init/013-cache-graph-schema.sql`
**BR**: BR-801 (Page Cache), BR-503 (Graph Metrics)
**Parallel**: After T2

- [ ] T13.1: `page_cache` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url TEXT NOT NULL,
  page_type TEXT NOT NULL,
    -- profile, search_results, feed, company, group, event
  html_content TEXT NOT NULL,
  compressed BOOLEAN DEFAULT FALSE,
  content_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  captured_by TEXT DEFAULT 'extension',
  parsed BOOLEAN DEFAULT FALSE,
  parsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T13.2: Page cache 5-version rotation trigger
  ```sql
  CREATE OR REPLACE FUNCTION rotate_page_cache()
  RETURNS TRIGGER AS $$
  BEGIN
    DELETE FROM page_cache
    WHERE url = NEW.url
      AND id NOT IN (
        SELECT id FROM page_cache
        WHERE url = NEW.url
        ORDER BY created_at DESC
        LIMIT 4
      );
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER trg_rotate_page_cache
    AFTER INSERT ON page_cache
    FOR EACH ROW EXECUTE FUNCTION rotate_page_cache();
  ```
- [ ] T13.3: `graph_metrics` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  pagerank REAL,
  betweenness_centrality REAL,
  closeness_centrality REAL,
  degree_centrality INTEGER,
  eigenvector_centrality REAL,
  clustering_coefficient REAL,
  computed_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
  ```
- [ ] T13.4: `selector_configs` table
  ```sql
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_type TEXT NOT NULL,
  selector_name TEXT NOT NULL,
  css_selector TEXT NOT NULL,
  fallback_selectors TEXT[] DEFAULT '{}',
  extraction_method TEXT DEFAULT 'text',
    -- text, html, attribute, regex
  attribute_name TEXT,
  regex_pattern TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(page_type, selector_name, version)
  ```
- [ ] T13.5: Indexes on `page_cache(url)`, `page_cache(page_type)`, `graph_metrics(contact_id)`

**Acceptance Criteria**:
- Page cache rotation trigger keeps only the 5 most recent versions per URL
- Selector configs are versioned and support fallback selector chains
- Graph metrics are 1:1 with contacts

---

### T14: System Tables and Materialized Views

**Agent**: Schema Architect
**File**: `db/init/014-system-schema.sql`
**BR**: BR-901 (Admin/System)
**Parallel**: After all other schema files (T2-T13)

- [ ] T14.1: `schema_versions` table
  ```sql
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  description TEXT,
  applied_at TIMESTAMPTZ DEFAULT now_utc()
  ```
- [ ] T14.2: Insert initial schema version record `('1.0.0', 'Phase 1 Foundation schema')`
- [ ] T14.3: `enriched_contacts` materialized view
  ```sql
  CREATE MATERIALIZED VIEW enriched_contacts AS
  SELECT
    c.id,
    c.linkedin_url,
    c.first_name,
    c.last_name,
    c.full_name,
    c.headline,
    c.title,
    c.current_company,
    c.location,
    c.email,
    c.phone,
    c.degree,
    c.tags,
    c.created_at,
    c.updated_at,
    co.name AS company_name,
    co.industry AS company_industry,
    co.size_range AS company_size,
    cs.composite_score,
    cs.tier,
    cs.persona,
    cs.behavioral_persona,
    ms.total_messages,
    ms.last_message_at,
    os.state AS outreach_state,
    CASE WHEN pe.id IS NOT NULL THEN 'enriched' ELSE 'pending' END AS enrichment_status
  FROM contacts c
  LEFT JOIN companies co ON c.current_company_id = co.id
  LEFT JOIN contact_scores cs ON cs.contact_id = c.id
  LEFT JOIN message_stats ms ON ms.contact_id = c.id
  LEFT JOIN outreach_states os ON os.contact_id = c.id
  LEFT JOIN person_enrichments pe ON pe.contact_id = c.id
  WITH DATA;
  ```
- [ ] T14.4: Index on `enriched_contacts(id)` (unique) and `enriched_contacts(composite_score)`
- [ ] T14.5: Function to refresh the materialized view
  ```sql
  CREATE OR REPLACE FUNCTION refresh_enriched_contacts()
  RETURNS void AS $$
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_contacts;
  END;
  $$ LANGUAGE plpgsql;
  ```

**Acceptance Criteria**:
- Schema version is recorded
- Materialized view joins across all major tables
- `REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_contacts` works without error
- View is queryable: `SELECT * FROM enriched_contacts WHERE tier = 'gold'`

---

### T15: Graph Sync Triggers

**Agent**: Schema Architect
**File**: `db/init/015-graph-sync-triggers.sql`
**BR**: BR-501 (Native Graph Integration)
**Parallel**: After T2 (needs edges table)

- [ ] T15.1: Trigger on `edges` INSERT to call `ruvector_graph_add_edge()` if the function exists
- [ ] T15.2: Trigger on `edges` DELETE to call `ruvector_graph_remove_edge()` if the function exists
- [ ] T15.3: Trigger on `contacts` INSERT to call `ruvector_graph_add_node()` if the function exists
- [ ] T15.4: Trigger on `contacts` DELETE to call `ruvector_graph_remove_node()` if the function exists
- [ ] T15.5: Graceful no-op if ruvector graph functions are not available (check `pg_proc` before calling)

**Acceptance Criteria**:
- Inserting an edge also registers it in the ruvector native graph
- Deleting a contact cascades to both SQL edges and ruvector graph nodes
- Triggers do not error if ruvector graph functions are absent (graceful degradation)

---

### T16: Docker Compose Setup

**Agent**: Docker Engineer
**File**: `docker-compose.yml`
**BR**: BR-101 (Infrastructure)
**Parallel**: Can start immediately, in parallel with Agent 1

- [ ] T16.1: Define `db` service using `ruvnet/ruvector-postgres:latest`
  - Port mapping: `5432:5432`
  - Environment: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` from `.env`
  - Volumes: `./db/init:/docker-entrypoint-initdb.d` (init scripts), `pgdata:/var/lib/postgresql/data` (persistence)
  - Health check: `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` every 10s, 5 retries
- [ ] T16.2: Define `app` service using custom `Dockerfile`
  - Port mapping: `3000:3000`
  - Environment: `DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@db:5432/$POSTGRES_DB`
  - Depends on: `db` (condition: `service_healthy`)
  - Volumes: `.:/app` (development bind mount), `/app/node_modules` (anonymous volume)
  - Health check: `curl -f http://localhost:3000/api/health` every 15s
- [ ] T16.3: Define named volume `pgdata` for PostgreSQL data persistence
- [ ] T16.4: Define `.env.example` file with all required environment variables documented

**Acceptance Criteria**:
- `docker-compose up` starts both services without error
- Database health check passes within 30 seconds
- App health check passes after database is healthy
- Data persists across `docker-compose down && docker-compose up`

---

### T17: Dockerfile for Next.js App

**Agent**: Docker Engineer
**File**: `Dockerfile`
**BR**: BR-101 (Infrastructure)
**Parallel**: With T16

- [ ] T17.1: Multi-stage build (deps stage, build stage, runtime stage)
- [ ] T17.2: Use `node:20-alpine` as base
- [ ] T17.3: Copy `package.json` and `package-lock.json` first (layer caching)
- [ ] T17.4: Install dependencies with `npm ci`
- [ ] T17.5: Copy source and build with `npm run build`
- [ ] T17.6: Runtime stage copies only built output + node_modules
- [ ] T17.7: Expose port 3000
- [ ] T17.8: CMD `npm start`

**Acceptance Criteria**:
- `docker build .` completes successfully
- Built image is under 500 MB
- Container starts and responds on port 3000

---

### T18: .dockerignore

**Agent**: Docker Engineer
**File**: `.dockerignore`
**BR**: BR-101 (Infrastructure)
**Parallel**: With T16/T17

- [ ] T18.1: Exclude `node_modules`, `.next`, `.git`, `*.md`, `.env`, `db/`, `tests/`

**Acceptance Criteria**:
- Docker build context is minimal (no node_modules or .git in context)

---

### T19: CSV Parser -- Generic Foundation

**Agent**: Import Engineer
**File**: `src/lib/import/csv-parser.ts`
**BR**: BR-101 (CSV Import)
**Depends on**: T2 (schema must be deployed)

- [ ] T19.1: Implement `CsvParser` class that reads a CSV file and returns typed rows
- [ ] T19.2: Implement 2-line preamble detection for LinkedIn CSVs (Connections.csv starts with 2 metadata lines before headers)
- [ ] T19.3: Handle BOM (byte order mark) stripping
- [ ] T19.4: Support configurable delimiter (default comma)
- [ ] T19.5: Return rows as `Record<string, string>` with normalized header names (trimmed, lowercased, underscored)
- [ ] T19.6: Track row count and error count for reporting back to import session
- [ ] T19.7: Unit tests for preamble detection, BOM handling, header normalization

**Acceptance Criteria**:
- Correctly parses LinkedIn Connections.csv (which has 2 preamble lines)
- Handles UTF-8 BOM without corruption
- Returns typed rows with consistent header naming

---

### T20: Connections.csv Importer

**Agent**: Import Engineer
**File**: `src/lib/import/connections-importer.ts`
**BR**: BR-102 (Connections Import), BR-103 (Company Resolution)
**Depends on**: T19 (csv-parser), T21 (company-resolver), T22 (deduplication)

- [ ] T20.1: Map Connections.csv fields to contacts table columns:
  - `First Name` -> `first_name`
  - `Last Name` -> `last_name`
  - `URL` -> `linkedin_url` (canonical ID)
  - `Email Address` -> `email`
  - `Company` -> trigger company resolution
  - `Position` -> `title`
  - `Connected On` -> used for edge `created_at`
- [ ] T20.2: Construct `full_name` from first + last
- [ ] T20.3: Call company resolver for each contact's company
- [ ] T20.4: Call deduplication check before insert
- [ ] T20.5: Create CONNECTED_TO edge between the user (self-contact) and each connection
- [ ] T20.6: Track every change in import_change_log (created, updated, skipped)
- [ ] T20.7: Generate dedup_hash as SHA-256 of `linkedin_url + full_name + title + company`
- [ ] T20.8: Unit tests with mock Connections.csv data

**Acceptance Criteria**:
- All rows from a Connections.csv are processed
- Duplicate contacts (same linkedin_url) are detected and trigger field-level diff update
- Company records are created or linked via fuzzy matching
- CONNECTED_TO edges are created
- Import change_log records every action

---

### T21: Company Resolver

**Agent**: Import Engineer
**File**: `src/lib/import/company-resolver.ts`
**BR**: BR-103 (Company Resolution)
**Depends on**: T2 (companies table)

- [ ] T21.1: Normalize company name: trim whitespace, collapse multiple spaces
- [ ] T21.2: Generate slug from normalized name using `generate_slug()` or local equivalent
- [ ] T21.3: Exact match on slug first (fast path)
- [ ] T21.4: If no exact match, fuzzy match using Levenshtein distance < 3 on name (using `pg_trgm` or `fuzzystrmatch`)
- [ ] T21.5: If fuzzy match found, return existing company ID
- [ ] T21.6: If no match, create new company record and return its ID
- [ ] T21.7: Cache resolved companies in-memory during an import session to avoid repeated queries
- [ ] T21.8: Unit tests for normalization, slug generation, fuzzy matching threshold

**Acceptance Criteria**:
- "Acme Corp" and "Acme Corp " resolve to the same company
- "Acme Corp" and "Acme Corp." resolve to the same company (Levenshtein = 1)
- "Acme Corp" and "Totally Different Inc" do NOT match
- Company records are reused across contacts

---

### T22: Deduplication Engine

**Agent**: Import Engineer
**File**: `src/lib/import/deduplication.ts`
**BR**: BR-104 (Deduplication)
**Depends on**: T2 (contacts table)

- [ ] T22.1: Compute SHA-256 hash of `linkedin_url + full_name + title + company_name`
- [ ] T22.2: Check existing contacts for matching `linkedin_url` (primary dedup key)
- [ ] T22.3: If match found, compute field-level diff between existing and incoming data
- [ ] T22.4: Detect job change: if `title` or `current_company` changed, flag as job change
- [ ] T22.5: Apply update strategy: incoming data overwrites existing ONLY for non-null fields
- [ ] T22.6: Never delete existing data -- append-only with field-level updates
- [ ] T22.7: Return dedup result: `{ action: 'created' | 'updated' | 'skipped', changes: FieldChange[] }`
- [ ] T22.8: Unit tests for hash computation, field-level diff, job change detection

**Acceptance Criteria**:
- Re-importing the same CSV produces zero new records (all skipped or updated)
- Job changes are detected when title or company changes
- Field-level diff is recorded in import_change_log
- Null incoming fields do not overwrite existing non-null values

---

### T23: Edge Builder

**Agent**: Import Engineer
**File**: `src/lib/import/edge-builder.ts`
**BR**: BR-105 (Edge Construction)
**Depends on**: T2 (edges table)

- [ ] T23.1: Create CONNECTED_TO edges from Connections.csv
- [ ] T23.2: Create MESSAGED edges from messages.csv (weight based on message count)
- [ ] T23.3: Create ENDORSED edges from Endorsements.csv
- [ ] T23.4: Create RECOMMENDED edges from Recommendations.csv
- [ ] T23.5: Create INVITED_BY edges from Invitations.csv
- [ ] T23.6: Create WORKS_AT edges from Positions.csv (current positions)
- [ ] T23.7: Create WORKED_AT edges from Positions.csv (past positions)
- [ ] T23.8: Create EDUCATED_AT edges from Education.csv
- [ ] T23.9: Create FOLLOWS_COMPANY edges from Company Follows.csv
- [ ] T23.10: Avoid duplicate edges (upsert based on source + target + type)
- [ ] T23.11: Set edge weight based on relationship strength signals (e.g., MESSAGED weight = log(message_count))
- [ ] T23.12: Store edge properties as JSONB (e.g., connected_on date, endorsement skill, recommendation text)
- [ ] T23.13: Unit tests for each edge type creation

**Acceptance Criteria**:
- Each CSV type produces the correct edge type
- Edge weights reflect relationship signals
- No duplicate edges are created on re-import
- Edge properties contain relevant metadata from the CSV

---

### T24: Messages Importer

**Agent**: Import Engineer
**File**: `src/lib/import/messages-importer.ts`
**BR**: BR-108 (Message Import)
**Depends on**: T5 (messages table), T2 (contacts table)

- [ ] T24.1: Parse messages.csv (fields: FROM, TO, DATE, SUBJECT, CONTENT, FOLDER, CONVERSATION ID)
- [ ] T24.2: Resolve contact from FROM/TO field by matching against known contacts (linkedin_url or name)
- [ ] T24.3: Store full message content in `messages` table
- [ ] T24.4: Determine direction (sent vs received) based on whether FROM matches user's name
- [ ] T24.5: Group by conversation_id
- [ ] T24.6: After all messages imported, compute `message_stats` per contact:
  - `total_messages`: count
  - `sent_count`: count where direction = 'sent'
  - `received_count`: count where direction = 'received'
  - `first_message_at`: MIN(sent_at)
  - `last_message_at`: MAX(sent_at)
  - `conversation_count`: COUNT(DISTINCT conversation_id)
  - `avg_response_time_hours`: computed from response pairs
- [ ] T24.7: Create MESSAGED edges between user and each contact with messages
- [ ] T24.8: Unit tests for message parsing, direction detection, stats computation

**Acceptance Criteria**:
- All messages stored with full content
- Message stats accurately reflect communication patterns
- Direction detection correctly identifies sent vs received
- MESSAGED edges created with message count as weight

---

### T25: Relationships Importers (Invitations, Endorsements, Recommendations)

**Agent**: Import Engineer
**File**: `src/lib/import/relationships-importer.ts`
**BR**: BR-109 (Relationship Import)
**Depends on**: T2 (contacts, edges)

- [ ] T25.1: Parse Invitations.csv -- create INVITED_BY edges with direction and date
- [ ] T25.2: Parse Endorsements Given.csv -- create ENDORSED edges with skill metadata
- [ ] T25.3: Parse Endorsements Received.csv -- create ENDORSED edges (reverse direction)
- [ ] T25.4: Parse Recommendations Given.csv -- create RECOMMENDED edges with recommendation text
- [ ] T25.5: Parse Recommendations Received.csv -- create RECOMMENDED edges (reverse direction)
- [ ] T25.6: Resolve contacts by name when linkedin_url is not available in these CSVs
- [ ] T25.7: Unit tests for each relationship type

**Acceptance Criteria**:
- Each relationship CSV produces the correct edge type with correct direction
- Contact resolution by name works when URL is unavailable
- Edge properties store relevant metadata (skill, recommendation text, date)

---

### T26: Positions and Education Importers

**Agent**: Import Engineer
**Files**: `src/lib/import/positions-importer.ts`, `src/lib/import/education-importer.ts`
**BR**: BR-110 (Work History), BR-111 (Education)
**Depends on**: T3 (work_history, education tables), T21 (company-resolver)

- [ ] T26.1: Parse Positions.csv -- store in `work_history` table with company resolution
- [ ] T26.2: Determine `is_current` based on missing end_date
- [ ] T26.3: Create WORKS_AT / WORKED_AT edges via edge builder
- [ ] T26.4: Parse Education.csv -- store in `education` table
- [ ] T26.5: Create EDUCATED_AT edges via edge builder
- [ ] T26.6: Unit tests for date parsing, current position detection

**Acceptance Criteria**:
- Work history entries link to resolved companies
- Current positions have `is_current = true`
- Education records store institution, degree, field of study
- Appropriate edges created for each record

---

### T27: Skills and Company Follows Importers

**Agent**: Import Engineer
**Files**: `src/lib/import/skills-importer.ts`, `src/lib/import/company-follows-importer.ts`
**BR**: BR-112 (Skills/Company Follows)
**Depends on**: T2 (contacts, companies, edges)

- [ ] T27.1: Parse Skills.csv -- store skills as tags on the contact record (append to `tags` array)
- [ ] T27.2: Parse Company Follows.csv -- create FOLLOWS_COMPANY edges
- [ ] T27.3: Resolve companies from Company Follows via company resolver
- [ ] T27.4: Unit tests for skills tag merging, company follows edge creation

**Acceptance Criteria**:
- Skills are stored as tags on the contact (not a separate table in Phase 1)
- Company follows create edges to resolved company records
- Re-import does not duplicate tags or edges

---

### T28: Import Pipeline Orchestrator

**Agent**: Import Engineer
**File**: `src/lib/import/pipeline.ts`
**BR**: BR-101 (Import Pipeline)
**Depends on**: T19-T27 (all importers)

- [ ] T28.1: Accept a directory path or array of file paths
- [ ] T28.2: Detect file types from filenames (Connections.csv, messages.csv, etc.)
- [ ] T28.3: Create import_session record
- [ ] T28.4: Process files in correct order:
  1. Profile.csv (if present -- user's own profile)
  2. Connections.csv (creates contacts + companies)
  3. Positions.csv (work history, needs contacts)
  4. Education.csv (needs contacts)
  5. Skills.csv (needs contacts)
  6. Endorsements.csv (needs contacts)
  7. Recommendations.csv (needs contacts)
  8. Invitations.csv (needs contacts)
  9. messages.csv (needs contacts, creates message_stats)
  10. Company Follows.csv (needs companies)
- [ ] T28.5: Track progress on import_session (processed_files, total_records, etc.)
- [ ] T28.6: Update import_session status to 'completed' or 'failed'
- [ ] T28.7: Return import summary with counts and errors
- [ ] T28.8: Integration test with sample CSV files

**Acceptance Criteria**:
- Pipeline processes files in dependency order
- Skips missing files gracefully (not all CSVs may be present)
- Import session tracks progress accurately
- Integration test passes with sample data

---

### T29: Profile Embedding Generation

**Agent**: Import Engineer
**File**: `src/lib/import/embedding-generator.ts`
**BR**: BR-205 (Embedding Generation)
**Depends on**: T10 (profile_embeddings table)

- [ ] T29.1: Construct embedding source text: `"{headline} | {title} at {current_company} | {about}"`
- [ ] T29.2: Call `ruvector_embed()` SQL function with source text to get 384-dim vector
- [ ] T29.3: Upsert into `profile_embeddings` table (one per contact)
- [ ] T29.4: Batch embedding: process N contacts at a time (configurable, default 50)
- [ ] T29.5: Track embedding generation in import pipeline (optional post-import step)
- [ ] T29.6: Handle contacts with insufficient text (skip if headline + about is empty)
- [ ] T29.7: Unit test for source text construction, batch processing

**Acceptance Criteria**:
- Embedding generated for contacts with sufficient profile text
- `ruvector_embed()` produces a valid 384-dimensional vector
- Batch processing completes without OOM for 1000+ contacts
- Contacts with empty profiles are skipped gracefully

---

### T30: Database Client and Connection Pool

**Agent**: API Developer
**File**: `src/lib/db/client.ts`
**BR**: BR-201 (Data Access)
**Depends on**: T16 (Docker Compose -- database must be running)

- [ ] T30.1: Create PostgreSQL connection pool using `pg` library
- [ ] T30.2: Configure pool from `DATABASE_URL` environment variable
- [ ] T30.3: Set pool size (min: 2, max: 10 for development)
- [ ] T30.4: Implement `query()` helper with parameterized queries
- [ ] T30.5: Implement `transaction()` helper for multi-statement transactions
- [ ] T30.6: Implement connection health check function
- [ ] T30.7: Graceful shutdown (drain pool on process exit)

**Acceptance Criteria**:
- Pool connects to the Docker Compose PostgreSQL instance
- Parameterized queries prevent SQL injection
- Transaction helper commits on success, rolls back on error
- Health check returns connection status

---

### T31: Contact Query Functions

**Agent**: API Developer
**File**: `src/lib/db/queries/contacts.ts`
**BR**: BR-201 (Contact CRUD)
**Depends on**: T30 (db client)

- [ ] T31.1: `listContacts(options)` -- paginated list with filters (tier, company, tags) and sorting
- [ ] T31.2: `getContactById(id)` -- single contact with joined company data
- [ ] T31.3: `createContact(data)` -- insert with company resolution
- [ ] T31.4: `updateContact(id, data)` -- partial update with updated_at timestamp
- [ ] T31.5: `deleteContact(id)` -- soft delete (set is_archived = true) or hard delete
- [ ] T31.6: `searchContacts(query)` -- basic keyword search across name, headline, title, company
- [ ] T31.7: Pagination: offset-based with total count return
- [ ] T31.8: Unit tests for query construction

**Acceptance Criteria**:
- List endpoint supports pagination (page, limit, total)
- Filtering by tier, company, tags works
- Sorting by name, score, created_at works
- Search returns relevant results for partial matches (pg_trgm)

---

### T32: Import Query Functions

**Agent**: API Developer
**File**: `src/lib/db/queries/import.ts`
**BR**: BR-101 (Import API)
**Depends on**: T30 (db client)

- [ ] T32.1: `createImportSession()` -- create new session record
- [ ] T32.2: `getImportSession(id)` -- get session with file list
- [ ] T32.3: `listImportSessions()` -- paginated list of import history
- [ ] T32.4: `updateImportSession(id, data)` -- update progress/status
- [ ] T32.5: `getImportChangeLog(sessionId)` -- get changes for a session

**Acceptance Criteria**:
- Session creation returns UUID
- Session status updates are reflected immediately
- History list shows most recent imports first

---

### T33: API Routes -- Contacts

**Agent**: API Developer
**Files**: `src/app/api/contacts/route.ts`, `src/app/api/contacts/[id]/route.ts`, `src/app/api/contacts/search/route.ts`
**BR**: BR-201 (Contact API)
**Depends on**: T31 (contact query functions)

- [ ] T33.1: `GET /api/contacts` -- list contacts with query params: `page`, `limit`, `sort`, `order`, `tier`, `company`, `tags`, `search`
  - Response: `{ data: Contact[], pagination: { page, limit, total, totalPages } }`
- [ ] T33.2: `POST /api/contacts` -- create contact
  - Request body: contact fields
  - Validate required fields (linkedin_url minimum)
  - Response: `{ data: Contact }`
- [ ] T33.3: `GET /api/contacts/:id` -- get single contact
  - Response: `{ data: Contact }` with company details
  - 404 if not found
- [ ] T33.4: `PATCH /api/contacts/:id` -- update contact
  - Request body: partial contact fields
  - Response: `{ data: Contact }`
  - 404 if not found
- [ ] T33.5: `DELETE /api/contacts/:id` -- delete contact
  - Response: `{ success: true }`
  - 404 if not found
- [ ] T33.6: `GET /api/contacts/search?q=query` -- keyword search
  - Response: `{ data: Contact[], pagination: {...} }`
- [ ] T33.7: Input validation on all routes (validate UUIDs, sanitize strings, reject unknown fields)
- [ ] T33.8: Error handling middleware (consistent error response format)
- [ ] T33.9: Integration tests for each route

**Acceptance Criteria**:
- All routes return consistent JSON response format
- Pagination works correctly (page 1 returns first N, page 2 returns next N)
- Invalid UUIDs return 400, missing resources return 404
- Input validation rejects malformed requests

---

### T34: API Routes -- Import

**Agent**: API Developer
**Files**: `src/app/api/import/upload/route.ts`, `src/app/api/import/csv/route.ts`, `src/app/api/import/history/route.ts`, `src/app/api/import/status/[sessionId]/route.ts`
**BR**: BR-101 (Import API)
**Depends on**: T28 (import pipeline), T32 (import queries)

- [ ] T34.1: `POST /api/import/upload` -- accept multipart file upload
  - Accept multiple CSV files
  - Store to temp directory
  - Create import session
  - Response: `{ sessionId: UUID, files: string[] }`
- [ ] T34.2: `POST /api/import/csv` -- trigger CSV processing for a session
  - Request body: `{ sessionId: UUID }`
  - Kick off pipeline processing (async)
  - Response: `{ sessionId: UUID, status: 'processing' }`
- [ ] T34.3: `GET /api/import/history` -- list past imports
  - Response: `{ data: ImportSession[], pagination: {...} }`
- [ ] T34.4: `GET /api/import/status/:sessionId` -- get import progress
  - Response: `{ data: ImportSession }` with files and progress counts
  - Support polling for progress updates
- [ ] T34.5: File size validation (reject files > 50 MB)
- [ ] T34.6: File type validation (only .csv files accepted)
- [ ] T34.7: Integration tests for upload and processing flow

**Acceptance Criteria**:
- File upload accepts multiple CSV files in one request
- Processing runs asynchronously (non-blocking response)
- Status endpoint returns live progress during processing
- File validation rejects non-CSV and oversized files

---

### T35: Health Check API Route

**Agent**: API Developer
**File**: `src/app/api/health/route.ts`
**BR**: BR-101 (Infrastructure Health)
**Depends on**: T30 (db client)

- [ ] T35.1: `GET /api/health` -- returns system health status
  - Check database connectivity
  - Return app version, uptime, database status
  - Response: `{ status: 'ok' | 'degraded' | 'error', db: boolean, uptime: number, version: string }`

**Acceptance Criteria**:
- Returns 200 with `status: 'ok'` when DB is connected
- Returns 503 with `status: 'error'` when DB is unreachable
- Docker health check uses this endpoint

---

## Orchestrator Instructions

The Phase 1 Backend Sub-Orchestrator should follow this delegation sequence:

### Wave 1 (Parallel -- no dependencies)
Launch Agent 1 (Schema Architect) and Agent 2 (Docker Engineer) simultaneously.

- Agent 1 starts with T1 (extensions), then proceeds through T2-T15 sequentially (each schema file may reference prior tables via foreign keys)
- Agent 2 works on T16-T18 (Docker setup) independently

**Checkpoint**: When Agent 1 completes T1-T15 and Agent 2 completes T16-T18:
- Run `docker-compose up -d`
- Verify all SQL files execute without error
- Verify database health check passes
- Record result in implementation log

### Wave 2 (Parallel -- depends on Wave 1)
Launch Agent 3 (Import Engineer) and Agent 4 (API Developer) simultaneously.

- Agent 3 works on T19-T29 (import pipeline) -- some tasks are sequential (T19 before T20, T21/T22 before T20)
- Agent 4 works on T30-T35 (API routes) -- T30 first, then T31-T35

**Checkpoint**: When both agents complete:
- Run full test suite
- Test CSV import end-to-end with sample data
- Test API routes via curl or integration tests
- Verify `GET /api/contacts` returns imported data
- Record result in implementation log

### Final Verification
- Run `docker-compose down && docker-compose up`
- Verify data persists
- Run `GET /api/health`
- Import a Connections.csv
- Query `GET /api/contacts`
- Verify contacts appear in the database

---

## Dependencies

### Internal (within Backend)

```
T1 -> T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13 (extensions before tables)
T2 -> T5, T6, T7, T8, T9, T10, T13, T14, T15 (core tables before dependent tables)
T2, T3 -> T14 (materialized view needs all joined tables)
T16 -> T19-T35 (Docker must be running for import/API work)
T19 -> T20, T24, T25, T26, T27 (csv-parser before specific importers)
T21 -> T20, T26, T27 (company-resolver before importers that use it)
T22 -> T20 (dedup before connections importer)
T19-T27 -> T28 (all importers before pipeline orchestrator)
T10 -> T29 (vector tables before embedding generator)
T30 -> T31, T32 (db client before query functions)
T31 -> T33 (contact queries before contact routes)
T32 -> T34 (import queries before import routes)
T28 -> T34 (import pipeline before import routes)
```

### External (cross-domain)

- App team needs `GET /api/contacts`, `GET /api/health` to build contacts table and health indicator
- App team needs `POST /api/import/upload` and `GET /api/import/status/:sessionId` to build import wizard

---

## Gate Criteria

All of the following must pass before Phase 2 begins:

- [ ] `docker-compose up` starts both containers and health checks pass
- [ ] All 15 SQL init scripts execute without error on a fresh database
- [ ] `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'` returns 30+ tables
- [ ] CSV import of sample Connections.csv creates contact records in the database
- [ ] CSV import of sample messages.csv creates messages and computes message_stats
- [ ] Company resolver correctly deduplicates companies across contacts
- [ ] Re-importing the same CSV produces zero new contacts (all skipped/updated)
- [ ] `GET /api/contacts` returns paginated contact list
- [ ] `GET /api/contacts/:id` returns a single contact with company data
- [ ] `GET /api/contacts/search?q=test` returns matching contacts
- [ ] `POST /api/import/upload` accepts CSV files
- [ ] `GET /api/import/status/:sessionId` returns progress during import
- [ ] `GET /api/health` returns `{ status: 'ok' }` with database connection confirmed
- [ ] HNSW index builds on profile_embeddings (at least one embedding generated)
- [ ] Page cache rotation trigger keeps only 5 versions per URL
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Schema version record shows `1.0.0`

---

## Estimated Agent Count and Specializations

| Agent | Type | Specialization | Estimated Duration |
|-------|------|---------------|-------------------|
| Agent 1 | Schema Architect | PostgreSQL DDL, triggers, indexes, materialized views, ruvector extensions | 2-3 days |
| Agent 2 | Docker Engineer | Docker Compose, Dockerfile, init script orchestration, health checks | 1 day |
| Agent 3 | Import Engineer | CSV parsing, company resolution, dedup, edge construction, embeddings | 3-4 days |
| Agent 4 | API Developer | Next.js API routes, pg client, query functions, input validation | 2-3 days |

**Total agents**: 4
**Parallelism**: Wave 1 (2 agents), Wave 2 (2 agents)
**Critical path**: Agent 1 (schema) -> Agent 3 (import) -- approximately 5-7 days sequential
