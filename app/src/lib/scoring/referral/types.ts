// Referral scoring types and configuration

import { ContactScoringData } from '../types';

export interface ReferralComponent {
  readonly name: string;
  readonly weight: number;
  score(contact: ContactScoringData, context: ReferralContext): number | null;
}

export interface ReferralContext {
  p90Mutuals: number;
  p90Edges: number;
  totalClusters: number;
  existingGoldScore: number;
  existingRelationshipStrength: number;
}

export const REFERRAL_WEIGHTS = {
  referralRole: 0.25,
  clientOverlap: 0.20,
  networkReach: 0.20,
  amplificationPower: 0.15,
  relationshipWarmth: 0.10,
  buyerInversion: 0.10,
} as const;

export const REFERRAL_TIER_THRESHOLDS = {
  'gold-referral': 0.65,
  'silver-referral': 0.45,
  'bronze-referral': 0.30,
} as const;
