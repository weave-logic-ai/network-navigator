// Scoring pipeline - orchestrates scoring for single/batch contacts

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
import { DimensionScorer, ScoringRunResult, IcpCriteria } from './types';
import * as scoringQueries from '../db/queries/scoring';

const ALL_SCORERS: DimensionScorer[] = [
  new IcpFitScorer(),
  new NetworkHubScorer(),
  new RelationshipStrengthScorer(),
  new SignalBoostScorer(),
  new SkillsRelevanceScorer(),
  new NetworkProximityScorer(),
  new BehavioralScorer(),
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
  const defaultIcpCriteria: IcpCriteria | undefined = icpProfiles[0]?.criteria;

  // Compute composite score
  const score = computeCompositeScore(contact, ALL_SCORERS, weights, defaultIcpCriteria);

  // Store score
  await scoringQueries.upsertContactScore(contactId, score);

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

  const results: ScoringRunResult[] = [];

  for (const contactId of ids) {
    const contact = await scoringQueries.getContactScoringData(contactId);
    if (!contact) continue;

    const availableDimensions = getAvailableDimensions(contact);
    const weights = weightManager.redistributeWeights(availableDimensions);

    const score = computeCompositeScore(contact, ALL_SCORERS, weights, defaultIcpCriteria);
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
  }

  return results;
}

function getAvailableDimensions(contact: import('./types').ContactScoringData): string[] {
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

  // Behavioral: need observations or content
  if (contact.observationCount > 0 || contact.contentTopics.length > 0 || contact.postingFrequency) {
    available.push('behavioral');
  }

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
