// Graph Centrality Scorer - uses PageRank and betweenness from graph_metrics

import { ContactScoringData, DimensionScorer } from '../types';

/** Absolute centrality from one contact's metrics. On a star-shaped network
 * (every contact linked through the owner) PageRank is uniform and values
 * cluster near zero, so this alone does not differentiate contacts. */
export function rawGraphCentrality(contact: Pick<ContactScoringData, 'pagerank' | 'betweenness' | 'degreeCentrality'>): number {
  let score = 0;
  let factors = 0;

  // PageRank (typically 0-1 normalized)
  if (contact.pagerank != null && contact.pagerank > 0) {
    factors++;
    score += Math.min(contact.pagerank, 1.0);
  }

  // Betweenness centrality (typically 0-1 normalized)
  if (contact.betweenness != null && contact.betweenness > 0) {
    factors++;
    score += Math.min(contact.betweenness, 1.0);
  }

  // Degree centrality (number of direct connections in our graph)
  if (contact.degreeCentrality != null && contact.degreeCentrality > 0) {
    factors++;
    // Normalize: 25+ connections in graph = 1.0
    score += Math.min(contact.degreeCentrality / 25, 1.0);
  }

  if (factors === 0) return 0;
  return score / factors;
}

/** percent_rank of `raw` within the ascending network distribution:
 * the share of other contacts strictly below it, in [0, 1]. Null when the
 * network is too small to rank against. */
export function graphCentralityPercentile(raw: number, sortedDistribution: readonly number[]): number | null {
  const n = sortedDistribution.length;
  if (n < 2) return null;
  let low = 0;
  let high = n;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sortedDistribution[mid] < raw) low = mid + 1; else high = mid;
  }
  return Math.min(low / (n - 1), 1);
}

export class GraphCentralityScorer implements DimensionScorer {
  readonly dimension = 'graph_centrality';

  score(contact: ContactScoringData): number {
    // Owner scoring ranks graph position within the network (see pipeline).
    if (contact.graphCentralityPercentile != null) return contact.graphCentralityPercentile;
    return rawGraphCentrality(contact);
  }
}
