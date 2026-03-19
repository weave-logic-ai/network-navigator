// Relationship Warmth Score - evaluates existing relationship depth
// Weight: 0.10

import { ContactScoringData } from '../types';
import { ReferralComponent, ReferralContext, REFERRAL_WEIGHTS } from './types';

export class RelationshipWarmthScorer implements ReferralComponent {
  readonly name = 'relationshipWarmth';
  readonly weight = REFERRAL_WEIGHTS.relationshipWarmth;

  score(contact: ContactScoringData, context: ReferralContext): number {
    // Mutual connections normalized against p90
    const mutualScore =
      context.p90Mutuals > 0
        ? Math.min(contact.mutualConnectionCount / context.p90Mutuals, 1.0)
        : 0;

    // Existing relationship strength from Phase 1 scoring
    const relStrength = context.existingRelationshipStrength;

    // Connection recency
    const recencyScore = computeRecencyScore(contact.connectedAt);

    return mutualScore * 0.35 + relStrength * 0.35 + recencyScore * 0.30;
  }
}

function computeRecencyScore(connectedAt: string | null): number {
  if (!connectedAt) return 0.1;

  const connDate = new Date(connectedAt);
  if (isNaN(connDate.getTime())) return 0.1;

  const now = new Date();
  const diffMs = now.getTime() - connDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays <= 90) return 1.0;
  if (diffDays <= 180) return 0.7;
  if (diffDays <= 365) return 0.4;
  return 0.2;
}
