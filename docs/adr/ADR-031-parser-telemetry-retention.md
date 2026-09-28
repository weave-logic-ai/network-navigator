# ADR-031: Parser telemetry retention — 90-day raw plus daily aggregate

**Status**: Accepted (date: 2026-04-17) — **Updated: 2026-08-19**

> **Update 2026-08-19**: The daily roll-up job that populates
> `parse_field_outcomes_daily` (Decision point 2) was never written — no
> cron, script, or route anywhere in the repo inserts into that table. The
> table exists (migration `033-parse-telemetry.sql`) but is permanently
> empty. `readYieldReport()` (`app/src/lib/parser/telemetry.ts:151-176`)
> queries the aggregate first, gets zero rows every time, and falls
> through to re-aggregating raw `parse_field_outcomes` on every call — so
> the admin `/admin/parsers` page pays the full raw-scan cost on every
> request, the exact cost the "Cheap long-term trends" Positive
> consequence below says the aggregate avoids. This is a real gap, not a
> documented phase deferral: Decision point 4 explicitly defers only the
> drop-after-90-days **prune** cron to Phase 2 ("Phase 0 only needs the
> tables to exist" refers to retention enforcement); the aggregate
> *population* job carries no such deferral in the source planning docs
> and was expected to exist from Phase 0.

## Context

WS-1 (`.planning/research-tools-sprint/01-parser-audit.md` §4.2, lines 146-164)
introduces `parse_field_outcomes` — one row per field per parse call, carrying
`{value_present, confidence, source, selector_used, selector_index}`. This is
the substrate for drift detection, admin alerts, and regression analysis.

Volume estimate from `09-open-questions.md` Q8 (lines 176-190):

```
50 captures/day/user × ~20 fields × 20 users × 90 days ≈ 1.8M rows
```

Not catastrophic, but grows linearly. Three retention shapes were considered:

- **A**: 90-day raw retention + daily aggregate table for long-term trends.
- **B**: Raw retention indefinitely; query raw for any trend.
- **C**: Compressed archive — 30-day raw, aggregated to daily for 2 years.

Operator answer: "A" (`10-decisions.md` Q8, line 148).

## Decision

Adopt Option A:

1. **Raw retention**: `parse_field_outcomes` rows are kept for 90 days, then
   dropped by a scheduled job.
2. **Aggregate retention**: a daily roll-up table
   `parse_field_outcomes_daily` is populated each day and retained for 2 years
   for trend analysis.
3. **Migration**: `data/db/init/033-parse-telemetry.sql` creates both the raw
   table and the aggregate table in the same Phase 0 migration.
   (`10-decisions.md` §Updates-to-phased-delivery, lines 202-208)
4. **Retention job**: the drop-after-90-days cron lands in Phase 2, not
   Phase 0. Phase 0 only needs the tables to exist.
   (`10-decisions.md` line 207)

Aggregate row shape (derived from `01-parser-audit.md` §4.2 trend query):

```
parse_field_outcomes_daily (
  tenant_id     uuid,
  page_type     text,
  field_name    text,
  day           date,
  n_samples     int,
  n_present     int,
  avg_confidence real,
  primary key (tenant_id, page_type, field_name, day)
)
```

The 7-day / 30-day / 90-day trend queries in `01-parser-audit.md` §4.2 run
against this aggregate; the admin parsers page at `/admin/parsers` consumes
the trend query output.

## Consequences

### Positive

- **Bounded raw table**. Steady-state size is ~1.8M rows at the estimated
  volume, deterministically capped by the 90-day retention.
- ~~**Cheap long-term trends**. The aggregate table is ~60x smaller than raw
  per field, so 2-year trend queries stay fast with an index on
  `(page_type, field_name, day)`.~~ **Not realized (2026-08-19)**: the
  aggregate was never populated (no roll-up job existed until 2026-08-20,
  see the Decision note above), so every trend
  query falls through to a full raw-table scan. See the update note at the
  top of this file.
- **Debuggability preserved**. 90 days of raw rows let engineers inspect
  individual parse outcomes when a field starts regressing. Debug questions
  rarely reach further back.
- ~~**Simple migration story**. Aggregate is a nightly roll-up; if the cron
  fails, the next run backfills from raw (within the 90-day window).~~
  ~~**Not built (2026-08-19)**: there is no nightly roll-up cron at all yet.~~
  **BUILT 2026-08-20.** `app/src/lib/parser/rollup.ts` (`runParserRollup`)
  aggregates raw outcomes into `parse_field_outcomes_daily`, exposed as
  `POST /api/sources/cron/parser-rollup` following the existing cron-route
  convention (flag-gated on `RESEARCH_FLAGS.parserTelemetry`, cron-authorized,
  optional `?day=YYYY-MM-DD` for backfill). Idempotent by construction: each
  run recomputes the day's full aggregate from raw and upserts via
  `ON CONFLICT ... DO UPDATE SET` against `uq_pfod_bucket` — absolute
  overwrite, never `+=`, so a re-run is a no-op rather than a double-count.
  No migration was needed; migration 033 already shipped the exact unique
  constraint an upsert requires. NOTE: no scheduler is registered in-repo for
  this or any sibling cron route — they are assumed to be triggered
  externally. The Phase 2 *prune* cron remains deliberately unbuilt.
  See the update note at the top of this file.

### Negative

- **Raw rows older than 90 days are lost**. Any future analytic question that
  needs per-row granularity beyond 90 days (e.g. "show me exactly which
  selector variants were tried on 2026-Jan-15") cannot be answered. We
  accept this for storage efficiency and can extend retention case-by-case.
- **Roll-up cron is a new operational surface**. It must run; missing a day
  means the aggregate has a gap. Mitigation: idempotent roll-up + a
  gap-detection check in the parser-alerts cron from `01-parser-audit.md`
  §4.2.
- **Schema change on the raw table is constrained by the 90-day window**.
  Adding a new column requires backfilling nulls across up to 90 days of
  history — usually fine, but callable out.

### Neutral

- Retention cron is Phase 2, so Phase 0 ships with the tables empty of
  retention enforcement. Early data is simply kept as raw until the cron
  activates.
- Aggregate can be re-derived at any time from raw (within the 90-day
  window). Schema is non-authoritative — a schema change to aggregate
  only requires a truncate + re-roll-up, not a data migration.
- `parse_field_outcomes` and its aggregate are **not** causal_nodes — they
  are parser-domain telemetry, not causal events.
  (`06-evidence-and-provenance.md` §13, line 308)

## Alternatives considered

### Q8 Option B — raw retention indefinitely

Rejected: linear growth, no practical upper bound, and 90 days is already
beyond the useful debug window (operator confirmed A).
(`09-open-questions.md` Q8 Option B, lines 183-184)

### Q8 Option C — 30-day raw plus 2-year aggregate

Narrower debug window than A (30 vs 90 days) with the same aggregate shape.
Rejected implicitly by operator answer "A" and explicitly in
`09-open-questions.md` recommendation (lines 188-190): "90-day rows are
small and queryable; anything older is trend-only." 30 days is tighter
than sprint planning cycles; 90 days survives a quarterly post-mortem.

### No aggregate — just drop raw at 90 days

Raw drops without preservation. Rejected: trend queries beyond 90 days become
impossible, defeating the drift-detection goal of WS-1.
(`01-parser-audit.md` §4.2 trend query needs history, lines 166-189)

## Related

- Source: `.planning/research-tools-sprint/01-parser-audit.md`
  §4.2 (confidence telemetry schema and trend query, lines 146-189)
  §9 (risk register row on unbounded growth, line 393)
- Source: `.planning/research-tools-sprint/10-decisions.md`
  Q8 (lines 146-154)
- Source: `.planning/research-tools-sprint/09-open-questions.md`
  Q8 (lines 176-190)
- Migration: `data/db/init/033-parse-telemetry.sql`
  (creates `parse_field_outcomes`, `parse_field_outcomes_daily`,
  `parser_regression_reports`, `selector_config_audit`)
- Retention cron: future Phase 2 addition under
  `app/src/app/api/cron/parse-field-outcomes-prune/route.ts`
  (not named in source docs; implied by Phase 2 scheduling)
- Cross-ref: ADR-033 (research-mode flag does not gate this — parser
  telemetry is global, not target-scoped)
