# ADR-030: Source trust resolution — composite final_weight = category_default × per_item_multiplier

**Status**: Accepted (date: 2026-04-17) — **Updated: 2026-08-19**

> **Update 2026-08-19**: Two corrections verified against
> `data/db/init/036-sources-schema.sql` and `app/src/lib/sources/connectors/`.
> 1. The Decision section's "Conflict resolution uses `final_weight` **at
>    query time**, not at ingestion time" is inverted from what shipped.
>    `source_field_values.final_weight` is a Postgres `GENERATED ALWAYS AS
>    (category_default_snapshot * per_item_multiplier) STORED` column
>    (`036-sources-schema.sql:194-195`) — computed and frozen at
>    INSERT/UPDATE time, not recomputed on read. The schema's own comment
>    admits the gap: writers must keep `category_default_snapshot` in sync
>    when admins retune category weights, and "a backfill job is a future
>    item" (`036-sources-schema.sql:174`). A tenant who retunes
>    `source_type_weights.category_default` today does not change any
>    existing row's `final_weight` until that row is re-ingested or a
>    (currently unbuilt) backfill job runs.
> 2. `per_item_multiplier` implements two of the four signals this ADR
>    names (engagement score, citation count, recency modifier, manual
>    override) and only partially at that. Citation count is not
>    implemented anywhere in `app/src/lib/sources`. A general,
>    tenant-configurable recency modifier (distinct from ordinary
>    `referenced_date` temporal resolution, which this ADR explicitly
>    scopes out) is not implemented. Manual override does not adjust
>    `per_item_multiplier` at all — user overrides bypass the composite
>    formula entirely via `source_field_overrides` (ADR-032's
>    display-time win). Of what *is* implemented:
>    `app/src/lib/sources/connectors/news/shared.ts:350-353` derives a
>    1.0/1.2 multiplier from a JSON-LD `viewCount` heuristic — the closest
>    thing to "engagement" that exists, wired into only the five news-site
>    connectors (wsj, bloomberg, reuters, techcrunch, cnbc — one of the
>    seven `source_type` categories this ADR's ordering names).
>    `app/src/lib/sources/connectors/wayback.ts` derives its multiplier
>    from snapshot age, not engagement. `app/src/lib/sources/connectors/rss.ts:236-260`
>    derives its multiplier from cross-feed republication count, not
>    engagement. `edgar.ts` writes a hardcoded `1.0` and computes nothing
>    (`edgar.ts:348`). `corporate-blog.ts`, `podcast.ts`, and
>    `google-news.ts` do not write `source_field_values` rows at all.

## Context

When two sources disagree about the same field at the same point in time
(e.g. an EDGAR filing lists a contact as "VP, Technology" while a press
release issued in the same month says "VP Engineering"),
`05-source-expansion.md` §13.2 defined a default source-trust ordering:

```
edgar > press_release > news > linkedin > blog > podcast > wayback
```

`09-open-questions.md` Q5 (lines 116-137) raised the question of how rigid
that ordering should be. Three shapes were considered:

- **A**: Default ordering, tenant-overridable.
- **B**: Recency-wins regardless of source type.
- **C**: No implicit winner — always ask the user.

The operator accepted A as the baseline but added a dynamic-weight dimension:

> "Maybe the default is the default scoring for these categories. To be honest,
> it may be that the post, the podcast, or whatever it is did so well, like,
> say, it became viral, that it would actually want to be first, right,
> because it was the most important, or last, depending on which way you're
> cutting it. I would say we're probably going to follow the default order
> for that initial thing, but I do think that the weights can actually affect
> that." (`10-decisions.md` Q5, lines 99-104)

## Decision

Source-trust resolution computes a composite weight per source instance:

```
final_weight = source_category_default × per_item_multiplier
```

- `source_category_default` comes from the per-tenant table of category
  weights, seeded from the `05-source-expansion.md` §13.2 ordering and
  overridable per tenant.
- `per_item_multiplier` is derived per `source_records` row from signals:
  - **engagement score** (likes, shares, comments — normalized per source
    type)
  - **citation count** (how many other stored sources reference this one)
  - **recency modifier** (optional, tenant-configurable, defaults off)
  - **manual override** (user clicks "trust this more/less")
  (`10-decisions.md` Q5, lines 107-112)
  **Not fully implemented (2026-08-19)**: only a per-connector proxy for
  "engagement" (news `viewCount`, wayback age-decay, RSS republication
  count) exists; citation count, a general recency modifier, and manual
  override as a multiplier component are all unbuilt. See the update note
  at the top of this file.
- ~~Conflict resolution uses `final_weight` **at query time**, not at
  ingestion time. A snippet or source record can move up or down the trust
  order after the fact as engagement accrues.~~ **Correction 2026-08-19**:
  `final_weight` is a `GENERATED ... STORED` column computed at write
  time; it does not move after ingestion without a re-ingest or a backfill
  job that does not exist yet. See the update note at the top of this
  file. (`10-decisions.md` Q5, lines 113-114)

Scope:

- The composite formula applies only to **contradictory-value reconciliation**
  in the contact / company projection path.
  (`05-source-expansion.md` §13.2, lines 373-378)
- It does NOT apply to temporal resolution (which still uses
  `referenced_date`; `05-source-expansion.md` §13.1, lines 366-370).
- It does NOT apply to manual user overrides, which always win at display
  time. Those are handled by ADR-032.

## Consequences

### Positive

- **Default ordering is preserved for the common case**. Tenants who never
  touch weights see exactly the behavior `05-source-expansion.md` §13.2
  specified. Operator: "we're probably going to follow the default order for
  that initial thing."
- **Viral or contested content can surface or be buried** without hard-coding
  per-source exceptions. A blog post that accrues 50,000 shares can legitimately
  outrank a passing news article.
- ~~**Conflict-reconciliation stays query-time**, so ingesting a new source
  does not rewrite stored projections — the projection is recomputed on
  next read.~~ **Correction 2026-08-19**: not what shipped —
  `final_weight` is fixed at write time. See the update note at the top of
  this file.
- **Per-tenant category defaults** remain one axis of the composite; they are
  not replaced, just multiplied. Tenants can still tune category-level trust
  without touching per-item logic.

### Negative

- **Query-time computation cost**: every contradictory-value read fans out
  across the candidate sources and computes `final_weight`. We mitigate with
  the existing `caches` table (`013-cache-graph-schema.sql`) and recompute
  on source-record change events via the `source.fetched` impulse.
- **Engagement signal reliability varies by source type**. A podcast has no
  native engagement count; we fall back to a default multiplier of 1.0 and
  rely on citation count and manual override instead. This is a known
  asymmetry; documented in the signal calibration spec.
- **Testability**: composite scoring requires per-signal fixtures plus
  end-to-end conflict tests. The existing conflict test from
  `05-source-expansion.md` §18 acceptance checklist ("EDGAR and LinkedIn show
  different titles → projection shows both with attribution") must be
  extended with engagement-override variants.
- **Admin debuggability**: when a field's "winner" is not what the tenant
  expects, the admin needs to see the multipliers. UI must expose the
  breakdown (category_default, multiplier components, final_weight) for any
  conflict row.

### Neutral

- ADR-032's challenge-banner treatment runs regardless of which weight won.
  A conflict is always surfaced, never buried.
  (`10-decisions.md` Q5, lines 114-116)
- Migration for this decision is additive: signals are derived from columns
  that already exist on `source_records.metadata` (engagement) or from join
  counts (citations). No new tables beyond the tenant-category-weights one
  `05-source-expansion.md` §13.2 already proposed.

## Alternatives considered

### Q5 Option A — plain default ordering, tenant-overridable only

Accepted as the baseline but extended. Pure A would ignore viral-content
signals and give every source the same weight inside its category.

### Q5 Option B — recency-wins regardless of source type

Rejected per `09-open-questions.md` trade-off: "fragile — a scraped news
article's date can be wrong" (lines 130-131). Temporal resolution is
already handled separately by `referenced_date` (§13.1); conflating
trust with recency would lose the "older EDGAR > newer blog" case.

### Q5 Option C — no implicit winner, always ask the user

Rejected: "never wrong but every conflict requires user action"
(`09-open-questions.md` Q5, lines 132-133). Friction unacceptable for the
research workflow. The banner treatment in ADR-032 gives users awareness
of disagreements without requiring resolution on every read.

### Static tenant-only overrides (no per-item signals)

Tenants can override category weights but individual sources cannot move.
Rejected per operator wording: virality is a real, observed reason for a
single source to matter more than its category suggests.

## Related

- Source: `.planning/research-tools-sprint/05-source-expansion.md`
  §13.2 (contradictory reconciliation, lines 373-378)
  §13.1 (temporal resolution — unaffected by this ADR, lines 366-370)
- Source: `.planning/research-tools-sprint/10-decisions.md`
  Q5 (lines 98-116)
- Source: `.planning/research-tools-sprint/09-open-questions.md`
  Q5 (lines 116-137)
- Cross-ref: ADR-032 (conflict banner runs regardless of weight outcome)
- Cross-ref: ADR-033 (research-mode flag gates the source-conflict UI)
- Impulses: `source.fetched` (triggers projection recompute),
  `source.mismatch` (fires the banner in ADR-032)
