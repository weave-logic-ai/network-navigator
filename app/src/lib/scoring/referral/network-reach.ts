// Network Reach Score - evaluates breadth and depth of a contact's network
// Weight: 0.20

import { ContactScoringData } from '../types';
import { ReferralComponent, ReferralContext, REFERRAL_WEIGHTS } from './types';

export class NetworkReachScorer implements ReferralComponent {
  readonly name = 'networkReach';
  readonly weight = REFERRAL_WEIGHTS.networkReach;

  score(contact: ContactScoringData, context: ReferralContext): number {
    // Connection count score: normalized to 500
    const connScore = Math.min((contact.connectionsCount || 0) / 500, 1.0);

    // Cluster diversity score: how many clusters they belong to relative to total
    const clusterDenom = context.totalClusters * 0.3;
    const clusterScore =
      clusterDenom > 0
        ? Math.min(contact.clusterIds.length / clusterDenom, 1.0)
        : 0;

    // Edge score: normalized against p90 edge count
    const edgeScore =
      context.p90Edges > 0
        ? Math.min(contact.edgeCount / context.p90Edges, 1.0)
        : 0;

    return connScore * 0.30 + clusterScore * 0.40 + edgeScore * 0.30;
  }
}
