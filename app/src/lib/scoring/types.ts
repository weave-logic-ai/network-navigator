// Scoring engine type definitions

export interface DimensionScore {
  dimension: string;
  rawValue: number;
  weightedValue: number;
  weight: number;
  metadata?: Record<string, unknown>;
}

export interface CompositeScore {
  compositeScore: number;
  tier: Tier;
  persona: Persona;
  behavioralPersona: BehavioralPersona;
  dimensions: DimensionScore[];
  scoringVersion: number;
  // Referral scoring (Phase 3)
  referralLikelihood: number | null;
  referralTier: ReferralTier | null;
  referralPersona: ReferralPersona | null;
  referralDimensions: ReferralDimensionScore[] | null;
  // Enhanced behavioral signals
  behavioralSignals: BehavioralSignals | null;
  referralSignals: ReferralSignals | null;
}

export type Tier = 'gold' | 'silver' | 'bronze' | 'watch' | 'unscored';

export type ReferralTier = 'gold-referral' | 'silver-referral' | 'bronze-referral' | 'watch-referral';

export type Persona =
  | 'buyer'
  | 'warm-lead'
  | 'advisor'
  | 'hub'
  | 'active-influencer'
  | 'passive-contact'
  | 'unknown';

export type BehavioralPersona =
  | 'super-connector'
  | 'content-creator'
  | 'silent-influencer'
  | 'engaged-professional'
  | 'passive-observer'
  | 'rising-connector'
  | 'data-insufficient'
  | 'unknown';

export type ReferralPersona =
  | 'white-label-partner'
  | 'warm-introducer'
  | 'co-seller'
  | 'amplifier'
  | 'passive-referral';

export interface BehavioralSignals {
  connectionCount: number | null;
  connectionPower: number | null;
  connectionRecency: number | null;
  connectedDaysAgo: number | null;
  aboutSignals: string[];
  headlineSignals: string[];
  superConnectorTraits: string[];
  traitCount: number;
  amplification: number | null;
  availableComponents: number;
  totalComponents: number;
}

export interface ReferralSignals {
  referralRole: number | null;
  referralRoleMatch: string | null;
  clientOverlap: number;
  clientOverlapIndustries: string[];
  networkReach: number;
  networkReachDetail: {
    connections: number;
    clusters: number;
    edges: number;
  };
  amplificationPower: number;
  amplificationSignals: string[];
  relationshipWarmth: number;
  buyerInversion: number;
}

export interface ReferralDimensionScore {
  component: string;
  rawValue: number;
  weightedValue: number;
  weight: number;
  metadata?: Record<string, unknown>;
}

export interface WeightProfile {
  id: string;
  name: string;
  description: string | null;
  weights: Record<string, number>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TierThreshold {
  tier: Tier;
  minScore: number;
  maxScore: number | null;
  degree: number | null;
}

export interface ContactScoringData {
  id: string;
  degree: number;
  title: string | null;
  headline: string | null;
  about: string | null;
  currentCompany: string | null;
  connectionsCount: number | null;
  tags: string[];
  location: string | null;
  // Joined data
  companyIndustry: string | null;
  companySizeRange: string | null;
  // Edges
  mutualConnectionCount: number;
  edgeCount: number;
  // Skills from tags or headline
  skills: string[];
  // Graph metrics
  pagerank: number | null;
  betweenness: number | null;
  degreeCentrality: number | null;
  // Behavioral
  observationCount: number;
  contentTopics: string[];
  postingFrequency: string | null;
  avgEngagement: number | null;
  // Enhanced behavioral (v2 parity)
  connectedAt: string | null;
  connectionCountRaw: string | null; // e.g. "500+ connections" or "277 connections"
  // Referral context
  discoveredVia: string[];
  clusterIds: string[];
  // Existing scores (for referral phase which depends on Phase 1 results)
  existingGoldScore?: number;
  existingRelationshipStrength?: number;
  existingBehavioralPersona?: BehavioralPersona;
}

export interface IcpCriteria {
  roles?: string[];
  industries?: string[];
  signals?: string[];
  companySizeRanges?: string[];
  locations?: string[];
  minConnections?: number;
  nicheKeywords?: string[];
}

export interface IcpProfile {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  criteria: IcpCriteria;
  weightOverrides: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface DimensionScorer {
  readonly dimension: string;
  score(contact: ContactScoringData, icpCriteria?: IcpCriteria): number;
}

export interface ScoringRunResult {
  contactId: string;
  score: CompositeScore;
  icpFits: Array<{ icpProfileId: string; fitScore: number; breakdown: Record<string, unknown> }>;
}

export interface ScoringRunStatus {
  id: string;
  runType: 'single' | 'batch' | 'rescore-all';
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalContacts: number;
  scoredContacts: number;
  failedContacts: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}
