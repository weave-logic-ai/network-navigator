# Phase 1 — WS-2: Taxonomy Hierarchy Fix

**Completed**: 2026-03-24
**Agent**: ws2-taxonomy

## Files Created

| File | Purpose |
|------|---------|
| `app/src/lib/taxonomy/types.ts` | Vertical, NicheProfile (vertical_id), IcpProfileWithNiche (niche_id), TaxonomyChain, DiscoveredIcp, SaveDiscoveryResult |
| `app/src/lib/taxonomy/service.ts` | Vertical CRUD, hierarchy queries (getVerticalWithNiches, getNicheWithIcps), resolveTaxonomyChain |
| `app/src/lib/taxonomy/discovery.ts` | saveDiscoveredIcp with name dedup + criteria overlap (>80% Jaccard = duplicate) |
| `app/src/app/api/verticals/route.ts` | GET (list) + POST (create) |
| `app/src/app/api/verticals/[id]/route.ts` | GET (with niches) + PUT + DELETE |

## Files Modified

| File | Change Summary |
|------|----------------|
| `app/src/lib/db/queries/niches.ts` | `industry` → `vertical_id` in NicheRow and all queries; added `listNichesByVertical`, `findNicheByVerticalAndName` |
| `app/src/lib/db/queries/icps.ts` | Added `niche_id` to IcpRow and all queries; added `listIcpsByNiche`, `findIcpByNicheAndName` |
| `app/src/lib/db/queries/scoring.ts` | `createIcpProfile` accepts optional `nicheId` |
| `app/src/lib/scoring/types.ts` | Added `nicheKeywords?: string[]` to IcpCriteria (kept `industries` for vertical-derived matching) |
| `app/src/lib/scoring/scorers/icp-fit.ts` | Added niche keywords matching block after signals |
| `app/src/lib/scoring/pipeline.ts` | Imported `resolveTaxonomyChain`; enriches criteria with `industries: [vertical.name]` and `nicheKeywords: niche.keywords` |
| `app/src/app/api/niches/route.ts` | GET supports `?verticalId=` filter; POST accepts `verticalId` |
| `app/src/app/api/icp/profiles/route.ts` | GET supports `?nicheId=` filter; POST accepts `nicheId` |
| `app/src/app/api/icp/discover/route.ts` | GET no longer auto-saves; POST added with nicheId + dedup |
| `app/src/lib/graph/icp-discovery.ts` | Removed `createIcpFromDiscovery` (replaced by taxonomy/discovery.ts) |

## Decisions Made

- Kept `industries` in IcpCriteria for backward compatibility — the pipeline now populates it from vertical.name
- `nicheKeywords` is additive — scored as a separate dimension check in IcpFitScorer
- Discovery POST requires nicheId — cannot save an ICP without a parent niche
- Criteria overlap uses Jaccard similarity per field, averaged across non-empty fields

## Known Issues

- None identified.

## Acceptance Status

- [x] Vertical CRUD works
- [x] Niche requires vertical_id on create
- [x] ICP accepts niche_id on create
- [x] ICP discovery GET is read-only (no auto-save)
- [x] ICP discovery POST checks name + criteria overlap
- [x] Scoring pipeline resolves ICP→Niche→Vertical
- [x] IcpFitScorer uses vertical.name for industry + niche.keywords
- [x] All existing API contracts preserved
