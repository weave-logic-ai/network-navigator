import { ECC_FLAGS } from '../types';
import type { CrossRefType } from '../types';
import { createCrossRef } from './service';
import { query } from '../../db/client';

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
