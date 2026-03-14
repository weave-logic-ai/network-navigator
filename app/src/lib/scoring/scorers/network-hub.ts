// Network Hub Scorer - evaluates how connected a contact is in the network

import { ContactScoringData, DimensionScorer } from '../types';

export class NetworkHubScorer implements DimensionScorer {
  readonly dimension = 'network_hub';

  score(contact: ContactScoringData): number {
    let score = 0;
    let factors = 0;

    // Mutual connections (normalized: 50+ mutuals = 1.0)
    if (contact.mutualConnectionCount > 0) {
      factors++;
      score += Math.min(contact.mutualConnectionCount / 50, 1.0);
    }

    // Edge count (connections in our graph, normalized: 20+ = 1.0)
    if (contact.edgeCount > 0) {
      factors++;
      score += Math.min(contact.edgeCount / 20, 1.0);
    }

    // Total connections (normalized: 500+ = 1.0)
    if (contact.connectionsCount && contact.connectionsCount > 0) {
      factors++;
      score += Math.min(contact.connectionsCount / 500, 1.0);
    }

    // Degree centrality from graph metrics
    if (contact.degreeCentrality && contact.degreeCentrality > 0) {
      factors++;
      score += Math.min(contact.degreeCentrality / 30, 1.0);
    }

    if (factors === 0) return 0;
    return score / factors;
  }
}
