// D2 scoring contract: persisted scores use the owner basis. Lens scoring is
// transient and may only be requested through the read-only preview.

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

describe('D2 — owner baseline and transient lens preview', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function mockScoringQueries() {
    const queries = {
      getActiveIcpProfiles: jest.fn(async () => [{
        id: 'owner-icp', name: 'Owner', description: null, isActive: true,
        criteria: { roles: ['CEO'] }, weightOverrides: {}, createdAt: '', updatedAt: '',
      }]),
      getDefaultWeightProfile: jest.fn(async () => null),
      getAllContactIds: jest.fn(async () => []),
      getScoringBaselines: jest.fn(async () => ({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5, graphCentralityDistribution: [] })),
      getContactScoringData: jest.fn(async () => makeContact()),
      upsertContactScore: jest.fn(async () => undefined),
      upsertContactIcpFit: jest.fn(async () => undefined),
    };
    jest.doMock('@/lib/db/queries/scoring', () => queries);
    return queries;
  }

  it('uses owner ICPs for an ordinary batch even when targets are enabled', async () => {
    const queries = mockScoringQueries();
    const getActiveLensForTarget = jest.fn();
    jest.doMock('@/lib/db/client', () => ({
      transaction: jest.fn(async fn => fn({ query: jest.fn(async () => ({ rows: [{ snapshot_id: '1:2:' }] })) })),
      query: jest.fn(),
    }));
    jest.doMock('@/lib/taxonomy/service', () => ({ resolveTaxonomyChain: jest.fn(async () => ({})) }));
    jest.doMock('@/lib/targets/lens-service', () => ({ getActiveLensForTarget }));
    jest.doMock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { targets: true } }));

    const { scoreBatch } = await import('@/lib/scoring/pipeline');
    await expect(scoreBatch([])).resolves.toEqual([]);

    expect(queries.getActiveIcpProfiles).toHaveBeenCalledTimes(1);
    expect(queries.getDefaultWeightProfile).toHaveBeenCalledTimes(1);
    expect(getActiveLensForTarget).not.toHaveBeenCalled();
    expect(queries.upsertContactScore).not.toHaveBeenCalled();
  });

  it('rejects target-scoped mutation before reading settings or writing scores', async () => {
    const queries = mockScoringQueries();
    const getActiveLensForTarget = jest.fn();
    jest.doMock('@/lib/targets/lens-service', () => ({ getActiveLensForTarget }));
    jest.doMock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { targets: true } }));

    const { scoreBatch, TargetScopedScoreError } = await import('@/lib/scoring/pipeline');
    await expect(scoreBatch(['contact-1'], undefined, 'target-1'))
      .rejects.toBeInstanceOf(TargetScopedScoreError);

    expect(queries.getActiveIcpProfiles).not.toHaveBeenCalled();
    expect(queries.getDefaultWeightProfile).not.toHaveBeenCalled();
    expect(queries.getContactScoringData).not.toHaveBeenCalled();
    expect(queries.upsertContactScore).not.toHaveBeenCalled();
    expect(getActiveLensForTarget).not.toHaveBeenCalled();
  });

  it('previews distinct lens criteria without persisting either result', async () => {
    const queries = mockScoringQueries();
    const getActiveLensForTarget = jest.fn(async (targetId: string) => ({
      id: `lens-${targetId}`, updatedAt: '2026-09-01T00:00:00Z',
      tenantId: 'tenant-1', userId: 'owner-1', primaryTargetId: targetId,
    }));
    const resolveTaxonomyChain = jest.fn(async () => ({}));
    const emitScoringImpulses = jest.fn();
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SET TRANSACTION')) return { rows: [] };
      if (sql.startsWith('SELECT transaction_timestamp')) return {
        rows: [{ captured_at: new Date('2026-09-02'), snapshot_id: '1:2:' }],
      };
      if (sql.includes('FROM tenants tenant')) return { rows: [{ tenant_id: 'tenant-1', owner_id: 'owner-1' }] };
      const cto = params?.[0] === 'target-cto';
      return { rows: [{
        id: cto ? 'icp-cto' : 'icp-marketing', name: 'Lens ICP', description: null,
        is_active: true, criteria: { roles: cto ? ['CTO'] : ['VP of Marketing'] },
        weight_overrides: {}, created_at: new Date('2026-09-01'),
        updated_at: new Date('2026-09-01'),
      }] };
    });
    jest.doMock('@/lib/db/client', () => ({ transaction: jest.fn(async fn => fn({ query })), query: jest.fn() }));
    jest.doMock('@/lib/targets/lens-service', () => ({ getActiveLensForTarget }));
    jest.doMock('@/lib/taxonomy/service', () => ({ resolveTaxonomyChain }));
    jest.doMock('@/lib/ecc/impulses/scoring-adapter', () => ({ emitScoringImpulses }));
    jest.doMock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { targets: true } }));

    const { previewContactForTarget } = await import('@/lib/scoring/pipeline');
    const cto = await previewContactForTarget('contact-1', 'target-cto');
    const marketing = await previewContactForTarget('contact-1', 'target-marketing');

    expect(cto.score.compositeScore).toBeGreaterThan(marketing.score.compositeScore);
    expect(cto.basis.selectedIcpId).toBe('icp-cto');
    expect(marketing.basis.selectedIcpId).toBe('icp-marketing');
    expect(cto.basis.kind).toBe('lens-preview');
    expect(query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(queries.getContactScoringData).toHaveBeenCalledWith('contact-1', expect.objectContaining({ query }));
    expect(queries.getActiveIcpProfiles).not.toHaveBeenCalled();
    expect(queries.upsertContactScore).not.toHaveBeenCalled();
    expect(queries.upsertContactIcpFit).not.toHaveBeenCalled();
    expect(emitScoringImpulses).not.toHaveBeenCalled();
  });

  it('rejects a lens preview with no active ICP instead of using owner ICPs', async () => {
    const queries = mockScoringQueries();
    const query = jest.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT transaction_timestamp')
      ? [{ captured_at: new Date('2026-09-02'), snapshot_id: '1:2:' }]
      : sql.includes('FROM tenants tenant') ? [{ tenant_id: 'tenant-1', owner_id: 'owner-1' }] : [] }));
    jest.doMock('@/lib/db/client', () => ({ transaction: jest.fn(async fn => fn({ query })), query: jest.fn() }));
    jest.doMock('@/lib/targets/lens-service', () => ({
      getActiveLensForTarget: jest.fn(async () => ({
        id: 'empty-lens', updatedAt: '2026-09-01T00:00:00Z', tenantId: 'tenant-1',
        userId: 'owner-1', primaryTargetId: 'target-empty',
      })),
    }));
    jest.doMock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { targets: true } }));

    const { previewContactForTarget, LensPreviewError } = await import('@/lib/scoring/pipeline');
    await expect(previewContactForTarget('contact-1', 'target-empty'))
      .rejects.toMatchObject({ name: LensPreviewError.name, status: 422 });
    expect(queries.getActiveIcpProfiles).not.toHaveBeenCalled();
    expect(queries.upsertContactScore).not.toHaveBeenCalled();
  });
});
