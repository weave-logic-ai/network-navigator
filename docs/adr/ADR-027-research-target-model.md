# ADR-027: Research target model — one self per owner, primary/secondary split, primary immutable for v1

**Status**: Accepted (date: 2026-04-17) — **Implementation note updated: 2026-09-25**

> **Implementation note (2026-09-25, checked against the current checkout):**
> The live Graph tab reads `secondaryTargetId` from `/api/targets/state` in
> `app/src/app/(app)/network/page.tsx` and passes it to `SigmaGraph`.
> `app/src/components/network/sigma-graph.tsx` requests
> `/api/graph/sigma-data?primaryTargetId=<secondary>`. The parameter name is
> historical and does **not** permit changing the immutable primary/self.
> `sigma-data` currently re-roots only `kind='contact'`; company and self
> targets fall through to the default PageRank view. A plain node click selects
> a node, while shift-click sets it as the secondary and re-roots. The older
> `/api/graph/data` also accepts `primaryTargetId`, but its `NetworkGraph`
> caller does not pass one and is not the live Graph tab. The decision below
> remains the intended behavior; company focus and the wider app's target
> scoping remain delivery gaps tracked in `08-phased-delivery.md`.

## Context

The Network Navigator research-tools sprint promotes "target" from an implicit UI
concept to a first-class data-model entity (`research_targets`). Two model
questions had to be settled before the Phase 0 migration lands:

1. What exactly is the `self` target — one row per `owner_profiles`, a shim that
   falls through to `owner_profiles`, or multiple self rows ("research
   personas")? (`.planning/research-tools-sprint/09-open-questions.md` Q1,
   lines 8-32)
2. When a secondary target is set, how active is it — passive bookmark,
   automatic two-column compare, or opt-in per-card compare? (Q4, lines 92-113)

Both questions shape WS-4 (`.planning/research-tools-sprint/04-targets-and-graph.md`)
and the migration that creates `research_targets` and `research_target_state`.
Downstream: every scoring, ECC-provenance, graph, gap-analysis, and ICP surface
either keeps its owner-scoped assumption or gains a target parameter.

The tool operator observation reshaped Q4 mid-review:

> "Self is me or the person who is using the tool to discover their network.
> However, it became clear over the last week that oftentimes you don't want the
> center of the graph to be yourself. You want to be the target, the person that
> you're looking at." (`10-decisions.md` Q1, lines 12-15)

## Decision

Adopt a one-`self`-per-`owner_profile` model with an immutable primary and an
optional secondary that auto-centers the UI. Concretely:

1. **Self target**: exactly one `research_targets` row per `owner_profiles` row,
   with `kind='self'` and `owner_id` set at migration time. No multi-self
   semantics. Multiple-ICP lenses on the same self are handled by the existing
   `research_target_icps` join, not by duplicate self rows.
   (`10-decisions.md` Q1, lines 8-23; `04-targets-and-graph.md` §8, lines 202-210)
2. **Primary target**: always the session user's self target. Immutable for v1.
   No swap-primary UI. `research_target_state.primary_target_id` is set at
   migration time and only changes when the self row changes.
   (`10-decisions.md` Q4, lines 76-87)
3. **Secondary target** (optional): when set, the UI re-centers on it. Graph
   re-roots to the secondary, dashboard cards reorient, ICP filters default to
   the secondary's segment. Primary (self) becomes the comparison lens — shown
   in the `[Compare]` toggle on individual cards.
   (`10-decisions.md` Q4, lines 76-94)
4. **Swap-primary** (user operating on behalf of someone else) is explicitly
   deferred to a future sprint.
   (`10-decisions.md` Q4, lines 84-87)

## Consequences

### Positive

- Zero-day-one behavior change. Existing dashboards read `owner_profiles`
  unchanged; a user logs in and sees exactly what they saw pre-migration
  because their primary target is themselves.
  (`04-targets-and-graph.md` §8, lines 209-210)
- Intended research workflow: pick a secondary, the app reorients around that
  person/company, and self becomes the comparison. Current code is partial;
  see the implementation note and delivery backlog.
- Migration is a single insert per `owner_profiles` row plus a state backfill —
  no branching read paths in existing code.
- Graph endpoints use the historical `?primaryTargetId=<secondary>` name;
  `sigma-data` is wired to the live Graph tab for contact targets. This is
  partial implementation of the secondary re-center decision, not a change
  to primary-target semantics. (`04-targets-and-graph.md` §3, §9)

### Negative

- Users who want to "become someone else" for a research session cannot
  change primary in v1. They set a secondary; target-aware scoring paths can
  accept its ID, but the dashboard cards still read owner-scoped data. Do not
  treat the two-column layout alone as a completed target comparison.
- Comparison UI must show self against the focused secondary where the card
  supports a meaningful comparison. The planned per-card `[Compare]` control
  is an acceptance item, not a shipped capability.
- `research_target_state` carries redundant columns during v1 because
  `primary_target_id` is derivable from `user_id` → `owner_profiles.id` →
  self-target. We keep the column for forward compatibility with the
  swap-primary future sprint.

### Neutral

- `research_target_icps` has a `lens_id` column from migration 046, while
  active scoring still reads ICP IDs from `research_lenses.config`. The
  canonical mapping and migration behavior remain an open delivery item.
- Target history / breadcrumbs only record secondary switches in v1 (primary
  never changes for a user). History schema still supports `role='primary'` for
  forward compatibility.

## Alternatives considered

### Q1 Option B — `self` as a shim that reads fall through to `owner_profiles`

Every read path that sees `kind='self'` detours back to `owner_profiles`.
Rejected: duplicates the concept without removing the old code path, and
introduces a conditional branch on every target read for zero benefit.
(`09-open-questions.md` Q1 Option B, lines 18-26)

### Q1 Option C — multiple self targets per user ("research personas")

One owner has N self rows — "me as consultant," "me as board member." Rejected
explicitly by the operator:

> "You don't need to actually make them a persona, so to speak, because they're
> already part of your persona." (`10-decisions.md` Q1, lines 16-19)

The existing persona / niche / ICP layer already covers this need via
`research_target_icps`. Revisit only if multiple users request it.

### Q4 Option A — fully passive secondary (bookmark only)

Setting a secondary changes nothing unless the user picks a compare lens.
Rejected: the whole research workflow described by the operator requires the
secondary to drive re-centering by default.
(`10-decisions.md` Q4, lines 72-75)

### Q4 Option B — automatic two-column everywhere

Every card renders in two columns when secondary is set. Rejected: clutters
cards that have no natural comparison (tasks, recent messages). The operator's
model is "secondary owns the view; primary is available as comparison" — not
"everything doubles up." (`10-decisions.md` Q4, lines 88-94)

### Q4 Option C — opt-in toggle per card

Originally recommended in `09-open-questions.md`. Rejected in favor of the
custom fourth pattern where secondary auto-centers. The per-card `[Compare]`
toggle is still present — but as a lens for seeing self's numbers against the
secondary backdrop, not as the only way to see comparison at all.
(`10-decisions.md` Q4, lines 92-94; `04-targets-and-graph.md` §4, lines 117-133)

## Related

- Source: `.planning/research-tools-sprint/04-targets-and-graph.md`
  (WS-4, the target architecture spec)
- Source: `.planning/research-tools-sprint/10-decisions.md`
  Q1 (lines 8-23), Q4 (lines 68-94)
- Source: `.planning/research-tools-sprint/09-open-questions.md`
  Q1 (lines 8-32), Q4 (lines 92-113)
- Migration: `data/db/init/035-targets-schema.sql`
  (named in `04-targets-and-graph.md` §15 and `07-architecture-and-schema.md` §4)
- Cross-ref: ADR-029 (chain_id scope uses target identity defined here)
- Cross-ref: ADR-032 (conflict banner runs on the target page this model defines)
- Cross-ref: ADR-033 (research-mode flag gates the secondary-centering UI)
