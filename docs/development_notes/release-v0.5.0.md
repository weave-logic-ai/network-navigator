# Release v0.5.0 — Development Notes

**Tag**: `v0.5.0` (proposed — first tagged release on this repo; `app/package.json` and `service-manifest.json` both realigned from `2.0.0` → `0.5.0` to signal pre-1.0 cadence)
**Branch at prep time**: `feat/ecc-hardening-b6-port`
**Target merge base**: `main` (`6a72d17`)
**Date drafted**: 2026-04-17

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


## Release procedure (on final green-light)

```bash
cd /path/to/network-navigator

# 1. Verify branch is clean and green
git status
cd app && npm run build && npm test && cd ..
cd browser && npm run build && cd ..

# 2. Open a PR from feat/ecc-hardening-b6-port → main, review, merge
gh pr create \
  --base main \
  --head feat/ecc-hardening-b6-port \
  --title "Release v0.5.0 — ECC hardening, B6 gauges, extension target panel" \
  --body-file docs/development_notes/release-v0.5.0.md

# 3. Once merged, tag on main
git checkout main
git pull
git tag -a v0.5.0 -m "$(cat <<'TAGMSG'
Release v0.5.0 — ECC Phase 2 hardening + B6 gauges + extension target panel

See CHANGELOG.md and docs/development_notes/release-v0.5.0.md for details.

Highlights:
- ExoChain BLAKE3 swap, impulse stubs finished, 128 new ECC tests
- B6: EMOT + SCEN network-health gauges on owner profile
- Sidebar Target Panel (task- and page-aware locking)
- Opt-in auto-paginate for LinkedIn search captures
- App container port moved to 3750
TAGMSG
)"
git push origin v0.5.0

# 4. Create the GitHub Release from the tag
gh release create v0.5.0 \
  --title "v0.5.0 — ECC hardening, B6 gauges, extension target panel" \
  --notes-file docs/development_notes/release-v0.5.0.md \
  --target main
```

## Post-release follow-ups (not blocking this tag)

These were intentionally deferred from this release; they belong in a future sprint:

1. **Live ECC flag-on validation** — run the `runtime-verification.md` runbook against a dev Docker stack, confirm rows appear in `causal_nodes`, `exo_chain_entries`, `impulses`, `cross_refs`. Document findings.
2. **Snippet editor / capture diff / parsing feedback** — `docs/plans/browser-snippet-expansion.md` holds the detail.
3. **Parser audit + graph re-centering + primary/secondary target architecture** — future joint sprint.
4. **P0 from `stub-inventory.md`**: `DEFAULT_TENANT_ID='default'` in `causal-graph/scoring-adapter.ts:7` must be addressed before multi-tenant mode ships.
5. **Webhook impulse branch** in `dispatcher.ts:88` is a silent no-op; needs proper handler.
