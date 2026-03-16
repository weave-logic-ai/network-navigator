// Graph analytics DB queries

import { query } from '../client';
import { GraphMetrics, Cluster, ClusterMembership, GraphEdge } from '../../graph/types';

// Graph metrics

export async function upsertGraphMetrics(
  contactId: string,
  metrics: Partial<Omit<GraphMetrics, 'contactId' | 'computedAt'>>
): Promise<void> {
  await query(
    `INSERT INTO graph_metrics (contact_id, pagerank, betweenness_centrality, closeness_centrality, degree_centrality, eigenvector_centrality, clustering_coefficient, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (contact_id) DO UPDATE SET
       pagerank = COALESCE($2, graph_metrics.pagerank),
       betweenness_centrality = COALESCE($3, graph_metrics.betweenness_centrality),
       closeness_centrality = COALESCE($4, graph_metrics.closeness_centrality),
       degree_centrality = COALESCE($5, graph_metrics.degree_centrality),
       eigenvector_centrality = COALESCE($6, graph_metrics.eigenvector_centrality),
       clustering_coefficient = COALESCE($7, graph_metrics.clustering_coefficient),
       computed_at = NOW()`,
    [
      contactId,
      metrics.pagerank ?? null,
      metrics.betweennessCentrality ?? null,
      metrics.closenessCentrality ?? null,
      metrics.degreeCentrality ?? null,
      metrics.eigenvectorCentrality ?? null,
      metrics.clusteringCoefficient ?? null,
    ]
  );
}

export async function getGraphMetrics(contactId: string): Promise<GraphMetrics | null> {
  const result = await query<{
    contact_id: string; pagerank: number | null;
    betweenness_centrality: number | null; closeness_centrality: number | null;
    degree_centrality: number | null; eigenvector_centrality: number | null;
    clustering_coefficient: number | null; computed_at: Date;
  }>(
    'SELECT * FROM graph_metrics WHERE contact_id = $1',
    [contactId]
  );
  return result.rows[0] ? mapGraphMetrics(result.rows[0]) : null;
}

export async function listGraphMetrics(
  page: number = 1,
  limit: number = 50
): Promise<{ data: GraphMetrics[]; total: number }> {
  const offset = (page - 1) * limit;
  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM graph_metrics'
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query<{
    contact_id: string; pagerank: number | null;
    betweenness_centrality: number | null; closeness_centrality: number | null;
    degree_centrality: number | null; eigenvector_centrality: number | null;
    clustering_coefficient: number | null; computed_at: Date;
  }>(
    'SELECT * FROM graph_metrics ORDER BY pagerank DESC NULLS LAST LIMIT $1 OFFSET $2',
    [limit, offset]
  );

  return {
    data: result.rows.map(mapGraphMetrics),
    total,
  };
}

// Edge queries

export async function getEdgesForContact(contactId: string): Promise<GraphEdge[]> {
  const result = await query<{
    id: string; source_contact_id: string; target_contact_id: string | null;
    target_company_id: string | null; edge_type: string; weight: number;
    properties: Record<string, unknown>;
  }>(
    `SELECT * FROM edges WHERE source_contact_id = $1 OR target_contact_id = $1`,
    [contactId]
  );
  return result.rows.map(mapEdge);
}

export async function getAllEdges(): Promise<GraphEdge[]> {
  const result = await query<{
    id: string; source_contact_id: string; target_contact_id: string | null;
    target_company_id: string | null; edge_type: string; weight: number;
    properties: Record<string, unknown>;
  }>(
    'SELECT * FROM edges WHERE target_contact_id IS NOT NULL'
  );
  return result.rows.map(mapEdge);
}

export async function getDegreeCounts(): Promise<Map<string, number>> {
  const result = await query<{ contact_id: string; deg: string }>(
    `SELECT contact_id, COUNT(*)::text AS deg FROM (
       SELECT source_contact_id AS contact_id FROM edges WHERE target_contact_id IS NOT NULL
       UNION ALL
       SELECT target_contact_id AS contact_id FROM edges WHERE target_contact_id IS NOT NULL
     ) sub
     GROUP BY contact_id`
  );
  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.contact_id, parseInt(row.deg, 10));
  }
  return map;
}

// Cluster queries

export async function listClusters(): Promise<Cluster[]> {
  const result = await query<{
    id: string; label: string; description: string | null; algorithm: string;
    member_count: number; metadata: Record<string, unknown>;
    created_at: Date; updated_at: Date;
  }>(
    'SELECT * FROM clusters ORDER BY member_count DESC'
  );
  return result.rows.map(mapCluster);
}

export async function createCluster(data: {
  label: string;
  description?: string;
  algorithm: string;
  memberCount: number;
  metadata?: Record<string, unknown>;
}): Promise<Cluster> {
  const result = await query<{
    id: string; label: string; description: string | null; algorithm: string;
    member_count: number; metadata: Record<string, unknown>;
    created_at: Date; updated_at: Date;
  }>(
    `INSERT INTO clusters (label, description, algorithm, member_count, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.label, data.description ?? null, data.algorithm, data.memberCount, JSON.stringify(data.metadata || {})]
  );
  return mapCluster(result.rows[0]);
}

export async function addClusterMembership(
  contactId: string,
  clusterId: string,
  membershipScore: number = 1.0
): Promise<void> {
  await query(
    `INSERT INTO cluster_memberships (contact_id, cluster_id, membership_score)
     VALUES ($1, $2, $3)
     ON CONFLICT (contact_id, cluster_id) DO UPDATE SET membership_score = $3`,
    [contactId, clusterId, membershipScore]
  );
}

export async function getClusterMembers(clusterId: string): Promise<ClusterMembership[]> {
  const result = await query<{
    contact_id: string; cluster_id: string; membership_score: number;
  }>(
    'SELECT contact_id, cluster_id, membership_score FROM cluster_memberships WHERE cluster_id = $1 ORDER BY membership_score DESC',
    [clusterId]
  );
  return result.rows.map(r => ({
    contactId: r.contact_id,
    clusterId: r.cluster_id,
    membershipScore: r.membership_score,
  }));
}

export async function clearClusters(): Promise<void> {
  await query('DELETE FROM cluster_memberships');
  await query('DELETE FROM clusters');
}

// ICP/Niche discovery queries

export async function getContactAttributeClusters(): Promise<
  Array<{
    title_pattern: string | null;
    industry: string | null;
    company_size: string | null;
    location: string | null;
    contact_count: number;
    sample_ids: string[];
  }>
> {
  const result = await query<{
    title_pattern: string | null;
    industry: string | null;
    company_size: string | null;
    location: string | null;
    contact_count: string;
    sample_ids: string[];
  }>(
    `SELECT
       CASE
         WHEN c.title ILIKE '%CEO%' OR c.title ILIKE '%founder%' THEN 'Executive/Founder'
         WHEN c.title ILIKE '%VP%' OR c.title ILIKE '%director%' THEN 'VP/Director'
         WHEN c.title ILIKE '%manager%' OR c.title ILIKE '%lead%' THEN 'Manager/Lead'
         WHEN c.title ILIKE '%engineer%' OR c.title ILIKE '%developer%' THEN 'Engineer/Developer'
         WHEN c.title ILIKE '%sales%' OR c.title ILIKE '%account%' THEN 'Sales/Account'
         WHEN c.title ILIKE '%marketing%' OR c.title ILIKE '%growth%' THEN 'Marketing/Growth'
         ELSE 'Other'
       END AS title_pattern,
       co.industry,
       co.size_range AS company_size,
       c.location,
       COUNT(*)::text AS contact_count,
       (ARRAY_AGG(c.id ORDER BY c.created_at))[1:5] AS sample_ids
     FROM contacts c
     LEFT JOIN companies co ON c.current_company_id = co.id
     WHERE c.is_archived = FALSE
     GROUP BY title_pattern, co.industry, co.size_range, c.location
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC
     LIMIT 20`
  );

  return result.rows.map(r => ({
    title_pattern: r.title_pattern,
    industry: r.industry,
    company_size: r.company_size,
    location: r.location,
    contact_count: parseInt(r.contact_count, 10),
    sample_ids: r.sample_ids || [],
  }));
}

// Helpers

function mapGraphMetrics(row: {
  contact_id: string; pagerank: number | null;
  betweenness_centrality: number | null; closeness_centrality: number | null;
  degree_centrality: number | null; eigenvector_centrality: number | null;
  clustering_coefficient: number | null; computed_at: Date;
}): GraphMetrics {
  return {
    contactId: row.contact_id,
    pagerank: row.pagerank,
    betweennessCentrality: row.betweenness_centrality,
    closenessCentrality: row.closeness_centrality,
    degreeCentrality: row.degree_centrality,
    eigenvectorCentrality: row.eigenvector_centrality,
    clusteringCoefficient: row.clustering_coefficient,
    computedAt: row.computed_at.toISOString(),
  };
}

function mapEdge(row: {
  id: string; source_contact_id: string; target_contact_id: string | null;
  target_company_id: string | null; edge_type: string; weight: number;
  properties: Record<string, unknown>;
}): GraphEdge {
  return {
    id: row.id,
    sourceContactId: row.source_contact_id,
    targetContactId: row.target_contact_id,
    targetCompanyId: row.target_company_id,
    edgeType: row.edge_type,
    weight: row.weight,
    properties: row.properties,
  };
}

function mapCluster(row: {
  id: string; label: string; description: string | null; algorithm: string;
  member_count: number; metadata: Record<string, unknown>;
  created_at: Date; updated_at: Date;
}): Cluster {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    algorithm: row.algorithm,
    memberCount: row.member_count,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
