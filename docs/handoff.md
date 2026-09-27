# Handoff — network-navigator — 2026-09-27

This is the local-only research dashboard and Chrome extension. The integration branch contains reviewed context, import, graph, score, and responsive repairs, but the broader [UX repair plan](plans/feature-ux-review-2026-09-27.md) is unfinished. Do not treat the healthy local demo as the latest build or a release proof.

## Current state

- Integration code head before the handoff commit is `e9f9999` on `feat/harness-setup`. The branch was 12 commits ahead of `origin/feat/harness-setup` when this snapshot was written; verify the remote after resuming. No commit is on `master`. `agentdb.rvf` and `agentdb.rvf.lock` are root untracked coordination artifacts; confirm no agent uses them before removing them.
- `ctox-demo-app` and `ctox-demo-db` are healthy at `http://127.0.0.1:3751`; the demo DB has **918 contacts**. The running image is `network-navigator-app:latest` (`sha256:df0b4e26a09d9faca7d2f3c647bee23d28a8fa6f19dee65c70ebb4a8dcddd253`), built from the earlier `326c2a6` integration state. The demo has **not** been migrated to 058–064 or refreshed to the current branch.
- The local operator secret is stored only in ignored `data/drives/demo-secrets/local-operator-secret` (mode 0600). An isolated Chrome for Testing profile `data/drives/demo-browser-profile` was unlocked at `/dashboard`; do not print the secret or commit either path. No extension was installed into the user's main Chrome profile.
- Pre-refresh backup: ignored `data/drives/demo-backups/pre-ux-refresh-2026-09-27.dump` (3.5 MB). It was previously restored successfully to a disposable DB and checked for 918 contacts. Take a **new** backup before any further demo migration.
- This turn's final integrated gates: TypeScript and lint passed; Jest **161 suites / 1,393 tests passed**, 11 suites / 96 tests skipped; Next build and local Docker build passed. `bash app/e2e/run-shell-navigation.sh` passed: synthetic dialogs 3/3, enabled research shell 6/6 (one skipped), disabled shell 1/1 (six skipped). The runner uses disposable ports 3752/3754 and fake DB state; it is not a real-data demo test.

## Integrated work

| Commit | Outcome | Boundary |
|---|---|---|
| `326c2a6` | Owner-safe target context and lenses | This is the last image deployed to the demo. |
| `190aee6` | Import/profile mapping and owner-data integrity | A synthetic served-app import check passed; disposable PostgreSQL verified current owner/self-target publication. |
| `79122d2` | Graph groups, counts, compute publication and retry | Conflict resolution retained revision-aware `contextController` Back/Focus. No old direct `PUT /api/targets/state` remains in the graph page. |
| `aa34044` | Owner score-basis snapshots, job recovery, import-trigger consistency | Independent review found a double `BEGIN`; corrected to one transaction, with Profile.csv identity preflight before the advisory lock. Full Jest and a real disposable PostgreSQL profile test passed. |
| `e9f9999` | Responsive shell, graph controls, keyboard contact links | Integrated current graph/group behavior with responsive layout. Browser fixture and full gates passed. |

The already-merged `graph-groups`, `score-context`, `responsive`, and `import-profile` worktrees were removed as requested. One untracked U9 smoke spec was preserved byte-for-byte at ignored `data/drives/ux-handoff-artifacts/u9-import-profile.spec.ts` (SHA-256 `8c870fe7e57d676de1a99eaeeabc1ce53c5141abdf2aa5c4c64b37870fe98d07`). It was **not** integrated; review it before use.

## Ready isolated branches

| Worktree / branch | HEAD and state | Next action |
|---|---|---|
| `data/drives/ux-worktrees/outreach-state`, `codex/ux-w4-outreach-state` | `c0695fe`, clean; TypeScript/lint/Jest/Next/Docker passed; disposable PG integration was skipped | Independently review against current root and run its guarded PG tests before merging migration 061. No outreach was sent. |
| `data/drives/ux-worktrees/enrichment-setup`, `codex/ux-w4-enrichment-setup` | `0afc309`, clean; TypeScript/lint/Jest/Next/Docker and 14 disposable PG tests passed | Independently review against current root, merge migration 063, and recheck cost/receipt semantics. No paid provider was called. |
| `data/drives/ux-worktrees/snippet-queue`, `codex/ux-w5-snippet-queue` | Base commit `e7f0265`; nine-file diff dirty and uncommitted. Real Chromium smoke and final gates passed. | Independently review the final no-Origin auth and canonical-hash compatibility revision, address findings, then commit on its branch and merge. Migration 062. |

The `comparison`, `lens`, `discover`, and `context-history` worktrees remain dirty and unmerged, based on older branch heads. Do not merge them blindly: compare their changes against the current CAS context, score-basis, and graph contracts, then send for adversarial review. Remove every owned worktree after a safe merge; do not touch unrelated historical Claude worktrees outside `data/drives/ux-worktrees/`.

## Immediate next steps

1. **Finish extension B2/B3 review.** Unmodified MV3 GETs reach the app with no `Origin` and `Sec-Fetch-Site: none`. The dirty branch accepts this shape only for token-authenticated extension reads; other local requests retain origin checks. Real isolated Chromium smoke passed: text/image/link drafts stayed bound to target A after navigation to B, offline text survived panel-document reopen, and a lost-response image retry yielded one receipt. The final revision also added compatibility for older idempotency receipt hashes. It has **not** received a second independent review. Review the final diff, rerun affected gates and commit before merge. The smoke used the panel document in a tab, not Chrome's native side-panel container.
2. **Review/merge ready branches one at a time.** Reserve migration order 058, 059, 060, 061, 062, 063, 064; 064 depends on 058. Re-run integrated TypeScript, lint, full Jest, Next and Docker after each merge. Use disposable DBs for migrations and paid-provider-free workflows. Run `METAHARNESS_NO_NPX=1 bash scripts/metaharness-scan.sh app browser scripts docs`; its exit 0 alone does not mean all components passed—read every component report.
3. **Complete remaining UX plan contracts and runtime gates.** Priority: lens save/apply and comparisons, Discover chart-to-list membership, graph tabs/groups and real-data focus/back, extension pairing/capture, outreach/enrichment UX. Q2–Q4 require served app + real disposable PostgreSQL + Chrome/extension, flags on/off, 390/768/1280 and 200% zoom, and adversarial auth/input review. Optional F2/F4 stay behind explicit product decisions in the plan.
4. **Refresh demo only after integration gates.** Back up `ctox-demo-db`, rehearse pending migrations on a restored disposable copy, build/tag the final app image, then recreate **only** the demo app and smoke authenticated dashboard, network, import, lens/compare, snippets and browser extension. Preserve demo volumes; never use `docker compose down -v`. Current demo remains healthy and untouched by these new merges.
5. **Push and close out.** Verify whether `feat/harness-setup` is pushed, then push subsequent reviewed commits. Reconcile plan/docs and changelog with actual outcomes. Remove merged worktrees/branches and ignored coordination artifacts only after their owners finish, then verify a clean root `git status`.

## Dead ends and traps

- Playwright's normal Chrome/Edge channels no longer accept the extension side-load flags in this environment. Bundled Chromium 1208 was extracted to ignored `data/drives/playwright-browsers/chromium-1208` after the standard download extractor stalled; use its Chrome for Testing binary for isolated MV3 smoke. Do not install an unsigned extension into the main Chrome profile without the user's direction.
- Do not copy the old responsive branch's local `rootHistory` or direct state `PUT` over the integrated graph. `contextController` is the sole CAS-aware Focus/Back path. The old branch's E2E mocked an empty state body; it was updated to carry a revision.
- Run `npx tsc --noEmit` **after** Next build, not concurrently with it: Next regenerates `.next/types`, and a parallel typecheck produced TS6053 missing-file noise. In zsh, `status` is read-only; use `test_exit` or `build_exit` when capturing shell exit codes.
- Docker's build context is `app`: `docker build -f app/Dockerfile app`, not `docker build -f app/Dockerfile .` (the latter cannot find `package.json`).
- Keep the demo's disabled paid provider keys and local-only loopback binding. A green mock suite is not proof of PostgreSQL row-level semantics, actual Chrome extension requests, or unchanged demo data.

## Resume here

```bash
cd /Users/mathewbeane/dev/network-navigator
git status --short --branch
git log -5 --oneline
git worktree list
docker ps --format '{{.Names}} {{.Status}}'
cd app
npx tsc --noEmit
npm run lint
npm test -- --runInBand
npm run build
cd ..
METAHARNESS_NO_NPX=1 bash scripts/metaharness-scan.sh app browser scripts docs
```

The repo's [UX repair plan](plans/feature-ux-review-2026-09-27.md) is the task/acceptance DAG. `data/config/docker-compose.demo.yml` is the local-only deployment override. `data/db/init/058-owner-score-basis.sql`, `059-cluster-membership-count-index.sql`, `060-graph-compute-publication.sql`, and `064-import-score-job-restart.sql` are already in the integration branch; 061–063 are in the isolated branches above.
