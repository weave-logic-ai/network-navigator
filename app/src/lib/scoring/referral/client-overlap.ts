// Client Overlap Score - measures overlap in target markets and service signals
// Weight: 0.20

import { ContactScoringData } from '../types';
import { ReferralComponent, ReferralContext, REFERRAL_WEIGHTS } from './types';

const INDUSTRY_KEYWORDS = [
  'ecommerce',
  'saas',
  'software',
  'professional services',
  'financial services',
  'healthcare',
  'consulting',
  'startup',
  'platform',
  'digital',
  'cloud',
  'data',
  'analytics',
  'ai',
  'automation',
];

const SERVICE_PROVIDER_SIGNALS = [
  'agency',
  'consultancy',
  'consulting',
  'solutions provider',
  'implementation partner',
  'technology partner',
  'service provider',
  'managed services',
  'professional services',
  'digital services',
];

export class ClientOverlapScorer implements ReferralComponent {
  readonly name = 'clientOverlap';
  readonly weight = REFERRAL_WEIGHTS.clientOverlap;

  score(contact: ContactScoringData, _context: ReferralContext): number {
    const textFields = [
      contact.title,
      contact.headline,
      contact.about,
      contact.companyIndustry,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!textFields.trim()) return 0;

    // Count matched industries
    let industryMatches = 0;
    for (const keyword of INDUSTRY_KEYWORDS) {
      if (textFields.includes(keyword)) {
        industryMatches++;
      }
    }
    const industryScore = Math.min(industryMatches / 3, 1.0);

    // Count matched service provider signals
    let serviceMatches = 0;
    for (const signal of SERVICE_PROVIDER_SIGNALS) {
      if (textFields.includes(signal)) {
        serviceMatches++;
      }
    }
    const serviceScore = Math.min(serviceMatches / 2, 1.0);

    return industryScore * 0.6 + serviceScore * 0.4;
  }
}
