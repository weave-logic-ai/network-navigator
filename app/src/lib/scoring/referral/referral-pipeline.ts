// Referral scoring pipeline - orchestrates all referral components

import {
  ContactScoringData,
  ReferralPersona,
  ReferralTier,
  ReferralDimensionScore,
  ReferralSignals,
} from '../types';
import {
  ReferralComponent,
  ReferralContext,
  REFERRAL_TIER_THRESHOLDS,
} from './types';
import { ReferralRoleScorer } from './referral-role';
import { ClientOverlapScorer } from './client-overlap';
import { NetworkReachScorer } from './network-reach';
import { AmplificationPowerScorer } from './amplification-power';
import { RelationshipWarmthScorer } from './relationship-warmth';
import { BuyerInversionScorer } from './buyer-inversion';

interface ReferralResult {
  likelihood: number;
  tier: ReferralTier | null;
  persona: ReferralPersona;
  dimensions: ReferralDimensionScore[];
  signals: ReferralSignals;
}

const ALL_COMPONENTS: ReferralComponent[] = [
  new ReferralRoleScorer(),
  new ClientOverlapScorer(),
  new NetworkReachScorer(),
  new AmplificationPowerScorer(),
  new RelationshipWarmthScorer(),
  new BuyerInversionScorer(),
];

/**
 * Compute the referral score for a contact.
 *
 * Runs all 6 referral components, handles null scores with dynamic weight
 * redistribution, assigns tier and persona, and builds signal output.
 */
export function computeReferralScore(
  contact: ContactScoringData,
  context: ReferralContext
): ReferralResult {
  // Score each component
  const rawScores = new Map<string, number | null>();
  for (const component of ALL_COMPONENTS) {
    rawScores.set(component.name, component.score(contact, context));
  }

  // Dynamic weight redistribution: components returning null get their weight
  // redistributed proportionally among components that returned a value.
  const activeComponents: Array<{ name: string; score: number; baseWeight: number }> = [];
  let nullWeightSum = 0;
  let activeWeightSum = 0;

  for (const component of ALL_COMPONENTS) {
    const score = rawScores.get(component.name);
    if (score === null || score === undefined) {
      nullWeightSum += component.weight;
    } else {
      activeComponents.push({
        name: component.name,
        score,
        baseWeight: component.weight,
      });
      activeWeightSum += component.weight;
    }
  }

  // Build dimension scores with redistributed weights
  const dimensions: ReferralDimensionScore[] = [];
  let likelihood = 0;

  for (const active of activeComponents) {
    // Redistribute null weight proportionally
    const redistributedWeight =
      activeWeightSum > 0
        ? active.baseWeight + (nullWeightSum * (active.baseWeight / activeWeightSum))
        : 0;

    const weightedValue = active.score * redistributedWeight;
    likelihood += weightedValue;

    dimensions.push({
      component: active.name,
      rawValue: active.score,
      weightedValue,
      weight: redistributedWeight,
    });
  }

  // Also include null components as zero-weight entries for visibility
  for (const component of ALL_COMPONENTS) {
    const score = rawScores.get(component.name);
    if (score === null || score === undefined) {
      dimensions.push({
        component: component.name,
        rawValue: 0,
        weightedValue: 0,
        weight: 0,
        metadata: { skipped: true },
      });
    }
  }

  // Assign tier
  const tier = assignReferralTier(likelihood);

  // Build individual component scores map for persona classification
  const scoreMap: Record<string, number> = {};
  for (const [name, score] of rawScores.entries()) {
    scoreMap[name] = score ?? 0;
  }

  // Assign persona
  const persona = classifyReferralPersona(contact, scoreMap);

  // Build signals output
  const amplificationScorer = new AmplificationPowerScorer();
  const ampDetail = amplificationScorer.scoreWithDetail(contact);

  const referralRoleScore = rawScores.get('referralRole');
  const referralRoleMatch = findReferralRoleMatch(contact);

  const signals: ReferralSignals = {
    referralRole: referralRoleScore ?? null,
    referralRoleMatch,
    clientOverlap: scoreMap.clientOverlap,
    clientOverlapIndustries: findMatchedIndustries(contact),
    networkReach: scoreMap.networkReach,
    networkReachDetail: {
      connections: contact.connectionsCount || 0,
      clusters: contact.clusterIds.length,
      edges: contact.edgeCount,
    },
    amplificationPower: scoreMap.amplificationPower,
    amplificationSignals: ampDetail.detail.matchedSignals,
    relationshipWarmth: scoreMap.relationshipWarmth,
    buyerInversion: scoreMap.buyerInversion,
  };

  return { likelihood, tier, persona, dimensions, signals };
}

function assignReferralTier(score: number): ReferralTier | null {
  if (score >= REFERRAL_TIER_THRESHOLDS['gold-referral']) return 'gold-referral';
  if (score >= REFERRAL_TIER_THRESHOLDS['silver-referral']) return 'silver-referral';
  if (score >= REFERRAL_TIER_THRESHOLDS['bronze-referral']) return 'bronze-referral';
  return null;
}

function classifyReferralPersona(
  contact: ContactScoringData,
  scores: Record<string, number>
): ReferralPersona {
  const roleScore = scores.referralRole ?? 0;
  const clientOverlap = scores.clientOverlap ?? 0;
  const warmth = scores.relationshipWarmth ?? 0;
  const reach = scores.networkReach ?? 0;
  const amp = scores.amplificationPower ?? 0;

  // White-label partner: agency/consultancy role + high role score + decent overlap
  if (hasAgencyConsultancyRole(contact) && roleScore >= 0.7 && clientOverlap >= 0.4) {
    return 'white-label-partner';
  }

  // Warm introducer: warm relationship + broad network
  if (warmth >= 0.5 && reach >= 0.5) {
    return 'warm-introducer';
  }

  // Co-seller: consultant/advisor/freelance/fractional + strong overlap
  if (hasCoSellerRole(contact) && clientOverlap >= 0.5) {
    return 'co-seller';
  }

  // Amplifier: high amplification power or matching behavioral persona
  if (
    amp >= 0.5 ||
    contact.existingBehavioralPersona === 'super-connector' ||
    contact.existingBehavioralPersona === 'content-creator'
  ) {
    return 'amplifier';
  }

  return 'passive-referral';
}

function hasAgencyConsultancyRole(contact: ContactScoringData): boolean {
  const text = [contact.title, contact.headline]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    text.includes('agency') ||
    text.includes('consultancy') ||
    text.includes('consulting firm') ||
    text.includes('digital agency')
  );
}

function hasCoSellerRole(contact: ContactScoringData): boolean {
  const text = [contact.title, contact.headline]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    text.includes('consultant') ||
    text.includes('advisor') ||
    text.includes('freelance') ||
    text.includes('fractional')
  );
}

function findReferralRoleMatch(contact: ContactScoringData): string | null {
  const fields = [contact.title, contact.headline].filter(Boolean) as string[];
  if (fields.length === 0) return null;

  // Return the first matching keyword found (most specific first)
  const allKeywords = [
    'digital agency', 'consulting firm', 'managing partner', 'founding partner',
    'fractional cto', 'fractional cmo', 'strategic advisor', 'white label',
    'channel partner', 'solutions partner', 'integration partner',
    'independent consultant', 'solutions architect', 'community manager',
    'business development', 'account executive',
    'agency', 'consultancy', 'partner', 'fractional', 'advisor',
    'reseller', 'alliance',
    'consultant', 'freelance', 'broker', 'referral',
    'ecosystem', 'partnerships', 'channel', 'alliances', 'pre-sales',
    'manager', 'director', 'head of', 'founder', 'co-founder',
    'ceo', 'cto', 'vp', 'vice president', 'lead',
  ];

  const combined = fields.join(' ').toLowerCase();
  for (const keyword of allKeywords) {
    if (combined.includes(keyword)) return keyword;
  }

  return null;
}

const INDUSTRY_KEYWORDS_FOR_SIGNALS = [
  'ecommerce', 'saas', 'software', 'professional services', 'financial services',
  'healthcare', 'consulting', 'startup', 'platform', 'digital', 'cloud',
  'data', 'analytics', 'ai', 'automation',
];

function findMatchedIndustries(contact: ContactScoringData): string[] {
  const text = [contact.title, contact.headline, contact.about, contact.companyIndustry]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return INDUSTRY_KEYWORDS_FOR_SIGNALS.filter(k => text.includes(k));
}
