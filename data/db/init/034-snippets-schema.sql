-- Research Tools Sprint — WS-3: Snippets storage
-- Per `07-architecture-and-schema.md` §2.2 and `03-snippet-editor.md` §§3–6.
-- Per ADR-027 (and the explicit decision in `03-snippet-editor.md` §3),
-- snippets are NOT a dedicated table — they live as causal_nodes rows with
-- entity_type='snippet' and kind='evidence'. This migration therefore only
-- adds the sidecar tables that cannot fit inside causal_nodes:
--   * snippet_blobs — binary payloads for image snippets (dedup by sha256)
--   * snippet_tags  — per-tenant tag taxonomy (seeded + user-extensible)
-- plus two indexes on causal_nodes itself that accelerate snippet reads.
--
-- Per user decision Q3 (`10-decisions.md`), snippets write ExoChain entries
-- keyed by `chain_id = 'snippet:' || target.kind || ':' || target.id` where
-- kind ∈ {self, contact, company}. That chain_id lives in exo_chain_entries
-- (already created by 026) and is not materialized here.
--
-- Per user decision Q9, snippets that create contacts kick off LinkedIn-only
-- enrichment via the `scripts/capture-fixture.ts` hook. Hook wiring is Phase 1;
-- this migration reserves no column for it.

-- -------------------------------------------------------------------------
-- snippet_blobs — binary payloads for image snippets
-- -------------------------------------------------------------------------
-- Stored inline as bytea for now; a future migration moves large bodies to
-- object storage. Dedup on (tenant_id, sha256) — the same logo twice is one
-- row. The 5 MB cap matches the server and extension; the CHECK provides
-- a database safeguard. Postgres bytea TOASTs automatically, so this is not
-- a performance concern for typical crop sizes.
CREATE TABLE IF NOT EXISTS snippet_blobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  mime_type    TEXT NOT NULL,
  byte_length  INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 5242880),
  sha256       BYTEA NOT NULL,
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_snippet_blobs_sha UNIQUE (tenant_id, sha256)
);

CREATE INDEX IF NOT EXISTS ix_snippet_blobs_tenant
  ON snippet_blobs(tenant_id, created_at DESC);

-- -------------------------------------------------------------------------
-- snippet_tags — per-tenant tag taxonomy
-- -------------------------------------------------------------------------
-- `slug` is the canonical identifier (e.g. 'filing/sec-10k'). Tags applied
-- to a snippet live denormalized in causal_nodes.output->'tags' (see
-- `03-snippet-editor.md` §6.2 — that design trade-off is deliberate;
-- GIN index below makes tag queries fast). User-added tags must namespace
-- under an existing seeded root (§6.3 validation).
CREATE TABLE IF NOT EXISTS snippet_tags (
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  slug        TEXT NOT NULL,
  label       TEXT NOT NULL,
  parent_slug TEXT,
  is_seeded   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS ix_snippet_tags_parent
  ON snippet_tags(tenant_id, parent_slug)
  WHERE parent_slug IS NOT NULL;

-- -------------------------------------------------------------------------
-- Indexes on causal_nodes that accelerate snippet reads
-- -------------------------------------------------------------------------
-- GIN on output->'tags' for "find snippets on this target tagged filing/*"
CREATE INDEX IF NOT EXISTS ix_causal_nodes_snippet_tags
  ON causal_nodes USING GIN ((output -> 'tags'))
  WHERE entity_type = 'snippet';

-- (entity_type, entity_id) lookup for snippet, source_record, and target nodes
CREATE INDEX IF NOT EXISTS ix_causal_nodes_entity_pair
  ON causal_nodes(entity_type, entity_id)
  WHERE entity_type IN ('snippet', 'source_record', 'target');

-- -------------------------------------------------------------------------
-- Seed the canonical tag taxonomy (per `03-snippet-editor.md` §6.1)
-- -------------------------------------------------------------------------
-- Seeded tags apply to every existing tenant (and every future tenant via
-- onboarding). 22 leaf slugs across 5 parent categories.
-- Parents are implicit (represented only as `parent_slug` on children); we
-- do not insert parent rows because parents are never applied to a snippet.

INSERT INTO snippet_tags (tenant_id, slug, label, parent_slug, is_seeded)
SELECT t.id, v.slug, v.label, v.parent_slug, TRUE
FROM tenants t
CROSS JOIN (
  VALUES
    -- role-history/*
    ('role-history/current',     'Current role',            'role-history'),
    ('role-history/prior',       'Prior role',              'role-history'),
    ('role-history/departure',   'Departure',               'role-history'),
    ('role-history/promotion',   'Promotion',               'role-history'),
    -- achievement/*
    ('achievement/award',        'Award',                   'achievement'),
    ('achievement/press',        'Press mention',           'achievement'),
    ('achievement/funding',      'Funding',                 'achievement'),
    -- filing/*
    ('filing/sec-10k',           'SEC 10-K',                'filing'),
    ('filing/sec-10q',           'SEC 10-Q',                'filing'),
    ('filing/sec-8k',            'SEC 8-K',                 'filing'),
    ('filing/sec-13f',           'SEC 13F',                 'filing'),
    ('filing/sec-proxy',         'SEC proxy (DEF 14A)',     'filing'),
    ('filing/court',             'Court filing',            'filing'),
    ('filing/patent',            'Patent filing',           'filing'),
    -- news/*
    ('news/press-release',       'Press release',           'news'),
    ('news/article',             'News article',            'news'),
    ('news/blog',                'Blog post',               'news'),
    ('news/podcast',             'Podcast',                 'news'),
    ('news/interview',           'Interview',               'news'),
    -- provenance/*
    ('provenance/wayback',       'Wayback snapshot',        'provenance'),
    ('provenance/screenshot',    'Screenshot',              'provenance'),
    ('provenance/user-note',     'User note',               'provenance')
) AS v(slug, label, parent_slug)
ON CONFLICT (tenant_id, slug) DO NOTHING;
