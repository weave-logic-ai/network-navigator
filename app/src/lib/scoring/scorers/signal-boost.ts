// Signal Boost Scorer - detects AI/automation/tech keywords in text fields

import { ContactScoringData, DimensionScorer } from '../types';

const SIGNAL_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning',
  'automation', 'saas', 'cloud', 'devops', 'data science',
  'analytics', 'digital transformation', 'growth', 'scale',
  'startup', 'venture', 'innovation', 'product-led',
  'revenue', 'pipeline', 'b2b', 'enterprise',
  'generative ai', 'llm', 'gpt', 'copilot',
];

export class SignalBoostScorer implements DimensionScorer {
  readonly dimension = 'signal_boost';

  score(contact: ContactScoringData): number {
    const text = [
      contact.headline,
      contact.title,
      contact.about,
      ...(contact.tags || []),
      ...(contact.contentTopics || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!text) return 0;

    let matchCount = 0;
    for (const keyword of SIGNAL_KEYWORDS) {
      if (text.includes(keyword)) {
        matchCount++;
      }
    }

    // Normalize: 5+ keyword matches = 1.0
    return Math.min(matchCount / 5, 1.0);
  }
}
