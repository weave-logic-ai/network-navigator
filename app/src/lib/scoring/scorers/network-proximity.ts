// Network Proximity Scorer - evaluates proximity in the network graph

import { ContactScoringData, DimensionScorer } from '../types';

export class NetworkProximityScorer implements DimensionScorer {
  readonly dimension = 'network_proximity';

  score(contact: ContactScoringData): number {
    let score = 0;
    let factors = 0;

    // Degree (1st = closest, 3rd = farthest)
    factors++;
    if (contact.degree === 1) {
      score += 1.0;
    } else if (contact.degree === 2) {
      score += 0.5;
    } else {
      score += 0.15;
    }

    // Shared connections (mutuals as a proxy for graph closeness)
    if (contact.mutualConnectionCount > 0) {
      factors++;
      score += Math.min(contact.mutualConnectionCount / 20, 1.0);
    }

    // Edge density in local subgraph
    if (contact.edgeCount > 0) {
      factors++;
      score += Math.min(contact.edgeCount / 15, 1.0);
    }

    if (factors === 0) return 0;
    return score / factors;
  }
}
