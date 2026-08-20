// Graph metrics computation — RuVector native with Node.js fallback

import * as graphQueries from "../db/queries/graph";
import {
  syncContactsGraph,
  computeRuVectorPageRank,
  computeRuVectorCentrality,
  ensureEdgeIndex,
} from "./ruvector-sync";
import { GraphMetrics } from "./types";

/**
 * Compute all graph metrics using RuVector native graph engine.
 * Falls back to Node.js computation if RuVector sync fails.
 */
export async function computeAllMetrics(): Promise<GraphMetrics[]> {
  try {
    return await computeAllMetricsRuVector();
  } catch (error) {
    console.warn(
      `[graph/metrics] RuVector computation failed; falling back to the Node.js ` +
        `implementation (in-memory PageRank + 50-sample betweenness approximation ` +
        `instead of RuVector's in-DB native computation). Results are still stored ` +
        `in graph_metrics, but which engine served this run is only visible here: ` +
        (error instanceof Error ? error.message : String(error))
    );
    return await computeAllMetricsNodeJS();
  }
}

/**
 * RuVector-based computation: sync graph, then run native PageRank + centrality.
 * Runs in-DB — dramatically faster than Node.js for large graphs.
 */
async function computeAllMetricsRuVector(): Promise<GraphMetrics[]> {
  // Ensure index for edge queries
  await ensureEdgeIndex();

  // Sync contacts graph (excludes synthetic edges)
  const nodeIdMap = await syncContactsGraph();

  // Run RuVector native computations
  await computeRuVectorPageRank(nodeIdMap);
  await computeRuVectorCentrality("betweenness", nodeIdMap);
  await computeRuVectorCentrality("degree", nodeIdMap);

  // Read back results from graph_metrics
  const metricsResult = await graphQueries.listGraphMetrics(1, 10000);
  return metricsResult.data;
}

// ---- Node.js fallback (original implementation) ----

/**
 * Compute PageRank approximation using iterative power iteration in Node.js.
 */
export async function computePageRank(
  dampingFactor: number = 0.85,
  iterations: number = 20
): Promise<Map<string, number>> {
  const edges = await graphQueries.getAllEdges();
  if (edges.length === 0) return new Map();

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

  for (const node of nodeList) {
    ranks.set(node, 1.0 / n);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>();

    for (const node of nodeList) {
      let incomingRank = 0;

      for (const [source, targets] of outLinks.entries()) {
        if (targets.has(node)) {
          const outDegree = targets.size;
          incomingRank += (ranks.get(source) || 0) / outDegree;
        }
      }

      newRanks.set(
        node,
        (1 - dampingFactor) / n + dampingFactor * incomingRank
      );
    }

    for (const [node, rank] of newRanks) {
      ranks.set(node, rank);
    }
  }

  return ranks;
}

/**
 * Compute betweenness centrality approximation (Node.js fallback).
 */
export async function computeBetweenness(
  sampleSize: number = 50
): Promise<Map<string, number>> {
  const edges = await graphQueries.getAllEdges();
  if (edges.length === 0) return new Map();

  const adj = new Map<string, Set<string>>();
  const allNodes = new Set<string>();

  for (const edge of edges) {
    if (!edge.targetContactId) continue;
    allNodes.add(edge.sourceContactId);
    allNodes.add(edge.targetContactId);

    if (!adj.has(edge.sourceContactId))
      adj.set(edge.sourceContactId, new Set());
    if (!adj.has(edge.targetContactId))
      adj.set(edge.targetContactId, new Set());
    adj.get(edge.sourceContactId)!.add(edge.targetContactId);
    adj.get(edge.targetContactId)!.add(edge.sourceContactId);
  }

  const nodeList = Array.from(allNodes);
  const betweenness = new Map<string, number>();
  for (const node of nodeList) {
    betweenness.set(node, 0);
  }

  const sources = nodeList.slice(0, Math.min(sampleSize, nodeList.length));

  for (const s of sources) {
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
        delta.set(
          v,
          delta.get(v)! +
            (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!)
        );
      }
      if (w !== s) {
        betweenness.set(w, betweenness.get(w)! + delta.get(w)!);
      }
    }
  }

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
 * Node.js fallback: compute all metrics and store them.
 */
async function computeAllMetricsNodeJS(): Promise<GraphMetrics[]> {
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
