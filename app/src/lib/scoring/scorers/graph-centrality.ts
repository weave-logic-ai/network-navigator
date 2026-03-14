// Graph Centrality Scorer - uses PageRank and betweenness from graph_metrics

import { ContactScoringData, DimensionScorer } from '../types';

export class GraphCentralityScorer implements DimensionScorer {
  readonly dimension = 'graph_centrality';

  score(contact: ContactScoringData): number {
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
}
