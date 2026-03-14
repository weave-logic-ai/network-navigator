// Content Relevance Scorer - evaluates topic alignment via content signals

import { ContactScoringData, DimensionScorer, IcpCriteria } from '../types';

export class ContentRelevanceScorer implements DimensionScorer {
  readonly dimension = 'content_relevance';

  score(contact: ContactScoringData, icpCriteria?: IcpCriteria): number {
    const topics = contact.contentTopics || [];

    // If no content topics at all, return baseline from about/headline
    if (topics.length === 0) {
      return this.fallbackScore(contact, icpCriteria);
    }

    if (!icpCriteria?.signals || icpCriteria.signals.length === 0) {
      // No ICP, base score for having content topics
      return Math.min(topics.length / 8, 0.5);
    }

    const topicsLower = topics.map(t => t.toLowerCase());
    const signalsLower = icpCriteria.signals.map(s => s.toLowerCase());

    let matches = 0;
    for (const signal of signalsLower) {
      if (topicsLower.some(t => t.includes(signal) || signal.includes(t))) {
        matches++;
      }
    }

    return signalsLower.length > 0 ? matches / signalsLower.length : 0;
  }

  private fallbackScore(contact: ContactScoringData, icpCriteria?: IcpCriteria): number {
    if (!icpCriteria?.signals || icpCriteria.signals.length === 0) return 0;

    const text = [contact.about, contact.headline].filter(Boolean).join(' ').toLowerCase();
    if (!text) return 0;

    let matches = 0;
    for (const signal of icpCriteria.signals) {
      if (text.includes(signal.toLowerCase())) {
        matches++;
      }
    }
    return (matches / icpCriteria.signals.length) * 0.5; // Discount fallback
  }
}
