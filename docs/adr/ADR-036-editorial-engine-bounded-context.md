# ADR-036: The editorial engine is a new bounded context, not an extension of outreach

**Status**: Proposed (date: 2026-09-19)

## Context

The product currently reasons about *other people's* content and about
*directed* messages to individuals. It has no model of content the
operator authors and publishes.

**What exists, and what it actually covers:**

- `content_profiles` and `content_embeddings` (`004-behavioral-schema.sql`)
  are keyed on `contact_id` — they describe a *contact's* topics, tone and
  posting frequency. They are inbound-facing. `UNIQUE(contact_id)` makes
  this unambiguous: there is no row shape for a piece the operator wrote.
- `content_relevance` (`app/src/lib/scoring/scorers/content-relevance.ts`)
  scores the topical alignment of a *contact's* posted content against the
  operator's targets. It consumes the tables above.
- The `outreach_*` family (`006-outreach-schema.sql`) models 1:1 directed
  messaging: `outreach_states` is per-contact, `outreach_events` records
  sends and replies to a recipient, `template_performance` measures
  per-template reply rates.

Publishing is 1:many and has no recipient. Every one of those outreach
invariants breaks if an article is stored as a campaign: a piece has no
`contact_id`, its "reply rate" is not a reply rate, and its state machine
(idea → drafted → scheduled → published → measured) shares no states with
an outreach sequence. Overloading `outreach_*` would corrupt the meaning
of `template_performance`, which is already load-bearing for the outreach
pipeline.

**What exists that the editorial engine should consume rather than rebuild:**

- `owner_profiles` (`016-`, `047-`) — versioned, `is_current` singleton.
  The authority and voice anchor: headline, summary, skills,
  certifications, honors, projects, `ad_targeting`. Already the canonical
  "who is the author".
- `app/src/lib/sources/` — real, built signal supply. Connectors for
  `google-news`, `rss`, `corporate-blog`, `podcast`, `edgar`, `wayback`,
  with `robots.ts`, `rate-limiter.ts`, `private-ip.ts` and
  `source_subscriptions` (`042-`). Topic-hook discovery is a query against
  this, not new scraping.
- The goal engine (`app/src/lib/goals/`, `031-goal-engine-schema.sql`) —
  tick model, a rotating check pool, dedup by `context_hash`, and
  `goal_check_feedback` suppression after 3 rejections in 30 days.
- ECC impulses (`027-`, `048-`) — the event spine, with the caveat
  recorded below.
- Snippets as `causal_nodes` rows with `entity_type='snippet'`,
  `kind='evidence'` (per ADR-029) — captured research already attached to
  a target and a chain.
- `analytics_events` (`040-`) — tenant-scoped, RLS-enforced event log.

## Decision

**Create `editorial` as a first-class bounded context** — its own tables,
its own `app/src/lib/editorial/` module, its own goal checks and its own
impulse types — consuming the scoring, sources, snippet and owner-profile
contexts through their existing interfaces.

### Domain objects

| Table | Grain | Purpose |
|-------|-------|---------|
| `editorial_themes` | one per positioning pillar | Slow-moving. Derived from `owner_profiles` + `icp_profiles` + `niche_profiles`. The stable spine an idea hangs from. |
| `content_ideas` | one per candidate topic | Provenance-carrying candidate: which signal produced it, which theme, which audience, which evidence. Scored, not yet committed. |
| `content_pieces` | one per committed draft | An idea promoted. Holds format, body, status lifecycle, intended publish window. |
| `content_publications` | one per (piece, channel, time) | A piece actually published. Carries the external reference (e.g. LinkedIn URN). A piece may be published more than once. |
| `content_performance` | one per (publication, observed_at) | Observed metrics. Append-only time series, never overwritten. |
| `content_audience_links` | (piece_or_publication, contact) | Who it was aimed at; who demonstrably engaged. The join that closes the loop back to the network. |

`content_ideas` and downstream tables carry `tenant_id` with an RLS policy
matching the pattern in `040-analytics-events.sql`. Evidence is referenced
as `causal_nodes(id)` rather than copied.

### Idea generation draws on four signals, all already supplied

1. **Network gap** — aggregate `content_profiles.topics` across gold- and
   silver-tier contacts, subtract themes the operator has already published
   on. Produces: *"Your gold tier talks about X; you have never written
   about X."* This is the signal no generic content tool can produce,
   because it needs the scored graph.
2. **Timeliness** — `source_records` arriving through existing connectors,
   filtered to subscribed themes, weighted by
   `sources/recency-modifier.ts`. Produces a dated hook for an evergreen
   theme.
3. **Evidence** — clusters of captured snippets on a theme. Research the
   operator already did is the cheapest article to write, and the citations
   exist.
4. **Repetition** — the same question or objection recurring across
   `messages` / `outreach_events`. A question answered five times in DMs is
   an article.

Each signal is a separate scorer under `app/src/lib/editorial/signals/`,
returning a normalized contribution. Composition mirrors
`scoring/composite.ts` so weights are tunable the same way.

### The loop closes through scoring, via impulses — not by direct writes

Engagement observed on a publication maps to contacts, and those contacts
should get warmer. The editorial context **must not write to
`contact_scores`**; it emits `content_engagement_observed` and lets the
scoring pipeline own that table, exactly as `scoring-adapter.ts` does
today.

New impulse types: `content_idea_generated`, `content_published`,
`content_engagement_observed`.

> **Seeding is mandatory, not optional.** `048-seed-impulse-handlers.sql`
> documents the failure this repo already shipped once: `dispatchImpulse()`
> routes only to rows in `impulse_handlers`, nothing ever inserted rows,
> and enabling `ECC_IMPULSES=true` dispatched every impulse to nobody —
> silently, with no error, while `task-triggers.ts` early-returned on the
> same flag and disabled the legacy path too. Any migration adding an
> impulse type here ships its `impulse_handlers` seed rows in the same
> file, scoped to the `default` tenant, idempotent via `NOT EXISTS`. A
> harness assertion should fail the build if an emitted impulse type has
> no enabled handler.

### Goal engine integration

Add `app/src/lib/goals/checks/editorial-checks.ts` to the pool. This
requires extending the `TickContext['page']` union in
`app/src/lib/goals/types.ts` with `'editorial'`. Dedup by `context_hash`
and the 3-rejection suppression in `goal_check_feedback` then apply with
no new machinery: reject "write about X" three times and the engine stops
proposing it.

### LinkedIn interaction stays on the extension path. Without exception.

Every read from and write to LinkedIn goes through the existing Chrome
extension: operator-driven capture, the `snippetQueue` /
`captureQueue` offline replay in `browser/src/shared/snippet-queue.ts`,
`withExtensionAuth`, and the curated `host_permissions` model of ADR-028.

Concretely, for this context:

- Post performance is **captured**, the same way a profile is captured —
  the operator visits their own post, the content script reads the page,
  the payload posts to a new `/api/extension/performance` endpoint and
  queues on failure like every other capture.
- Drafts are produced by the engine and land in `tasks` with a
  `task_type` of `content_draft` / `content_publish`, surfaced in the
  extension task list that `api/extension/tasks/route.ts` already serves.
  Publishing is an act the operator performs.
- **No headless LinkedIn session. No stored LinkedIn credentials. No
  posting API. No synthetic engagement.** The engine decides *what to
  write and to whom it matters*; the human publishes.

This is a boundary, not a default to be relaxed later. The always-on host
(ADR forthcoming, see `docs/plans/ruos-deployment.md`) runs the stack and
the reasoning; it does not run a browser that acts as the operator.

## Consequences

**Good:**

- The generic half of this product (a content calendar) becomes the part
  nobody would pay for, and the defensible half — *topic selection driven
  by a scored, enriched network graph* — is where the new code goes.
- Publishing feeds network growth instead of running beside it: engagement
  discovers contacts, warms scores, and creates goals.
- No outreach invariants are disturbed. `template_performance` keeps
  meaning what it means.

**Costs and risks:**

- Six new tables and the RLS policies for them. Migration numbering:
  **next free is 052**. Note the existing gaps at 021–023 and 049–050 —
  049/050 are unaccounted for in `data/db/init/` and may exist on an
  unmerged branch. This repo has already had one numbering collision
  (commit `6f90598`, 045→046). Claim 052+ only after checking every
  branch, not just `main`.
- The network-gap signal is only as good as `content_profiles` coverage,
  which is populated by capture. On a sparse database signal 1 degrades to
  noise. It must report its own coverage and abstain below a threshold
  rather than inventing themes.
- LLM drafting costs land on `ANTHROPIC_API_KEY` and need the same budget
  discipline as enrichment (`012-budget-schema.sql`, `budget_periods`).
  Reuse it; do not add a second budget system.
- `content_performance` is an append-only time series and will be the
  fastest-growing table here. It needs a retention decision at design
  time. ADR-031 specified a daily roll-up that went unbuilt long enough
  for the index to record `parse_field_outcomes_daily` as permanently
  empty; it has since been built
  (`app/src/app/api/sources/cron/parser-rollup/route.ts`,
  `app/src/lib/parser/rollup.ts`) and the index entry for ADR-031 is now
  stale. The lesson survives the correction: a roll-up specified in one
  phase and built in another leaves the table empty in between. Build it
  in the same phase as the table, or do not specify one.

## Alternatives considered

**Extend `outreach_*` to carry broadcast content.** Rejected: breaks the
per-contact grain of `outreach_states` and the semantics of
`template_performance`, for no saving — the state machines do not overlap.

**Store authored content in `content_profiles` with a null `contact_id`.**
Rejected: `UNIQUE(contact_id)` forbids it, and every consumer of that table
assumes inbound semantics.

**Use a third-party content tool and sync.** Rejected: the entire value
here is in the join between topic selection and the scored graph. Exporting
topics to a tool that cannot see the graph discards the only part that is
hard to build.

**Snippets-only, no new tables** (treat drafts as `causal_nodes` of a new
kind). Rejected: a draft has a lifecycle, a schedule and measured outcomes.
ADR-029 scopes snippet chains per target and kind; publications are not
target-scoped.

## Related

- [ADR-028](./ADR-028-chrome-permission-model.md) — the permission model
  every LinkedIn read in this context inherits.
- [ADR-029](./ADR-029-exochain-snippet-chain-scope.md) — evidence
  referenced by `content_ideas`.
- [ADR-030](./ADR-030-source-trust-composite-weight.md) — trust weighting
  applied to the timeliness signal.
- [ADR-034](./ADR-034-per-component-harness-strategy.md) — the harness this
  context must ship tests under, including the no-op-metric rule.
- ADR-037 — packaging this engine for other operators.
- `docs/plans/goal-engine.md` — the tick model extended here.
- `docs/plans/publicist-engine.md` — phased delivery.
