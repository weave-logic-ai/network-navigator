// Path finding - warm introduction paths via edge traversal

import * as graphQueries from '../db/queries/graph';
import { PathResult } from './types';

/**
 * Find shortest path between two contacts through shared connections.
 * Uses BFS on the edges table.
 */
export async function findPath(
  sourceId: string,
  targetId: string,
  maxDepth: number = 4
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
