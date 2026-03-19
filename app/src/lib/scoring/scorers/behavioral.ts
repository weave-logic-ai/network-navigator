// Behavioral Scorer v2 — 6 weighted components with dynamic weight redistribution
//
// Components:
//   1. Connection Power    (0.20) — raw connection count tier
//   2. Connection Recency  (0.15) — how recently connected
//   3. About Signals       (0.25) — keyword categories in "about" text
//   4. Headline Signals    (0.15) — pattern matching on headline
//   5. Super Connector     (0.15) — composite trait index
//   6. Network Amplifier   (0.10) — mutual connections × connection power

import { BehavioralSignals, ContactScoringData, DimensionScorer } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPONENT_WEIGHTS: Record<string, number> = {
  connectionPower: 0.20,
  connectionRecency: 0.15,
  aboutSignals: 0.25,
  headlineSignals: 0.15,
  superConnector: 0.15,
  networkAmplifier: 0.10,
};

const ABOUT_CATEGORIES: Record<string, string[]> = {
  connector: ['connector', 'connecting', 'introductions', 'bridge', 'matchmaker'],
  speaker: ['speaker', 'keynote', 'panelist', 'conference', 'podcast'],
  mentor: ['mentor', 'mentoring', 'coach', 'advise', 'guide'],
  builder: ['builder', 'founded', 'launched', 'built'],
  helper: ['helping', 'empower', 'enable', 'support teams'],
  'thought-leader': ['author', 'writer', 'published', 'thought leader'],
  community: ['community', 'ecosystem', 'network', 'board member'],
  teacher: ['teacher', 'instructor', 'professor', 'educator', 'trainer'],
};

const HEADLINE_PATTERNS: Record<string, { test: (h: string) => boolean; score: number }> = {
  'multi-role': {
    test: (h) => h.includes('|'),
    score: 0.7,
  },
  'helping-language': {
    test: (h) => /\b(helping|empowering|enabling|serving|passionate)\b/i.test(h),
    score: 0.6,
  },
  credentials: {
    test: (h) => /\b(mba|phd|pmp|cpa|certified)\b/i.test(h),
    score: 0.4,
  },
  'creator-mode': {
    test: (h) => /\b(creator|influencer|content|writer|author)\b/i.test(h),
    score: 0.8,
  },
};

const TOTAL_COMPONENTS = 6;

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

export class BehavioralScorer implements DimensionScorer {
  readonly dimension = 'behavioral';

  /** Signals produced by the most recent score() call. */
  lastSignals: BehavioralSignals | null = null;

  score(contact: ContactScoringData): number {
    // Compute each component — null means "no data available"
    const connectionPower = this.connectionPowerScore(contact);
    const connectionRecency = this.connectionRecencyScore(contact);
    const aboutResult = this.aboutSignalsScore(contact);
    const headlineResult = this.headlineSignalsScore(contact);
    const superResult = this.superConnectorScore(
      aboutResult.matchedCategories,
      headlineResult.matchedPatterns,
      connectionPower,
      contact
    );
    const amplification = this.networkAmplifierScore(contact, connectionPower);

    // Build component map with nullable scores
    const components: Record<string, number | null> = {
      connectionPower: connectionPower,
      connectionRecency: connectionRecency,
      aboutSignals: aboutResult.score,
      headlineSignals: headlineResult.score,
      superConnector: superResult.score,
      networkAmplifier: amplification,
    };

    // Dynamic weight redistribution: exclude null components, scale remaining
    const active: Array<{ key: string; value: number }> = [];
    for (const [key, value] of Object.entries(components)) {
      if (value !== null) {
        active.push({ key, value });
      }
    }

    let weightedScore = 0;

    if (active.length > 0) {
      const totalActiveWeight = active.reduce(
        (sum, c) => sum + (COMPONENT_WEIGHTS[c.key] || 0),
        0
      );

      if (totalActiveWeight > 0) {
        for (const c of active) {
          const baseWeight = COMPONENT_WEIGHTS[c.key] || 0;
          const redistributedWeight = baseWeight / totalActiveWeight;
          weightedScore += c.value * redistributedWeight;
        }
      }
    }

    // Clamp to [0, 1]
    const finalScore = Math.max(0, Math.min(1, weightedScore));

    // Parse connection count for signals
    const parsedCount = this.parseConnectionCount(contact);

    // Attach behavioral signals to instance for downstream consumers
    this.lastSignals = {
      connectionCount: parsedCount,
      connectionPower: connectionPower,
      connectionRecency: connectionRecency,
      connectedDaysAgo: this.computeDaysAgo(contact.connectedAt),
      aboutSignals: aboutResult.matchedCategories,
      headlineSignals: headlineResult.matchedPatterns,
      superConnectorTraits: superResult.traits,
      traitCount: superResult.traitCount,
      amplification: amplification,
      availableComponents: active.length,
      totalComponents: TOTAL_COMPONENTS,
    };

    return finalScore;
  }

  // -------------------------------------------------------------------------
  // Component 1: Connection Power (weight 0.20)
  // -------------------------------------------------------------------------

  private connectionPowerScore(contact: ContactScoringData): number | null {
    const count = this.parseConnectionCount(contact);
    if (count === null) return null;

    let score: number;
    if (count >= 500) score = 1.0;
    else if (count >= 300) score = 0.7;
    else if (count >= 100) score = 0.4;
    else score = 0.1;

    // Creator mode penalty: if raw string mentions "followers", the count
    // reflects followers rather than mutual connections — scale down.
    const raw = (contact.connectionCountRaw || '').toLowerCase();
    if (raw.includes('followers')) {
      score *= 0.8;
    }

    return score;
  }

  // -------------------------------------------------------------------------
  // Component 2: Connection Recency (weight 0.15)
  // -------------------------------------------------------------------------

  private connectionRecencyScore(contact: ContactScoringData): number | null {
    const daysAgo = this.computeDaysAgo(contact.connectedAt);
    if (daysAgo === null) return null;

    if (daysAgo <= 30) return 1.0;
    if (daysAgo <= 90) return 0.7;
    if (daysAgo <= 180) return 0.4;
    if (daysAgo <= 365) return 0.2;
    return 0.1;
  }

  // -------------------------------------------------------------------------
  // Component 3: About Signals (weight 0.25)
  // -------------------------------------------------------------------------

  private aboutSignalsScore(
    contact: ContactScoringData
  ): { score: number | null; matchedCategories: string[] } {
    if (!contact.about) return { score: null, matchedCategories: [] };

    const aboutLower = contact.about.toLowerCase();
    const matchedCategories: string[] = [];

    for (const [category, keywords] of Object.entries(ABOUT_CATEGORIES)) {
      const found = keywords.some((kw) => aboutLower.includes(kw));
      if (found) {
        matchedCategories.push(category);
      }
    }

    const totalCategories = Object.keys(ABOUT_CATEGORIES).length;
    // Score formula: matched / (total × 0.4) — matching ~40% of categories = 1.0
    const rawScore = matchedCategories.length / (totalCategories * 0.4);
    const score = Math.min(rawScore, 1.0);

    return { score, matchedCategories };
  }

  // -------------------------------------------------------------------------
  // Component 4: Headline Signals (weight 0.15)
  // -------------------------------------------------------------------------

  private headlineSignalsScore(
    contact: ContactScoringData
  ): { score: number | null; matchedPatterns: string[] } {
    if (!contact.headline) return { score: null, matchedPatterns: [] };

    const headline = contact.headline;
    const matchedPatterns: string[] = [];
    const matchedScores: number[] = [];

    for (const [name, pattern] of Object.entries(HEADLINE_PATTERNS)) {
      if (pattern.test(headline)) {
        matchedPatterns.push(name);
        matchedScores.push(pattern.score);
      }
    }

    if (matchedPatterns.length === 0) {
      return { score: 0, matchedPatterns: [] };
    }

    let score: number;
    if (matchedPatterns.length === 1) {
      score = matchedScores[0];
    } else {
      const maxScore = Math.max(...matchedScores);
      const avgScore =
        matchedScores.reduce((s, v) => s + v, 0) / matchedScores.length;
      score = maxScore * 0.6 + avgScore * 0.4;
    }

    return { score: Math.min(score, 1.0), matchedPatterns };
  }

  // -------------------------------------------------------------------------
  // Component 5: Super Connector Index (weight 0.15)
  // -------------------------------------------------------------------------

  private superConnectorScore(
    aboutCategories: string[],
    headlinePatterns: string[],
    connectionPower: number | null,
    contact: ContactScoringData
  ): { score: number | null; traits: string[]; traitCount: number } {
    const traits: string[] = [];

    // Trait: each matched about category
    for (const cat of aboutCategories) {
      traits.push(`about:${cat}`);
    }

    // Trait: each matched headline pattern
    for (const pat of headlinePatterns) {
      traits.push(`headline:${pat}`);
    }

    // Trait: 500+ connections
    const count = this.parseConnectionCount(contact);
    if (count !== null && count >= 500) {
      traits.push('connections:500+');
    }

    const traitCount = traits.length;

    // If no traits at all, score is null (no signal)
    if (traitCount === 0 && connectionPower === null) {
      return { score: null, traits, traitCount };
    }

    const minTraits = 3;
    const score = Math.min(traitCount / (minTraits + 2), 1.0);

    return { score, traits, traitCount };
  }

  // -------------------------------------------------------------------------
  // Component 6: Network Amplifier (weight 0.10)
  // -------------------------------------------------------------------------

  private networkAmplifierScore(
    contact: ContactScoringData,
    connectionPower: number | null
  ): number | null {
    if (connectionPower === null) return null;

    const mutualsNormalized = Math.min(contact.mutualConnectionCount / 50, 1.0);
    const amplification = mutualsNormalized * connectionPower;

    return Math.min(amplification, 1.0);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private parseConnectionCount(contact: ContactScoringData): number | null {
    // Prefer the parsed numeric field
    if (contact.connectionsCount != null && contact.connectionsCount > 0) {
      return contact.connectionsCount;
    }

    // Fall back to parsing the raw string (e.g. "500+ connections")
    if (contact.connectionCountRaw) {
      const match = contact.connectionCountRaw.match(/(\d[\d,]*)/);
      if (match) {
        return parseInt(match[1].replace(/,/g, ''), 10);
      }
    }

    return null;
  }

  private computeDaysAgo(dateStr: string | null): number | null {
    if (!dateStr) return null;

    const connected = new Date(dateStr);
    if (isNaN(connected.getTime())) return null;

    const now = new Date();
    const diffMs = now.getTime() - connected.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}
