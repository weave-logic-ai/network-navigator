// Buyer Inversion Score - identifies contacts who are poor ICP fits but strong referral partners
// Weight: 0.10

import { ContactScoringData } from '../types';
import { ReferralComponent, ReferralContext, REFERRAL_WEIGHTS } from './types';

const ECOSYSTEM_KEYWORDS = [
  'ecosystem',
  'partner',
  'community',
  'network',
  'alliance',
  'integration',
  'marketplace',
  'channel',
  'reseller',
  'agency',
  'consultancy',
  'service provider',
  'implementation',
];

export class BuyerInversionScorer implements ReferralComponent {
  readonly name = 'buyerInversion';
  readonly weight = REFERRAL_WEIGHTS.buyerInversion;

  score(contact: ContactScoringData, context: ReferralContext): number {
    // Inverted ICP: low ICP fit = high referral potential
    const invertedIcp = 1.0 - context.existingGoldScore;

    // Ecosystem keyword matching
    const allText = [
      contact.title,
      contact.headline,
      contact.about,
      contact.companyIndustry,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let matchCount = 0;
    for (const keyword of ECOSYSTEM_KEYWORDS) {
      if (allText.includes(keyword)) {
        matchCount++;
      }
    }
    const ecosystemScore = Math.min(matchCount / 3, 1.0);

    return invertedIcp * 0.5 + ecosystemScore * 0.5;
  }
}
