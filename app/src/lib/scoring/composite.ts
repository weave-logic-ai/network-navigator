// Composite score calculator - combines dimension scores into final score

import {
  CompositeScore,
  ContactScoringData,
  DimensionScore,
  DimensionScorer,
  IcpCriteria,
  Tier,
  Persona,
  BehavioralPersona,
} from './types';

const DEFAULT_TIER_THRESHOLDS = {
  gold: 0.55,
  silver: 0.40,
  bronze: 0.28,
};

export function computeCompositeScore(
  contact: ContactScoringData,
  scorers: DimensionScorer[],
  weights: Record<string, number>,
  icpCriteria?: IcpCriteria,
  scoringVersion: number = 1
): CompositeScore {
  const dimensions: DimensionScore[] = [];

  for (const scorer of scorers) {
    const rawValue = scorer.score(contact, icpCriteria);
    const weight = weights[scorer.dimension] || 0;
    const weightedValue = rawValue * weight;

    dimensions.push({
      dimension: scorer.dimension,
      rawValue,
      weightedValue,
      weight,
    });
  }

  const compositeScore = dimensions.reduce((sum, d) => sum + d.weightedValue, 0);
  const tier = assignTier(compositeScore, contact.degree);
  const persona = classifyPersona(contact, dimensions);
  const behavioralPersona = classifyBehavioralPersona(contact, dimensions);

  return {
    compositeScore,
    tier,
    persona,
    behavioralPersona,
    dimensions,
    scoringVersion,
  };
}

function assignTier(score: number, degree: number): Tier {
  // Higher bar for 2nd+ degree
  const multiplier = degree === 1 ? 1.0 : 0.85;
  const adjusted = score * multiplier;

  if (adjusted >= DEFAULT_TIER_THRESHOLDS.gold) return 'gold';
  if (adjusted >= DEFAULT_TIER_THRESHOLDS.silver) return 'silver';
  if (adjusted >= DEFAULT_TIER_THRESHOLDS.bronze) return 'bronze';
  return 'watch';
}

function classifyPersona(
  contact: ContactScoringData,
  dimensions: DimensionScore[]
): Persona {
  const dimMap = new Map(dimensions.map(d => [d.dimension, d.rawValue]));

  const icpFit = dimMap.get('icp_fit') || 0;
  const networkHub = dimMap.get('network_hub') || 0;
  const relationship = dimMap.get('relationship_strength') || 0;
  const behavioral = dimMap.get('behavioral') || 0;

  // Buyer: high ICP fit + relationship
  if (icpFit > 0.6 && relationship > 0.4) return 'buyer';

  // Warm lead: decent ICP + some relationship
  if (icpFit > 0.4 && relationship > 0.3) return 'warm-lead';

  // Active influencer: high behavioral + content
  if (behavioral > 0.6 && (dimMap.get('content_relevance') || 0) > 0.4) return 'active-influencer';

  // Hub: strong network position
  if (networkHub > 0.6) return 'hub';

  // Advisor: high relationship + moderate ICP
  if (relationship > 0.6 && icpFit > 0.2) return 'advisor';

  // Passive contact
  if (contact.degree <= 2) return 'passive-contact';

  return 'unknown';
}

function classifyBehavioralPersona(
  contact: ContactScoringData,
  dimensions: DimensionScore[]
): BehavioralPersona {
  const dimMap = new Map(dimensions.map(d => [d.dimension, d.rawValue]));

  const networkHub = dimMap.get('network_hub') || 0;
  const behavioral = dimMap.get('behavioral') || 0;
  const contentRelevance = dimMap.get('content_relevance') || 0;

  // Super connector: very high network hub
  if (networkHub > 0.7 && (contact.connectionsCount || 0) > 500) return 'super-connector';

  // Content creator: high content + behavioral
  if (contentRelevance > 0.5 && behavioral > 0.5) return 'content-creator';

  // Silent influencer: high centrality but low behavioral
  if ((dimMap.get('graph_centrality') || 0) > 0.5 && behavioral < 0.3) return 'silent-influencer';

  // Engaged professional: moderate behavioral
  if (behavioral > 0.3) return 'engaged-professional';

  return 'passive-observer';
}
