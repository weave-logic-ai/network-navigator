# ECC Runtime Verification

**Date**: 2026-04-17
**Purpose**: One-page runbook to prove ECC is actually writing provenance to the DB end-to-end, not just passing tests with mocked clients.

---

## Prerequisites (already done)

- All 7 migrations (`data/db/init/024-030*.sql`) present and applied on DB first-run
- Adapters wired with feature flags (`ECC_*`) — currently default to `false`
- `docker-compose.yml` now passes `ECC_*` env through to the app container
- `@noble/hashes@^2.2.0` installed, BLAKE3 active in `exo-chain/hash.ts`
- Test suite: 38 suites / 273 tests / 0 failures (`cd app && npm test`)

## Step 1 — Enable ECC in your local env

Edit `.env` (root) and add:

```
ECC_CAUSAL_GRAPH=true
ECC_EXO_CHAIN=true
ECC_IMPULSES=true
ECC_COGNITIVE_TICK=true
ECC_CROSS_REFS=true
```

These are gitignored via `.env` already.

## Step 2 — Bring the stack up

```bash
cd /home/aepod/dev/network-navigator
docker compose up -d db
# wait for db healthcheck to pass (~30s)
docker compose up -d --force-recreate app
# --force-recreate ensures the app picks up new env vars
docker compose ps
```

App should be reachable at http://localhost:3750/api/health returning 200.

## Step 3 — Confirm migrations applied

```bash
docker exec ctox-db psql -U ctox -d ctox -c "\dt causal_nodes causal_edges exo_chain_entries impulses impulse_acks research_sessions session_messages cross_refs"
```

All 8 tables should list. If any are missing, inspect `data/db/init/` files 024–030 — the db container only runs init scripts on a fresh volume. If you have a pre-existing volume from before these migrations landed, you'll need `docker compose down -v && docker compose up -d` (destroys all data).

## Step 4 — Trigger a scoring cycle

Pick any existing contact:

```bash
CONTACT_ID=$(docker exec ctox-db psql -U ctox -d ctox -At -c "SELECT id FROM contacts WHERE NOT is_archived LIMIT 1")
echo "Using contact: $CONTACT_ID"

curl -s -X POST "http://localhost:3750/api/scoring/run" \
  -H 'Content-Type: application/json' \
  -d "{\"contactId\":\"$CONTACT_ID\"}" | jq
```

With `ECC_CAUSAL_GRAPH=true`, the scoring-adapter should write nodes+edges for each signal + score computation. With `ECC_IMPULSES=true` a tier/persona change will emit an impulse.

## Step 5 — Trigger an enrichment cycle

```bash
curl -s -X POST "http://localhost:3750/api/enrichment/enrich" \
  -H 'Content-Type: application/json' \
  -d "{\"contactId\":\"$CONTACT_ID\"}" | jq
```

With `ECC_EXO_CHAIN=true`, each provider step becomes an exo-chain entry with BLAKE3 hash linkage. With `ECC_CROSS_REFS=true`, any relationships extracted during enrichment become cross_refs rows.

## Step 6 — Verify DB writes

```bash
docker exec ctox-db psql -U ctox -d ctox <<'SQL'
SELECT 'causal_nodes' AS table, COUNT(*) FROM causal_nodes
UNION ALL SELECT 'causal_edges', COUNT(*) FROM causal_edges
UNION ALL SELECT 'exo_chain_entries', COUNT(*) FROM exo_chain_entries
UNION ALL SELECT 'impulses', COUNT(*) FROM impulses
UNION ALL SELECT 'impulse_acks', COUNT(*) FROM impulse_acks
UNION ALL SELECT 'cross_refs', COUNT(*) FROM cross_refs
UNION ALL SELECT 'research_sessions', COUNT(*) FROM research_sessions
UNION ALL SELECT 'session_messages', COUNT(*) FROM session_messages
ORDER BY table;
SQL
```

Expected after one scoring + one enrichment cycle:
- `causal_nodes`: N dimensions + 1 composite = ~10 rows
- `causal_edges`: ~10–15 rows
- `exo_chain_entries`: 1 per provider called (PDL + Apollo + Lusha + TheirStack if all keys present = 4; at least 1 with none)
- `impulses`: 0–2 (only on tier or persona change)
- `impulse_acks`: 1 per impulse dispatched
- `cross_refs`: 0–N depending on enrichment payload
- `research_sessions`/`session_messages`: 0 unless you also hit `/api/claude/session` + `/api/claude/analyze`

## Step 7 — Verify BLAKE3 chain integrity

```bash
curl -s "http://localhost:3750/api/enrichment/chain/<CHAIN_ID>?verify=true" | jq '.data.verification'
```

Where `<CHAIN_ID>` is from the `chain_id` column of `exo_chain_entries`. The `verify=true` query param is required — without it the route only returns the raw entries, not the verification result. The handler (`app/src/app/api/enrichment/chain/[chainId]/route.ts`) calls `verifyChain()` in `app/src/lib/ecc/exo-chain/service.ts`, which runs `verifyChainHashes` and returns `{ valid, brokenAt?, totalEntries }` — check `.data.verification.valid === true`. If `valid` is `false`, `brokenAt` gives the sequence number of the first tampered entry.

Despite the URL living under `/api/enrichment/`, this route is chain-agnostic — `getChain`/`verifyChain` key purely off `chain_id` with no assumption it came from the enrichment waterfall. It is the correct endpoint for the snippet and source chains in Steps 9–10 below too.

## Step 8 — Test provenance retrieval

```bash
curl -s "http://localhost:3750/api/scoring/trace/$CONTACT_ID" | jq
curl -s "http://localhost:3750/api/contacts/$CONTACT_ID/relationships" | jq
```

Both should return structured provenance. If they return empty arrays with flags on, the adapter path didn't execute — check app logs.

## Step 9 — Verify the snippet chain

Added for the research-tools sprint (`.planning/research-tools-sprint/06-evidence-and-provenance.md` §5). Every snippet saved to a target appends to an ExoChain keyed by that target, so the chain proves no snippet was silently inserted or altered after capture.

**Chain ID convention as actually shipped** — this differs from the sprint doc's shorthand `snippet:<target_id>`. Per ADR-029 (`docs/adr/ADR-029-exochain-snippet-chain-scope.md`) the chain is kind-qualified:

```
chain_id = 'snippet:' + targetKind + ':' + targetId   // e.g. snippet:contact:a8f2-…
```

Implemented in `app/src/lib/snippets/chain.ts` (`snippetChainId()` / `parseSnippetChainId()`), with the actual `appendChainEntry` calls in `app/src/lib/snippets/service.ts` and `app/src/lib/snippets/service-link.ts`. Re-attributing a snippet to a different target does not migrate chain entries — it's a separate `snippet_edited` event appended to the *original* target's chain.

```bash
# Find a target that has snippets, then build its chain_id:
TARGET_ROW=$(docker exec ctox-db psql -U ctox -d ctox -At -F'|' \
  -c "SELECT chain_id FROM exo_chain_entries WHERE chain_id LIKE 'snippet:%' LIMIT 1")
echo "Using chain: $TARGET_ROW"

curl -s "http://localhost:3750/api/enrichment/chain/${TARGET_ROW}?verify=true" | jq '.data.verification'
```

Expect `{ valid: true, totalEntries: N }`. Entries use operation `snippet_captured` (and `snippet_edited`/`snippet_deleted` where applicable per §3.1 of the evidence-and-provenance doc).

## Step 10 — Verify the source chain (gap — not yet implemented)

The evidence-and-provenance doc (§5.1) also specifies a **source chain per tenant**, `chain_id = 'source:<tenant_id>'`, appended to on every source-record connector fetch (EDGAR, Wayback, RSS/news, etc.).

**This does not exist in code yet.** A repo-wide search for `appendChainEntry` turns up exactly two callers — `app/src/lib/snippets/service.ts` and `app/src/lib/snippets/service-link.ts` (the snippet chain from Step 9) plus the enrichment waterfall's own internal calls in `app/src/lib/ecc/exo-chain/enrichment-adapter.ts`. None of the connectors under `app/src/lib/sources/connectors/` (`edgar.ts`, `wayback.ts`, `rss.ts`, the per-outlet news connectors, etc.) write to `exo_chain_entries` or reference a `source:` chain_id anywhere. There is nothing to verify here today — `exo_chain_entries` will never contain a `chain_id LIKE 'source:%'` row until this is built. Track it as an open item against the evidence-and-provenance spec rather than something this runbook can currently exercise.

## Note — `/api/ecc/exo-chain/verify/:chainId` does not exist

The evidence-and-provenance doc (§5.3) describes a dedicated lightweight verify endpoint, `GET /api/ecc/exo-chain/verify/:chainId`. As of this writing there is no `app/src/app/api/ecc/` directory at all — the endpoint was never built. Do not script against it. The working verification path for **any** chain_id (enrichment, snippet, or a future source chain) is the existing `GET /api/enrichment/chain/:chainId?verify=true` route used in Step 7 and Step 9 above.

## Migration of pre-existing ExoChain rows

ExoChain originally used SHA-256; it now uses BLAKE3. Any rows written to `exo_chain_entries` before the hash swap will fail `verifyChainHashes`. If your DB volume pre-dates 2026-04-17, either:
- Truncate `exo_chain_entries` (evidence is auxiliary — safe to drop): `TRUNCATE exo_chain_entries;`
- Or keep old rows marked as legacy; add a `hash_algo` column in a future migration.

## P0 issue previously flagged here — now fixed (verify before trusting this section further)

This section used to say `app/src/lib/ecc/causal-graph/scoring-adapter.ts:7` hardcoded `DEFAULT_TENANT_ID = 'default'`, breaking multi-tenant isolation. That's stale — as of the WS-4 Phase 1 Track B polish, that literal is gone. `scoring-adapter.ts:7` today is an import line; the file now resolves the tenant through a shared `resolveTenantId()` helper (caller override → the target row's `tenant_id` → `getDefaultTenantId()` fallback for single-tenant mode). The same fix was applied in parallel to the sibling adapters: `app/src/lib/ecc/impulses/scoring-adapter.ts`, `app/src/lib/ecc/cognitive-tick/claude-adapter.ts`, and `app/src/lib/ecc/exo-chain/enrichment-adapter.ts` (which additionally falls back to the literal `'default'` only if `getDefaultTenantId()` itself throws, so a DB outage doesn't hard-fail enrichment's audit trail).

The underlying pattern isn't fully eradicated, though — two API routes still hardcode the same `const DEFAULT_TENANT_ID = 'default';` literal and were not part of the original P0: `app/src/app/api/claude/session/route.ts:8` and `app/src/app/api/scoring/trace/[contactId]/route.ts:5`. Neither takes a `targetId` today, so there's no target row to resolve a real tenant from — worth a follow-up if/when multi-tenant mode lands, but out of scope for this runbook to fix.

## Rollback

```bash
# In .env, flip all ECC_* to false (or delete the lines)
docker compose up -d --force-recreate app
```

Adapters become no-ops; existing rows are harmless (nothing reads them when flags are off).
