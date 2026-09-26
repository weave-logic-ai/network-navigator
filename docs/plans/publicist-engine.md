# Publicist Engine — Phased Delivery

**Status**: Design Document
**Date**: 2026-09-19
**Drives**: ADR-036 (editorial bounded context), ADR-037 (skill pack distribution)
**Deploys to**: `docs/plans/ruos-deployment.md`

---

## The thesis, in one paragraph

A content calendar is a commodity. What is not a commodity is knowing
*which article to write next because of who is in your network and how
they are scored*. This repo already has the expensive half: enrichment,
9 composite scoring dimensions, 6 referral components, 19 personas, graph
centrality, community detection, and a source-ingestion layer with trust
weighting. The publicist engine is the comparatively thin layer that
turns that into editorial decisions and measures whether they worked. Build
the thin layer; do not rebuild the thick one.

---

## Phase sequence

Each phase ends in something demonstrable. No phase depends on a later
phase's code.

### Phase 1 — Themes and the network-gap signal

*Deliverable: "Your gold tier talks about X. You have never written about X."*

- Migration: `editorial_themes`, `content_ideas` (+ RLS following the
  `040-analytics-events.sql` pattern).
- `app/src/lib/editorial/themes/` — derive candidate themes from
  `owner_profiles` (current version), `icp_profiles`, `niche_profiles`,
  `offerings`.
- `app/src/lib/editorial/signals/network-gap.ts` — aggregate
  `content_profiles.topics` over gold/silver contacts, diff against
  published themes.
- **Coverage guard**: the signal reports what fraction of scored contacts
  have a `content_profile` and abstains below threshold. ADR-036 calls this
  out; on a sparse database this signal is noise, and noise that looks like
  insight is worse than silence.
- API: `GET /api/editorial/themes`, `GET /api/editorial/ideas`.
- Tests under `tests/editorial/`, per ADR-034 — including the no-op-metric
  rule: a metric that cannot fail is not a test.

**Why first**: it is the differentiated claim. If the gap signal is not
convincing on real data, the rest of the plan needs rethinking, and it is
cheap to find that out now.

### Phase 2 — The other three signals, and composition

- `signals/timeliness.ts` — query `source_records` from existing
  connectors, weight via `sources/recency-modifier.ts` and the ADR-030
  composite trust weight.
- `signals/evidence.ts` — cluster snippets (`causal_nodes`,
  `entity_type='snippet'`) by theme; carry citations onto the idea.
- `signals/repetition.ts` — recurring questions across `messages` /
  `outreach_events`.
- `signals/composite.ts` — weighted composition mirroring
  `scoring/composite.ts`, weights tunable through the same mechanism as
  `scoring_weight_profiles`.
- UI: `/editorial` idea inbox — rank, provenance ("why am I seeing this"),
  accept / reject.

### Phase 3 — Drafting, with the budget already in the repo

- Migration: `content_pieces`.
- `app/src/lib/editorial/drafting/` — generation grounded in the captured
  evidence and the operator's own voice (`owner_profiles.summary`,
  headline, prior pieces). Cite the snippets that produced the idea.
- Spend goes through `budget_periods` (`012-budget-schema.sql`). Do **not**
  add a second budget system.
- LLM routing: prefer cheap models for classification and expansion, the
  strong model only for drafting. `AGENTS.md` documents a 3-tier routing
  convention; note its "ADR-026" citation refers to an upstream project's
  ADR sequence, not this repo's (which starts at 027) — `docs/adr/index.md`
  warns about exactly this class of foreign reference. ruOS
  `llm_route_set` can pin the route on the host.
- Tasks of type `content_draft` land in `tasks` against a goal, which means
  they appear in the extension's task list with no new surface.

### Phase 4 — Publication and performance

- Migrations: `content_publications`, `content_performance`,
  `content_audience_links`.
- Extension: capture post performance from the operator's own post page —
  new `/api/extension/performance`, queued on failure through the existing
  `snippetQueue` replay path. No new capture mechanism.
- Impulses `content_published` and `content_engagement_observed`, **with
  their `impulse_handlers` seed rows in the same migration** — the failure
  documented in `048-seed-impulse-handlers.sql` must not be repeated. Add
  a harness assertion that every emitted impulse type has an enabled
  handler.
- Engagement → contacts → scoring, via the impulse path only. The editorial
  context never writes `contact_scores`.
- **Decide retention for `content_performance` in this phase, and build it
  here or not at all.** ADR-031 specified a daily roll-up that went
  unbuilt for months before landing as
  `sources/cron/parser-rollup`; `parse_field_outcomes_daily` was empty for
  the whole interval. Model the new roll-up on
  `app/src/lib/parser/rollup.ts` — idempotent, upsert by bucket, safe to
  re-run — and ship it with the table, not after it.

### Phase 5 — Goal engine integration

- `app/src/lib/goals/checks/editorial-checks.ts` joins the check pool.
- Extend `TickContext['page']` with `'editorial'`
  (`app/src/lib/goals/types.ts`).
- Checks: theme with no piece in 60 days; a gold contact who engaged twice
  and has no outreach state; a published piece that outperformed its
  baseline and deserves a follow-up; a theme where the timeliness signal
  spiked.
- `goal_check_feedback` suppression applies with no new code — three
  rejections of the same check and context and it stops.

### Phase 6 — Skill pack (ADR-037)

- `/api/manifest` — capability manifest generated from
  `service-manifest.json` plus runtime flags.
- Generalize `extension_tokens` to client tokens with a client kind;
  keep `X-Extension-Token` working as an alias for one release. **This
  touches the shipped extension auth path — the `chrome-extension://`
  origin check must keep passing while a token-only agent client is
  admitted under a different rule. Getting it wrong locks the extension
  out.**
- `api-client.mjs` sends the token; non-localhost without a token is a
  hard startup error.
- Manifest-driven command generation; the pack logs what it generated and
  what it dropped.
- `publicist init` — scaffold a fresh instance end to end.

### Phase 7 — Deploy to ruOS

Per `docs/plans/ruos-deployment.md`. **Phase 0 of that document — the
root-layer persistence test — can and should run immediately and in
parallel with Phase 1 here.** It is a 10-minute test whose answer changes
the provisioning design, and the weekday 23:00 auto-stop guarantees it
will be exercised.

---

## Sequencing notes

- **Migration numbers**: next free is **052**. Gaps exist at 021–023 and
  049–050; 049/050 are unaccounted for in `data/db/init/` and may sit on
  an unmerged branch. This repo has already had one collision (`6f90598`,
  045→046). Check every branch before claiming a number.
- **Parallelism**: Phases 1 and the ruOS persistence test are independent.
  Phase 6 depends only on Phase 1 existing (it needs something to report
  in the manifest), so it can start early if distribution is the priority.
- **What is deliberately not in this plan**: authentication, multi-tenant
  hosting, billing, and any form of automated LinkedIn action. The first
  three are blocked on auth per ADR-035. The fourth is excluded by ADR-036
  as a boundary, not as a phase that has not arrived yet.

---

## How to tell whether this worked

Vanity metrics are a trap here, and this engine is capable of producing
them convincingly. The measures that count:

1. **Idea acceptance rate** — proportion of generated ideas the operator
   accepts. Falling rate means the signals are drifting; `goal_check_feedback`
   already records the raw data.
2. **Network movement per piece** — contacts whose tier improved within 30
   days of engaging with a published piece. This is the actual claim of the
   product.
3. **Gap closure** — themes where gold-tier interest existed and now has
   published coverage.
4. **Time from idea to publication** — if drafts pile up unpublished, the
   bottleneck is drafting quality, not idea generation, and effort should
   move.

Per ADR-034's no-op-metric rule, each of these needs a defined failure
condition, not just a number on a dashboard.
