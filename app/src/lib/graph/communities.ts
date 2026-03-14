// Community detection - cluster contacts by company, industry, scoring similarity

import * as graphQueries from '../db/queries/graph';
import { query } from '../db/client';
import { CommunityResult } from './types';

/**
 * Detect communities by grouping contacts by company and industry.
 * A pragmatic approach that uses existing relational data rather than
 * complex graph algorithms.
 */
export async function detectCommunities(): Promise<CommunityResult[]> {
  // Clear existing clusters before recomputing
  await graphQueries.clearClusters();

  const communities: CommunityResult[] = [];

  // Cluster by company
  const companyResult = await query<{
    company_name: string; industry: string | null;
    contact_count: string; contact_ids: string[];
  }>(
    `SELECT
       c.current_company AS company_name,
       co.industry,
       COUNT(*)::text AS contact_count,
       ARRAY_AGG(c.id) AS contact_ids
     FROM contacts c
     LEFT JOIN companies co ON c.current_company_id = co.id
     WHERE c.is_archived = FALSE AND c.current_company IS NOT NULL
     GROUP BY c.current_company, co.industry
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC
     LIMIT 50`
  );

  for (const row of companyResult.rows) {
    const count = parseInt(row.contact_count, 10);
    const label = row.industry
      ? `${row.company_name} (${row.industry})`
      : row.company_name;

    const cluster = await graphQueries.createCluster({
      label,
      description: `Contacts at ${row.company_name}`,
      algorithm: 'company-grouping',
      memberCount: count,
      metadata: { company: row.company_name, industry: row.industry },
    });

    for (const contactId of row.contact_ids) {
      await graphQueries.addClusterMembership(contactId, cluster.id, 1.0);
    }

    communities.push({
      clusterId: cluster.id,
      label,
      members: row.contact_ids,
      memberCount: count,
      cohesion: 1.0,
    });
  }

  // Cluster by industry (for contacts without a company cluster)
  const industryResult = await query<{
    industry: string; contact_count: string; contact_ids: string[];
  }>(
    `SELECT
       co.industry,
       COUNT(*)::text AS contact_count,
       ARRAY_AGG(c.id) AS contact_ids
     FROM contacts c
     JOIN companies co ON c.current_company_id = co.id
     WHERE c.is_archived = FALSE AND co.industry IS NOT NULL
     GROUP BY co.industry
     HAVING COUNT(*) >= 3
     ORDER BY COUNT(*) DESC
     LIMIT 20`
  );

  for (const row of industryResult.rows) {
    const count = parseInt(row.contact_count, 10);
    const label = `Industry: ${row.industry}`;

    const cluster = await graphQueries.createCluster({
      label,
      description: `Contacts in ${row.industry} industry`,
      algorithm: 'industry-grouping',
      memberCount: count,
      metadata: { industry: row.industry },
    });

    for (const contactId of row.contact_ids) {
      await graphQueries.addClusterMembership(contactId, cluster.id, 0.7);
    }

    communities.push({
      clusterId: cluster.id,
      label,
      members: row.contact_ids,
      memberCount: count,
      cohesion: 0.7,
    });
  }

  return communities;
}
