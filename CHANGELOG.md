# Changelog

All notable changes to Network Navigator are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); no strict SemVer contract yet.

## [Unreleased] — Release candidate `v0.5.0`

Scope: first tagged release on this repo. Cadence starts at `0.5.0` to
signal pre-1.0 maturity. `app/package.json` and `service-manifest.json`
were previously at `2.0.0` locally; both realigned to `0.5.0` for this
tag.

Release theme: **ECC Phase 2 hardening + owner-profile polish + extension target panel.**

### Added — app

- **B6 network-health gauges**: EMOT interest-temperature histogram (hot / warm / cold / unknown) and SCEN assessment-confidence grade distribution (A–F across six identity fields). Rendered inline in the existing `NetworkHealthCard` on `/profile`. Source: `app/src/app/api/profile/network-health/route.ts`, `app/src/components/profile/network-health.tsx`.
- **Extension company lookup endpoint**: `GET /api/extension/company/[...url]` mirrors the existing contact lookup against the `companies` table. Returns `contactCount`, `tasksPending`, `lastCapturedAt`, plus basic firmographics.
- **Extension tasks payload**: `contactId` now exposed on each `ExtensionTask` so the browser can resolve task-locks without parsing `appUrl`.
- **ECC runtime env pass-through**: `docker-compose.yml` forwards `ECC_CAUSAL_GRAPH`, `ECC_EXO_CHAIN`, `ECC_IMPULSES`, `ECC_COGNITIVE_TICK`, `ECC_CROSS_REFS` into the app container. All default `false`; flipping them on in `.env` activates adapters at startup.

### Added — browser extension

- **Sidebar Target Panel**: replaces the placeholder `sp-contact-info` block with a lock-aware header showing who/what the sidebar is targeting and the lock source (Page / Task / Pinned / None).
  - Page auto-lock fires on LinkedIn profile or company URLs.
  - Task-lock takes priority when the active tab URL matches a task whose `contact_id` is set; surfaces the task title as the reason.
  - Clear (×) button only shown for task-locks; resets on tab activation / navigation so each page gets a fresh decision.
- **Auto-paginate search results**: new opt-in popup setting. After capturing a `SEARCH_PEOPLE` or `SEARCH_CONTENT` page, the service worker confirms the server created a follow-up task for `?page=N+1`, waits 2s, navigates the active tab to that page, and re-fires `CAPTURE_REQUEST` once the page finishes loading. Self-terminates at the server's `MAX_SEARCH_PAGES` cap (currently 10).

### Changed — Claude Agent skill (retroactive record)

- **The `agent/network-navigator/` Claude Code skill was rewritten from v1 to v2** at some point before this release, but the rewrite was never recorded here — this entry backfills it. v1 drove a local Playwright browser to search and scrape LinkedIn directly, cached HTML and scored contacts entirely in local JSON files (`contacts.json`, `graph.json`, `icp-config.json`, etc.), and shipped 17 scripts plus a local ONNX/ruvector embedder for semantic search. v2 is API-first: the skill is now exactly four thin REST-client scripts (`api-client.mjs`, `configure.mjs`, `pipeline.mjs`, `analyze.mjs`) that call the app's REST API at `localhost:3750`; there is no Playwright, no local data store, and no browser automation in the agent. LinkedIn capture now happens exclusively through the browser extension as the user browses. The retired v1 scripts are preserved for reference under `agent/network-navigator/.v1-archive/` but are not part of the shipped skill.
- **Scoring, storage, and semantic search all moved server-side.** The 9-dimension composite scorer and 6-dimension referral scorer now run in `app/src/lib/scoring/`, backed by PostgreSQL; semantic search runs through the ruvector PostgreSQL extension (`GET /api/contacts/hybrid-search`, 384-dim all-MiniLM-L6-v2 embeddings, HNSW cosine index) instead of a local `.rvf` file and a client-side ONNX embedder.
- **Some v1 capabilities have no v2 equivalent yet**: active 2nd-degree "deep scan" of a contact's connections (`deep-scan.mjs`/`batch-deep-scan.mjs`), the `behavioral`/`visibility`/`employers`/`similar` analyzer modes, and delta/snapshot tracking (`delta.mjs`). See `docs/content/docs/claude-agent/analysis-modes.mdx` and `docs/content/docs/claude-agent/network-expansion.mdx` for the full list.

### Changed

- **Host port for the app container moved from `3000:3000` to `3750:3000`** — frees port `3000` for the Next.js dev server and Playwright smoke tests.
- **ExoChain hashes switched from SHA-256 (Web Crypto placeholder) to BLAKE3** via `@noble/hashes@^2.2.0`. Public API of `computeEntryHash` and `verifyChainHashes` unchanged.
- **Impulse handlers finished** — previously stubs:
  - `campaign-enroller` now resolves a campaign by `config.campaign_id` or case-insensitive match against active `outreach_campaigns`, inserts a properly-shaped row into `outreach_states` (fixing two schema bugs in the prior stub), dedups on `(contact_id, campaign_id)`, and handles unique-violation races gracefully.
  - `notification` falls back to the `tasks` table (no notifications table exists yet), creates a `notification`-type task with `impulseId`-keyed dedup. Email and webhook channels return `{ sent: false, reason: 'not_implemented' }` but still surface a user-visible task.

### Added — test coverage

- **ECC test suite, 19 new files, 128 new tests.** Full suite now reports 38 suites / 273 tests / 0 failures:
  - `tests/taxonomy/{service,discovery,scoring-integration}.test.ts`
  - `tests/ecc/causal-graph/{service,scoring-adapter,counterfactual}.test.ts`
  - `tests/ecc/exo-chain/{hash,service,enrichment-adapter}.test.ts` (hash tests are algorithm-agnostic — verify properties, not bytes)
  - `tests/ecc/impulses/{emitter,dispatcher,task-generator}.test.ts`
  - `tests/ecc/cognitive-tick/{session-service,claude-adapter}.test.ts`
  - `tests/ecc/cross-refs/{service,enrichment-adapter}.test.ts`
  - `tests/ecc/integration/{score-with-provenance,enrich-with-chain,feature-flags}.test.ts`
- **Jest config**: `moduleNameMapper` rewrites `@noble/hashes/blake3` to a Node-crypto shim for test runs only. Production bundles unaffected. `@noble/hashes@2.2.0` is ESM-only and Jest (CJS) cannot `require` it.

### Added — documentation

- `docs/development_notes/ecc/runtime-verification.md` — one-page runbook to prove ECC is actually writing provenance end-to-end: flip flags, restart, run scoring + enrichment, verify rows in all 8 ECC tables, check BLAKE3 chain integrity, rollback steps, and the SHA-256 → BLAKE3 migration callout.
- `docs/development_notes/stub-inventory.md` — codebase-wide audit of stubs, TODOs, and silent empty catch blocks. 8 stubs + 2 TODOs + ~28 empty catches; priority-ordered with file:line.
- `docs/plans/browser-snippet-expansion.md` — deferred plan for the snippet editor, capture diff view, and parsing feedback. Grouped with graph re-centering and primary/secondary target refactor into a future joint sprint.

### Fixed

- **`app/e2e/smoke-all-pages.spec.ts` screenshot path**: was writing to `tests/e2e/screenshots/` (wrong, since Playwright `testDir` is `./e2e`); now writes to `e2e/screenshots/` where the rest of the e2e assets live.
- **`.gitignore`**: now ignores `app/test-results/`, `app/playwright-report/`, `app/e2e/screenshots/`, and the legacy `app/tests/` directory that the prior path bug populated.
- **Published docs site (`docs/content/docs/claude-agent/**`, `docs/linkedin-prospector-guide.md`, `docs/configuration-guide.md`) still documented the retired v1 agent architecture** — `npm install playwright`, a Playwright LinkedIn login flow, 17 archived scripts, a local `icp-config.json`, and a local ONNX/`.rvf` vector store, all with no deprecation notice. Rewritten to match the shipped v2 skill (four REST-client scripts, server-side scoring and search, `POST /api/icps`/`/api/niches`/`/api/offerings` configuration). Two real defects surfaced while verifying the rewrite against the app: `pipeline.mjs --export` calls `GET /api/admin/export`, which returns CSV, but `api-client.mjs` always calls `res.json()` on the response; and `analyze.mjs --mode hubs` reads flat `n.company`/`n.score`/`n.connections` fields off `GET /api/graph/data` nodes, but that endpoint nests those under `node.data.*` and wraps the payload in `{ data: { nodes, edges } }`. Also found and corrected two wrong values the agent-bundled copy of `configuration-guide.md` had carried for the composite scoring weights (`network_hub` documented as `0.15`, actually `0.10`; `graph_centrality` documented as `0.05`, actually `0.10`, per `app/src/lib/scoring/weight-manager.ts`).

### Deferred (explicitly not in this release)

See `docs/plans/browser-snippet-expansion.md`. Short version: snippet editor (multi-modal, taggable, entity-linked), capture diff view, parser rethink, graph re-centering, and primary/secondary target model refactor all live in a future joint sprint once this take is stable in production.

### Known non-issues

- **Pre-existing SHA-256 `exo_chain_entries` rows** will fail `verifyChainHashes` after the BLAKE3 swap. These are auxiliary audit rows — the runbook documents `TRUNCATE exo_chain_entries` as the expected clean-up for existing volumes.
- **Hardcoded `DEFAULT_TENANT_ID = 'default'`** in `app/src/lib/ecc/causal-graph/scoring-adapter.ts:7`. Benign today (single-tenant); flagged P0 in `stub-inventory.md` for when multi-tenant lands.
- **Webhook impulse branch** in `app/src/lib/ecc/impulses/dispatcher.ts:88` silently returns `{ skipped: true }`. Known gap.

### Verification gates run for this release

- `cd app && npx tsc --noEmit` — clean
- `cd app && npm run lint` — clean on changed files (pre-existing warnings elsewhere untouched)
- `cd app && npm run build` — succeeds
- `cd app && npm test` — 38 suites / 273 tests / 0 failures
- `cd browser && npm run build` — esbuild succeeds for all four bundles (content.js, popup.js, sidepanel.js, service-worker.js)
- Live ECC runtime verification: not run from the dev shell (Docker unavailable in WSL session). See `docs/development_notes/ecc/runtime-verification.md` for the end-to-end runbook.

---
