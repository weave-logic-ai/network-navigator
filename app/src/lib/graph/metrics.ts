// Graph metrics computation using SQL aggregation

import * as graphQueries from '../db/queries/graph';
import { GraphMetrics } from './types';

/**
 * Compute PageRank approximation using iterative SQL aggregation.
 * This is a simplified power-iteration approach.
 */
export async function computePageRank(
  dampingFactor: number = 0.85,
  iterations: number = 20
): Promise<Map<string, number>> {
  const edges = await graphQueries.getAllEdges();
  if (edges.length === 0) return new Map();

  // Build adjacency list
  const outLinks = new Map<string, Set<string>>();
  const allNodes = new Set<string>();

  for (const edge of edges) {
    if (!edge.targetContactId) continue;
    allNodes.add(edge.sourceContactId);
    allNodes.add(edge.targetContactId);

    if (!outLinks.has(edge.sourceContactId)) {
      outLinks.set(edge.sourceContactId, new Set());
    }
    outLinks.get(edge.sourceContactId)!.add(edge.targetContactId);
  }

  const n = allNodes.size > 0 ? allNodes.size : 1;
  const nodeList = Array.from(allNodes);
  const ranks = new Map<string, number>();

  // Initialize equal rank
  for (const node of nodeList) {
    ranks.set(node, 1.0 / n);
  }

  // Iterate
  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>();

    for (const node of nodeList) {
      let incomingRank = 0;

      // Sum contributions from nodes that link to this node
      for (const [source, targets] of outLinks.entries()) {
        if (targets.has(node)) {
          const outDegree = targets.size;
          incomingRank += (ranks.get(source) || 0) / outDegree;
        }
      }

      newRanks.set(node, (1 - dampingFactor) / n + dampingFactor * incomingRank);
    }

    // Update ranks
    for (const [node, rank] of newRanks) {
      ranks.set(node, rank);
    }
  }

  return ranks;
}

/**
 * Compute betweenness centrality approximation.
 * Uses BFS from sampled nodes for scalability.
 */
export async function computeBetweenness(
  sampleSize: number = 50
): Promise<Map<string, number>> {
  const edges = await graphQueries.getAllEdges();
  if (edges.length === 0) return new Map();

  // Build adjacency list (undirected)
  const adj = new Map<string, Set<string>>();
  const allNodes = new Set<string>();

  for (const edge of edges) {
    if (!edge.targetContactId) continue;
    allNodes.add(edge.sourceContactId);
    allNodes.add(edge.targetContactId);

    if (!adj.has(edge.sourceContactId)) adj.set(edge.sourceContactId, new Set());
    if (!adj.has(edge.targetContactId)) adj.set(edge.targetContactId, new Set());
    adj.get(edge.sourceContactId)!.add(edge.targetContactId);
    adj.get(edge.targetContactId)!.add(edge.sourceContactId);
  }

  const nodeList = Array.from(allNodes);
  const betweenness = new Map<string, number>();
  for (const node of nodeList) {
    betweenness.set(node, 0);
  }

  // Sample source nodes for approximation
  const sources = nodeList.slice(0, Math.min(sampleSize, nodeList.length));

  for (const s of sources) {
    // BFS from s (Brandes algorithm simplified)
    const stack: string[] = [];
    const predecessors = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    const delta = new Map<string, number>();

    for (const v of nodeList) {
      predecessors.set(v, []);
      sigma.set(v, 0);
      dist.set(v, -1);
      delta.set(v, 0);
    }

    sigma.set(s, 1);
    dist.set(s, 0);
    const queue: string[] = [s];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);

      const neighbors = adj.get(v) || new Set();
      for (const w of neighbors) {
        if (dist.get(w)! < 0) {
          queue.push(w);
          dist.set(w, dist.get(v)! + 1);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          predecessors.get(w)!.push(v);
        }
      }
    }

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of predecessors.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      }
      if (w !== s) {
        betweenness.set(w, betweenness.get(w)! + delta.get(w)!);
      }
    }
  }

  // Normalize
  const n = nodeList.length;
  if (n > 2) {
    const norm = 2.0 / ((n - 1) * (n - 2));
    for (const [node, val] of betweenness) {
      betweenness.set(node, val * norm);
    }
  }

  return betweenness;
}

/**
 * Compute all graph metrics and store them.
 */
export async function computeAllMetrics(): Promise<GraphMetrics[]> {
  const degreeCounts = await graphQueries.getDegreeCounts();
  const pageranks = await computePageRank();
  const betweenness = await computeBetweenness();

  const allNodes = new Set([
    ...degreeCounts.keys(),
    ...pageranks.keys(),
    ...betweenness.keys(),
  ]);

  const results: GraphMetrics[] = [];

  for (const contactId of allNodes) {
    const metrics = {
      pagerank: pageranks.get(contactId) ?? null,
      betweennessCentrality: betweenness.get(contactId) ?? null,
      degreeCentrality: degreeCounts.get(contactId) ?? null,
    };

    await graphQueries.upsertGraphMetrics(contactId, metrics);

    results.push({
      contactId,
      pagerank: metrics.pagerank,
      betweennessCentrality: metrics.betweennessCentrality,
      closenessCentrality: null,
      degreeCentrality: metrics.degreeCentrality,
      eigenvectorCentrality: null,
      clusteringCoefficient: null,
      computedAt: new Date().toISOString(),
    });
  }

  return results;
}
