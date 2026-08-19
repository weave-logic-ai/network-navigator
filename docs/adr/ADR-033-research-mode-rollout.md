# ADR-033: Research-mode rollout — per-user flag plus suggestion-engine nudge

**Status**: Accepted (date: 2026-04-17) — **Accepted-but-not-implemented;
code does the literal thing this ADR rejects — Updated: 2026-08-19**

> ## ⚠️ DRIFT WARNING — read this before trusting anything below
> **(added 2026-08-19, verified against code)**
>
> This ADR's decision has never been implemented, and the code running in
> production today does the exact thing this ADR explicitly rejected. Do
> not read the Decision section below and assume research-mode gating
> works as designed — it does not.
>
> - Decision point 3 states: "No tenant-level force... Explicitly rejects
>   the `RESEARCH_*` env-flag pattern." Alternatives lists that pattern as
>   the rejected Q10 Option B.
> - Every research surface in the app gates on `RESEARCH_*` environment
>   variables read through `app/src/lib/config/research-flags.ts`
>   (`RESEARCH_TARGETS`, `RESEARCH_SNIPPETS`, `RESEARCH_PARSER_TELEMETRY`,
>   `RESEARCH_SOURCES`, `RESEARCH_CONNECTOR_NEWS`,
>   `RESEARCH_CONNECTOR_PODCAST`, etc.) — exactly the rejected pattern, and
>   process-wide rather than even per-tenant, so it is not even a faithful
>   build of the rejected option, just its shape.
> - `owner_profiles.research_mode_enabled` (added by migration
>   `035-targets-schema.sql:37`, per Decision point 1) exists as a column
>   but has **zero functional reads** anywhere in `app/src` — verified by
>   grep across the whole app source tree. The only other reference to it
>   is a comment in `research-flags.ts:9-10` stating that per-user gating
>   "lives on `owner_profiles.research_mode_enabled` — not in this
>   module": a comment describing a design that was never wired up.
> - Net effect: a user toggling their personal Research Mode setting today
>   has **no effect on any UI or API behavior whatsoever**. The real gate
>   is a deployment-time env var shared by every user of a given
>   deployment — the opposite of "different users in one tenant can opt in
>   independently," which is this ADR's stated selling point.
> - **This is a product decision, not an engineering fix, and is not made
>   by this annotation.** Two honest paths forward: (a) implement the
>   per-user gate this ADR actually specifies — wire `useResearchMode()`
>   (Decision/Negative already anticipates this hook) to read
>   `research_mode_enabled` at the UI-gating call sites this ADR names
>   (target switching, source panels, conflict banners, snippet panels),
>   and retire the `RESEARCH_*` envs; or (b) write a new ADR that formally
>   supersedes this one, documenting that per-deployment env flags are the
>   real, accepted design and that Q10 Option B was in fact adopted.
>   Neither the agent that found this drift nor the one annotating it
>   should make that call.

## Context

The research-tools sprint adds visible UI departures from the existing
owner-only workflow:

- Target switching + breadcrumbs (ADR-027, WS-4)
- Secondary target auto-centering (ADR-027)
- Source panels and conflict banners (ADR-030, ADR-032)
- Snippet widget surfaces beyond LinkedIn (ADR-028, WS-3)
- Evidence/provenance drilldowns (WS-6)

Existing users may not want these unless they opt in. `09-open-questions.md`
Q10 (lines 212-226) considered three rollout shapes:

- **A**: Per-user feature flag — each user toggles "Research mode" in
  settings.
- **B**: Per-tenant env flag (matching the `ECC_*` pattern from v0.5.0)
  — tenant admin enables for all users.
- **C**: Ship as default — everyone gets the new UI; existing users opt out.

`09-open-questions.md` recommended B (per-tenant env flag). The operator
overrode that:

> "A + Suggest engine may push user to toggle on depending on focus"
> (`10-decisions.md` Q10, line 180)

## Decision

**⚠️ Not implemented — see the drift warning at the top of this file.**

Research mode is a **per-user** feature flag, augmented by a
suggestion-engine nudge:

1. **Per-user storage**: new column `researchModeEnabled: boolean` (default
   `false`) on the owner-profile user settings, added in the Phase 0
   migration. (`10-decisions.md` §Updates-to-phased-delivery, lines 207-208)
2. **UI gating**: target switching, secondary target auto-centering,
   comparison lens, source panels, and main-app conflict banners render only
   when `researchModeEnabled = true` for the current user.
   (`10-decisions.md` Q10, lines 187-189)
3. ~~**No tenant-level force**: tenant admins cannot force-enable or
   force-disable. It is strictly a user choice. Explicitly rejects the
   `RESEARCH_*` env-flag pattern.~~ **INVERTED IN PRACTICE (2026-08-19)**:
   the shipped code gates every research surface on `RESEARCH_*` env
   vars — precisely the rejected pattern. See the drift warning at the top
   of this file.
   (`10-decisions.md` Q10, lines 191-192)
4. **Suggestion-engine nudge**: the existing engine in
   `app/src/components/suggestion-engine-provider.tsx` gains a detector rule.
   If the user has captured more than N non-self LinkedIn profiles OR
   created M snippets within a recent window, surface a toast:

   > "Looks like you're doing research — want to enable Research Mode?"

   with a single-click toggle. (`10-decisions.md` Q10, lines 187-190)
5. **Phasing**: the per-user flag column ships in Phase 0. The
   suggestion-engine rule ships in Phase 5.
   (`10-decisions.md` §Updates-to-phased-delivery, line 208)

## Consequences

### Positive

- ~~**Finer-grained control**. Different users in one tenant can opt in
  independently. A sales rep who only updates their own profile sees no
  research UI; a BD lead researching accounts gets the full surface.~~
  **Not realized (2026-08-19)**: the flag actually gating research
  surfaces is deployment-wide (`RESEARCH_*` env vars), not per-user. See
  the drift warning at the top of this file.
  (`10-decisions.md` Q10, lines 193-196)
- **Discoverability without force-on defaults**. The suggestion engine's
  nudge replaces what a per-tenant default-on would have provided — it
  surfaces the feature when the user's behavior already looks like research.
- ~~**No `RESEARCH_*` env flag churn**. Ops doesn't manage per-tenant env
  vars; settings live in the database, editable via normal user-settings
  flows.~~ **Inverted in practice (2026-08-19)**: `RESEARCH_*` env vars are
  exactly what gates every research surface today. See the drift warning
  at the top of this file.
- **Backward compatibility preserved**. Default-off means existing users
  log in to unchanged behavior. Day-one ship is safe for all tenants.
- ~~**Clean flag surface**. One column, one toggle, one UI gate pattern.
  Everything research-related checks the same boolean.~~ **Not
  implemented (2026-08-19)**: nothing in `app/src` reads that boolean. See
  the drift warning at the top of this file.

### Negative

- **Tenant admins lose visibility into who has research mode on**. If a
  tenant wants a roll-up, they need a query; there is no dashboard in v1.
  Acceptable — individual-user autonomy is the design goal.
- **Suggestion-engine rule is a behavior-detection surface**. The thresholds
  (N profiles, M snippets, recent window) are tunable and may need
  calibration after usage data arrives. Phase 5 delivery leaves time for
  calibration telemetry.
- **Feature-gate sprawl risk**. Every new research-mode component must
  remember to check the flag. Mitigation: a `useResearchMode()` hook that
  components consume; misuse is easy to lint for.
- **Mobile / shared-device case**: if two users share a browser session, the
  flag lives on the logged-in user's settings, not the device. That is the
  correct behavior but worth noting.

### Neutral

- Suggestion-engine toast copy and thresholds are implementation detail;
  this ADR commits to the pattern, not the exact numbers.
- The flag is user-scoped, so it travels across devices via the existing
  user-settings sync. No separate per-device storage is needed.
- Phase 0 only needs the column and the default. Actual UI gating can
  land per-component as WS-3 / WS-4 / WS-5 / WS-6 ship.

## Alternatives considered

### Q10 Option B — per-tenant env flag (`RESEARCH_*`)

Originally recommended in `09-open-questions.md` (lines 222-226) by analogy
to the `ECC_*` flag pattern from v0.5.0. Rejected explicitly by the operator
— finer-grained control wins over tenant-admin discretion. The
suggestion-engine nudge provides the discoverability a default-on would
have.

> "The user wants finer-grained control so different users in one tenant
> can opt in independently." (`10-decisions.md` Q10, lines 193-196)

### Q10 Option C — ship as default; users opt out

Rejected implicitly by the operator's answer "A" and directly by the need
for backward compatibility — existing users in production tenants should
not wake up to a UI they did not ask for.
(`09-open-questions.md` Q10 Option C, lines 221-222)

### Dual-flag: per-tenant gate AND per-user toggle

Tenant admin gates access; then users self-opt-in within gated tenants.
Rejected: re-introduces the env-flag ops surface the operator wanted to
drop, for marginal control. The suggestion-engine nudge plus per-user flag
is simpler and covers the desired behavior.

## Related

- Source: `.planning/research-tools-sprint/10-decisions.md`
  Q10 (lines 178-197)
- Source: `.planning/research-tools-sprint/09-open-questions.md`
  Q10 (lines 212-226)
- Suggestion engine: `app/src/components/suggestion-engine-provider.tsx`
  (receives the new detection rule in Phase 5)
- Settings storage: owner-profile user-settings row
  (`016-owner-profile-schema.sql` + research-mode column added by the
  Phase 0 migration)
- Cross-ref: ADR-027 (target switching / secondary auto-center — gated by
  this flag)
- Cross-ref: ADR-028 (snippet permissions — sidebar permission UX always
  on, but main-app snippet panels gated by this flag)
- Cross-ref: ADR-030 (source-trust composite — runs regardless, but
  surfaces in conflict UI gated by this flag)
- Cross-ref: ADR-032 (conflict banner — main-app rendering gated by this
  flag; sidebar banner always on)
- Cross-ref: ADR-031 (parser telemetry — NOT gated by this flag; parser
  audit is global infra)
