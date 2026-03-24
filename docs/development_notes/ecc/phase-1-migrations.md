# Phase 1 — WS-1: Database Migrations

**Completed**: 2026-03-24
**Agent**: ws1-migrations

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `data/db/init/024-taxonomy-hierarchy.sql` | ~70 | Verticals table, niche vertical_id FK, ICP niche_id FK, industry data migration, "General" fallback |
| `data/db/init/025-ecc-causal-graph.sql` | ~32 | causal_nodes + causal_edges with tenant_id, entity indexes |
| `data/db/init/026-ecc-exo-chain.sql` | ~22 | exo_chain_entries with chain_id grouping, UNIQUE(chain_id, sequence) |
| `data/db/init/027-ecc-impulses.sql` | ~46 | impulses + impulse_handlers + impulse_acks, status CHECK constraint |
| `data/db/init/028-ecc-cognitive-tick.sql` | ~33 | research_sessions + session_messages, status CHECK constraint |
| `data/db/init/029-ecc-cross-refs.sql` | ~29 | cross_refs on edges, UNIQUE(edge_id, relation_type, source) dedup |
| `data/db/init/030-ecc-rls.sql` | ~71 | RLS for all 9 new tables: tenant_isolation + admin_bypass |

## Files Modified

None — all new files.

## Decisions Made

- Used `gen_random_uuid()` (pg built-in) instead of `uuid_generate_v4()` for consistency
- `niche_profiles.vertical_id` is nullable to allow gradual migration
- `icp_profiles.niche_id` uses a partial unique index (WHERE niche_id IS NOT NULL)
- 024 migration creates a "General" fallback vertical and assigns orphan niches to it
- 030 RLS uses join-based policies for session_messages, causal_edges, impulse_acks (no direct tenant_id)

## Known Issues

- None. All SQL files are self-contained and parseable.

## Acceptance Status

- [x] All 7 SQL migration files created
- [x] FK references use correct table names
- [x] Indexes cover query patterns from architecture doc
- [x] RLS policies follow existing 022 pattern
- [x] "General" fallback vertical for migration safety
