// Path finding - warm introduction paths via edge traversal
// RuVector native (real-edge graph) with a Node.js BFS (all-edge graph) fallback.

import * as graphQueries from '../db/queries/graph';
import {
  GRAPH_NAME,
  ensureNodeContactIdIndex,
  getNodeIdForContact,
  getContactIdsForNodes,
  getEdgesByIds,
  computeRuVectorShortestPath,
  computeRuVectorPersonalizedPageRank,
} from './ruvector-sync';
import { PathResult } from './types';

/**
 * Find shortest path between two contacts through shared connections.
 *
 * Tries RuVector's native `ruvector_shortest_path` first, which runs over the
 * curated "contacts" graph (real relationship edges only — see
 * ruvector-sync.ts). Falls back to a Node.js BFS over the full `edges` table
 * (which includes synthetic mutual-proximity edges) when RuVector can't
 * answer — e.g. the graph hasn't been synced yet, or the DB call fails.
 * That means a fallback result can differ from the RuVector result: it
 * searches a noisier, larger edge set. The fallback is always logged so
 * it's possible to tell which engine actually served a given call.
 */
export async function findPath(
  sourceId: string,
  targetId: string,
  maxDepth: number = 4
): Promise<PathResult | null> {
  try {
    return await findPathRuVector(sourceId, targetId, maxDepth);
  } catch (error) {
    console.warn(
      `[graph/paths] ruvector_shortest_path failed for ${sourceId} -> ${targetId} ` +
        `(graph "${GRAPH_NAME}"); falling back to Node.js BFS over the full edges ` +
        `table (includes synthetic mutual-proximity edges, not just real relationships): ` +
        (error instanceof Error ? error.message : String(error))
    );
    return await findPathNodeJS(sourceId, targetId, maxDepth);
  }
}

/**
 * RuVector-native shortest path. Resolves contact UUIDs to RuVector node_ids,
 * calls ruvector_shortest_path, then resolves the returned node/edge ids back
 * to contact UUIDs and edge metadata. Throws on any failure that should
 * trigger the Node.js fallback (missing graph, unmapped contact, etc). A
 * genuine "no path within maxDepth" result from RuVector is returned as
 * `null` rather than triggering a fallback — it's the curated-graph answer,
 * not an error.
 */
async function findPathRuVector(
  sourceId: string,
  targetId: string,
  maxDepth: number
): Promise<PathResult | null> {
  await ensureNodeContactIdIndex();

  const [sourceNodeId, targetNodeId] = await Promise.all([
    getNodeIdForContact(sourceId),
    getNodeIdForContact(targetId),
  ]);

  if (sourceNodeId === null || targetNodeId === null) {
    const missing = sourceNodeId === null ? sourceId : targetId;
    throw new Error(
      `contact ${missing} has no node in RuVector graph "${GRAPH_NAME}" ` +
        `(graph may not be synced yet — see syncContactsGraph())`
    );
  }

  const raw = await computeRuVectorShortestPath(sourceNodeId, targetNodeId, maxDepth);
  if (raw === null) return null;

  const [contactIdByNode, edgeRecords] = await Promise.all([
    getContactIdsForNodes(raw.nodes),
    getEdgesByIds(raw.edges),
  ]);
  const edgeById = new Map(edgeRecords.map((edge) => [edge.id, edge]));

  const path: string[] = raw.nodes.map((nodeId) => {
    const contactId = contactIdByNode.get(nodeId);
    if (!contactId) {
      throw new Error(`RuVector node ${nodeId} on path has no mapped contact_id`);
    }
    return contactId;
  });

  const edges: PathResult['edges'] = raw.edges.map((edgeId, i) => {
    const edgeRecord = edgeById.get(edgeId);
    if (!edgeRecord) {
      throw new Error(`RuVector edge ${edgeId} on path could not be resolved`);
    }
    return {
      from: path[i],
      to: path[i + 1],
      edgeType: edgeRecord.edgeType,
      weight: (edgeRecord.properties?.weight as number) ?? 1,
    };
  });

  return { path, length: path.length - 1, edges };
}

/**
 * Node.js fallback: BFS on the edges table (all edge types, including
 * synthetic ones).
 */
async function findPathNodeJS(
  sourceId: string,
  targetId: string,
  maxDepth: number
): Promise<PathResult | null> {
  const edges = await graphQueries.getAllEdges();
  if (edges.length === 0) return null;

  // Build undirected adjacency list with edge metadata
  const adj = new Map<string, Array<{ neighbor: string; edgeType: string; weight: number }>>();

  for (const edge of edges) {
    if (!edge.targetContactId) continue;

    if (!adj.has(edge.sourceContactId)) adj.set(edge.sourceContactId, []);
    if (!adj.has(edge.targetContactId)) adj.set(edge.targetContactId, []);

    adj.get(edge.sourceContactId)!.push({
      neighbor: edge.targetContactId,
      edgeType: edge.edgeType,
      weight: edge.weight,
    });
    adj.get(edge.targetContactId)!.push({
      neighbor: edge.sourceContactId,
      edgeType: edge.edgeType,
      weight: edge.weight,
    });
  }

  // BFS
  const visited = new Set<string>([sourceId]);
  const parent = new Map<string, { from: string; edgeType: string; weight: number }>();
  const queue: Array<{ node: string; depth: number }> = [{ node: sourceId, depth: 0 }];

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;

    if (node === targetId) {
      // Reconstruct path
      return reconstructPath(sourceId, targetId, parent);
    }

    if (depth >= maxDepth) continue;

    const neighbors = adj.get(node) || [];
    for (const { neighbor, edgeType, weight } of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, { from: node, edgeType, weight });
        queue.push({ node: neighbor, depth: depth + 1 });
      }
    }
  }

  return null;
}

function reconstructPath(
  source: string,
  target: string,
  parent: Map<string, { from: string; edgeType: string; weight: number }>
): PathResult {
  const path: string[] = [];
  const edges: PathResult['edges'] = [];

  let current = target;
  while (current !== source) {
    path.unshift(current);
    const info = parent.get(current);
    if (!info) break;

    edges.unshift({
      from: info.from,
      to: current,
      edgeType: info.edgeType,
      weight: info.weight,
    });
    current = info.from;
  }
  path.unshift(source);

  return {
    path,
    length: path.length - 1,
    edges,
  };
}

/**
 * Find all contacts reachable within N hops.
 */
export async function findReachable(
  contactId: string,
  maxHops: number = 2
): Promise<Array<{ id: string; distance: number }>> {
  const edges = await graphQueries.getAllEdges();

  const adj = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.targetContactId) continue;
    if (!adj.has(edge.sourceContactId)) adj.set(edge.sourceContactId, new Set());
    if (!adj.has(edge.targetContactId)) adj.set(edge.targetContactId, new Set());
    adj.get(edge.sourceContactId)!.add(edge.targetContactId);
    adj.get(edge.targetContactId)!.add(edge.sourceContactId);
  }

  const visited = new Map<string, number>();
  visited.set(contactId, 0);
  const queue: Array<{ node: string; dist: number }> = [{ node: contactId, dist: 0 }];

  while (queue.length > 0) {
    const { node, dist } = queue.shift()!;
    if (dist >= maxHops) continue;

    const neighbors = adj.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.set(neighbor, dist + 1);
        queue.push({ node: neighbor, dist: dist + 1 });
      }
    }
  }

  // Remove the source node itself
  visited.delete(contactId);

  return Array.from(visited.entries())
    .map(([id, distance]) => ({ id, distance }))
    .sort((a, b) => a.distance - b.distance);
}

export interface RankedContact {
  id: string;
  score: number;
}

/**
 * Rank contacts by relevance to a source contact using personalized
 * PageRank — a random walk that restarts at `contactId` instead of
 * teleporting uniformly, so mass concentrates on nodes that are both close
 * to and well-connected relative to the source. This was previously not
 * available at all (there is no personalized/seeded variant of
 * computePageRank in metrics.ts) — RuVector's `ruvector_pagerank_personalized`
 * is the only engine for this until now.
 *
 * Tries RuVector first; falls back to an in-process weighted power-iteration
 * implementation of the same algorithm (teleport vector concentrated on the
 * source) if RuVector fails. Both engines walk the same edge set (all real +
 * synthetic edges from the `edges` table, treated as undirected), so unlike
 * findPath, this fallback is not searching a different graph — only a
 * different implementation of the same math.
 */
export async function rankByRelevance(
  contactId: string,
  options: { limit?: number; dampingFactor?: number } = {}
): Promise<RankedContact[]> {
  const { limit = 20, dampingFactor = 0.85 } = options;

  const edges = await graphQueries.getAllEdges();
  if (edges.length === 0) return [];

  const nodeSet = new Set<string>();
  for (const edge of edges) {
    nodeSet.add(edge.sourceContactId);
    if (edge.targetContactId) nodeSet.add(edge.targetContactId);
  }
  const nodeList = Array.from(nodeSet);
  const nodeIndex = new Map(nodeList.map((id, idx) => [id, idx]));

  const sourceIndex = nodeIndex.get(contactId);
  if (sourceIndex === undefined) return [];

  const indexedEdges: number[][] = [];
  for (const edge of edges) {
    if (!edge.targetContactId) continue;
    indexedEdges.push([
      nodeIndex.get(edge.sourceContactId)!,
      nodeIndex.get(edge.targetContactId)!,
      edge.weight || 1,
    ]);
  }

  try {
    const ranks = await computeRuVectorPersonalizedPageRank(
      indexedEdges,
      sourceIndex,
      dampingFactor
    );
    return ranks
      .filter((r) => r.node !== sourceIndex)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map((r) => ({ id: nodeList[r.node], score: r.rank }));
  } catch (error) {
    console.warn(
      `[graph/paths] ruvector_pagerank_personalized failed for contact ${contactId}; ` +
        `falling back to Node.js power-iteration personalized PageRank: ` +
        (error instanceof Error ? error.message : String(error))
    );
    return rankByRelevanceNodeJS(nodeList, indexedEdges, sourceIndex, dampingFactor, limit);
  }
}

/**
 * Node.js fallback for personalized PageRank: weighted power iteration over
 * an undirected adjacency list, with the teleport vector concentrated
 * entirely on `sourceIndex` (rather than uniform 1/n, as in plain PageRank).
 */
function rankByRelevanceNodeJS(
  nodeList: string[],
  indexedEdges: number[][],
  sourceIndex: number,
  dampingFactor: number,
  limit: number,
  iterations: number = 20
): RankedContact[] {
  const n = nodeList.length;
  const adjacency: Array<Array<{ to: number; weight: number }>> = Array.from(
    { length: n },
    () => []
  );
  const totalWeight = new Float64Array(n);

  for (const [src, dst, weight] of indexedEdges) {
    adjacency[src].push({ to: dst, weight });
    adjacency[dst].push({ to: src, weight });
    totalWeight[src] += weight;
    totalWeight[dst] += weight;
  }

  let ranks = new Float64Array(n);
  ranks[sourceIndex] = 1;

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float64Array(n);
    for (let node = 0; node < n; node++) {
      let incoming = 0;
      for (const { to, weight } of adjacency[node]) {
        if (totalWeight[to] > 0) {
          incoming += (ranks[to] * weight) / totalWeight[to];
        }
      }
      const teleport = node === sourceIndex ? 1 : 0;
      next[node] = (1 - dampingFactor) * teleport + dampingFactor * incoming;
    }
    ranks = next;
  }

  const results: RankedContact[] = [];
  for (let i = 0; i < n; i++) {
    if (i === sourceIndex) continue;
    results.push({ id: nodeList[i], score: ranks[i] });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
