# Phase 1 — WS-3: CausalGraph + ExoChain

**Completed**: 2026-03-24
**Agent**: ws3-causal-exo

## Files Created

| File | Purpose |
|------|---------|
| `app/src/lib/ecc/types.ts` | Canonical shared ECC types — all modules import from here |
| `app/src/lib/ecc/index.ts` | Public re-exports |
| `app/src/lib/ecc/causal-graph/types.ts` | CounterfactualResult type |
| `app/src/lib/ecc/causal-graph/service.ts` | createNode, createEdge, batchCreate, getCausalGraph (recursive CTE), getLatestTraceForContact |
| `app/src/lib/ecc/causal-graph/counterfactual.ts` | Replays causal graph with modified weights, returns diff |
| `app/src/lib/ecc/causal-graph/scoring-adapter.ts` | Wraps scoreContact: creates root node, per-dimension nodes, weight nodes, edges |
| `app/src/lib/ecc/exo-chain/types.ts` | Re-exports ChainOperation, ExoChainEntry |
| `app/src/lib/ecc/exo-chain/hash.ts` | SHA-256 via Web Crypto (BLAKE3 when @noble/hashes installed) + verifyChainHashes |
| `app/src/lib/ecc/exo-chain/service.ts` | appendEntry (BYTEA hex), getChain, verifyChain |
| `app/src/lib/ecc/exo-chain/enrichment-adapter.ts` | Wraps enrichContact: budget_check, field_check, per-provider entries, waterfall_complete |
| `app/src/app/api/scoring/trace/[contactId]/route.ts` | GET trace, POST counterfactual |
| `app/src/app/api/enrichment/chain/[chainId]/route.ts` | GET chain entries with optional ?verify=true |

## Files Modified

| File | Change |
|------|--------|
| `app/src/app/api/scoring/run/route.ts` | Added causal adapter import; uses adapter when ECC_CAUSAL_GRAPH=true |
| `app/src/app/api/enrichment/enrich/route.ts` | Added ExoChain adapter; wraps enrichment call; adds _chainId to response |

## Decisions Made

- Used SHA-256 via Web Crypto as initial hash function (zero dependencies). BLAKE3 can be swapped in when @noble/hashes is installed.
- BYTEA stored as hex-encoded strings in the TypeScript layer for JSON serializability
- Causal graph uses recursive CTE for traversal (2 levels deep from root)
- Scoring adapter creates nodes sequentially (not batched) — can optimize later if latency > 30ms
- ExoChain entries wrapped in try/catch — chain tracking never blocks enrichment

## Known Issues

- Hash function is SHA-256, not BLAKE3 as spec'd. Swap when @noble/hashes added (Phase 2).
- Scoring adapter uses hardcoded `DEFAULT_TENANT_ID = 'default'` — needs request context resolution.

## Acceptance Status

- [x] CausalGraph service with batch create
- [x] Scoring adapter creates nodes per dimension + weight
- [x] Counterfactual modifies weights, returns diff
- [x] ExoChain hash + verify
- [x] Enrichment adapter tracks full waterfall chain
- [x] Feature flags control passthrough behavior
- [x] New API routes: /scoring/trace/[contactId], /enrichment/chain/[chainId]
