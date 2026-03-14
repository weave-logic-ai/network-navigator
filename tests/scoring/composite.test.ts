// Tests for composite score computation

import { computeCompositeScore } from '@/lib/scoring/composite';
import { ContactScoringData, DimensionScorer, IcpCriteria } from '@/lib/scoring/types';
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
} from '@/lib/scoring/scorers';

function makeContact(overrides: Partial<ContactScoringData> = {}): ContactScoringData {
  return {
    id: 'test-id',
    degree: 1,
    title: null,
    headline: null,
    about: null,
    currentCompany: null,
    connectionsCount: null,
    tags: [],
    location: null,
    companyIndustry: null,
    companySizeRange: null,
    mutualConnectionCount: 0,
    edgeCount: 0,
    skills: [],
    pagerank: null,
    betweenness: null,
    degreeCentrality: null,
    observationCount: 0,
    contentTopics: [],
    postingFrequency: null,
    avgEngagement: null,
    ...overrides,
  };
}

describe('computeCompositeScore', () => {
  const allScorers: DimensionScorer[] = [
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

  const defaultWeights: Record<string, number> = {
    icp_fit: 0.20,
    network_hub: 0.10,
    relationship_strength: 0.15,
    signal_boost: 0.10,
    skills_relevance: 0.10,
    network_proximity: 0.05,
    behavioral: 0.10,
    content_relevance: 0.10,
    graph_centrality: 0.10,
  };

  it('should return composite score between 0 and 1', () => {
    const contact = makeContact({
      title: 'CEO',
      headline: 'AI startup founder',
      connectionsCount: 500,
      mutualConnectionCount: 20,
      edgeCount: 10,
    });

    const result = computeCompositeScore(contact, allScorers, defaultWeights);
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(1);
  });

  it('should assign tiers correctly', () => {
    // Minimal contact should be watch tier
    const minimal = makeContact();
    const minResult = computeCompositeScore(minimal, allScorers, defaultWeights);
    expect(['watch', 'unscored']).toContain(minResult.tier);

    // Well-scored contact should be gold tier
    const strong = makeContact({
      title: 'VP Sales',
      headline: 'Building AI-powered SaaS for enterprise automation',
      about: 'Machine learning expert with deep learning background in data science analytics',
      connectionsCount: 800,
      mutualConnectionCount: 60,
      edgeCount: 30,
      companyIndustry: 'Technology',
      pagerank: 0.9,
      betweenness: 0.7,
      degreeCentrality: 35,
      observationCount: 20,
      contentTopics: ['AI', 'SaaS', 'Growth'],
      postingFrequency: 'daily',
      avgEngagement: 120,
      skills: ['AI', 'machine learning'],
    });

    const icpCriteria: IcpCriteria = {
      roles: ['VP'],
      industries: ['Technology'],
      signals: ['AI', 'SaaS'],
    };

    const strongResult = computeCompositeScore(strong, allScorers, defaultWeights, icpCriteria);
    expect(strongResult.tier).toBe('gold');
  });

  it('should include all 9 dimensions in output', () => {
    const contact = makeContact();
    const result = computeCompositeScore(contact, allScorers, defaultWeights);
    expect(result.dimensions).toHaveLength(9);
  });

  it('should classify personas', () => {
    const contact = makeContact({
      title: 'VP Sales',
      connectionsCount: 300,
      mutualConnectionCount: 40,
      edgeCount: 15,
    });

    const criteria: IcpCriteria = {
      roles: ['VP'],
      industries: ['Technology'],
    };

    const result = computeCompositeScore(contact, allScorers, defaultWeights, criteria);
    expect(result.persona).toBeDefined();
    expect(result.behavioralPersona).toBeDefined();
  });

  it('should apply weights correctly', () => {
    const contact = makeContact({
      title: 'CEO',
      connectionsCount: 100,
    });

    const zeroWeights: Record<string, number> = {
      icp_fit: 0, network_hub: 0, relationship_strength: 0,
      signal_boost: 0, skills_relevance: 0, network_proximity: 0,
      behavioral: 0, content_relevance: 0, graph_centrality: 0,
    };

    const result = computeCompositeScore(contact, allScorers, zeroWeights);
    expect(result.compositeScore).toBe(0);
  });
});
