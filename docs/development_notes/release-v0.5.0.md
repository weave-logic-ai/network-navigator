# Release v0.5.0 — Development Notes

**Tag**: `v0.5.0` (exists locally; first tagged release on this repo)
**Branch at prep time**: `feat/ecc-hardening-b6-port`
**Target merge base**: `main` (`6a72d17`)
**Date drafted**: 2026-04-17
**Status checked**: 2026-09-25 — tag is an ancestor of cached `origin/main`; this note records the v0.5.0 scope, not the later research-tools sprint

---

## What shipped

Five commits, grouped by concern:

| Commit | Subject | Scope |
|---|---|---|
| `4eacd8f` | `chore: move app host port 3000→3750, pass ECC flags, ignore run artifacts` | infra / compose |
| `82f9fc9` | `feat(b6): add EMOT temperature and SCEN grade distributions to network health` | app UI / API |
| `1f1bbb6` | `feat(ecc): swap to BLAKE3, finish impulse stubs, add 128-test ECC suite` | ECC hardening |
| `2a7c72b` | `feat(extension): sidebar target panel with page- and task-aware locking` | extension UX |
| `e40b26a` | `feat(extension): browser-side auto-pagination click-through for search captures` | extension UX |

Totals: 43 files changed, ~4200 insertions, ~60 deletions (mostly test code + docs).

## Why each commit

**`4eacd8f` — port + env + smoke fix.** The port move exists so the Next.js dev server can keep `3000` for Playwright while Docker publishes the production stack on `3750`. Adding `ECC_*` to the compose env section is what actually makes the feature flags reachable from inside the container — without it, you could set them in `.env` and nothing would happen.

**`82f9fc9` — B6 finish.** The existing network-health card had three of the five ECC-gauge rollups (DCTE completeness, RSTE relationship distribution, coverage). EMOT and SCEN were missing. Added as single-query aggregations in the existing `Promise.all` to avoid extra round-trips.

**`1f1bbb6` — ECC hardening.** Four things in one commit because they're interdependent:
1. BLAKE3 swap so ExoChain hashes are no longer a placeholder.
2. Impulse stubs finished so the impulse system has real side-effects when flags are on.
3. 19 new test files so Phase 2 Task 2.5 is complete and flags can be flipped on without blind risk.
4. Runtime-verification runbook + stub inventory + deferred-plan doc so nothing is carried forward silently.

**`2a7c72b` — sidebar target panel.** Replaced the unused `sp-contact-info` placeholder with a real target-aware panel. Task-locks take priority over page-locks because a task is an explicit user intent; page-locks are automatic.

**`e40b26a` — auto-pagination.** Closes the loop on the already-landed server-side follow-up task creation in `app/src/app/api/extension/capture/route.ts:94`. The server creates the next-page task; the browser now click-throughs it if the user opts in.

## Gates run

| Gate | Result |
|---|---|
| `cd app && npx tsc --noEmit` | clean |
| `cd app && npm run lint` | clean in touched files |
| `cd app && npm run build` | succeeds |
| `cd app && npm test` | 38 suites / 273 tests / 0 failures |
| `cd browser && npm run typecheck` | clean (the pre-existing `service-worker.ts` casts were resolved during final prep in `c71bd97`) |
| `cd browser && npm run build` | succeeds — content.js, popup.js, sidepanel.js, service-worker.js |
| Live ECC DB-write verification | **deferred** — see `ecc/runtime-verification.md`; not runnable from the WSL shell (Docker integration off) |

## Version choices

- Public cadence starts at `v0.5.0`. `app/package.json` and `service-manifest.json` realigned from `2.0.0` → `0.5.0` as part of this prep. `service-manifest.json`'s app port also corrected from `3000` → `3750` to match the new docker-compose binding. Only the Next.js toolchain and the service manifest read these values; nothing at runtime keys off the literal strings. Extension-handshake version (`app/src/app/api/extension/health/route.ts`) and parser schema version (`app/src/lib/parser/parsers/profile-parser.ts`) are separate tracks and were intentionally left at `'2.0.0'`.
- `browser/package.json` stays at `0.1.0`. The extension hasn't been published to the Chrome Web Store and isn't a separately consumed artifact; its version bump can come with a distinct extension release when that happens.
- `docs/package.json` stays at `1.0.0`. Fumadocs site, separate deployment.


## Release record and later work

The local `v0.5.0` tag points to the ECC hardening/B6/extension-target-panel
release and is an ancestor of cached `origin/main` (merge PR #6). The tag and
merge history are verifiable locally; GitHub release publication and production
runtime state were not rechecked because the GitHub API was unavailable.
The gates above record the checks made during release preparation, not checks
rerun for this documentation update.

The snippet editor, parser feedback, research target model and graph work named
as future work in this historical release were subsequently developed under
the research-tools sprint. ADR-027 now fixes primary to the operator's self
and uses secondary for research focus; the earlier phrase "primary/secondary
target architecture" does not authorize swapping primary. Current delivery
status, remaining story outcomes and release gates are maintained in
`.planning/research-tools-sprint/08-phased-delivery.md`.
