// Tests for scoring dimension scorers

import { IcpFitScorer } from '@/lib/scoring/scorers/icp-fit';
import { NetworkHubScorer } from '@/lib/scoring/scorers/network-hub';
import { RelationshipStrengthScorer } from '@/lib/scoring/scorers/relationship-strength';
import { SignalBoostScorer } from '@/lib/scoring/scorers/signal-boost';
import { SkillsRelevanceScorer } from '@/lib/scoring/scorers/skills-relevance';
import { NetworkProximityScorer } from '@/lib/scoring/scorers/network-proximity';
import { BehavioralScorer } from '@/lib/scoring/scorers/behavioral';
import { ContentRelevanceScorer } from '@/lib/scoring/scorers/content-relevance';
import { GraphCentralityScorer } from '@/lib/scoring/scorers/graph-centrality';
import { ContactScoringData, IcpCriteria } from '@/lib/scoring/types';

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

describe('IcpFitScorer', () => {
  const scorer = new IcpFitScorer();

  it('should have correct dimension name', () => {
    expect(scorer.dimension).toBe('icp_fit');
  });

  it('should return 0 with no ICP criteria', () => {
    const contact = makeContact({ title: 'CEO' });
    expect(scorer.score(contact)).toBe(0);
  });

  it('should score role match', () => {
    const contact = makeContact({ title: 'VP of Engineering' });
    const criteria: IcpCriteria = { roles: ['VP', 'Director'] };
    expect(scorer.score(contact, criteria)).toBeGreaterThan(0);
  });

  it('should score industry match', () => {
    const contact = makeContact({ companyIndustry: 'Technology' });
    const criteria: IcpCriteria = { industries: ['Technology'] };
    expect(scorer.score(contact, criteria)).toBeGreaterThan(0);
  });

  it('should score multiple criteria', () => {
    const contact = makeContact({
      title: 'VP Sales',
      companyIndustry: 'SaaS',
      location: 'San Francisco',
    });
    const criteria: IcpCriteria = {
      roles: ['VP'],
      industries: ['SaaS'],
      locations: ['San Francisco'],
    };
    const score = scorer.score(contact, criteria);
    expect(score).toBe(1.0);
  });
});

describe('NetworkHubScorer', () => {
  const scorer = new NetworkHubScorer();

  it('should return 0 for contact with no connections', () => {
    const contact = makeContact();
    expect(scorer.score(contact)).toBe(0);
  });

  it('should score high for well-connected contacts', () => {
    const contact = makeContact({
      mutualConnectionCount: 60,
      edgeCount: 25,
      connectionsCount: 600,
    });
    const score = scorer.score(contact);
    expect(score).toBeGreaterThan(0.8);
  });
});

describe('RelationshipStrengthScorer', () => {
  const scorer = new RelationshipStrengthScorer();

  it('should score higher for 1st degree contacts', () => {
    const first = makeContact({ degree: 1 });
    const second = makeContact({ degree: 2 });
    expect(scorer.score(first)).toBeGreaterThan(scorer.score(second));
  });
});

describe('SignalBoostScorer', () => {
  const scorer = new SignalBoostScorer();

  it('should return 0 for empty text', () => {
    const contact = makeContact();
    expect(scorer.score(contact)).toBe(0);
  });

  it('should detect AI/tech keywords', () => {
    const contact = makeContact({
      headline: 'Building AI-powered automation tools for enterprise SaaS',
      about: 'Passionate about machine learning and data science',
    });
    const score = scorer.score(contact);
    expect(score).toBeGreaterThan(0.5);
  });
});

describe('SkillsRelevanceScorer', () => {
  const scorer = new SkillsRelevanceScorer();

  it('should match skills against ICP signals', () => {
    const contact = makeContact({ skills: ['python', 'machine learning', 'data science'] });
    const criteria: IcpCriteria = { signals: ['machine learning', 'python'] };
    const score = scorer.score(contact, criteria);
    expect(score).toBe(1.0);
  });
});

describe('NetworkProximityScorer', () => {
  const scorer = new NetworkProximityScorer();

  it('should score 1st degree higher than 2nd', () => {
    const first = makeContact({ degree: 1 });
    const second = makeContact({ degree: 2 });
    expect(scorer.score(first)).toBeGreaterThan(scorer.score(second));
  });
});

describe('BehavioralScorer', () => {
  const scorer = new BehavioralScorer();

  it('should return 0 for no behavioral data', () => {
    const contact = makeContact();
    expect(scorer.score(contact)).toBe(0);
  });

  it('should score active contacts higher', () => {
    const contact = makeContact({
      observationCount: 15,
      contentTopics: ['AI', 'SaaS', 'Growth'],
      postingFrequency: 'weekly',
      avgEngagement: 50,
      connectionsCount: 500,
    });
    const score = scorer.score(contact);
    expect(score).toBeGreaterThan(0.5);
  });
});

describe('ContentRelevanceScorer', () => {
  const scorer = new ContentRelevanceScorer();

  it('should return 0 for no content', () => {
    const contact = makeContact();
    expect(scorer.score(contact)).toBe(0);
  });

  it('should score content alignment with ICP', () => {
    const contact = makeContact({
      contentTopics: ['AI', 'automation', 'data pipeline'],
    });
    const criteria: IcpCriteria = { signals: ['AI', 'automation'] };
    const score = scorer.score(contact, criteria);
    expect(score).toBe(1.0);
  });
});

describe('GraphCentralityScorer', () => {
  const scorer = new GraphCentralityScorer();

  it('should return 0 for no graph metrics', () => {
    const contact = makeContact();
    expect(scorer.score(contact)).toBe(0);
  });

  it('should score contacts with high centrality', () => {
    const contact = makeContact({
      pagerank: 0.8,
      betweenness: 0.6,
      degreeCentrality: 30,
    });
    const score = scorer.score(contact);
    expect(score).toBeGreaterThan(0.7);
  });
});
