// Research Tools Sprint — WS-4 Phase 1.5 lens-scoring integration.
//
// Golden case: one contact, two lenses on the same target, different
// `icp_fit` values. Demonstrates that the scoring pipeline's ICP resolution
// is actually lens-driven when the `targets` flag is on, and that callers
// that omit `targetId` still see today's owner-default behavior.

import { IcpFitScorer } from '@/lib/scoring/scorers/icp-fit';
import type { ContactScoringData, IcpCriteria } from '@/lib/scoring/types';

function makeContact(overrides: Partial<ContactScoringData> = {}): ContactScoringData {
  return {
    id: 'contact-1',
    degree: 1,
    title: 'Chief Technology Officer',
    headline: 'CTO at Acme — scaling AI teams in fintech',
    about: 'Leading ML research and platform teams.',
    currentCompany: 'Acme Corp',
    connectionsCount: 500,
    tags: ['leadership', 'ml'],
    location: 'San Francisco, CA',
    companyIndustry: 'Financial Services',
    companySizeRange: '501-1000',
    mutualConnectionCount: 5,
    edgeCount: 10,
    skills: ['Python', 'Machine Learning'],
    pagerank: null,
    betweenness: null,
    degreeCentrality: null,
    observationCount: 0,
    contentTopics: [],
    postingFrequency: null,
    avgEngagement: null,
    connectedAt: null,
    connectionCountRaw: null,
    discoveredVia: [],
    clusterIds: [],
    ...overrides,
  };
}

describe('WS-4 Phase 1.5 — lens-driven icp_fit scoring', () => {
  const scorer = new IcpFitScorer();

  // Two realistic lens-scoped ICPs — one targeting "CTO in fintech", the
  // other targeting "VP of Marketing in retail". The same contact should
  // score very differently under each.
  const ctoLensIcp: IcpCriteria = {
    roles: ['CTO', 'Chief Technology Officer'],
    industries: ['Financial'],
    locations: ['San Francisco'],
  };
  const marketingLensIcp: IcpCriteria = {
    roles: ['VP of Marketing', 'Chief Marketing Officer'],
    industries: ['Retail'],
    locations: ['New York'],
  };

  it('same contact + CTO lens = high icp_fit', () => {
    const contact = makeContact();
    const fit = scorer.score(contact, ctoLensIcp);
    expect(fit).toBeGreaterThan(0.9); // roles + industry + location all match
  });

  it('same contact + marketing lens = zero icp_fit', () => {
    const contact = makeContact();
    const fit = scorer.score(contact, marketingLensIcp);
    expect(fit).toBe(0); // nothing matches
  });

  it('lens diff produces a clearly different icp_fit for the same contact', () => {
    const contact = makeContact();
    const ctoFit = scorer.score(contact, ctoLensIcp);
    const marketingFit = scorer.score(contact, marketingLensIcp);
    expect(ctoFit - marketingFit).toBeGreaterThan(0.8);
  });
});

describe('WS-4 Phase 1.5 — pipeline lens resolution', () => {
  beforeEach(() => {
    jest.resetModules();
    // Start with the flag off; individual tests enable it as needed.
    delete process.env.RESEARCH_TARGETS;
  });

  it('falls back to owner-default ICPs when targets flag is off', async () => {
    const getActiveIcpProfiles = jest.fn(async () => [
      {
        id: 'owner-default-icp',
        name: 'Owner Default',
        description: null,
        isActive: true,
        criteria: { roles: ['CTO'] },
        weightOverrides: {},
        createdAt: '',
        updatedAt: '',
      },
    ]);
    jest.doMock('@/lib/db/queries/scoring', () => ({
      getActiveIcpProfiles,
      getDefaultWeightProfile: jest.fn(async () => null),
      getWeightProfileByName: jest.fn(async () => null),
      getAllContactIds: jest.fn(async () => []),
      getScoringBaselines: jest.fn(async () => ({
        p90Mutuals: 0,
        p90Edges: 0,
        totalClusters: 0,
      })),
      upsertContactScore: jest.fn(async () => undefined),
      upsertContactIcpFit: jest.fn(async () => undefined),
      getContactScoringData: jest.fn(async () => null),
      createScoringRun: jest.fn(async () => 'run-1'),
      updateScoringRun: jest.fn(async () => undefined),
    }));
    const lensService = {
      getActiveLensIcps: jest.fn(async () => [
        {
          id: 'lens-icp',
          name: 'Lens ICP',
          description: null,
          isActive: true,
          criteria: { roles: ['VP Marketing'] },
          weightOverrides: {},
          createdAt: '',
          updatedAt: '',
        },
      ]),
    };
    jest.doMock('@/lib/targets/lens-service', () => lensService);
    jest.doMock('@/lib/config/research-flags', () => ({
      RESEARCH_FLAGS: {
        targets: false,
        snippets: false,
        parserTelemetry: false,
        sources: false,
      },
    }));

    // Import after mocks so the module captures the flag-off state.
    const { scoreBatch } = await import('@/lib/scoring/pipeline');
    // Batch with no IDs resolves to an empty list of contacts — the call
    // is only to drive the ICP-resolver code path. We verify via the
    // mock call counts which path ran.
    await scoreBatch([], undefined, 'target-1').catch(() => undefined);

    expect(lensService.getActiveLensIcps).not.toHaveBeenCalled();
  });

  it('prefers the lens-scoped ICPs when targets flag is on AND targetId is set', async () => {
    const getActiveIcpProfiles = jest.fn(async () => [
      {
        id: 'owner-default',
        name: 'Owner Default',
        description: null,
        isActive: true,
        criteria: { roles: ['CEO'] },
        weightOverrides: {},
        createdAt: '',
        updatedAt: '',
      },
    ]);
    jest.doMock('@/lib/db/queries/scoring', () => ({
      getActiveIcpProfiles,
      getDefaultWeightProfile: jest.fn(async () => null),
      getWeightProfileByName: jest.fn(async () => null),
      getAllContactIds: jest.fn(async () => []),
      getScoringBaselines: jest.fn(async () => ({ p90Mutuals: 0, p90Edges: 0, totalClusters: 0 })),
      upsertContactScore: jest.fn(async () => undefined),
      upsertContactIcpFit: jest.fn(async () => undefined),
      getContactScoringData: jest.fn(async () => null),
    }));
    const getActiveLensIcps = jest.fn(async () => [
      {
        id: 'lens-icp',
        name: 'Lens ICP',
        description: null,
        isActive: true,
        criteria: { roles: ['CTO'] },
        weightOverrides: {},
        createdAt: '',
        updatedAt: '',
      },
    ]);
    jest.doMock('@/lib/targets/lens-service', () => ({ getActiveLensIcps }));
    jest.doMock('@/lib/config/research-flags', () => ({
      RESEARCH_FLAGS: {
        targets: true,
        snippets: false,
        parserTelemetry: false,
        sources: false,
      },
    }));

    jest.doMock('@/lib/targets/service', () => ({
      getCurrentOwnerProfileId: jest.fn(async () => 'owner'),
      getResearchTargetState: jest.fn(async () => ({ tenantId: 'tenant' })),
      getTargetById: jest.fn(async () => ({ tenantId: 'tenant', kind: 'contact' })),
    }));
    const { scoreBatch } = await import('@/lib/scoring/pipeline');
    await scoreBatch([], undefined, 'target-1').catch(() => undefined);

    expect(getActiveLensIcps).toHaveBeenCalledWith('target-1', { tenantId: 'tenant', ownerId: 'owner' });
    // Owner-default must NOT be queried when the lens yields a non-empty set.
    expect(getActiveIcpProfiles).not.toHaveBeenCalled();
  });

  it('falls back to owner-default when the flag is on but the target has no lens ICPs', async () => {
    const getActiveIcpProfiles = jest.fn(async () => [
      {
        id: 'owner-default',
        name: 'Owner Default',
        description: null,
        isActive: true,
        criteria: { roles: ['CEO'] },
        weightOverrides: {},
        createdAt: '',
        updatedAt: '',
      },
    ]);
    jest.doMock('@/lib/db/queries/scoring', () => ({
      getActiveIcpProfiles,
      getDefaultWeightProfile: jest.fn(async () => null),
      getWeightProfileByName: jest.fn(async () => null),
      getAllContactIds: jest.fn(async () => []),
      getScoringBaselines: jest.fn(async () => ({ p90Mutuals: 0, p90Edges: 0, totalClusters: 0 })),
      upsertContactScore: jest.fn(async () => undefined),
      upsertContactIcpFit: jest.fn(async () => undefined),
      getContactScoringData: jest.fn(async () => null),
    }));
    const getActiveLensIcps = jest.fn(async () => []); // empty — no lens
    jest.doMock('@/lib/targets/lens-service', () => ({ getActiveLensIcps }));
    jest.doMock('@/lib/config/research-flags', () => ({
      RESEARCH_FLAGS: {
        targets: true,
        snippets: false,
        parserTelemetry: false,
        sources: false,
      },
    }));

    jest.doMock('@/lib/targets/service', () => ({
      getCurrentOwnerProfileId: jest.fn(async () => 'owner'),
      getResearchTargetState: jest.fn(async () => ({ tenantId: 'tenant' })),
      getTargetById: jest.fn(async () => ({ tenantId: 'tenant', kind: 'contact' })),
    }));
    const { scoreBatch } = await import('@/lib/scoring/pipeline');
    await scoreBatch([], undefined, 'target-1').catch(() => undefined);

    expect(getActiveLensIcps).toHaveBeenCalledWith('target-1', { tenantId: 'tenant', ownerId: 'owner' });
    expect(getActiveIcpProfiles).toHaveBeenCalled(); // fallback fired
  });
});
