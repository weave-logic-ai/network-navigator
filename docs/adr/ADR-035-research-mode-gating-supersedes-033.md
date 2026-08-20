# ADR-035: Research-mode gating is per-deployment, not per-user (supersedes ADR-033)

**Status**: Accepted (date: 2026-08-19) — supersedes [ADR-033](./ADR-033-research-mode-rollout.md)

## Context

ADR-033 recorded a decision to gate the research-tools UI behind a
**per-user** flag (`owner_profiles.research_mode_enabled`), explicitly
rejecting the `RESEARCH_*` environment-variable pattern. Its stated
selling point was that *different users in one tenant can opt in
independently*.

That is not what shipped. A 2026-08-19 audit found the decision had been
**inverted, not merely left unimplemented**:

- Every research surface gates on `RESEARCH_FLAGS`, read from
  `RESEARCH_*` env vars (`app/src/lib/config/research-flags.ts:36-50`) —
  the exact mechanism ADR-033 rejected.
- `owner_profiles.research_mode_enabled` exists (migration 035) and has
  **zero functional reads**. A user toggling their personal setting has
  no effect on any UI or API behaviour.

The audit also established *why* this happened, which is the load-bearing
fact for this ADR:

**There is no authentication in this application today.** No
`getServerSession`, `currentUser`, `auth()` or `getUser()` exists
anywhere under `app/src/lib` or `app/src/app/api`. Routes identify the
owner as `owner_profiles WHERE is_current = TRUE LIMIT 1` — a singleton —
and `tenants.owner_user_id` defaults to the literal string `'local'`.

The product is **single-user, multi-tenant**: the tenant model is real
and carries data isolation (see `020-tenant-schema.sql` and the RLS
policies in `030-ecc-rls.sql`), but there is exactly one human operator.
ADR-033's premise — several users inside one tenant choosing differently —
describes a product that does not exist yet.

## Decision

**Adopt Q10 Option B: per-deployment `RESEARCH_*` environment flags are
the accepted gating mechanism.** This ratifies what the code already
does, rather than changing the code to match a plan written for a
different product shape.

`09-open-questions.md` originally recommended Option B. The operator
overrode it in favour of Option A. That override was correct *for a
multi-user product* — it is being reversed here on the narrow grounds
that the multi-user precondition is absent, not because the reasoning was
wrong.

### Option A is deferred, not rejected

This is the important distinction, and it should survive future readings
of this file. A per-user research-mode toggle becomes the right design
**the moment authentication exists**. Authentication is planned. When it
lands, revisit this ADR rather than treating per-deployment flags as
permanent.

What Option A would require, and why it was not a small change:

- `RESEARCH_FLAGS` has **40 consumers** across `app/src`, and most are API
  routes rather than UI components. A per-user gate on a route needs
  per-request user identity.
- That means an auth system, a `user_id` on `owner_profiles`, and session
  plumbing through every one of those call sites.
- ADR-033's own proposed `useResearchMode()` hook only addresses the UI
  half of that surface.

It is a multi-week project contingent on authentication — not a wiring
task.

## Consequences

- ADR-033 is marked **Superseded**. Its drift warning stays in place: the
  historical record of what was decided, and what actually shipped,
  is more useful than a clean file.
- `owner_profiles.research_mode_enabled` is now formally **dormant**, not
  broken. It is the natural home for the per-user flag when auth arrives.
  It should not be deleted, and code should not start reading it until
  there is a real user identity to read it *for*.
- Research-tools features remain **off by default in every environment**.
  All `RESEARCH_*` flags default `false`, and only four of them
  (`TARGETS`, `SNIPPETS`, `PARSER_TELEMETRY`, `SOURCES`) are forwarded in
  `docker-compose.yml` — the news, per-site and podcast connector flags
  are not, so that code is unreachable via the documented local-dev path.
  That gap is tracked separately and is not resolved by this ADR.
- The suggestion-engine nudge from ADR-033's title ("Suggest engine may
  push user to toggle on") has no per-user toggle to push toward. It is
  deferred alongside Option A.

## Alternatives considered

### Implement the per-user gate now (ADR-033 as written)

Rejected on preconditions, not merit. Without authentication there is no
user to distinguish, so the control would gate nothing — a settings
toggle that changes behaviour for every operator of a deployment is a
per-deployment flag wearing a per-user costume. Building it now would
also mean building auth first, expanding a documentation-reconciliation
task into a multi-week project.

### Leave ADR-033 as Accepted with only a drift warning

Rejected. The drift warning makes the file honest but leaves the project
with no accepted decision describing how gating actually works. A reader
looking for the current design would find a warning and no answer. An
ADR set should record what is true, not only flag what is false.

### Ship research tools on by default (Q10 Option C)

Rejected, unchanged from ADR-033's reasoning. The research-tools UI is a
visible departure from the existing owner-only workflow, and the ability
to run a deployment without it remains worth keeping.

## Related

- [ADR-033](./ADR-033-research-mode-rollout.md) — superseded by this ADR
- [ADR-027](./ADR-027-research-target-model.md), [ADR-028](./ADR-028-chrome-permission-model.md),
  [ADR-029](./ADR-029-exochain-snippet-chain-scope.md), [ADR-030](./ADR-030-source-trust-composite-weight.md),
  [ADR-031](./ADR-031-parser-telemetry-retention.md), [ADR-032](./ADR-032-conflict-resolution-banner.md) —
  the research-tools sprint surfaces this gating controls
- `app/src/lib/config/research-flags.ts` — the actual gate
- `data/db/init/035-targets-schema.sql` — where the dormant per-user
  column lives
- `data/db/init/020-tenant-schema.sql`, `030-ecc-rls.sql` — the tenant
  model that *is* real, distinct from the user model that is not yet
