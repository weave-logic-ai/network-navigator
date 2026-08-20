// Community detection — RuVector spectral clustering with company-grouping fallback

import * as graphQueries from "../db/queries/graph";
import { query } from "../db/client";
import { CommunityResult } from "./types";

/**
 * Detect communities using RuVector spectral clustering on real edge topology.
 * Falls back to company-based grouping if spectral clustering fails.
 */
export async function detectCommunities(): Promise<CommunityResult[]> {
  try {
    return await detectCommunitiesSpectral();
  } catch (error) {
    console.warn(
      `[graph/communities] RuVector spectral clustering failed; falling back to ` +
        `attribute-based grouping (company/industry name, not real topology — see ` +
        `docs/plans/graph-architecture.md "What's Broken"). Which engine produced ` +
        `the current clusters is only visible here: ` +
        (error instanceof Error ? error.message : String(error))
    );
    return await detectCommunitiesCompany();
  }
}

/**
 * Spectral clustering via RuVector.
 * Builds adjacency JSON from real edges and passes to ruvector_spectral_cluster.
 */
async function detectCommunitiesSpectral(): Promise<CommunityResult[]> {
  await graphQueries.clearClusters();

  // Build adjacency JSON for spectral clustering
  // ruvector_spectral_cluster expects: { "edges": [[src_idx, dst_idx, weight], ...] }
  // We need to map contact UUIDs to integer indices
  const edgesRes = await query<{
    source_contact_id: string;
    target_contact_id: string;
    weight: number;
  }>(
    `SELECT source_contact_id, target_contact_id, weight
     FROM edges
     WHERE target_contact_id IS NOT NULL
       AND edge_type IN ('CONNECTED_TO','MESSAGED','same-company','INVITED_BY','ENDORSED','RECOMMENDED')
     LIMIT 10000`
  );

  if (edgesRes.rows.length < 10) {
    console.warn(
      `[graph/communities] Only ${edgesRes.rows.length} real edges found — too few for ` +
        `spectral clustering; falling back to attribute-based grouping instead.`
    );
    return await detectCommunitiesCompany();
  }

  // Build node index map
  const nodeSet = new Set<string>();
  for (const edge of edgesRes.rows) {
    nodeSet.add(edge.source_contact_id);
    nodeSet.add(edge.target_contact_id);
  }
  const nodeList = Array.from(nodeSet);
  const nodeIndex = new Map<string, number>();
  nodeList.forEach((id, idx) => nodeIndex.set(id, idx));

  // Build adjacency JSON
  const adjEdges: number[][] = [];
  for (const edge of edgesRes.rows) {
    const srcIdx = nodeIndex.get(edge.source_contact_id)!;
    const dstIdx = nodeIndex.get(edge.target_contact_id)!;
    adjEdges.push([srcIdx, dstIdx, edge.weight || 1.0]);
  }

  // Auto-detect k (number of clusters): sqrt(n) capped at 20
  const k = Math.max(2, Math.min(20, Math.round(Math.sqrt(nodeList.length))));

  const adjJson = JSON.stringify({ edges: adjEdges, n: nodeList.length });

  const clusterRes = await query<{ ruvector_spectral_cluster: number[] }>(
    `SELECT ruvector_spectral_cluster($1::jsonb, $2)`,
    [adjJson, k]
  );

  const assignments = clusterRes.rows[0]?.ruvector_spectral_cluster || [];

  if (assignments.length === 0) {
    console.warn(
      `[graph/communities] ruvector_spectral_cluster returned no assignments; ` +
        `falling back to attribute-based grouping instead.`
    );
    return await detectCommunitiesCompany();
  }

  // Group contacts by cluster assignment
  const clusterGroups = new Map<number, string[]>();
  for (let i = 0; i < assignments.length && i < nodeList.length; i++) {
    const clusterId = assignments[i];
    if (!clusterGroups.has(clusterId)) {
      clusterGroups.set(clusterId, []);
    }
    clusterGroups.get(clusterId)!.push(nodeList[i]);
  }

  // Create cluster records
  const communities: CommunityResult[] = [];
  let clusterIdx = 0;

  for (const [, members] of clusterGroups) {
    if (members.length < 2) continue;
    clusterIdx++;

    // Try to label the cluster by most common company or industry
    const labelRes = await query<{ label: string; cnt: string }>(
      `SELECT COALESCE(c.current_company, 'Mixed') as label, COUNT(*)::text as cnt
       FROM contacts c
       WHERE c.id = ANY($1)
       GROUP BY c.current_company
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
      [members]
    );

    const topLabel = labelRes.rows[0]?.label || `Cluster ${clusterIdx}`;
    const label =
      members.length > 5
        ? `${topLabel} (+${members.length - 1})`
        : `Community: ${topLabel}`;

    const cluster = await graphQueries.createCluster({
      label,
      description: `Spectral cluster with ${members.length} members`,
      algorithm: "spectral-ruvector",
      memberCount: members.length,
      metadata: { clusterIndex: clusterIdx },
    });

    for (const contactId of members) {
      await graphQueries.addClusterMembership(contactId, cluster.id, 1.0);
    }

    communities.push({
      clusterId: cluster.id,
      label,
      members,
      memberCount: members.length,
      cohesion: 1.0,
    });
  }

  console.log(
    `[communities] Spectral clustering found ${communities.length} communities from ${nodeList.length} nodes`
  );
  return communities;
}

/**
 * Fallback: Cluster by company and industry (original implementation).
 */
async function detectCommunitiesCompany(): Promise<CommunityResult[]> {
  await graphQueries.clearClusters();

  const communities: CommunityResult[] = [];

  const companyResult = await query<{
    company_name: string;
    industry: string | null;
    contact_count: string;
    contact_ids: string[];
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
      algorithm: "company-grouping",
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

  const industryResult = await query<{
    industry: string;
    contact_count: string;
    contact_ids: string[];
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
      algorithm: "industry-grouping",
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
