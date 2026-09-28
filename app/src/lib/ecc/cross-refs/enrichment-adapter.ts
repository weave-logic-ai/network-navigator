import { ECC_FLAGS } from '../types';
import type { CrossRefType } from '../types';
import { createCrossRef } from './service';
import { query } from '../../db/client';
import type { EnrichmentResult } from '../../enrichment/types';

const MAX_PER_EVENT = 50;

/**
 * Extract CrossRefs from enrichment results.
 * Called after enrichment provider returns data.
 */
export async function extractCrossRefsFromEnrichment(
  contactId: string,
  enrichmentResult: Record<string, unknown>,
  providerName: string,
  tenantId: string = 'default'
): Promise<number> {
  if (!ECC_FLAGS.crossRefs) return 0;

  let created = 0;

  // Extract co-worker relationships from work history
  const workHistory = enrichmentResult.workHistory as Array<Record<string, unknown>> | undefined;
  if (workHistory && Array.isArray(workHistory)) {
    for (const job of workHistory) {
      if (created >= MAX_PER_EVENT) break;

      const companyName = String(job.companyName ?? job.company ?? '');
      if (!companyName) continue;

      // Find contacts who worked at the same company
      const coworkers = await query<{ id: string; title: string }>(
        `SELECT c.id, c.title FROM contacts c
         WHERE c.current_company = $1 AND c.id != $2
         LIMIT 10`,
        [companyName, contactId]
      );

      for (const coworker of coworkers.rows) {
        if (created >= MAX_PER_EVENT) break;

        const edge = await getOrCreateEdge(contactId, coworker.id, tenantId);
        if (!edge) continue;

        try {
          await createCrossRef({
            tenantId,
            edgeId: edge.id,
            relationType: 'co_worker' as CrossRefType,
            context: {
              company: companyName,
              period: `${job.startDate ?? 'unknown'}-${job.endDate ?? 'present'}`,
            },
            confidence: 0.85,
            source: `enrichment:${providerName}`,
          });
          created++;
        } catch {
          // Skip on conflict
        }
      }
    }
  }

  // Extract shared company relationships
  const currentCompany = enrichmentResult.currentCompany as string | undefined;
  if (currentCompany && created < MAX_PER_EVENT) {
    const colleagues = await query<{ id: string }>(
      `SELECT id FROM contacts
       WHERE current_company = $1 AND id != $2
       LIMIT 10`,
      [currentCompany, contactId]
    );

    for (const colleague of colleagues.rows) {
      if (created >= MAX_PER_EVENT) break;

      const edge = await getOrCreateEdge(contactId, colleague.id, tenantId);
      if (!edge) continue;

      try {
        await createCrossRef({
          tenantId,
          edgeId: edge.id,
          relationType: 'shared_company' as CrossRefType,
          context: { company: currentCompany, current: true },
          confidence: 0.95,
          source: `enrichment:${providerName}`,
        });
        created++;
      } catch {
        // Skip on conflict
      }
    }
  }

  return created;
}

/**
 * Map real waterfall enrichment output (`EnrichmentResult[]`, as returned by
 * `enrichContact`/`enrichContactWithChain`) into the `Record<string, unknown>`
 * shape `extractCrossRefsFromEnrichment` expects, then run extraction once
 * per provider result that supplied usable data.
 *
 * Wired from `app/src/app/api/enrichment/enrich/route.ts`'s dryRun=false
 * auto-apply branch — the point where enrichment results are complete and
 * about to be persisted. Not wired into `waterfall.ts`/`enrichContactWithChain`
 * directly because those run during dry-run previews too, and a preview must
 * not have side effects on other tables.
 *
 * IMPORTANT — provider coverage: as of this writing, none of the waterfall
 * providers (`pdl`, `lusha`, `theirstack`, `apollo` — see
 * `lib/enrichment/waterfall.ts` `createProviderInstance`) ever return a
 * `workHistory`/experience array; they only ever return a flat
 * `current_company` field. That means this can only ever produce
 * `shared_company` cross-refs, never `co_worker` ones, until a provider
 * starts returning employment history through the waterfall path. The
 * LinkedIn extension provider *does* map an `employment` field (see
 * `providers/linkedin.ts` `mapExtensionResponse`), but only via its separate
 * async scrape-callback path — `LinkedinProvider.enrich()` itself always
 * returns `fields: []` synchronously — so it never reaches this call either.
 */
export async function extractCrossRefsFromEnrichmentResults(
  contactId: string,
  results: EnrichmentResult[],
  tenantId: string
): Promise<number> {
  if (!ECC_FLAGS.crossRefs) return 0;

  let total = 0;
  for (const result of results) {
    if (!result.success) continue;

    const companyField = result.fields.find((f) => f.field === 'current_company');
    if (!companyField || typeof companyField.value !== 'string' || !companyField.value) continue;

    total += await extractCrossRefsFromEnrichment(
      contactId,
      { currentCompany: companyField.value },
      result.providerName,
      tenantId
    );
  }

  return total;
}

async function getOrCreateEdge(
  sourceId: string,
  targetId: string,
  _tenantId: string
): Promise<{ id: string } | null> {
  // Check existing edge
  const existing = await query<{ id: string }>(
    `SELECT id FROM edges
     WHERE (source_id = $1 AND target_id = $2) OR (source_id = $2 AND target_id = $1)
     LIMIT 1`,
    [sourceId, targetId]
  );

  if (existing.rows.length > 0) return existing.rows[0];

  // Create new edge
  try {
    const result = await query<{ id: string }>(
      `INSERT INTO edges (source_id, target_id, edge_type, weight)
       VALUES ($1, $2, 'professional', 0.5)
       RETURNING id`,
      [sourceId, targetId]
    );
    return result.rows[0];
  } catch {
    return null;
  }
}
