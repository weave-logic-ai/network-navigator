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
}

export type Tier = 'gold' | 'silver' | 'bronze' | 'watch' | 'unscored';

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
  | 'unknown';

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
}

export interface IcpCriteria {
  roles?: string[];
  industries?: string[];
  signals?: string[];
  companySizeRanges?: string[];
  locations?: string[];
  minConnections?: number;
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
