// RuVector Graph Sync — Sync edges table to RuVector named graph
// Excludes synthetic edges (mutual-proximity, same-cluster)
// Maps UUID contact IDs to RuVector bigint node IDs

import { query } from "../db/client";

/** Real edge types to include (excludes synthetic mutual-proximity, same-cluster) */
const REAL_EDGE_TYPES = [
  "CONNECTED_TO",
  "MESSAGED",
  "same-company",
  "INVITED_BY",
  "ENDORSED",
  "RECOMMENDED",
  "FOLLOWS_COMPANY",
  "WORKED_AT",
  "EDUCATED_AT",
  "WORKS_AT",
];

export const GRAPH_NAME = "contacts";

/**
 * Full sync: recreate the RuVector contacts graph from the edges table.
 * Steps:
 *   1. Delete existing graph (if any)
 *   2. Create fresh graph
 *   3. Add all contacts as nodes (with tier, niche info)
 *   4. Add only real relationship edges
 * Returns a map of contactId (UUID) -> ruvector node_id (bigint)
 */
export async function syncContactsGraph(): Promise<Map<string, number>> {
  // 1. Delete existing graph
  try {
    await query(`SELECT ruvector_delete_graph($1)`, [GRAPH_NAME]);
  } catch {
    // Graph might not exist yet, ignore
  }

  // 2. Create fresh graph
  await query(`SELECT ruvector_create_graph($1)`, [GRAPH_NAME]);

  // 3. Add contacts as nodes
  const contactsRes = await query<{
    id: string;
    full_name: string | null;
    tier: string | null;
    degree: number;
    composite_score: number | null;
  }>(
    `SELECT c.id, c.full_name, c.tier, c.degree, c.composite_score
     FROM contacts c
     WHERE c.is_archived = FALSE`
  );

  const uuidToNodeId = new Map<string, number>();

  for (const contact of contactsRes.rows) {
    const nodeRes = await query<{ ruvector_add_node: number }>(
      `SELECT ruvector_add_node($1, $2, $3)`,
      [
        GRAPH_NAME,
        [contact.tier || "unscored"],
        JSON.stringify({
          contact_id: contact.id,
          name: contact.full_name || "",
          tier: contact.tier || "unscored",
          degree: contact.degree,
          score: contact.composite_score ?? 0,
        }),
      ]
    );
    uuidToNodeId.set(contact.id, nodeRes.rows[0].ruvector_add_node);
  }

  // 4. Add real edges only
  const edgesRes = await query<{
    source_contact_id: string;
    target_contact_id: string;
    edge_type: string;
    weight: number;
  }>(
    `SELECT source_contact_id, target_contact_id, edge_type, weight
     FROM edges
     WHERE target_contact_id IS NOT NULL
       AND edge_type = ANY($1)`,
    [REAL_EDGE_TYPES]
  );

  let edgesAdded = 0;
  for (const edge of edgesRes.rows) {
    const sourceNodeId = uuidToNodeId.get(edge.source_contact_id);
    const targetNodeId = uuidToNodeId.get(edge.target_contact_id);
    if (sourceNodeId === undefined || targetNodeId === undefined) continue;

    await query(`SELECT ruvector_add_edge($1, $2, $3, $4, $5)`, [
      GRAPH_NAME,
      sourceNodeId,
      targetNodeId,
      edge.edge_type,
      JSON.stringify({ weight: edge.weight }),
    ]);
    edgesAdded++;
  }

  console.log(
    `[ruvector-sync] Graph "${GRAPH_NAME}" synced: ${uuidToNodeId.size} nodes, ${edgesAdded} edges`
  );

  return uuidToNodeId;
}

/**
 * Get graph stats from RuVector
 */
export async function getGraphStats(): Promise<{
  nodeCount: number;
  edgeCount: number;
  raw: Record<string, unknown>;
}> {
  const res = await query<{ ruvector_graph_stats: Record<string, unknown> }>(
    `SELECT ruvector_graph_stats($1)`,
    [GRAPH_NAME]
  );
  const stats = res.rows[0]?.ruvector_graph_stats || {};
  return {
    nodeCount: (stats.node_count as number) || 0,
    edgeCount: (stats.edge_count as number) || 0,
    raw: stats,
  };
}

/**
 * Run PageRank via RuVector and store results in graph_metrics
 */
export async function computeRuVectorPageRank(
  nodeIdMap?: Map<string, number>
): Promise<number> {
  // Build reverse map: node_id -> contact UUID
  let reverseMap: Map<number, string>;

  if (nodeIdMap) {
    reverseMap = new Map();
    for (const [uuid, nodeId] of nodeIdMap) {
      reverseMap.set(nodeId, uuid);
    }
  } else {
    // Rebuild from graph by querying nodes
    reverseMap = await buildReverseMap();
  }

  const res = await query<{ node_id: number; rank: number }>(
    `SELECT * FROM ruvector_graph_pagerank($1, 0.85, 0.001)`,
    [GRAPH_NAME]
  );

  let updated = 0;
  for (const row of res.rows) {
    const contactId = reverseMap.get(row.node_id);
    if (!contactId) continue;

    await query(
      `INSERT INTO graph_metrics (contact_id, pagerank, computed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (contact_id) DO UPDATE SET pagerank = $2, computed_at = NOW()`,
      [contactId, row.rank]
    );
    updated++;
  }

  console.log(`[ruvector-sync] PageRank computed for ${updated} nodes`);
  return updated;
}

/**
 * Run centrality via RuVector and store results
 */
export async function computeRuVectorCentrality(
  method: string = "betweenness",
  nodeIdMap?: Map<string, number>
): Promise<number> {
  let reverseMap: Map<number, string>;

  if (nodeIdMap) {
    reverseMap = new Map();
    for (const [uuid, nodeId] of nodeIdMap) {
      reverseMap.set(nodeId, uuid);
    }
  } else {
    reverseMap = await buildReverseMap();
  }

  const res = await query<{ node_id: number; centrality: number }>(
    `SELECT * FROM ruvector_graph_centrality($1, $2)`,
    [GRAPH_NAME, method]
  );

  let updated = 0;
  const column =
    method === "betweenness"
      ? "betweenness_centrality"
      : method === "degree"
      ? "degree_centrality"
      : method === "closeness"
      ? "closeness_centrality"
      : "eigenvector_centrality";

  for (const row of res.rows) {
    const contactId = reverseMap.get(row.node_id);
    if (!contactId) continue;

    await query(
      `INSERT INTO graph_metrics (contact_id, ${column}, computed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (contact_id) DO UPDATE SET ${column} = $2, computed_at = NOW()`,
      [contactId, row.centrality]
    );
    updated++;
  }

  console.log(
    `[ruvector-sync] ${method} centrality computed for ${updated} nodes`
  );
  return updated;
}

/**
 * Build reverse map from RuVector nodes back to contact UUIDs.
 * Uses the contact_id stored in node properties.
 */
async function buildReverseMap(): Promise<Map<number, string>> {
  const res = await query<{ node_id: number; properties: Record<string, unknown> }>(
    `SELECT node_id, properties FROM ruvector_cypher($1, 'MATCH (n) RETURN n.id AS node_id, n.properties AS properties', '{}')`,
    [GRAPH_NAME]
  ).catch(() => ({ rows: [] }));

  const map = new Map<number, string>();
  for (const row of res.rows) {
    const contactId = row.properties?.contact_id as string;
    if (contactId) {
      map.set(row.node_id, contactId);
    }
  }

  // Fallback: if cypher doesn't return easily, rebuild from contacts table
  if (map.size === 0) {
    // We can't easily reverse-map without re-syncing, return empty
    console.warn(
      "[ruvector-sync] Could not build reverse map. Run syncContactsGraph() first."
    );
  }

  return map;
}

/**
 * Add the recommended index for edge queries
 */
export async function ensureEdgeIndex(): Promise<void> {
  await query(
    `CREATE INDEX IF NOT EXISTS idx_edges_target_type
     ON edges(target_contact_id, edge_type)`
  );
}

/**
 * Index the RuVector node table for contact_id lookups (used by shortest-path
 * to resolve a contact UUID to its RuVector node_id without a full graph scan).
 */
export async function ensureNodeContactIdIndex(): Promise<void> {
  await query(
    `CREATE INDEX IF NOT EXISTS idx_ruvector_nodes_graph_contact
     ON _ruvector_nodes (graph_name, (properties->>'contact_id'))`
  );
}

/**
 * Look up the RuVector node_id for a contact UUID in the given graph.
 * Returns null if the contact has no node in the graph (not yet synced,
 * or excluded because it had no real edges).
 */
export async function getNodeIdForContact(
  contactId: string,
  graphName: string = GRAPH_NAME
): Promise<number | null> {
  const res = await query<{ id: number }>(
    `SELECT id FROM _ruvector_nodes WHERE graph_name = $1 AND properties->>'contact_id' = $2 LIMIT 1`,
    [graphName, contactId]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Resolve RuVector node_ids back to contact UUIDs.
 */
export async function getContactIdsForNodes(
  nodeIds: number[],
  graphName: string = GRAPH_NAME
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (nodeIds.length === 0) return map;

  const res = await query<{ id: number; contact_id: string | null }>(
    `SELECT id, properties->>'contact_id' AS contact_id
     FROM _ruvector_nodes WHERE graph_name = $1 AND id = ANY($2)`,
    [graphName, nodeIds]
  );
  for (const row of res.rows) {
    if (row.contact_id) map.set(row.id, row.contact_id);
  }
  return map;
}

/**
 * Fetch RuVector edge records (source/target/type/properties) by edge id.
 */
export async function getEdgesByIds(
  edgeIds: number[],
  graphName: string = GRAPH_NAME
): Promise<
  Array<{
    id: number;
    source: number;
    target: number;
    edgeType: string;
    properties: Record<string, unknown>;
  }>
> {
  if (edgeIds.length === 0) return [];

  const res = await query<{
    id: number;
    source: number;
    target: number;
    edge_type: string;
    properties: Record<string, unknown>;
  }>(
    `SELECT id, source, target, edge_type, properties
     FROM _ruvector_edges WHERE graph_name = $1 AND id = ANY($2)`,
    [graphName, edgeIds]
  );
  return res.rows.map((row) => ({
    id: row.id,
    source: row.source,
    target: row.target,
    edgeType: row.edge_type,
    properties: row.properties,
  }));
}

export interface RuVectorPathResult {
  nodes: number[];
  edges: number[];
  length: number;
  cost: number;
}

/**
 * Run ruvector_shortest_path between two RuVector node_ids.
 * Returns null when the primitive reports no path within maxHops
 * (a legitimate negative result over the curated real-edge graph),
 * and throws for any other failure (missing graph, connection error, etc.)
 * so the caller can distinguish "no path" from "couldn't ask RuVector".
 */
export async function computeRuVectorShortestPath(
  sourceNodeId: number,
  targetNodeId: number,
  maxHops: number,
  graphName: string = GRAPH_NAME
): Promise<RuVectorPathResult | null> {
  try {
    const res = await query<{ ruvector_shortest_path: RuVectorPathResult }>(
      `SELECT ruvector_shortest_path($1, $2, $3, $4)`,
      [graphName, sourceNodeId, targetNodeId, maxHops]
    );
    return res.rows[0].ruvector_shortest_path;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No path found")) {
      return null;
    }
    throw error;
  }
}

/**
 * Run ruvector_pagerank_personalized over an ad-hoc edge list (0-based integer
 * node indices, matching the format ruvector_spectral_cluster already uses in
 * communities.ts). Does not depend on a synced named graph.
 */
export async function computeRuVectorPersonalizedPageRank(
  edges: number[][],
  sourceIndex: number,
  alpha: number = 0.85,
  epsilon: number = 0.000001
): Promise<Array<{ node: number; rank: number }>> {
  const res = await query<{
    ruvector_pagerank_personalized: Array<{ node: number; rank: number }>;
  }>(
    `SELECT ruvector_pagerank_personalized($1::jsonb, $2, $3, $4)`,
    [JSON.stringify({ edges }), sourceIndex, alpha, epsilon]
  );
  return res.rows[0].ruvector_pagerank_personalized;
}
