# V2 Final Analysis: Backend Stream

## 1. Backend Architecture Overview

### Why PostgreSQL + ruvector-postgres Now

The V1 system uses a dual-store architecture: a monolithic `graph.json` file for structured data and a `network.rvf` file for 384-dim vector embeddings. The symposium panels originally recommended SQLite as the structured store, but the product owner's decision to adopt **PostgreSQL with the ruvector-postgres extension** supersedes that recommendation and delivers significantly more capability with minimal additional complexity.

**What ruvector-postgres replaces:**

| V1 Component | Replaced By | Benefit |
|---|---|---|
| `graph.json` (monolithic JSON) | PostgreSQL relational tables | ACID transactions, indexing, concurrent access, SQL queries |
| `network.rvf` (file-based HNSW) | ruvector-postgres vector columns + `ruhnsw` indexes | Same HNSW search, but co-located with relational data; no separate sync step |
| Custom graph traversal code (`graph-cache.ts`) | `ruvector_cypher_query()`, `ruvector_graph_shortest_path()` | Native Cypher queries, shortest path, PageRank -- 8 graph functions built in |
| Manual BFS/Dijkstra for warm intros | `ruvector_graph_shortest_path(start, end)` | Sub-millisecond path finding |
| No community detection | `ruvector_spectral_cluster()`, `ruvector_pagerank()` | Built-in graph analytics at SQL level |
| External embedding generation | `ruvector_embed()` with 6 local models | Local 384-dim embeddings via `all-MiniLM-L6-v2` or `bge-small-en-v1.5` -- no API calls |
| No hybrid search | `ruvector_hybrid_search()`, `ruvector_bm25_score()` | Vector + BM25 keyword fusion in one query |
| No GNN capability | `ruvector_gnn_gcn_layer()`, `ruvector_gnn_graphsage_layer()` | Graph neural network inference for influence propagation |
| No self-healing indexes | `ruvector_index_health()`, `ruvector_auto_repair()` | Autonomous index maintenance |

**Key ruvector-postgres capabilities used in this design:**

- **143 SQL functions** covering vectors, graph, GNN, attention, BM25, and more
- **Local embedding generation** via `ruvector_embed(text, model)` -- 384-dim using `all-MiniLM-L6-v2`
- **Cypher graph queries** via `ruvector_cypher_query()` for traversal and pattern matching
- **SPARQL/RDF** via `ruvector_sparql()` for semantic web interop (future)
- **Hybrid search** combining vector similarity with BM25 keyword scoring
- **Self-healing HNSW indexes** with scheduled maintenance
- **GNN layers** for influence propagation and node classification
- **PageRank and spectral clustering** for centrality and community detection

### docker-compose Architecture

The V2 backend runs as three containers:

```
+---------------------------------------------------+
|              docker-compose stack                   |
|                                                     |
|  +-------------+  +----------------------------+   |
|  | ruvector-pg |  | linkedin-prospector-app    |   |
|  | (postgres)  |  | (Next.js 15 + Node 20)     |   |
|  |             |  |                            |   |
|  | Port: 5432  |<-| DATABASE_URL=postgres://   |   |
|  | Vol: pgdata |  | Port: 3000                 |   |
|  +-------------+  | Vol: ./app, ./data         |   |
|                    +----------------------------+   |
+---------------------------------------------------+
```

### docker-compose.yml

```yaml
version: "3.9"

services:
  db:
    image: ruvnet/ruvector-postgres:latest
    container_name: lp-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: linkedin_prospector
      POSTGRES_USER: lp_user
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:-changeme_in_env}"
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lp_user -d linkedin_prospector"]
      interval: 5s
      timeout: 5s
      retries: 5
    shm_size: "256mb"

  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: lp-app
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: "postgresql://lp_user:${POSTGRES_PASSWORD:-changeme_in_env}@db:5432/linkedin_prospector"
      NODE_ENV: production
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./config:/app/config

volumes:
  pgdata:
    driver: local
```

**Note:** API keys for enrichment providers are stored in `./config/api-keys.json` (mounted into the app container, never committed). The `POSTGRES_PASSWORD` and `ANTHROPIC_API_KEY` come from a `.env` file that is `.gitignore`-d.

### Database Initialization Script

Placed at `./db/init/001-extensions.sql`, run automatically on first container start:

```sql
-- Enable ruvector extension
CREATE EXTENSION IF NOT EXISTS ruvector;

-- Verify
SELECT ruvector_embed('test initialization', 'all-MiniLM-L6-v2');
```

---

## 2. Database Schema

### 2.1 Core Tables

#### contacts

The primary node table. Every person in the network is a row here. The LinkedIn URL is the canonical identifier.

```sql
CREATE TABLE contacts (
    id              TEXT PRIMARY KEY,           -- LinkedIn URL (canonical, e.g. https://www.linkedin.com/in/janesmith)
    first_name      TEXT,
    last_name       TEXT,
    display_name    TEXT NOT NULL,
    headline        TEXT,
    position        TEXT,
    company_id      TEXT REFERENCES companies(id),
    company_raw     TEXT,                       -- original company string from CSV before resolution
    location        TEXT,
    email           TEXT,                       -- from CSV export (if available)
    connected_on    DATE,
    degree          INTEGER DEFAULT 1,          -- 1 = direct connection, 2 = discovered
    source          TEXT DEFAULT 'csv_import',   -- csv_import | chrome_extension | enrichment | manual
    data_completeness REAL DEFAULT 0.0,         -- 0.0-1.0 how much data we have
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_degree ON contacts(degree);
CREATE INDEX idx_contacts_source ON contacts(source);
CREATE INDEX idx_contacts_connected_on ON contacts(connected_on);
CREATE INDEX idx_contacts_display_name ON contacts(display_name);
```

#### companies

Company nodes linked via `WORKS_AT` edges. De-duplicated by slug.

```sql
CREATE TABLE companies (
    id              TEXT PRIMARY KEY,           -- slug (e.g. acme-corp)
    name            TEXT NOT NULL,
    domain          TEXT,                       -- website domain for enrichment lookups
    industry        TEXT,
    size_range      TEXT,                       -- '1-10', '11-50', '51-200', '201-1000', '1000+'
    founded_year    INTEGER,
    website         TEXT,
    linkedin_url    TEXT,
    contact_count   INTEGER DEFAULT 0,         -- denormalized: how many contacts work here
    penetration_score REAL DEFAULT 0.0,        -- account penetration metric
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_name ON companies(name);
CREATE INDEX idx_companies_domain ON companies(domain);
CREATE INDEX idx_companies_industry ON companies(industry);
```

#### edges

Typed, weighted relationships between any two nodes.

```sql
CREATE TABLE edges (
    id          SERIAL PRIMARY KEY,
    source_id   TEXT NOT NULL,                 -- contact or company id
    target_id   TEXT NOT NULL,                 -- contact or company id
    edge_type   TEXT NOT NULL,                 -- CONNECTED_TO, WORKS_AT, WORKED_AT, MESSAGED,
                                               -- ENDORSED, RECOMMENDED, INVITED_BY, SIMILAR_TO,
                                               -- SIMILAR_CONTENT, DISCOVERED_VIA, WARM_INTRO_PATH
    weight      REAL DEFAULT 1.0,
    direction   TEXT DEFAULT 'undirected',     -- undirected | outgoing | incoming
    metadata    JSONB DEFAULT '{}',            -- flexible edge attributes
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_id, target_id, edge_type)
);

CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_type ON edges(edge_type);
CREATE INDEX idx_edges_source_type ON edges(source_id, edge_type);
CREATE INDEX idx_edges_weight ON edges(weight DESC);
```

#### clusters

Communities/groups detected by algorithms or defined by the user.

```sql
CREATE TABLE clusters (
    id              TEXT PRIMARY KEY,           -- generated slug
    label           TEXT NOT NULL,
    description     TEXT,
    discovery_method TEXT DEFAULT 'louvain',    -- louvain | spectral | hdbscan | manual
    member_count    INTEGER DEFAULT 0,
    gold_density    REAL DEFAULT 0.0,           -- fraction of gold-tier members
    avg_gold_score  REAL DEFAULT 0.0,
    keywords        JSONB DEFAULT '[]',         -- characteristic terms
    top_roles       JSONB DEFAULT '[]',         -- top 5 role patterns
    top_industries  JSONB DEFAULT '[]',         -- top 3 industries
    centroid_embedding RUVECTOR(384),           -- cluster centroid in profile space
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cluster_memberships (
    cluster_id  TEXT REFERENCES clusters(id) ON DELETE CASCADE,
    contact_id  TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    fit_score   REAL DEFAULT 0.0,              -- how well this contact fits the cluster
    is_hub      BOOLEAN DEFAULT FALSE,
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (cluster_id, contact_id)
);

CREATE INDEX idx_cluster_members_contact ON cluster_memberships(contact_id);
```

### 2.2 Enrichment Provenance Tables

Separate tables per enrichment domain, with full source attribution. This preserves "PDL says X, Apollo says Y" and supports TTL-based refresh.

#### person_enrichments

```sql
CREATE TABLE person_enrichments (
    id              SERIAL PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,              -- pdl | apollo | lusha | chrome_extension
    emails          JSONB DEFAULT '[]',         -- [{email, type, confidence}]
    phones          JSONB DEFAULT '[]',         -- [{number, type}]
    summary         TEXT,                       -- about/bio
    skills          JSONB DEFAULT '[]',         -- [string]
    social_profiles JSONB DEFAULT '{}',         -- {twitter: url, github: url, ...}
    raw_response    JSONB,                      -- full API response for debugging
    confidence      REAL DEFAULT 0.0,           -- overall match confidence
    credits_consumed INTEGER DEFAULT 0,
    retrieved_at    TIMESTAMPTZ DEFAULT NOW(),
    ttl_expires_at  TIMESTAMPTZ,               -- when this data should be re-enriched
    is_current      BOOLEAN DEFAULT TRUE,       -- FALSE after re-enrichment replaces this
    UNIQUE(contact_id, provider, retrieved_at)
);

CREATE INDEX idx_person_enrich_contact ON person_enrichments(contact_id);
CREATE INDEX idx_person_enrich_provider ON person_enrichments(provider);
CREATE INDEX idx_person_enrich_ttl ON person_enrichments(ttl_expires_at);
CREATE INDEX idx_person_enrich_current ON person_enrichments(contact_id, is_current) WHERE is_current = TRUE;
```

#### work_history

```sql
CREATE TABLE work_history (
    id          SERIAL PRIMARY KEY,
    contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    company     TEXT NOT NULL,
    company_id  TEXT REFERENCES companies(id),
    title       TEXT,
    description TEXT,
    location    TEXT,
    start_date  DATE,
    end_date    DATE,                          -- NULL = current
    is_current  BOOLEAN DEFAULT FALSE,
    source      TEXT DEFAULT 'pdl',            -- pdl | csv | chrome_extension
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_work_history_contact ON work_history(contact_id);
CREATE INDEX idx_work_history_company ON work_history(company_id);
CREATE INDEX idx_work_history_current ON work_history(contact_id) WHERE is_current = TRUE;
```

#### education

```sql
CREATE TABLE education (
    id          SERIAL PRIMARY KEY,
    contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    school      TEXT NOT NULL,
    degree      TEXT,
    field       TEXT,
    start_date  DATE,
    end_date    DATE,
    activities  TEXT,
    source      TEXT DEFAULT 'pdl',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_education_contact ON education(contact_id);
```

#### company_enrichments

```sql
CREATE TABLE company_enrichments (
    id              SERIAL PRIMARY KEY,
    company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,              -- crunchbase | builtwith | theirstack
    funding_total   BIGINT,                    -- total funding in USD cents
    funding_rounds  JSONB DEFAULT '[]',         -- [{round, amount, date, investors[]}]
    revenue_range   TEXT,                       -- '$1M-$10M', '$10M-$50M', etc
    employee_count  INTEGER,
    employee_growth REAL,                      -- % growth YoY
    tech_stack      JSONB DEFAULT '[]',         -- [string] technologies
    investors       JSONB DEFAULT '[]',         -- [string] investor names
    growth_signals  JSONB DEFAULT '{}',         -- {hiring: bool, expanding: bool, ...}
    raw_response    JSONB,
    credits_consumed INTEGER DEFAULT 0,
    retrieved_at    TIMESTAMPTZ DEFAULT NOW(),
    ttl_expires_at  TIMESTAMPTZ,
    is_current      BOOLEAN DEFAULT TRUE,
    UNIQUE(company_id, provider, retrieved_at)
);

CREATE INDEX idx_company_enrich_company ON company_enrichments(company_id);
CREATE INDEX idx_company_enrich_provider ON company_enrichments(provider);
CREATE INDEX idx_company_enrich_ttl ON company_enrichments(ttl_expires_at);
```

#### Materialized "current best" view

Joins across provenance tables using priority order to provide a single enriched view per contact:

```sql
CREATE MATERIALIZED VIEW enriched_contacts AS
SELECT
    c.id,
    c.display_name,
    c.headline,
    c.position,
    co.name AS company_name,
    co.industry,
    c.location,
    c.email AS csv_email,
    c.connected_on,
    c.degree,
    -- Best email from enrichment (PDL > Apollo > Lusha priority)
    COALESCE(
        (SELECT pe.emails->0->>'email' FROM person_enrichments pe
         WHERE pe.contact_id = c.id AND pe.is_current AND pe.provider = 'pdl'
         AND jsonb_array_length(pe.emails) > 0 LIMIT 1),
        (SELECT pe.emails->0->>'email' FROM person_enrichments pe
         WHERE pe.contact_id = c.id AND pe.is_current AND pe.provider = 'apollo'
         AND jsonb_array_length(pe.emails) > 0 LIMIT 1),
        (SELECT pe.emails->0->>'email' FROM person_enrichments pe
         WHERE pe.contact_id = c.id AND pe.is_current AND pe.provider = 'lusha'
         AND jsonb_array_length(pe.emails) > 0 LIMIT 1),
        c.email
    ) AS best_email,
    -- Best phone (Lusha > PDL > Apollo)
    COALESCE(
        (SELECT pe.phones->0->>'number' FROM person_enrichments pe
         WHERE pe.contact_id = c.id AND pe.is_current AND pe.provider = 'lusha'
         AND jsonb_array_length(pe.phones) > 0 LIMIT 1),
        (SELECT pe.phones->0->>'number' FROM person_enrichments pe
         WHERE pe.contact_id = c.id AND pe.is_current AND pe.provider = 'pdl'
         AND jsonb_array_length(pe.phones) > 0 LIMIT 1)
    ) AS best_phone,
    -- Company enrichment
    ce.funding_total,
    ce.revenue_range,
    ce.tech_stack,
    ce.employee_count,
    -- Scoring
    cs.gold_score,
    cs.tier,
    cs.persona,
    -- Data completeness
    c.data_completeness
FROM contacts c
LEFT JOIN companies co ON c.company_id = co.id
LEFT JOIN LATERAL (
    SELECT * FROM company_enrichments
    WHERE company_id = co.id AND is_current ORDER BY retrieved_at DESC LIMIT 1
) ce ON TRUE
LEFT JOIN LATERAL (
    SELECT * FROM contact_scores
    WHERE contact_id = c.id ORDER BY scored_at DESC LIMIT 1
) cs ON TRUE;

CREATE UNIQUE INDEX idx_enriched_contacts_id ON enriched_contacts(id);
```

### 2.3 Behavioral Observation Tables

Both generic and specific tables as directed by the product owner, then vectorized.

#### behavioral_observations (generic)

```sql
CREATE TABLE behavioral_observations (
    id              SERIAL PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    observation_type TEXT NOT NULL,             -- post | comment | like | profile_view |
                                                -- endorsement | share | article | activity_pattern
    data            JSONB NOT NULL,             -- type-specific structured data
    observed_at     TIMESTAMPTZ NOT NULL,       -- when the behavior occurred
    captured_at     TIMESTAMPTZ DEFAULT NOW(),  -- when we recorded it
    source          TEXT DEFAULT 'chrome_extension',
    page_cache_id   INTEGER REFERENCES page_cache(id),
    UNIQUE(contact_id, observation_type, observed_at)
);

CREATE INDEX idx_behavioral_contact ON behavioral_observations(contact_id);
CREATE INDEX idx_behavioral_type ON behavioral_observations(observation_type);
CREATE INDEX idx_behavioral_observed ON behavioral_observations(observed_at DESC);
CREATE INDEX idx_behavioral_contact_type ON behavioral_observations(contact_id, observation_type);
```

#### content_profiles (specific, derived from NLP analysis)

```sql
CREATE TABLE content_profiles (
    id              SERIAL PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    topics          JSONB DEFAULT '[]',         -- [{topic, confidence, frequency}]
    pain_points     JSONB DEFAULT '[]',         -- [{pain, confidence}]
    engagement_style TEXT,                      -- thought-leadership | educational | promotional | personal
    posting_frequency TEXT,                     -- daily | weekly | monthly | rare
    avg_likes       REAL DEFAULT 0,
    avg_comments    REAL DEFAULT 0,
    content_recency DATE,
    sentiment_trajectory TEXT,                  -- improving | stable | declining
    analysis_depth  TEXT DEFAULT 'light',       -- light | medium | deep
    analyzed_at     TIMESTAMPTZ DEFAULT NOW(),
    analysis_cost   REAL DEFAULT 0,             -- Claude API cost for this analysis
    UNIQUE(contact_id)
);

CREATE INDEX idx_content_profiles_contact ON content_profiles(contact_id);
CREATE INDEX idx_content_profiles_style ON content_profiles(engagement_style);
```

#### activity_patterns (specific, derived from observation aggregation)

```sql
CREATE TABLE activity_patterns (
    id              SERIAL PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    posting_days    JSONB DEFAULT '[]',         -- ['tuesday', 'thursday']
    posting_hours   JSONB DEFAULT '[]',         -- [9, 10, 14, 15]
    timezone        TEXT,                       -- inferred, e.g. 'America/New_York'
    engagement_peaks JSONB DEFAULT '[]',        -- ['tuesday-morning', 'thursday-afternoon']
    last_active     TIMESTAMPTZ,
    activity_level  TEXT DEFAULT 'unknown',     -- active | moderate | dormant | unknown
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(contact_id)
);
```

### 2.4 Message/Communication Tables

Full message storage in PostgreSQL for Claude analysis, as approved by the product owner.

```sql
CREATE TABLE messages (
    id                  SERIAL PRIMARY KEY,
    conversation_id     TEXT NOT NULL,
    contact_id          TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    sender_name         TEXT,
    sender_profile_url  TEXT,
    recipient_name      TEXT,
    recipient_profile_url TEXT,
    direction           TEXT NOT NULL,          -- sent | received
    subject             TEXT,
    content             TEXT,                   -- full message body
    sent_at             TIMESTAMPTZ NOT NULL,
    imported_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_contact ON messages(contact_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_sent ON messages(sent_at DESC);
CREATE INDEX idx_messages_direction ON messages(direction);

-- Aggregated relationship signals derived from messages
CREATE TABLE message_stats (
    id              SERIAL PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    message_count   INTEGER DEFAULT 0,
    sent_count      INTEGER DEFAULT 0,
    received_count  INTEGER DEFAULT 0,
    conversation_count INTEGER DEFAULT 0,
    first_message   TIMESTAMPTZ,
    last_message    TIMESTAMPTZ,
    direction_ratio REAL DEFAULT 0.5,          -- sent/(sent+received), 0.5 = balanced
    avg_response_time_hours REAL,              -- average time between send and reply
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(contact_id)
);

CREATE INDEX idx_message_stats_contact ON message_stats(contact_id);
```

### 2.5 Outreach State Tables

Full outreach state machine with campaigns, templates, sequences, and branching as described in `docs/plans/messages_templates.md`.

```sql
-- Campaign groupings
CREATE TABLE outreach_campaigns (
    id              TEXT PRIMARY KEY,           -- slug
    name            TEXT NOT NULL,
    description     TEXT,
    niche_id        TEXT REFERENCES niche_profiles(id),
    icp_id          TEXT REFERENCES icp_profiles(id),
    sequence_id     TEXT REFERENCES outreach_sequences(id),
    status          TEXT DEFAULT 'draft',       -- draft | active | paused | completed | archived
    daily_limit     INTEGER DEFAULT 20,
    total_limit     INTEGER,
    contacts_added  INTEGER DEFAULT 0,
    contacts_completed INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Reusable message templates
CREATE TABLE outreach_templates (
    id              TEXT PRIMARY KEY,           -- slug
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,              -- connection-request | followup | meeting-request |
                                                -- value-add | re-engage | warm-intro
    channel         TEXT NOT NULL,              -- linkedin_connection_request | linkedin_message |
                                                -- email | clipboard
    max_chars       INTEGER,                    -- LinkedIn limits: 300 for connection, ~8000 for message
    template_body   TEXT NOT NULL,              -- with {{variable}} merge fields
    required_fields JSONB DEFAULT '[]',         -- fields that must be present to use this template
    conditions      JSONB DEFAULT '{}',         -- {tier: ['gold'], hasContentProfile: true, ...}
    is_user_created BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Sequences define multi-step outreach flows with branching
CREATE TABLE outreach_sequences (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    is_default      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE outreach_sequence_steps (
    id              SERIAL PRIMARY KEY,
    sequence_id     TEXT NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
    step_number     INTEGER NOT NULL,
    action          TEXT NOT NULL,              -- connection_request | follow_up | value_add |
                                                -- meeting_request | re_engage
    template_id     TEXT REFERENCES outreach_templates(id),
    delay_days      INTEGER DEFAULT 0,          -- days to wait after previous step
    delay_type      TEXT DEFAULT 'fixed',       -- fixed | adaptive (based on activity patterns)
    condition       TEXT,                       -- connection_accepted | no_response | message_read |
                                                -- responded | engaged
    branch_on_fail  INTEGER,                   -- step_number to jump to if condition not met
    abort_after     BOOLEAN DEFAULT FALSE,      -- if TRUE and condition not met, end sequence
    cooldown_days   INTEGER,                    -- days before re-engagement after abort
    UNIQUE(sequence_id, step_number)
);

-- Per-contact outreach state (the state machine)
CREATE TABLE outreach_states (
    id              SERIAL PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    campaign_id     TEXT REFERENCES outreach_campaigns(id),
    sequence_id     TEXT NOT NULL REFERENCES outreach_sequences(id),
    current_state   TEXT NOT NULL DEFAULT 'planned',  -- planned | sent | pending_response |
                                                       -- responded | engaged | converted |
                                                       -- declined | deferred | closed_lost
    current_step    INTEGER DEFAULT 1,
    next_action_at  TIMESTAMPTZ,               -- when the next step should fire
    template_used   TEXT REFERENCES outreach_templates(id),
    message_content TEXT,                       -- the actual rendered message (for audit)
    response_proba  REAL,                       -- predicted response probability
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(contact_id, campaign_id)
);

CREATE INDEX idx_outreach_states_contact ON outreach_states(contact_id);
CREATE INDEX idx_outreach_states_state ON outreach_states(current_state);
CREATE INDEX idx_outreach_states_next ON outreach_states(next_action_at) WHERE next_action_at IS NOT NULL;

-- Outreach event log (append-only audit trail)
CREATE TABLE outreach_events (
    id              SERIAL PRIMARY KEY,
    outreach_state_id INTEGER NOT NULL REFERENCES outreach_states(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,              -- state_change | message_sent | response_received |
                                                -- meeting_booked | template_rendered
    from_state      TEXT,
    to_state        TEXT,
    step_number     INTEGER,
    template_id     TEXT,
    notes           TEXT,
    occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_outreach_events_state ON outreach_events(outreach_state_id);

-- Template performance tracking
CREATE TABLE template_performance (
    id              SERIAL PRIMARY KEY,
    template_id     TEXT NOT NULL REFERENCES outreach_templates(id),
    tier            TEXT,                       -- gold | silver | bronze
    persona         TEXT,
    sent_count      INTEGER DEFAULT 0,
    accepted_count  INTEGER DEFAULT 0,
    response_count  INTEGER DEFAULT 0,
    meeting_count   INTEGER DEFAULT 0,
    accept_rate     REAL DEFAULT 0,
    avg_response_days REAL,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    UNIQUE(template_id, tier, persona, period_start)
);
```

### 2.6 Task/Goal Tables

The agent-driven task system where Claude creates goals and tasks, and the user can accept, reject, or modify them.

```sql
-- High-level goals (visible on dashboard widget and extension)
CREATE TABLE goals (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    goal_type       TEXT NOT NULL,              -- network_exploration | enrichment | outreach |
                                                -- icp_discovery | relationship_building | data_quality
    priority        INTEGER DEFAULT 50,        -- 0-100
    status          TEXT DEFAULT 'proposed',    -- proposed | active | paused | completed | rejected
    progress        REAL DEFAULT 0.0,          -- 0.0-1.0
    niche_id        TEXT REFERENCES niche_profiles(id),
    icp_id          TEXT REFERENCES icp_profiles(id),
    created_by      TEXT DEFAULT 'agent',       -- agent | user
    total_tasks     INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_priority ON goals(priority DESC);

-- Tasks under goals (actionable items for user or agent)
CREATE TABLE tasks (
    id              TEXT PRIMARY KEY,
    goal_id         TEXT REFERENCES goals(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    task_type       TEXT NOT NULL,              -- visit_profile | enrich_contact | send_message |
                                                -- review_icp | capture_page | analyze_content |
                                                -- configure_enrichment | export_data
    target_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    target_url      TEXT,                       -- LinkedIn URL for extension tasks
    priority        INTEGER DEFAULT 50,
    status          TEXT DEFAULT 'pending',     -- pending | in_progress | completed | skipped | failed
    assigned_to     TEXT DEFAULT 'user',        -- user | agent
    execution_data  JSONB DEFAULT '{}',         -- task-specific parameters
    result_data     JSONB DEFAULT '{}',         -- task output/result
    due_at          TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_goal ON tasks(goal_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_type ON tasks(task_type);
CREATE INDEX idx_tasks_target ON tasks(target_contact_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to, status);
```

### 2.7 ICP/Niche Profile Tables

Multiple profiles, switchable, with the wedge model dimensions.

```sql
-- Niche profiles define the breadth of the offering (arc length of wedge)
CREATE TABLE niche_profiles (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    description     TEXT,
    offering        TEXT,                       -- what the user sells/offers in this niche
    keywords        JSONB DEFAULT '[]',         -- characteristic terms
    industries      JSONB DEFAULT '[]',         -- target industries
    tech_signals    JSONB DEFAULT '[]',         -- technologies that indicate fit
    discovery_method TEXT DEFAULT 'manual',     -- manual | hdbscan | agent
    is_active       BOOLEAN DEFAULT TRUE,
    wedge_arc       REAL DEFAULT 0.0,          -- niche breadth metric (arc length)
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ICP profiles define the depth of the market (height of wedge)
CREATE TABLE icp_profiles (
    id              TEXT PRIMARY KEY,
    niche_id        TEXT REFERENCES niche_profiles(id) ON DELETE SET NULL,
    label           TEXT NOT NULL,
    description     TEXT,
    role_patterns   JSONB DEFAULT '{}',         -- {high: [...], medium: [...], low: [...]}
    industries      JSONB DEFAULT '[]',
    signals         JSONB DEFAULT '[]',         -- buying signals / keywords
    company_size_min INTEGER,
    company_size_max INTEGER,
    funding_stages  JSONB DEFAULT '[]',         -- [pre-seed, seed, A, B, ...]
    solvable_pains  JSONB DEFAULT '[]',         -- pains the offering addresses
    topic_signals   JSONB DEFAULT '[]',         -- content topics that indicate fit
    discovery_method TEXT DEFAULT 'manual',     -- manual | hdbscan | agent
    is_active       BOOLEAN DEFAULT TRUE,
    wedge_height    REAL DEFAULT 0.0,          -- ICP depth metric (height)
    scoring_weight  REAL DEFAULT 1.0,          -- relative importance when multiple ICPs active
    cluster_id      TEXT REFERENCES clusters(id), -- link to discovered cluster
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_icp_niche ON icp_profiles(niche_id);
CREATE INDEX idx_icp_active ON icp_profiles(is_active) WHERE is_active = TRUE;

-- Contact-to-ICP fit scores (many-to-many)
CREATE TABLE contact_icp_fits (
    contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    icp_id      TEXT NOT NULL REFERENCES icp_profiles(id) ON DELETE CASCADE,
    fit_score   REAL NOT NULL DEFAULT 0.0,     -- 0.0-1.0
    rank        INTEGER,                       -- 1 = best fit ICP for this contact
    is_primary  BOOLEAN DEFAULT FALSE,
    scored_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (contact_id, icp_id)
);

CREATE INDEX idx_icp_fits_contact ON contact_icp_fits(contact_id);
CREATE INDEX idx_icp_fits_icp ON contact_icp_fits(icp_id);
CREATE INDEX idx_icp_fits_primary ON contact_icp_fits(contact_id) WHERE is_primary = TRUE;

-- Wedge metrics (aggregate for visualization)
CREATE TABLE wedge_metrics (
    id              SERIAL PRIMARY KEY,
    niche_id        TEXT NOT NULL REFERENCES niche_profiles(id) ON DELETE CASCADE,
    icp_id          TEXT REFERENCES icp_profiles(id) ON DELETE CASCADE,
    radius          REAL DEFAULT 0.0,          -- user's penetration into this niche/ICP
    arc_length      REAL DEFAULT 0.0,          -- niche breadth
    height          REAL DEFAULT 0.0,          -- ICP depth
    total_contacts  INTEGER DEFAULT 0,
    gold_contacts   INTEGER DEFAULT 0,
    silver_contacts INTEGER DEFAULT 0,
    computed_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(niche_id, icp_id)
);
```

### 2.8 Scoring Tables

Extensible base with dimension extensions. Complete rewrite from V1 as authorized.

```sql
-- Main score record per contact (latest score is the active one)
CREATE TABLE contact_scores (
    id              SERIAL PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    score_version   INTEGER NOT NULL DEFAULT 1,
    -- Base composite
    gold_score      REAL NOT NULL DEFAULT 0.0,  -- 0.0-1.0 composite
    tier            TEXT DEFAULT 'watch',        -- gold | silver | bronze | watch
    persona         TEXT,                        -- buyer | warm-lead | advisor | hub |
                                                 -- active-influencer | ecosystem-contact | peer | network-node
    behavioral_persona TEXT,                     -- super-connector | content-creator | silent-influencer |
                                                 -- rising-connector | data-insufficient | passive-network
    -- Weight configuration used for this score
    weights_config  JSONB NOT NULL DEFAULT '{}', -- {icpFit: 0.22, networkHub: 0.18, ...}
    -- Metadata
    dimensions_available INTEGER DEFAULT 0,     -- how many dimensions had data
    scored_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scores_contact ON contact_scores(contact_id);
CREATE INDEX idx_scores_tier ON contact_scores(tier);
CREATE INDEX idx_scores_gold ON contact_scores(gold_score DESC);
CREATE INDEX idx_scores_latest ON contact_scores(contact_id, scored_at DESC);

-- Individual dimension scores (extensible -- add new dimensions without schema change)
CREATE TABLE score_dimensions (
    id              SERIAL PRIMARY KEY,
    score_id        INTEGER NOT NULL REFERENCES contact_scores(id) ON DELETE CASCADE,
    dimension       TEXT NOT NULL,              -- icp_fit | network_hub | relationship_strength |
                                                -- signal_boost | skills_relevance | network_proximity |
                                                -- behavioral | content_relevance | graph_centrality |
                                                -- (extensible: add new dimensions freely)
    raw_value       REAL NOT NULL DEFAULT 0.0,  -- 0.0-1.0 dimension score
    weight          REAL NOT NULL DEFAULT 0.0,  -- weight used in composite (after redistribution)
    sub_scores      JSONB DEFAULT '{}',         -- dimension-specific breakdown
    UNIQUE(score_id, dimension)
);

CREATE INDEX idx_dimensions_score ON score_dimensions(score_id);
CREATE INDEX idx_dimensions_dim ON score_dimensions(dimension);

-- Scoring weight profiles (user-tunable)
CREATE TABLE scoring_weight_profiles (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    weights         JSONB NOT NULL,             -- {icpFit: 0.22, networkHub: 0.18, ...}
    is_default      BOOLEAN DEFAULT FALSE,
    is_learned      BOOLEAN DEFAULT FALSE,      -- TRUE if weights came from Bayesian updating
    learning_data   JSONB DEFAULT '{}',         -- {conversions: 15, model_params: {...}}
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tier thresholds (configurable per degree)
CREATE TABLE tier_thresholds (
    id              SERIAL PRIMARY KEY,
    degree          INTEGER NOT NULL,           -- 1 or 2
    gold_min        REAL NOT NULL,
    silver_min      REAL NOT NULL,
    bronze_min      REAL NOT NULL,
    icp_id          TEXT REFERENCES icp_profiles(id), -- NULL = default thresholds
    UNIQUE(degree, icp_id)
);

-- Insert V1 defaults
INSERT INTO tier_thresholds (degree, gold_min, silver_min, bronze_min, icp_id)
VALUES
    (1, 0.55, 0.40, 0.28, NULL),
    (2, 0.42, 0.30, 0.18, NULL);
```

### 2.9 Vector Embedding Tables

Two 384-dim embedding spaces as specified: profile similarity (nodes) and content/topic similarity (signals).

```sql
-- Profile embeddings (who someone IS: role, skills, industry, experience)
CREATE TABLE profile_embeddings (
    contact_id      TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    embedding       RUVECTOR(384) NOT NULL,
    input_text      TEXT,                       -- the text used to generate the embedding
    model           TEXT DEFAULT 'all-MiniLM-L6-v2',
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profile_emb_hnsw ON profile_embeddings
    USING ruhnsw (embedding ruvector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Content/topic embeddings (what someone TALKS ABOUT: posts, themes, pain points)
CREATE TABLE content_embeddings (
    contact_id      TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    embedding       RUVECTOR(384) NOT NULL,
    input_text      TEXT,                       -- concatenated topic/content text
    model           TEXT DEFAULT 'all-MiniLM-L6-v2',
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_emb_hnsw ON content_embeddings
    USING ruhnsw (embedding ruvector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Company embeddings (for company similarity search)
CREATE TABLE company_embeddings (
    company_id      TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    embedding       RUVECTOR(384) NOT NULL,
    input_text      TEXT,
    model           TEXT DEFAULT 'all-MiniLM-L6-v2',
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_company_emb_hnsw ON company_embeddings
    USING ruhnsw (embedding ruvector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

**Embedding generation examples using ruvector-postgres:**

```sql
-- Generate profile embedding from contact data
INSERT INTO profile_embeddings (contact_id, embedding, input_text)
SELECT
    c.id,
    ruvector_embed(
        CONCAT_WS(' | ',
            c.display_name, c.headline, c.position,
            co.name, co.industry,
            c.location
        ),
        'all-MiniLM-L6-v2'
    ),
    CONCAT_WS(' | ', c.display_name, c.headline, c.position, co.name, co.industry, c.location)
FROM contacts c
LEFT JOIN companies co ON c.company_id = co.id
WHERE c.id = $1;

-- Find similar profiles (vector search)
SELECT c.display_name, c.headline, pe.embedding <=> $query_vec AS distance
FROM profile_embeddings pe
JOIN contacts c ON c.id = pe.contact_id
ORDER BY pe.embedding <=> $query_vec
LIMIT 20;

-- Hybrid search: vector + keyword
SELECT * FROM ruvector_hybrid_search(
    query_text := 'AI startup CTO',
    query_embedding := ruvector_embed('AI startup CTO', 'all-MiniLM-L6-v2'),
    table_name := 'profile_embeddings',
    vector_column := 'embedding',
    limit_k := 10
);
```

### 2.10 CSV Import Tracking Tables

```sql
CREATE TABLE import_sessions (
    id              SERIAL PRIMARY KEY,
    import_type     TEXT NOT NULL,              -- full_directory | single_csv | re_import
    directory_path  TEXT,
    status          TEXT DEFAULT 'in_progress', -- in_progress | completed | failed | partial
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    error_message   TEXT
);

CREATE TABLE import_files (
    id              SERIAL PRIMARY KEY,
    session_id      INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,              -- Connections.csv, messages.csv, etc
    file_hash       TEXT NOT NULL,              -- SHA-256 of file contents for dedup
    file_size_bytes BIGINT,
    record_count    INTEGER DEFAULT 0,
    new_records     INTEGER DEFAULT 0,
    updated_records INTEGER DEFAULT 0,
    skipped_records INTEGER DEFAULT 0,
    error_count     INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'pending',     -- pending | processing | completed | failed
    processed_at    TIMESTAMPTZ,
    UNIQUE(file_hash)                          -- prevent re-importing same file
);

CREATE TABLE import_change_log (
    id              SERIAL PRIMARY KEY,
    session_id      INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
    contact_id      TEXT REFERENCES contacts(id),
    change_type     TEXT NOT NULL,              -- new_contact | field_update | job_change |
                                                -- new_edge | new_message
    field_name      TEXT,
    old_value       TEXT,
    new_value       TEXT,
    detected_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_import_changes_session ON import_change_log(session_id);
CREATE INDEX idx_import_changes_contact ON import_change_log(contact_id);
CREATE INDEX idx_import_changes_type ON import_change_log(change_type);
```

### 2.11 Budget/Cost Tracking Tables

```sql
CREATE TABLE enrichment_providers (
    id              TEXT PRIMARY KEY,           -- pdl | apollo | lusha | crunchbase | builtwith | theirstack
    display_name    TEXT NOT NULL,
    plan            TEXT,                       -- free | starter | pro | growth | custom
    api_key_configured BOOLEAN DEFAULT FALSE,
    is_enabled      BOOLEAN DEFAULT FALSE,
    monthly_credit_limit INTEGER,
    credit_reset_day INTEGER DEFAULT 1,         -- day of month credits reset
    cost_per_credit REAL DEFAULT 0.0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Insert known providers
INSERT INTO enrichment_providers (id, display_name) VALUES
    ('pdl', 'People Data Labs'),
    ('apollo', 'Apollo.io'),
    ('lusha', 'Lusha'),
    ('crunchbase', 'Crunchbase'),
    ('builtwith', 'BuiltWith'),
    ('theirstack', 'TheirStack'),
    ('claude', 'Claude API (Anthropic)');

CREATE TABLE budget_periods (
    id              SERIAL PRIMARY KEY,
    provider_id     TEXT NOT NULL REFERENCES enrichment_providers(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    credits_total   INTEGER NOT NULL DEFAULT 0,
    credits_used    INTEGER NOT NULL DEFAULT 0,
    credits_remaining INTEGER GENERATED ALWAYS AS (credits_total - credits_used) STORED,
    spend_total     REAL DEFAULT 0.0,          -- actual dollar spend this period
    budget_cap      REAL,                      -- user-set max spend for this period (NULL = no cap)
    UNIQUE(provider_id, period_start)
);

CREATE TABLE enrichment_transactions (
    id              SERIAL PRIMARY KEY,
    provider_id     TEXT NOT NULL REFERENCES enrichment_providers(id),
    contact_id      TEXT REFERENCES contacts(id),
    company_id      TEXT REFERENCES companies(id),
    operation       TEXT NOT NULL,              -- person_enrich | company_enrich | email_verify | tech_lookup
    credits_consumed INTEGER DEFAULT 0,
    cost_usd        REAL DEFAULT 0.0,
    success         BOOLEAN DEFAULT TRUE,
    match_found     BOOLEAN DEFAULT TRUE,
    error_message   TEXT,
    occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_provider ON enrichment_transactions(provider_id);
CREATE INDEX idx_transactions_contact ON enrichment_transactions(contact_id);
CREATE INDEX idx_transactions_date ON enrichment_transactions(occurred_at DESC);

-- ROI tracking view
CREATE VIEW enrichment_roi AS
SELECT
    DATE_TRUNC('month', et.occurred_at) AS month,
    et.provider_id,
    COUNT(*) AS total_lookups,
    COUNT(*) FILTER (WHERE et.match_found) AS matches,
    ROUND(COUNT(*) FILTER (WHERE et.match_found)::numeric / NULLIF(COUNT(*), 0), 3) AS match_rate,
    SUM(et.cost_usd) AS total_spend,
    COUNT(DISTINCT et.contact_id) AS contacts_enriched
FROM enrichment_transactions et
GROUP BY DATE_TRUNC('month', et.occurred_at), et.provider_id;
```

### 2.12 Page Cache Tables

For Chrome extension full-page captures. Keep last 5 copies per page as directed by the product owner.

```sql
CREATE TABLE page_cache (
    id              SERIAL PRIMARY KEY,
    contact_id      TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    page_url        TEXT NOT NULL,
    page_type       TEXT NOT NULL,              -- profile | search_results | feed | company | messages
    html_content    TEXT NOT NULL,              -- full rendered DOM
    captured_at     TIMESTAMPTZ DEFAULT NOW(),
    content_hash    TEXT NOT NULL,              -- SHA-256 for dedup
    size_bytes      INTEGER,
    metadata        JSONB DEFAULT '{}',         -- {viewport, user_agent, selectors_version, ...}
    is_processed    BOOLEAN DEFAULT FALSE,
    processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_page_cache_contact ON page_cache(contact_id);
CREATE INDEX idx_page_cache_url ON page_cache(page_url);
CREATE INDEX idx_page_cache_type ON page_cache(page_type);
CREATE INDEX idx_page_cache_captured ON page_cache(captured_at DESC);

-- Trigger to keep only last 5 cached pages per URL
CREATE OR REPLACE FUNCTION prune_page_cache()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM page_cache
    WHERE id IN (
        SELECT id FROM page_cache
        WHERE page_url = NEW.page_url
        ORDER BY captured_at DESC
        OFFSET 5
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prune_page_cache
AFTER INSERT ON page_cache
FOR EACH ROW EXECUTE FUNCTION prune_page_cache();
```

### 2.13 Graph Nodes and Edges (ruvector-postgres native graph)

In addition to the relational tables above, we register nodes and edges in the ruvector-postgres native graph store for Cypher query access:

```sql
-- Sync contacts into the native graph on insert/update
CREATE OR REPLACE FUNCTION sync_contact_to_graph()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM ruvector_graph_create_node(
        ARRAY['Person'],
        jsonb_build_object(
            'id', NEW.id,
            'name', NEW.display_name,
            'position', NEW.position,
            'company', NEW.company_raw,
            'degree', NEW.degree
        ),
        (SELECT embedding FROM profile_embeddings WHERE contact_id = NEW.id)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sync edges into the native graph
CREATE OR REPLACE FUNCTION sync_edge_to_graph()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM ruvector_graph_create_edge(
        NEW.source_id,
        NEW.target_id,
        NEW.edge_type,
        jsonb_build_object('weight', NEW.weight, 'metadata', NEW.metadata)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2.14 Schema Versioning

```sql
CREATE TABLE schema_versions (
    version     INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO schema_versions (version, description)
VALUES (1, 'Initial V2 schema with ruvector-postgres');
```

---

## 3. CSV Import Pipeline

### 3.1 Multi-CSV Import Architecture

The LinkedIn export is a directory containing multiple CSV files. The import pipeline processes all of them in a defined order:

```
LinkedIn Export Directory
|
+-- Phase 1: Identity (must be first)
|   +-- Profile.csv          --> owner_profile table (user's own data)
|   +-- Connections.csv      --> contacts + companies + CONNECTED_TO edges
|
+-- Phase 2: Relationship Signals
|   +-- messages.csv          --> messages table + message_stats
|   +-- Invitations.csv       --> edges (INVITED_BY) + direction signals
|
+-- Phase 3: Endorsement/Recommendation
|   +-- Endorsement_Received_Info.csv  --> edges (ENDORSED) + skills
|   +-- Endorsement_Given_Info.csv     --> edges (ENDORSED, reverse)
|   +-- Recommendations_Received.csv   --> edges (RECOMMENDED)
|   +-- Recommendations_Given.csv      --> edges (RECOMMENDED, reverse)
|
+-- Phase 4: Context
|   +-- Positions.csv         --> owner work_history
|   +-- Education.csv         --> owner education
|   +-- Skills.csv            --> owner skills (for similarity matching)
|   +-- Company Follows.csv   --> companies of interest
```

### 3.2 Connections.csv Field Mapping

LinkedIn's `Connections.csv` has a 2-line preamble before the header. The parser must detect and skip it.

```
LinkedIn CSV columns         --> Database fields
-----------------------         ----------------
First Name                   --> contacts.first_name
Last Name                    --> contacts.last_name
(derived)                    --> contacts.display_name = "{first} {last}"
URL                          --> contacts.id (canonical LinkedIn URL)
Email Address                --> contacts.email (nullable, opt-in)
Company                      --> contacts.company_raw, companies.name (resolved)
Position                     --> contacts.position, contacts.headline
Connected On                 --> contacts.connected_on (parse "13 Mar 2026" -> DATE)
```

### 3.3 Company Resolution

Every unique company string from CSV gets resolved to a company record:

1. Normalize: trim, collapse whitespace
2. Generate slug: lowercase, replace spaces with hyphens, remove special characters
3. Fuzzy match against existing companies (Levenshtein distance < 3)
4. Create new company record if no match
5. Set `contacts.company_id` to the resolved company

### 3.4 Deduplication Strategy

```
On CSV import, for each row:

1. Extract LinkedIn URL, canonicalize (lowercase, strip trailing slash)
2. Query: SELECT id FROM contacts WHERE id = $url
3. If NOT found:
   - INSERT new contact
   - INSERT CONNECTED_TO edge from owner to contact
   - Log as import_change_log.new_contact
4. If found:
   - Compare fields: company, position
   - If company changed:
     - Log as import_change_log.job_change with old/new values
     - Create new work_history entry for old company (end_date = now)
     - Update contact.company_id, contact.position
   - If position changed (same company):
     - Log as import_change_log.field_update
     - Update contact.position
   - Update contact.updated_at
```

### 3.5 Incremental Re-Import

Users periodically re-export from LinkedIn. The pipeline supports:

- **File hash check**: SHA-256 of file contents prevents re-importing identical files
- **Field-level diff**: Only changed fields are updated (no unnecessary writes)
- **Job change detection**: Company changes between imports are logged as high-value signals
- **Never-delete policy**: Contacts are never removed on re-import; only added or updated
- **Import session tracking**: Every import is logged with counts (new, updated, unchanged, errors)

### 3.6 messages.csv Processing

Messages are imported and aggregated into `message_stats`:

```sql
-- After importing raw messages, compute per-contact stats
INSERT INTO message_stats (contact_id, message_count, sent_count, received_count,
                           conversation_count, first_message, last_message, direction_ratio)
SELECT
    COALESCE(
        CASE WHEN m.direction = 'sent' THEN
            (SELECT id FROM contacts WHERE id = m.recipient_profile_url)
        ELSE
            (SELECT id FROM contacts WHERE id = m.sender_profile_url)
        END
    ) AS contact_id,
    COUNT(*) AS message_count,
    COUNT(*) FILTER (WHERE m.direction = 'sent') AS sent_count,
    COUNT(*) FILTER (WHERE m.direction = 'received') AS received_count,
    COUNT(DISTINCT m.conversation_id) AS conversation_count,
    MIN(m.sent_at) AS first_message,
    MAX(m.sent_at) AS last_message,
    COUNT(*) FILTER (WHERE m.direction = 'sent')::real /
        NULLIF(COUNT(*), 0) AS direction_ratio
FROM messages m
GROUP BY contact_id
ON CONFLICT (contact_id)
DO UPDATE SET
    message_count = EXCLUDED.message_count,
    sent_count = EXCLUDED.sent_count,
    received_count = EXCLUDED.received_count,
    conversation_count = EXCLUDED.conversation_count,
    first_message = EXCLUDED.first_message,
    last_message = EXCLUDED.last_message,
    direction_ratio = EXCLUDED.direction_ratio,
    updated_at = NOW();
```

### 3.7 Edge Construction from CSVs

| CSV File | Edge Type | Weight Basis |
|---|---|---|
| Connections.csv | `CONNECTED_TO` | 1.0 (base) |
| messages.csv | `MESSAGED` | message_count normalized |
| Invitations.csv (outgoing) | `INVITED_BY` (direction: outgoing) | recency |
| Invitations.csv (incoming) | `INVITED_BY` (direction: incoming) | recency |
| Endorsement_Received_Info.csv | `ENDORSED` (direction: incoming) | count per skill |
| Endorsement_Given_Info.csv | `ENDORSED` (direction: outgoing) | count per skill |
| Recommendations_Received.csv | `RECOMMENDED` (direction: incoming) | 2.0 (high-value) |
| Recommendations_Given.csv | `RECOMMENDED` (direction: outgoing) | 1.5 |

---

## 4. Enrichment Pipeline

### 4.1 Waterfall Architecture

The enrichment pipeline follows a field-aware waterfall where providers are queried in cost-optimal order, stopping as soon as required fields are filled.

```
Contact Input: {url, name, company, position}
                |
                v
[Cache Check] -- hit? --> return cached; skip providers
                |
                v (miss or stale)
[Stage 1: PDL] -- best overall, $0.22-0.28/call
    fills: email, phone, work_history, education, skills, summary
    match rate: ~95% on LinkedIn URL
                |
                v (if email/phone missing)
[Stage 2: Apollo] -- $0.02-0.24/call depending on reveal
    fills: missing email, phone, buying intent signals
    match rate: ~76%
                |
                v (if still no email/phone)
[Stage 3: Lusha] -- $0.00-0.087/call
    fills: verified email, phone (strongest for direct phones)
    match rate: varies
                |
                v (per unique company, not per contact)
[Stage 4: Crunchbase] -- $99/mo or per-call
    fills: funding_total, funding_rounds, revenue_range, investors
                |
                v (per unique company domain)
[Stage 5: BuiltWith/TheirStack] -- $59-295/mo
    fills: tech_stack
                |
                v
[Store Results] --> person_enrichments / company_enrichments
                    with full provenance
```

### 4.2 Cost Analysis Per Provider

| Provider | Best Plan for V2 | Cost/Lookup | Best Fields | Monthly Coverage (at plan limit) |
|---|---|---|---|---|
| PDL Starter | $98/mo | $0.28 | Email, phone, experience, skills, education | 350 contacts |
| Apollo Basic | $49/mo | ~$0.02 per search, $0.24 per reveal | Email, phone, intent | 2,500 searches |
| Lusha Free | $0/mo | $0.00 | Verified email + phone | 40 contacts |
| Lusha Pro | $52.45/mo | $0.087 | Same, higher volume | 600 contacts |
| TheirStack Starter | $59/mo | $0.03 | Tech stack | 2,000 companies |
| Crunchbase Pro | $99/mo | UI-based | Funding, revenue, investors | Unlimited UI |
| Claude API | Variable | ~$0.004-0.015/contact | Content analysis | Unlimited (token-based) |

**Cheapest path to maximum data (product owner directive):**

1. Start with **PDL Starter ($98/mo)** + **Lusha Free ($0/mo)** + **TheirStack Starter ($59/mo)** = **$157/mo**
2. PDL covers 350 contacts with full person enrichment (email, phone, experience, skills)
3. Lusha Free fills 40 phone gaps PDL missed
4. TheirStack covers 2,000 company tech stacks
5. Add Apollo Basic ($49/mo) when user needs intent signals or higher email volume
6. Add Crunchbase Pro ($99/mo) when company funding data becomes important
7. Add BuiltWith ($295/mo) only for comprehensive technographics

### 4.3 Provider Abstraction Layer

Every provider implements a common TypeScript interface:

```typescript
interface EnrichmentProvider {
    readonly id: string;                        // 'pdl' | 'apollo' | 'lusha' | etc
    readonly displayName: string;
    isConfigured(): boolean;                    // API key present and valid
    isEnabled(): boolean;                       // user has enabled this provider
    getCreditsRemaining(): Promise<number>;
    getRateLimitStatus(): Promise<RateLimitStatus>;

    enrichPerson(input: PersonEnrichInput): Promise<PersonEnrichResult>;
    enrichCompany(input: CompanyEnrichInput): Promise<CompanyEnrichResult>;

    estimateCost(operation: 'person' | 'company', count: number): CostEstimate;
}

// Each provider module: src/enrichment/providers/pdl.ts, apollo.ts, lusha.ts, etc.
// All registered in: src/enrichment/provider-registry.ts
```

### 4.4 Enrichment Execution Modes

| Mode | Trigger | Description |
|---|---|---|
| **Batch** | User clicks "Enrich selected" in UI | Process N contacts through the full waterfall. Show cost estimate first. |
| **Individual** | User clicks "Enrich" on a single contact | Full waterfall for one contact. Immediate. |
| **Background Drip** | Agent-driven, budget-controlled | Agent selects contacts by priority (gold-tier unenriched first), enriches N/hour within budget cap. |
| **Selective** | User selects specific fields | "Just get emails for gold-tier" -- skip unnecessary providers/stages. |
| **Re-enrichment** | TTL expiry or manual trigger | Re-run waterfall only for stale fields. |

### 4.5 Budget Enforcement

```
Before any enrichment operation:

1. Check budget_periods for current period
2. Compare credits_remaining against requested count
3. If budget_cap set, compare spend_total + estimated_cost against cap
4. If over budget:
   - Refuse operation
   - Surface message: "Monthly budget of $X reached. Adjust in Settings > Enrichment."
5. If near budget (>80%):
   - Warn but allow: "This will use 90% of your remaining PDL credits."
6. After operation:
   - Log enrichment_transactions
   - Update budget_periods.credits_used and spend_total
```

---

## 5. Scoring Engine

### 5.1 Extensible Architecture

The V2 scorer is a complete rewrite as authorized by the product owner. It uses an extensible base with pluggable dimension scorers:

```
Scoring Pipeline:
                                    +-- ICP Fit Scorer
                                    +-- Network Hub Scorer
                                    +-- Relationship Strength Scorer
                                    +-- Signal Boost Scorer
Contact Data -----> [Dimension      +-- Skills Relevance Scorer
(from DB)           Router] ------> +-- Network Proximity Scorer
                                    +-- Behavioral Scorer
                                    +-- Content Relevance Scorer   (NEW in V2)
                                    +-- Graph Centrality Scorer    (NEW in V2)
                                    +-- (future dimensions...)
                        |
                        v
                [Weight Manager]
                - Load active weight profile
                - Null-safe redistribution (V1 pattern preserved)
                - Apply weights to dimension scores
                        |
                        v
                [Composite Calculator]
                - gold_score = sum(dimension * weight)
                - Tier assignment (degree-aware thresholds)
                - Persona classification
                        |
                        v
                [Store to contact_scores + score_dimensions]
```

### 5.2 V2 Base Weights

```typescript
const V2_DEFAULT_WEIGHTS = {
    icp_fit:             0.22,  // ICP profile match (down from V1's 0.28; dynamic ICPs are more precise)
    network_hub:         0.18,  // Mutual connections, cluster breadth, connector index
    relationship_strength: 0.14, // Message frequency, endorsements, recommendations, recency
    signal_boost:        0.06,  // Keyword signals in headline/about
    skills_relevance:    0.08,  // Skill alignment with ICP
    network_proximity:   0.06,  // Bridge quality and diversity
    behavioral:          0.06,  // Activity patterns, connection power
    content_relevance:   0.10,  // NEW: topic/pain point alignment from NLP
    graph_centrality:    0.10,  // NEW: betweenness + PageRank + eigenvector
};
// Total: 1.00
```

Null-safe weight redistribution from V1 is preserved: if a dimension has no data (e.g., no content profile), its weight is redistributed proportionally among available dimensions.

### 5.3 ICP/Niche-Aware Scoring

Each contact is scored against ALL active ICP profiles. The `contact_icp_fits` table stores per-ICP fit scores. The gold_score uses the best-fitting ICP (or a weighted blend if the user configures blending).

### 5.4 The Wedge Model

The "wedge" is a 3D visualization metaphor for the user's network position:

```
Wedge Dimensions:
- Radius = user's penetration depth (how many contacts, how strong)
- Arc = niche breadth (how many niches covered, how wide the offering)
- Height = ICP depth (how deep into a specific market)

Computed from:
- radius = f(contact_count, avg_gold_score, gold_density) per niche
- arc = f(number_of_active_niches, cross_niche_connections)
- height = f(tier_distribution, decision_maker_density) per ICP

Stored in: wedge_metrics table
Updated: on each scoring run
```

### 5.5 Scoring Weight Tuning

Users can create custom weight profiles via the admin panel. All math is exposed:

- View dimension scores on hover in detailed contact view
- Adjust weights with sliders in the scoring tuning panel
- Save as named profiles ("Sales-focused", "Networking-focused")
- Bayesian weight learning from outreach outcomes (when data > 200 attempts)

---

## 6. Graph Analytics

### 6.1 Leveraging ruvector-postgres Graph Functions

The ruvector-postgres extension provides native graph operations that replace the V1 custom JavaScript implementations:

#### Cypher Queries

```sql
-- Find all gold-tier contacts connected to a specific company
SELECT ruvector_cypher_query(
    'MATCH (p:Person)-[:WORKS_AT]->(c:Company {name: "Acme Corp"})
     WHERE p.tier = "gold"
     RETURN p.name, p.position'
);

-- Find mutual connections between two contacts
SELECT ruvector_cypher_query(
    'MATCH (a:Person {id: $source})-[:CONNECTED_TO]->(mutual)<-[:CONNECTED_TO]-(b:Person {id: $target})
     RETURN mutual.name, mutual.tier'
);

-- Find 2-hop paths for warm intros
SELECT ruvector_cypher_query(
    'MATCH path = (me:Person {id: $owner})-[:CONNECTED_TO*1..2]->(target:Person {id: $target})
     RETURN path, length(path) AS hops
     ORDER BY hops ASC'
);
```

#### Centrality Measures

```sql
-- PageRank for influence scoring
SELECT ruvector_pagerank(
    (SELECT jsonb_build_object('edges',
        jsonb_agg(jsonb_build_array(
            (SELECT row_number FROM edges_numbered WHERE id = e.source_id),
            (SELECT row_number FROM edges_numbered WHERE id = e.target_id)
        ))
    ) FROM edges e WHERE e.edge_type = 'CONNECTED_TO')
);

-- Personalized PageRank from the owner node
SELECT ruvector_pagerank_personalized(edges_json, owner_node_index);
```

#### Community Detection

```sql
-- Spectral clustering for community detection
SELECT ruvector_spectral_cluster(adjacency_json, k_clusters);

-- Alternative: use the GNN layer for node classification
SELECT ruvector_gnn_gcn_layer(
    feature_matrix,   -- contact feature vectors
    adjacency_matrix, -- from edges table
    weight_matrix     -- learned or initialized
);
```

### 6.2 Warm Introduction Path Finding

```sql
-- Shortest path between owner and target contact
SELECT ruvector_graph_shortest_path($owner_id, $target_id);
```

The result is enhanced with relationship quality data from the relational tables:

```typescript
interface WarmIntroPath {
    hops: number;
    path: Array<{
        contactId: string;
        displayName: string;
        tier: string;
        goldScore: number;
        relationshipStrength: number;  // from edge weight
    }>;
    introQuality: 'high' | 'medium' | 'low';  // based on weakest link
    bridgeQuality: number;  // average gold_score of intermediaries
}
```

### 6.3 Incremental vs Full Recompute

As directed by the product owner:

- **Incremental**: When new contacts or edges are added, recompute centrality and community membership for the affected subgraph (contacts within 2 hops of the change)
- **On-demand full**: User or agent triggers "Reanalyze Network" for complete recomputation
- **Scheduled**: Nightly full recompute if enabled

### 6.4 Graph Metrics Stored Per Contact

```sql
CREATE TABLE graph_metrics (
    contact_id      TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    betweenness     REAL DEFAULT 0.0,
    pagerank        REAL DEFAULT 0.0,
    eigenvector     REAL DEFAULT 0.0,
    degree_centrality REAL DEFAULT 0.0,
    community_id    TEXT REFERENCES clusters(id),
    is_bridge       BOOLEAN DEFAULT FALSE,      -- high betweenness, connects communities
    is_hub          BOOLEAN DEFAULT FALSE,       -- high degree + high pagerank
    computed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graph_metrics_community ON graph_metrics(community_id);
CREATE INDEX idx_graph_metrics_bridge ON graph_metrics(is_bridge) WHERE is_bridge = TRUE;
```

---

## 7. Agent Task System

### 7.1 How Claude Creates Goals and Tasks

The Claude agent operates as the primary intelligence driver. It analyzes the network state and creates goals with associated tasks. The user can accept, reject, or modify any goal or task.

#### Goal Creation Flow

```
Network State Analysis (by Claude):
1. After CSV import: Analyze clusters, identify ICP candidates
   --> Goal: "Discover your natural ICP profiles"
       Tasks: [review_icp x N clusters, configure_enrichment]

2. After enrichment: Identify gaps and opportunities
   --> Goal: "Enrich gold-tier contacts missing email"
       Tasks: [enrich_contact x N contacts]

3. After scoring: Identify high-value unexplored contacts
   --> Goal: "Explore high-potential contacts in SaaS CTOs cluster"
       Tasks: [visit_profile x 10, capture_page x 10]

4. After content analysis: Identify outreach candidates
   --> Goal: "Connect with AI leaders discussing scaling challenges"
       Tasks: [send_message x 5, with personalized templates]

5. Ongoing: Network health monitoring
   --> Goal: "Strengthen weak connections in Enterprise IT"
       Tasks: [visit_profile x 3, send_message x 2]
```

#### Task Execution

Tasks are categorized by who executes them:

| Task Type | Executor | Where |
|---|---|---|
| `visit_profile` | User (via extension) | Extension shows clickable link |
| `capture_page` | User (via extension) | Extension captures DOM to page_cache |
| `enrich_contact` | Agent (background) | App calls enrichment providers |
| `analyze_content` | Agent (background) | App calls Claude for NLP analysis |
| `send_message` | User (via extension clipboard) | Extension provides rendered template |
| `review_icp` | User (in app) | App shows ICP cluster for confirmation |
| `configure_enrichment` | User (in app) | App shows enrichment provider setup |
| `export_data` | Agent (background) | App generates CSV export |

#### Task Prioritization

Tasks within a goal are prioritized by expected value:

```typescript
function prioritizeTask(task: Task, contact: Contact): number {
    let priority = 0;

    // Gold-tier contacts get highest priority
    if (contact.tier === 'gold') priority += 40;
    else if (contact.tier === 'silver') priority += 20;
    else if (contact.tier === 'bronze') priority += 10;

    // Unenriched contacts with high base scores
    if (contact.data_completeness < 0.3) priority += 15;

    // Tasks that unblock other tasks
    if (task.task_type === 'capture_page') priority += 10;  // enables enrichment
    if (task.task_type === 'enrich_contact') priority += 5;  // enables scoring

    // Recency bonus for newly connected
    const daysSinceConnect = daysBetween(contact.connected_on, new Date());
    if (daysSinceConnect < 7) priority += 20;
    else if (daysSinceConnect < 30) priority += 10;

    return priority;
}
```

### 7.2 How Tasks Drive Enrichment

The agent creates enrichment tasks based on scoring tier and data completeness:

```
Priority 1: Gold-tier, no email       --> enrich via PDL (highest ROI)
Priority 2: Silver-tier, top ICP fit  --> enrich via PDL or Apollo
Priority 3: High behavioral, missing data --> enrich to validate scoring
Priority 4: Companies with 3+ contacts --> company enrichment (account penetration)
Priority 5: Bronze-tier, budget allows  --> enrich via cheapest provider
Priority 6: Watch-tier                  --> skip, wait for re-scoring
```

### 7.3 How Tasks Drive Network Exploration

The agent identifies gaps in the network graph and creates exploration tasks:

```
- Orphan contacts (no edges except CONNECTED_TO) --> visit_profile tasks
- Clusters with low density --> explore mutual connections
- ICP candidates outside the graph --> search task suggestions
- Bridge contacts (high betweenness) --> relationship deepening tasks
- Recent job changers --> visit_profile + outreach tasks
```

---

## 8. API Layer

### 8.1 Next.js Route Handlers

All API routes use the Next.js App Router (`app/api/` directory). Route handlers return JSON.

#### Contacts

```
GET    /api/contacts                    List contacts (paginated, filterable, sortable)
GET    /api/contacts/:id                Get single contact with all enrichment data
POST   /api/contacts                    Create contact manually
PATCH  /api/contacts/:id                Update contact fields
DELETE /api/contacts/:id                Delete contact (cascading, with forget compliance)
GET    /api/contacts/:id/edges          Get all edges for a contact
GET    /api/contacts/:id/enrichments    Get enrichment history for a contact
GET    /api/contacts/:id/scores         Get scoring history for a contact
GET    /api/contacts/:id/messages       Get message history for a contact
GET    /api/contacts/:id/observations   Get behavioral observations for a contact
GET    /api/contacts/:id/warm-intros    Get warm introduction paths to a contact
POST   /api/contacts/:id/enrich        Trigger enrichment for a single contact
POST   /api/contacts/batch-enrich      Trigger enrichment for multiple contacts
GET    /api/contacts/search             Hybrid search (vector + keyword)
GET    /api/contacts/similar/:id        Find similar contacts (vector similarity)
POST   /api/contacts/export             Export contacts to CSV
```

#### Companies

```
GET    /api/companies                   List companies (paginated, filterable)
GET    /api/companies/:id               Get company with enrichment + contacts
POST   /api/companies/:id/enrich        Trigger company enrichment
GET    /api/companies/:id/contacts      Get all contacts at this company
GET    /api/companies/:id/penetration   Get account penetration analysis
```

#### Import

```
POST   /api/import/upload               Upload LinkedIn export directory (multipart)
POST   /api/import/csv                  Import a single CSV file
GET    /api/import/history              Get import session history
GET    /api/import/changes              Get change log from imports
GET    /api/import/status/:sessionId    Get status of an in-progress import
```

#### Scoring

```
POST   /api/scoring/run                 Trigger scoring run (all or filtered contacts)
GET    /api/scoring/weights             Get current weight profile
PUT    /api/scoring/weights             Update weight profile
GET    /api/scoring/weight-profiles     List all weight profiles
POST   /api/scoring/weight-profiles     Create new weight profile
GET    /api/scoring/tiers               Get tier thresholds
PUT    /api/scoring/tiers               Update tier thresholds
GET    /api/scoring/distribution        Get score distribution stats
```

#### ICP / Niche

```
GET    /api/niches                      List all niche profiles
POST   /api/niches                      Create niche profile
PATCH  /api/niches/:id                  Update niche profile
DELETE /api/niches/:id                  Delete niche profile
GET    /api/icps                        List all ICP profiles
POST   /api/icps                        Create ICP profile
PATCH  /api/icps/:id                    Update ICP profile
DELETE /api/icps/:id                    Delete ICP profile
POST   /api/icps/discover              Trigger ICP discovery (HDBSCAN clustering)
GET    /api/icps/:id/contacts           Get contacts matching this ICP
GET    /api/wedge                       Get wedge metrics for all niches/ICPs
```

#### Graph

```
GET    /api/graph/data                  Get full graph data (nodes + edges) for visualization
GET    /api/graph/metrics               Get network health metrics
POST   /api/graph/recompute             Trigger full graph recompute
GET    /api/graph/communities           Get detected communities
GET    /api/graph/bridges               Get bridge nodes
GET    /api/graph/path/:from/:to        Get shortest path between two contacts
POST   /api/graph/cypher                Execute a Cypher query (admin)
GET    /api/graph/clusters              List clusters
GET    /api/graph/clusters/:id          Get cluster details with members
```

#### Enrichment Management

```
GET    /api/enrichment/providers        List configured providers with status
PUT    /api/enrichment/providers/:id    Configure/enable/disable provider
GET    /api/enrichment/budget           Get current budget status across all providers
PUT    /api/enrichment/budget/:provider Set budget cap for a provider
GET    /api/enrichment/transactions     Get enrichment transaction history
GET    /api/enrichment/roi              Get ROI metrics
POST   /api/enrichment/estimate         Estimate cost for a proposed enrichment batch
GET    /api/enrichment/queue            Get pending enrichment queue
```

#### Outreach

```
GET    /api/outreach/campaigns          List campaigns
POST   /api/outreach/campaigns          Create campaign
PATCH  /api/outreach/campaigns/:id      Update campaign
GET    /api/outreach/templates          List templates
POST   /api/outreach/templates          Create template
PATCH  /api/outreach/templates/:id      Update template
GET    /api/outreach/sequences          List sequences
POST   /api/outreach/sequences          Create sequence
GET    /api/outreach/states             Get outreach states (filterable by state, campaign)
PATCH  /api/outreach/states/:id         Update outreach state (manual transition)
POST   /api/outreach/render             Render template for a contact (merge fields)
GET    /api/outreach/performance        Get template performance metrics
GET    /api/outreach/next-actions       Get upcoming outreach actions (due soon)
```

#### Tasks & Goals

```
GET    /api/goals                       List goals (filterable by status)
POST   /api/goals                       Create goal (manual)
PATCH  /api/goals/:id                   Update goal (accept/reject/pause)
DELETE /api/goals/:id                   Delete goal
GET    /api/goals/:id/tasks             Get tasks for a goal
GET    /api/tasks                       List all tasks (filterable, sortable by priority)
PATCH  /api/tasks/:id                   Update task (complete/skip/fail)
GET    /api/tasks/extension             Get tasks formatted for Chrome extension display
POST   /api/tasks/agent-generate        Trigger Claude to generate new goals/tasks
```

#### Chrome Extension

```
POST   /api/extension/capture           Receive page capture from extension (HTML + metadata)
GET    /api/extension/tasks             Get task list formatted for extension popup
GET    /api/extension/contact/:url      Check if a LinkedIn URL is a known contact
POST   /api/extension/sync              Sync extension settings from app
GET    /api/extension/health            Health check (app is running)
POST   /api/extension/message-render    Render outreach message for clipboard
```

#### Agent (Claude)

```
POST   /api/agent/analyze               Trigger Claude analysis (content, scoring, ICP)
POST   /api/agent/chat                  Chat with Claude about the network
GET    /api/agent/suggestions           Get Claude's current suggestions
POST   /api/agent/execute-task          Agent executes a background task
```

#### Admin / System

```
GET    /api/admin/health                System health (DB connection, extension, providers)
GET    /api/admin/stats                 System-wide stats (contacts, enrichments, scores)
POST   /api/admin/purge                 Manual data purge with filters (name, date, older-than)
POST   /api/admin/backup                Create database backup
GET    /api/admin/schema-version        Get current schema version
POST   /api/admin/forget/:contactId     GDPR right to erasure for a contact
GET    /api/admin/page-cache            List cached pages
DELETE /api/admin/page-cache/:id        Delete a cached page
POST   /api/admin/refresh-views         Refresh materialized views (enriched_contacts)
```

### 8.2 Authentication

V2 is single-user, local-only. No user authentication is required for the API. The Chrome extension authenticates to the local app via a shared secret token stored in `chrome.storage.local` and `./config/extension-token.json`. All API calls from the extension include this token in an `X-Extension-Token` header.

### 8.3 Error Response Format

All API errors follow a consistent format:

```typescript
interface ApiError {
    error: string;          // machine-readable error code
    message: string;        // human-readable message
    details?: unknown;      // additional context
    status: number;         // HTTP status code
}
```

---

## Appendix: Schema Diagram Summary

```
contacts -------< edges >------- contacts
    |                                |
    +--< person_enrichments          +--< behavioral_observations
    +--< work_history                +--< content_profiles
    +--< education                   +--< activity_patterns
    +--< messages                    +--< graph_metrics
    +--< message_stats               +--< profile_embeddings
    +--< contact_scores              +--< content_embeddings
    |       +--< score_dimensions    +--< outreach_states
    +--< contact_icp_fits            |       +--< outreach_events
    +--< cluster_memberships         +--< tasks
    +--< page_cache
    |
    +--- company_id --> companies
                            +--< company_enrichments
                            +--< company_embeddings

niche_profiles --< icp_profiles --< contact_icp_fits
                                --< wedge_metrics

goals --< tasks
outreach_campaigns --> outreach_sequences --< outreach_sequence_steps
outreach_templates --< template_performance
enrichment_providers --< budget_periods
                     --< enrichment_transactions
import_sessions --< import_files
               --< import_change_log
```
