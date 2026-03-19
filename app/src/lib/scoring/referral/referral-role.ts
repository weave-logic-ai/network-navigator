// Referral Role Score - identifies contacts in referral-oriented roles
// Weight: 0.25

import { ContactScoringData } from '../types';
import { ReferralComponent, ReferralContext, REFERRAL_WEIGHTS } from './types';

const HIGH_TIER_KEYWORDS = [
  'agency',
  'digital agency',
  'consultancy',
  'consulting firm',
  'partner',
  'managing partner',
  'founding partner',
  'fractional',
  'fractional cto',
  'fractional cmo',
  'advisor',
  'strategic advisor',
  'white label',
  'reseller',
  'channel partner',
  'solutions partner',
  'alliance',
  'integration partner',
];

const MEDIUM_TIER_KEYWORDS = [
  'consultant',
  'independent consultant',
  'freelance',
  'broker',
  'referral',
  'business development',
  'community manager',
  'ecosystem',
  'partnerships',
  'channel',
  'alliances',
  'account executive',
  'solutions architect',
  'pre-sales',
];

const LOW_TIER_KEYWORDS = [
  'manager',
  'director',
  'head of',
  'founder',
  'co-founder',
  'ceo',
  'cto',
  'vp',
  'vice president',
  'lead',
];

const TIER_SCORES = {
  high: 1.0,
  medium: 0.7,
  low: 0.3,
} as const;

function matchTier(text: string): number | null {
  const lower = text.toLowerCase();

  // Check high-tier first (longest/most specific match wins)
  for (const keyword of HIGH_TIER_KEYWORDS) {
    if (lower.includes(keyword)) return TIER_SCORES.high;
  }

  for (const keyword of MEDIUM_TIER_KEYWORDS) {
    if (lower.includes(keyword)) return TIER_SCORES.medium;
  }

  for (const keyword of LOW_TIER_KEYWORDS) {
    if (lower.includes(keyword)) return TIER_SCORES.low;
  }

  return null;
}

export class ReferralRoleScorer implements ReferralComponent {
  readonly name = 'referralRole';
  readonly weight = REFERRAL_WEIGHTS.referralRole;

  score(contact: ContactScoringData, _context: ReferralContext): number | null {
    const fields = [contact.title, contact.headline].filter(Boolean) as string[];

    if (fields.length === 0) return null;

    let bestScore: number | null = null;

    for (const field of fields) {
      const tierScore = matchTier(field);
      if (tierScore !== null) {
        bestScore = bestScore === null ? tierScore : Math.max(bestScore, tierScore);
      }
    }

    return bestScore;
  }
}
