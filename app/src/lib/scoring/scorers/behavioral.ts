// Behavioral Scorer - evaluates connection power, content signals, activity patterns

import { ContactScoringData, DimensionScorer } from '../types';

export class BehavioralScorer implements DimensionScorer {
  readonly dimension = 'behavioral';

  score(contact: ContactScoringData): number {
    let score = 0;
    let factors = 0;

    // Observation count (behavioral signals captured)
    if (contact.observationCount > 0) {
      factors++;
      score += Math.min(contact.observationCount / 10, 1.0);
    }

    // Content topics (active content creator signal)
    if (contact.contentTopics && contact.contentTopics.length > 0) {
      factors++;
      score += Math.min(contact.contentTopics.length / 5, 1.0);
    }

    // Posting frequency
    if (contact.postingFrequency) {
      factors++;
      const freqMap: Record<string, number> = {
        daily: 1.0,
        weekly: 0.7,
        biweekly: 0.5,
        monthly: 0.3,
        rarely: 0.1,
      };
      score += freqMap[contact.postingFrequency] || 0.2;
    }

    // Average engagement
    if (contact.avgEngagement != null && contact.avgEngagement > 0) {
      factors++;
      // Normalize: 100+ avg engagement = 1.0
      score += Math.min(contact.avgEngagement / 100, 1.0);
    }

    // Connection power (connections count as a proxy)
    if (contact.connectionsCount && contact.connectionsCount > 0) {
      factors++;
      score += Math.min(contact.connectionsCount / 1000, 1.0);
    }

    if (factors === 0) return 0;
    return score / factors;
  }
}
