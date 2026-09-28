// Community detection — RuVector spectral clustering with derived attribute fallback

import { CommunityResult } from "./types";
import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

type PendingCommunity = { label: string; members: string[]; algorithm: string; description: string; metadata: Record<string, unknown>; cohesion: number };

/** Keep IDs when a new result substantially overlaps an existing group. */
export function reconcileCommunityIds(
  previous: Array<{ id: string; members: string[]; algorithm: string }>,
  next: Array<{ members: string[]; algorithm: string }>
): Array<string | null> {
  const candidates = previous.flatMap((old) => next.map((group, index) => {
    const members = new Set(group.members);
    const overlap = old.members.filter((id) => members.has(id)).length;
    return { id: old.id, index, overlap, fraction: overlap / Math.max(1, old.members.length + group.members.length - overlap), sameAlgorithm: old.algorithm === group.algorithm };
  })).filter((item) => item.sameAlgorithm && item.overlap > 0 && item.fraction >= 0.5)
    .sort((a, b) => b.overlap - a.overlap || b.fraction - a.fraction || a.id.localeCompare(b.id) || a.index - b.index);
  const ids: Array<string | null> = next.map(() => null);
  const used = new Set<string>();
  for (const item of candidates) {
    if (ids[item.index] || used.has(item.id)) continue;
    ids[item.index] = item.id;
    used.add(item.id);
  }
  return ids;
}

async function publishCommunities(client: PoolClient, pending: PendingCommunity[]): Promise<CommunityResult[]> {
    const old = await client.query<{ id: string; algorithm: string; contact_id: string | null }>(
      `SELECT cl.id, cl.algorithm, cm.contact_id FROM clusters cl
       LEFT JOIN cluster_memberships cm ON cm.cluster_id = cl.id
       WHERE cl.algorithm = 'spectral-ruvector'`
    );
    const previous = new Map<string, { members: string[]; algorithm: string }>();
    for (const row of old.rows) {
      if (!previous.has(row.id)) previous.set(row.id, { members: [], algorithm: row.algorithm });
      if (row.contact_id) previous.get(row.id)!.members.push(row.contact_id);
    }
    const ids = reconcileCommunityIds([...previous].map(([id, group]) => ({ id, ...group })), pending);
    // Historical company/industry clusters can hold name-only contacts. They
    // remain explicit stored groups; only inferred communities are replaced.
    await client.query("DELETE FROM clusters WHERE algorithm = 'spectral-ruvector'");
    const results: CommunityResult[] = [];
    for (const [index, group] of pending.entries()) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO clusters (id, label, description, algorithm, member_count, metadata)
         VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, $4, $5, $6::jsonb) RETURNING id`,
        [ids[index], group.label, group.description, group.algorithm, group.members.length, JSON.stringify(group.metadata)]
      );
      const id = inserted.rows[0].id;
      if (group.members.length) await client.query(
        `INSERT INTO cluster_memberships (contact_id, cluster_id, membership_score)
         SELECT unnest($1::uuid[]), $2::uuid, $3`,
        [group.members, id, group.cohesion]
      );
      results.push({ clusterId: id, label: group.label, members: group.members, memberCount: group.members.length, cohesion: group.cohesion });
    }
    return results;
}

export type CommunityComputeResult = {
  communities: CommunityResult[];
  method: "spectral" | "linked-company-fallback";
};

/** Caller holds the compute lock and transaction before any graph reads. */
export async function detectCommunitiesInTransaction(client: PoolClient): Promise<CommunityComputeResult> {
  return detectCommunitiesSpectral(client);
}

/**
 * Spectral clustering via RuVector.
 * Builds adjacency JSON from real edges and passes to ruvector_spectral_cluster.
 */
async function detectCommunitiesSpectral(client: PoolClient): Promise<CommunityComputeResult> {
  const read = <T extends QueryResultRow>(sql: string, params?: unknown[]) => client.query<T>(sql, params);
  // Build adjacency JSON for spectral clustering
  // ruvector_spectral_cluster expects: { "edges": [[src_idx, dst_idx, weight], ...] }
  // We need to map contact UUIDs to integer indices
  const edgesRes = await read<{
    source_contact_id: string;
    target_contact_id: string;
    weight: number;
  }>(
    `SELECT e.source_contact_id, e.target_contact_id, e.weight
     FROM edges e
     JOIN contacts source ON source.id = e.source_contact_id AND source.is_archived = FALSE
     JOIN contacts target ON target.id = e.target_contact_id AND target.is_archived = FALSE
     WHERE e.edge_type IN ('CONNECTED_TO','MESSAGED','same-company','INVITED_BY','ENDORSED','RECOMMENDED')
     ORDER BY e.id ASC
     LIMIT 10000`
  );

  if (edgesRes.rows.length < 10) {
    console.warn(
      `[graph/communities] Only ${edgesRes.rows.length} real edges found — too few for ` +
        `spectral clustering; falling back to attribute-based grouping instead.`
    );
    await publishCommunities(client, []);
    return { communities: await detectCommunitiesCompany(client), method: "linked-company-fallback" };
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

  // A failed PostgreSQL function aborts its transaction. Isolate only the
  // optional native call so the linked-company fallback can still publish.
  await client.query("SAVEPOINT spectral_cluster");
  let clusterRes;
  try {
    clusterRes = await read<{ ruvector_spectral_cluster: number[] }>(
      `SELECT ruvector_spectral_cluster($1::jsonb, $2)`,
      [adjJson, k]
    );
    await client.query("RELEASE SAVEPOINT spectral_cluster");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT spectral_cluster");
    await client.query("RELEASE SAVEPOINT spectral_cluster");
    console.warn("[graph/communities] Spectral clustering failed; using linked-company groups", error);
    await publishCommunities(client, []);
    return { communities: await detectCommunitiesCompany(client), method: "linked-company-fallback" };
  }

  const assignments = clusterRes.rows[0]?.ruvector_spectral_cluster || [];

  if (assignments.length !== nodeList.length || assignments.some((value) => !Number.isInteger(value) || value < 0)) {
    console.warn(
      `[graph/communities] ruvector_spectral_cluster returned incomplete assignments; ` +
        `falling back to attribute-based grouping instead.`
    );
    await publishCommunities(client, []);
    return { communities: await detectCommunitiesCompany(client), method: "linked-company-fallback" };
  }

  // Group contacts by cluster assignment
  const clusterGroups = new Map<number, string[]>();
  for (let i = 0; i < nodeList.length; i++) {
    const clusterId = assignments[i];
    if (!clusterGroups.has(clusterId)) {
      clusterGroups.set(clusterId, []);
    }
    clusterGroups.get(clusterId)!.push(nodeList[i]);
  }

  // Create cluster records
  const pending: PendingCommunity[] = [];
  let clusterIdx = 0;

  for (const [, members] of clusterGroups) {
    if (members.length < 2) continue;
    clusterIdx++;

    // Try to label the cluster by most common company or industry
    const labelRes = await read<{ label: string; cnt: string }>(
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

    pending.push({ label, members, description: `Spectral cluster with ${members.length} members`, algorithm: "spectral-ruvector", metadata: { clusterIndex: clusterIdx }, cohesion: 1 });
  }

  const communities = await publishCommunities(client, pending);

  console.log(
    `[communities] Spectral clustering found ${communities.length} communities from ${nodeList.length} nodes`
  );
  return { communities, method: "spectral" };
}

/**
 * Fallback: report groups derived from linked company identities. The graph
 * route already derives these; publishing them would erase stored name-only
 * memberships or create duplicate persisted attribute groups.
 */
async function detectCommunitiesCompany(client: PoolClient): Promise<CommunityResult[]> {
  const read = <T extends QueryResultRow>(sql: string, params?: unknown[]) => client.query<T>(sql, params);
  const communities: CommunityResult[] = [];

  const companyResult = await read<{
    company_id: string;
    company_name: string;
    industry: string | null;
    contact_count: string;
    contact_ids: string[];
  }>(
    `SELECT
       co.id AS company_id, co.name AS company_name,
       MIN(trim(co.industry)) AS industry,
       COUNT(*)::text AS contact_count,
       ARRAY_AGG(c.id) AS contact_ids
     FROM contacts c
     JOIN companies co ON c.current_company_id = co.id
     WHERE c.is_archived = FALSE
     GROUP BY co.id, co.name
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC
     LIMIT 50`
  );

  for (const row of companyResult.rows) {
    const label = row.industry
      ? `${row.company_name} (${row.industry})`
      : row.company_name;

    communities.push({ clusterId: `company:${row.company_id}`, label, members: row.contact_ids, memberCount: row.contact_ids.length, cohesion: 1 });
  }

  const industryResult = await read<{
    industry: string;
    contact_count: string;
    contact_ids: string[];
  }>(
    `SELECT
       MIN(trim(co.industry)) AS industry,
       COUNT(*)::text AS contact_count,
       ARRAY_AGG(c.id) AS contact_ids
     FROM contacts c
     JOIN companies co ON c.current_company_id = co.id
     WHERE c.is_archived = FALSE AND nullif(trim(co.industry), '') IS NOT NULL
     GROUP BY lower(trim(co.industry))
     HAVING COUNT(*) >= 3
     ORDER BY COUNT(*) DESC
     LIMIT 20`
  );

  for (const row of industryResult.rows) {
    const label = `Industry: ${row.industry}`;

    const identity = row.industry.trim().toLocaleLowerCase("en-US");
    communities.push({ clusterId: `industry:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`, label, members: row.contact_ids, memberCount: row.contact_ids.length, cohesion: 0.7 });
  }

  return communities;
}
