// Scoring pipeline - orchestrates scoring for single/batch contacts
// Phase 1: Core 9-dimension composite scoring
// Phase 2: Referral scoring (6 components)

import { WeightManager } from './weight-manager';
import { computeCompositeScore } from './composite';
import {
  IcpFitScorer,
  NetworkHubScorer,
  RelationshipStrengthScorer,
  SignalBoostScorer,
  SkillsRelevanceScorer,
  NetworkProximityScorer,
  BehavioralScorer,
  ContentRelevanceScorer,
  GraphCentralityScorer,
} from './scorers';
import { DimensionScorer, ScoringRunResult, IcpCriteria, ContactScoringData, CompositeScore } from './types';
import * as scoringQueries from '../db/queries/scoring';
import { checkAndGenerateTasks } from './task-triggers';
import { resolveTaxonomyChain } from '../taxonomy/service';

const behavioralScorer = new BehavioralScorer();

const ALL_SCORERS: DimensionScorer[] = [
  new IcpFitScorer(),
  new NetworkHubScorer(),
  new RelationshipStrengthScorer(),
  new SignalBoostScorer(),
  new SkillsRelevanceScorer(),
  new NetworkProximityScorer(),
  behavioralScorer,
  new ContentRelevanceScorer(),
  new GraphCentralityScorer(),
];

export async function scoreContact(
  contactId: string,
  profileName?: string
): Promise<ScoringRunResult> {
  const weightManager = new WeightManager();
  await weightManager.loadProfile(profileName);

  // Load contact scoring data
  const contact = await scoringQueries.getContactScoringData(contactId);
  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  // Determine which dimensions have data
  const availableDimensions = getAvailableDimensions(contact);
  const weights = weightManager.redistributeWeights(availableDimensions);

  // Load active ICP profiles
  const icpProfiles = await scoringQueries.getActiveIcpProfiles();
  let defaultIcpCriteria: IcpCriteria | undefined = icpProfiles[0]?.criteria;

  // Resolve taxonomy chain to enrich ICP criteria with industry/niche context
  if (icpProfiles[0]?.id) {
    try {
      const chain = await resolveTaxonomyChain(icpProfiles[0].id);
      if (chain.industry || chain.niche) {
        defaultIcpCriteria = {
          ...defaultIcpCriteria,
          ...(chain.industry ? { industries: [chain.industry.name] } : {}),
          ...(chain.niche?.keywords?.length ? { nicheKeywords: chain.niche.keywords } : {}),
        };
      }
    } catch {
      // Taxonomy resolution is non-blocking — use raw criteria
    }
  }

  // Phase 1: Compute composite score (9 dimensions)
  const score = computeCompositeScore(contact, ALL_SCORERS, weights, defaultIcpCriteria);

  // Phase 2: Compute referral scoring
  try {
    const { computeReferralScore } = await import('./referral/referral-pipeline');
    const baselines = await scoringQueries.getScoringBaselines();
    const referralContext = {
      p90Mutuals: baselines.p90Mutuals,
      p90Edges: baselines.p90Edges,
      totalClusters: baselines.totalClusters,
      existingGoldScore: score.compositeScore,
      existingRelationshipStrength:
        score.dimensions.find(d => d.dimension === 'relationship_strength')?.rawValue ?? 0,
    };

    // Attach existing behavioral persona for referral persona classification
    contact.existingGoldScore = score.compositeScore;
    contact.existingRelationshipStrength = referralContext.existingRelationshipStrength;
    contact.existingBehavioralPersona = score.behavioralPersona;

    const referral = computeReferralScore(contact, referralContext);
    score.referralLikelihood = referral.likelihood;
    score.referralTier = referral.tier;
    score.referralPersona = referral.persona;
    score.referralDimensions = referral.dimensions;
    score.referralSignals = referral.signals;
  } catch (err) {
    // Referral scoring is non-blocking — log and continue
    console.error(`[scoring] Referral scoring failed for ${contactId}:`, err);
  }

  // Extract behavioral signals from the scorer instance
  if (behavioralScorer.lastSignals) {
    score.behavioralSignals = behavioralScorer.lastSignals;
  }

  // Retrieve old score before writing (for task trigger comparison)
  let oldScore: CompositeScore | null = null;
  try {
    const oldBreakdown = await scoringQueries.getContactScoreBreakdown(contactId);
    if (oldBreakdown) {
      oldScore = {
        compositeScore: oldBreakdown.compositeScore,
        tier: oldBreakdown.tier as CompositeScore['tier'],
        persona: (oldBreakdown.persona ?? 'unknown') as CompositeScore['persona'],
        behavioralPersona: (oldBreakdown.behavioralPersona ?? 'unknown') as CompositeScore['behavioralPersona'],
        dimensions: oldBreakdown.dimensions.map(d => ({ ...d, metadata: {} })),
        scoringVersion: score.scoringVersion,
        referralLikelihood: oldBreakdown.referralLikelihood,
        referralTier: oldBreakdown.referralTier as CompositeScore['referralTier'],
        referralPersona: oldBreakdown.referralPersona as CompositeScore['referralPersona'],
        referralDimensions: null,
        behavioralSignals: null,
        referralSignals: null,
      };
    }
  } catch {
    // Non-critical — proceed without old score
  }

  // Store score
  await scoringQueries.upsertContactScore(contactId, score);

  // Generate tasks based on score transitions (fire-and-forget)
  checkAndGenerateTasks(contactId, oldScore, score).catch((err) => {
    console.error(`[scoring] Task trigger failed for ${contactId}:`, err);
  });

  // Compute ICP fits for all active profiles
  const icpFits: ScoringRunResult['icpFits'] = [];
  for (const icp of icpProfiles) {
    const icpScore = computeCompositeScore(
      contact,
      [new IcpFitScorer()],
      { icp_fit: 1.0 },
      icp.criteria
    );
    const fitScore = icpScore.compositeScore;
    const breakdown = { dimensions: icpScore.dimensions };
    await scoringQueries.upsertContactIcpFit(contactId, icp.id, fitScore, breakdown);
    icpFits.push({ icpProfileId: icp.id, fitScore, breakdown });
  }

  return { contactId, score, icpFits };
}

export async function scoreBatch(
  contactIds?: string[],
  profileName?: string
): Promise<ScoringRunResult[]> {
  const weightManager = new WeightManager();
  await weightManager.loadProfile(profileName);

  // If no IDs provided, score all non-archived contacts
  const ids = contactIds ?? await scoringQueries.getAllContactIds();
  const icpProfiles = await scoringQueries.getActiveIcpProfiles();
  const defaultIcpCriteria: IcpCriteria | undefined = icpProfiles[0]?.criteria;

  // Pre-compute baselines for referral scoring (once for the batch)
  let baselines = { p90Mutuals: 20, p90Edges: 10, totalClusters: 5 };
  try {
    baselines = await scoringQueries.getScoringBaselines();
  } catch {
    // Use defaults if baselines query fails
  }

  const results: ScoringRunResult[] = [];

  for (const contactId of ids) {
    try {
      const contact = await scoringQueries.getContactScoringData(contactId);
      if (!contact) continue;

      const availableDimensions = getAvailableDimensions(contact);
      const weights = weightManager.redistributeWeights(availableDimensions);

      // Phase 1
      const score = computeCompositeScore(contact, ALL_SCORERS, weights, defaultIcpCriteria);

      // Phase 2: Referral scoring
      try {
        const { computeReferralScore } = await import('./referral/referral-pipeline');
        contact.existingGoldScore = score.compositeScore;
        contact.existingRelationshipStrength =
          score.dimensions.find(d => d.dimension === 'relationship_strength')?.rawValue ?? 0;
        contact.existingBehavioralPersona = score.behavioralPersona;

        const referral = computeReferralScore(contact, {
          ...baselines,
          existingGoldScore: score.compositeScore,
          existingRelationshipStrength: contact.existingRelationshipStrength,
        });
        score.referralLikelihood = referral.likelihood;
        score.referralTier = referral.tier;
        score.referralPersona = referral.persona;
        score.referralDimensions = referral.dimensions;
        score.referralSignals = referral.signals;
      } catch {
        // Non-blocking
      }

      // Behavioral signals
      const behavioralDim = score.dimensions.find(d => d.dimension === 'behavioral');
      if (behavioralDim?.metadata?.behavioralSignals) {
        score.behavioralSignals = behavioralDim.metadata.behavioralSignals as typeof score.behavioralSignals;
      }

      await scoringQueries.upsertContactScore(contactId, score);

      const icpFits: ScoringRunResult['icpFits'] = [];
      for (const icp of icpProfiles) {
        const icpScore = computeCompositeScore(
          contact,
          [new IcpFitScorer()],
          { icp_fit: 1.0 },
          icp.criteria
        );
        const fitScore = icpScore.compositeScore;
        const breakdown = { dimensions: icpScore.dimensions };
        await scoringQueries.upsertContactIcpFit(contactId, icp.id, fitScore, breakdown);
        icpFits.push({ icpProfileId: icp.id, fitScore, breakdown });
      }

      results.push({ contactId, score, icpFits });
    } catch (err) {
      console.error(`[scoring] Failed to score contact ${contactId}:`, err);
    }
  }

  return results;
}

function getAvailableDimensions(contact: ContactScoringData): string[] {
  const available: string[] = [];

  // ICP fit is always available (may score 0 if no ICP)
  available.push('icp_fit');

  // Network hub: need connections or edges
  if (contact.mutualConnectionCount > 0 || contact.edgeCount > 0 || (contact.connectionsCount || 0) > 0) {
    available.push('network_hub');
  }

  // Relationship strength: always available (uses degree)
  available.push('relationship_strength');

  // Signal boost: need text data
  if (contact.headline || contact.about || contact.tags.length > 0) {
    available.push('signal_boost');
  }

  // Skills relevance: need skills or headline
  if (contact.skills.length > 0 || contact.headline || contact.title) {
    available.push('skills_relevance');
  }

  // Network proximity: always available (uses degree)
  available.push('network_proximity');

  // Behavioral: always include (enhanced scorer handles nulls internally)
  available.push('behavioral');

  // Content relevance: need content topics or about text
  if (contact.contentTopics.length > 0 || contact.about) {
    available.push('content_relevance');
  }

  // Graph centrality: need graph metrics
  if (contact.pagerank != null || contact.betweenness != null || contact.degreeCentrality != null) {
    available.push('graph_centrality');
  }

  return available;
}
