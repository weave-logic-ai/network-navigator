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
cd /path/to/network-navigator
docker compose up -d db
# wait for db healthcheck to pass (~30s)
docker compose up -d --force-recreate app
# --force-recreate ensures the app picks up new env vars
docker compose ps
```

App should be reachable at http://localhost:3750/api/health returning 200.

## Step 3 — Confirm migrations applied

```bash
docker exec network-navigator-db psql -U navigator -d navigator -c "\dt causal_nodes causal_edges exo_chain_entries impulses impulse_acks research_sessions session_messages cross_refs"
```

All 8 tables should list. If any are missing, inspect `data/db/init/` files 024–030 — the db container only runs init scripts on a fresh volume. If you have a pre-existing volume from before these migrations landed, you'll need `docker compose down -v && docker compose up -d` (destroys all data).

## Step 4 — Trigger a scoring cycle

Pick any existing contact:

```bash
CONTACT_ID=$(docker exec network-navigator-db psql -U navigator -d navigator -At -c "SELECT id FROM contacts WHERE NOT is_archived LIMIT 1")
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
docker exec network-navigator-db psql -U navigator -d navigator <<'SQL'
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
curl -s "http://localhost:3750/api/enrichment/chain/<CHAIN_ID>" | jq '.verified'
```

Where `<CHAIN_ID>` is from the `chain_id` column of `exo_chain_entries` — this endpoint runs `verifyChainHashes` which must return `true`. If it returns `false`, a row was tampered with.

## Step 8 — Test provenance retrieval

```bash
curl -s "http://localhost:3750/api/scoring/trace/$CONTACT_ID" | jq
curl -s "http://localhost:3750/api/contacts/$CONTACT_ID/relationships" | jq
```

Both should return structured provenance. If they return empty arrays with flags on, the adapter path didn't execute — check app logs.

## Migration of pre-existing ExoChain rows

ExoChain originally used SHA-256; it now uses BLAKE3. Any rows written to `exo_chain_entries` before the hash swap will fail `verifyChainHashes`. If your DB volume pre-dates 2026-04-17, either:
- Truncate `exo_chain_entries` (evidence is auxiliary — safe to drop): `TRUNCATE exo_chain_entries;`
- Or keep old rows marked as legacy; add a `hash_algo` column in a future migration.

## Expected P0 issue to watch for

From the stub audit: `app/src/lib/ecc/causal-graph/scoring-adapter.ts:7` hardcodes `DEFAULT_TENANT_ID = 'default'`. When multi-tenant mode eventually lands, this will misattribute causal rows. Track as P0 in stub-inventory.md — benign today because the app runs single-tenant.

## Rollback

```bash
# In .env, flip all ECC_* to false (or delete the lines)
docker compose up -d --force-recreate app
```

Adapters become no-ops; existing rows are harmless (nothing reads them when flags are off).
