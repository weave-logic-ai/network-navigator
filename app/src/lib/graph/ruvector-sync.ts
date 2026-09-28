// RuVector Graph Sync — Sync edges table to RuVector named graph
// Excludes synthetic edges (mutual-proximity, same-cluster)
// Maps UUID contact IDs to RuVector bigint node IDs

import { query } from "../db/client";
import type { PoolClient, QueryResultRow } from "pg";
import { PUBLISHED_GRAPH_EDGE_TYPES } from "./edge-policy";

export const GRAPH_NAME = "contacts";

function graphId(value: number | string): number {
  // pg returns SQL bigint as a string; RuVector's path JSON uses numbers.
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(`Invalid RuVector graph id: ${value}`);
  return id;
}

function readGraph<T extends QueryResultRow>(client: PoolClient | undefined, sql: string, params?: unknown[]) {
  return client ? client.query<T>(sql, params) : query<T>(sql, params);
}

/**
 * Build a native graph inside a caller-owned publication transaction.
 * Steps:
 *   1. Lock and refuse an existing graph name
 *   2. Create a fresh graph
 *   3. Add all contacts as nodes (with tier and score)
 *   4. Add only real relationship edges
 * Returns a map of contactId (UUID) -> ruvector node_id (bigint)
 */
export async function syncContactsGraph(
  client?: PoolClient,
  graphName: string = GRAPH_NAME,
  edgeTypes: readonly string[] = PUBLISHED_GRAPH_EDGE_TYPES,
): Promise<Map<string, number>> {
  if (!client) {
    throw new Error("Direct graph sync is retired; use computeGraphSnapshot() to publish metrics and a private graph atomically.");
  }
  if (graphName !== GRAPH_NAME && !/^contacts_[0-9a-f]{32}$/.test(graphName)) {
    throw new Error("Invalid private graph name");
  }
  const run = <T extends QueryResultRow>(sql: string, params?: unknown[]) =>
    client.query<T>(sql, params);

  // Caller holds a transaction through publication. This conflicts with the
  // shared read pin if the name were ever reused.
  await run(`SELECT pg_advisory_xact_lock(832782, hashtext($1))`, [graphName]);
  // The installed extension returns true even when a graph already exists.
  // Refuse to append to any existing graph, including one held by a reader.
  const existing = await run<{ exists: boolean }>(`SELECT $1 = ANY(ruvector_list_graphs()) AS exists`, [graphName]);
  if (existing.rows[0]?.exists) {
    throw new Error(`RuVector graph "${graphName}" already exists; publish under a fresh private name.`);
  }
  await run(`SELECT ruvector_create_graph($1)`, [graphName]);

  // 3. Add contacts as nodes
  const contactsRes = await run<{
    id: string;
    full_name: string | null;
    tier: string | null;
    degree: number;
    composite_score: number | null;
  }>(
    `SELECT c.id, c.full_name, cs.tier, c.degree, cs.composite_score
     FROM contacts c
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     WHERE c.is_archived = FALSE`
  );

  const uuidToNodeId = new Map<string, number>();

  for (const contact of contactsRes.rows) {
    const nodeRes = await run<{ ruvector_add_node: number }>(
      `SELECT ruvector_add_node($1, $2, $3)`,
      [
        graphName,
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
    uuidToNodeId.set(contact.id, graphId(nodeRes.rows[0].ruvector_add_node));
  }

  // 4. Add real edges only
  const edgesRes = await run<{
    source_contact_id: string;
    target_contact_id: string;
    edge_type: string;
    weight: number;
  }>(
    `SELECT source_contact_id, target_contact_id, edge_type, weight
     FROM edges
     WHERE target_contact_id IS NOT NULL
       AND edge_type = ANY($1)`,
    [edgeTypes]
  );

  let edgesAdded = 0;
  for (const edge of edgesRes.rows) {
    const sourceNodeId = uuidToNodeId.get(edge.source_contact_id);
    const targetNodeId = uuidToNodeId.get(edge.target_contact_id);
    if (sourceNodeId === undefined || targetNodeId === undefined) continue;

    await run(`SELECT ruvector_add_edge($1, $2, $3, $4, $5)`, [
      graphName,
      sourceNodeId,
      targetNodeId,
      edge.edge_type,
      JSON.stringify({ weight: edge.weight }),
    ]);
    edgesAdded++;
  }

  console.log(
    `[ruvector-sync] Graph "${graphName}" synced: ${uuidToNodeId.size} nodes, ${edgesAdded} edges`
  );

  return uuidToNodeId;
}

/**
 * Get graph stats from RuVector
 */
export async function getGraphStats(graphName: string = GRAPH_NAME): Promise<{
  nodeCount: number;
  edgeCount: number;
  raw: Record<string, unknown>;
}> {
  const res = await query<{ ruvector_graph_stats: Record<string, unknown> }>(
    `SELECT ruvector_graph_stats($1)`,
    [graphName]
  );
  const stats = res.rows[0]?.ruvector_graph_stats || {};
  return {
    nodeCount: (stats.node_count as number) || 0,
    edgeCount: (stats.edge_count as number) || 0,
    raw: stats,
  };
}

export async function getPublishedGraphName(client?: PoolClient): Promise<string> {
  const result = await readGraph<{ active_graph_name: string | null }>(client,
    "SELECT active_graph_name FROM graph_compute_state WHERE id = TRUE"
  );
  if (!result.rows[0]?.active_graph_name) throw new Error("No native graph has been published; run graph Compute.");
  return result.rows[0].active_graph_name;
}

/** Native metric writes were replaced by computeGraphSnapshot's atomic publication. */
export async function computeRuVectorPageRank(_nodeIdMap?: Map<string, number>): Promise<number> {
  throw new Error("Direct native metric writes are retired; use computeGraphSnapshot().");
}

/** Native metric writes were replaced by computeGraphSnapshot's atomic publication. */
export async function computeRuVectorCentrality(_method: string = "betweenness", _nodeIdMap?: Map<string, number>): Promise<number> {
  throw new Error("Direct native metric writes are retired; use computeGraphSnapshot().");
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
  graphName: string = GRAPH_NAME,
  client?: PoolClient
): Promise<number | null> {
  const res = await readGraph<{ id: number }>(client,
    `SELECT id FROM _ruvector_nodes WHERE graph_name = $1 AND properties->>'contact_id' = $2 LIMIT 1`,
    [graphName, contactId]
  );
  return res.rows[0] ? graphId(res.rows[0].id) : null;
}

/**
 * Resolve RuVector node_ids back to contact UUIDs.
 */
export async function getContactIdsForNodes(
  nodeIds: number[],
  graphName: string = GRAPH_NAME,
  client?: PoolClient
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (nodeIds.length === 0) return map;

  const res = await readGraph<{ id: number; contact_id: string | null }>(client,
    `SELECT id, properties->>'contact_id' AS contact_id
     FROM _ruvector_nodes WHERE graph_name = $1 AND id = ANY($2)`,
    [graphName, nodeIds]
  );
  for (const row of res.rows) {
    if (row.contact_id) map.set(graphId(row.id), row.contact_id);
  }
  return map;
}

/**
 * Fetch RuVector edge records (source/target/type/properties) by edge id.
 */
export async function getEdgesByIds(
  edgeIds: number[],
  graphName: string = GRAPH_NAME,
  client?: PoolClient
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

  const res = await readGraph<{
    id: number;
    source: number;
    target: number;
    edge_type: string;
    properties: Record<string, unknown>;
  }>(client,
    `SELECT id, source, target, edge_type, properties
     FROM _ruvector_edges WHERE graph_name = $1 AND id = ANY($2)`,
    [graphName, edgeIds]
  );
  return res.rows.map((row) => ({
    id: graphId(row.id),
    source: graphId(row.source),
    target: graphId(row.target),
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
  graphName: string = GRAPH_NAME,
  client?: PoolClient
): Promise<RuVectorPathResult | null> {
  try {
    const res = await readGraph<{ ruvector_shortest_path: RuVectorPathResult }>(client,
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
