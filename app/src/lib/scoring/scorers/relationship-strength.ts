// Relationship Strength Scorer - evaluates the strength of existing relationship

import { ContactScoringData, DimensionScorer } from '../types';

export class RelationshipStrengthScorer implements DimensionScorer {
  readonly dimension = 'relationship_strength';

  score(contact: ContactScoringData): number {
    let score = 0;
    let factors = 0;

    // Degree-based base score (1st degree = stronger relationship)
    factors++;
    if (contact.degree === 1) {
      score += 1.0;
    } else if (contact.degree === 2) {
      score += 0.5;
    } else {
      score += 0.2;
    }

    // Mutual connections boost (more mutuals = stronger tie)
    if (contact.mutualConnectionCount > 0) {
      factors++;
      score += Math.min(contact.mutualConnectionCount / 30, 1.0);
    }

    // Has contact info (email/phone indicates real relationship)
    factors++;
    let contactInfoScore = 0;
    if (contact.tags.length > 0) contactInfoScore += 0.3;
    if (contact.about) contactInfoScore += 0.2;
    if (contact.connectionsCount && contact.connectionsCount > 100) contactInfoScore += 0.3;
    if (contact.location) contactInfoScore += 0.2;
    score += Math.min(contactInfoScore, 1.0);

    if (factors === 0) return 0;
    return score / factors;
  }
}
