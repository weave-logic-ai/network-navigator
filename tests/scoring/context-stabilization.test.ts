import type { NextRequest } from 'next/server';
import { GET as previewGet } from '@/app/api/scoring/context-preview/route';
import { POST as runPost } from '@/app/api/scoring/run/route';
import { POST as rescorePost } from '@/app/api/scoring/rescore-all/route';
import { captureOwnerScoringBasis, previewContactForTarget, scoreBatch, scoreContact, TargetScopedScoreError } from '@/lib/scoring/pipeline';
import { triggerRescoreAll } from '@/lib/scoring/auto-score';
import { scoreContactWithProvenance } from '@/lib/ecc/causal-graph/scoring-adapter';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { ECC_FLAGS } from '@/lib/ecc/types';
import * as scoringQueries from '@/lib/db/queries/scoring';
import { query, transaction } from '@/lib/db/client';
import { getActiveLensForTarget } from '@/lib/targets/lens-service';
import { resolveTaxonomyChain } from '@/lib/taxonomy/service';
import { emitScoringImpulses } from '@/lib/ecc/impulses/scoring-adapter';
import { checkAndGenerateTasks } from '@/lib/scoring/task-triggers';
import { drainScoringImpulses, recordScoringImpulses } from '@/lib/scoring/transition-writer';
import { createCausalNode } from '@/lib/ecc/causal-graph/service';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

jest.mock('@/lib/db/queries/scoring');
jest.mock('next/server', () => ({ NextResponse: { json: Response.json } }), { virtual: true });
jest.mock('@/lib/db/client', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('@/lib/targets/lens-service', () => ({ getActiveLensForTarget: jest.fn() }));
jest.mock('@/lib/taxonomy/service', () => ({ resolveTaxonomyChain: jest.fn() }));
jest.mock('@/lib/ecc/impulses/scoring-adapter', () => ({ emitScoringImpulses: jest.fn() }));
jest.mock('@/lib/scoring/task-triggers', () => ({ checkAndGenerateTasks: jest.fn() }));
jest.mock('@/lib/scoring/transition-writer', () => ({
  drainScoringImpulses: jest.fn(), recordScoringImpulses: jest.fn(),
}));
jest.mock('@/lib/ecc/causal-graph/service', () => ({ createCausalNode: jest.fn() }));
jest.mock('@/lib/auth/local-request-boundary', () => ({ requireLocalDashboardRequest: jest.fn() }));

const targetA = '550e8400-e29b-41d4-a716-446655440001';
const targetB = '550e8400-e29b-41d4-a716-446655440002';
const contactId = '550e8400-e29b-41d4-a716-446655440003';
const mockedQueries = jest.mocked(scoringQueries);
const mockedQuery = jest.mocked(query);
const mockedTransaction = jest.mocked(transaction);
const mockedLens = jest.mocked(getActiveLensForTarget);
const snapshotClient = {
  query: jest.fn(),
};

const contact = {
  id: contactId, degree: 1, title: 'Engineer', headline: 'Engineer', about: null,
  currentCompany: 'Acme', connectionsCount: 0, tags: [], location: null,
  companyIndustry: 'Software', companySizeRange: null, mutualConnectionCount: 0,
  edgeCount: 0, skills: [], pagerank: null, betweenness: null, degreeCentrality: null,
  observationCount: 0, contentTopics: [], postingFrequency: null, avgEngagement: null,
  connectedAt: null, connectionCountRaw: null, discoveredVia: [], clusterIds: [],
};

beforeEach(() => {
  jest.resetAllMocks();
  RESEARCH_FLAGS.targets = true;
  ECC_FLAGS.causalGraph = false;
  mockedQueries.getContactScoringData.mockResolvedValue(contact);
  mockedQueries.getDefaultWeightProfile.mockResolvedValue(null);
  mockedQueries.getAllContactIds.mockResolvedValue([]);
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([]);
  mockedQueries.getScoringBaselines.mockResolvedValue({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5 });
  mockedQueries.createScoringRun.mockResolvedValue('run-1');
  mockedQueries.updateScoringRun.mockResolvedValue(undefined);
  mockedQueries.getContactScoreBreakdown.mockResolvedValue(null);
  mockedQueries.upsertContactScore.mockResolvedValue({ comparable: true, previous: null, revision: 1 });
  jest.mocked(emitScoringImpulses).mockResolvedValue(undefined);
  jest.mocked(checkAndGenerateTasks).mockResolvedValue(undefined);
  jest.mocked(recordScoringImpulses).mockResolvedValue(undefined);
  jest.mocked(drainScoringImpulses).mockResolvedValue(undefined);
  jest.mocked(requireLocalDashboardRequest).mockResolvedValue(null);
  jest.mocked(resolveTaxonomyChain).mockResolvedValue({} as Awaited<ReturnType<typeof resolveTaxonomyChain>>);
  mockedLens.mockImplementation(async targetId => ({
    id: targetId === targetA ? 'lens-a' : 'lens-b', updatedAt: '2026-09-01T00:00:00Z',
    tenantId: 'tenant-a', userId: 'owner-a', primaryTargetId: targetId,
  } as Awaited<ReturnType<typeof getActiveLensForTarget>>));
  mockedTransaction.mockImplementation(async callback => callback(snapshotClient as Parameters<typeof transaction>[0] extends (client: infer C) => unknown ? C : never));
  snapshotClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SET TRANSACTION')) return { rows: [] };
    if (sql.startsWith('SELECT transaction_timestamp')) return {
      rows: [{ captured_at: new Date('2026-09-02'), snapshot_id: '1:2:' }],
    };
    if (sql.startsWith('SELECT txid_current_snapshot')) return { rows: [{ snapshot_id: '1:2:' }] };
    if (sql.includes('FROM tenants tenant')) return { rows: [{ owner_id: 'owner-a', tenant_id: 'tenant-a' }] };
    return { rows: [{
      id: params?.[0] === targetA ? 'icp-a' : 'icp-b',
      name: 'ICP', description: null, is_active: true,
      criteria: { roles: [params?.[0] === targetA ? 'Engineer' : 'Sales'] },
      weight_overrides: {}, created_at: new Date('2026-09-01'), updated_at: new Date('2026-09-02'),
    }] };
  });
});

it('previews different lens criteria and never writes or emits', async () => {
  const a = await previewContactForTarget(contactId, targetA);
  const b = await previewContactForTarget(contactId, targetB);
  expect(a.score.compositeScore).toBeGreaterThan(b.score.compositeScore);
  expect(a.basis.selectedIcpId).toBe('icp-a');
  expect(b.basis.selectedIcpId).toBe('icp-b');
  expect(a.basis.icps).toEqual([{ id: 'icp-a', updatedAt: expect.any(String) }]);
  expect(a.basis.scope).toBe('composite-and-referral');
  expect(a.score.referralLikelihood).toEqual(expect.any(Number));
  expect(a.score.referralDimensions).toHaveLength(6);
  expect(a.basis.referralBaselines).toEqual({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5 });
  expect(mockedLens).toHaveBeenCalledTimes(2);
  expect(mockedLens).toHaveBeenNthCalledWith(1, targetA,
    { tenantId: 'tenant-a', ownerId: 'owner-a' }, snapshotClient);
  expect(mockedQueries.getContactScoringData).toHaveBeenCalledWith(contactId, snapshotClient);
  expect(resolveTaxonomyChain).toHaveBeenCalledWith('icp-a', snapshotClient);
  expect(mockedQueries.getDefaultWeightProfile).toHaveBeenCalledWith(snapshotClient);
  expect(mockedQueries.getScoringBaselines).toHaveBeenCalledWith(snapshotClient);
  expect(snapshotClient.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  expect(mockedQueries.upsertContactScore).not.toHaveBeenCalled();
  expect(mockedQueries.upsertContactIcpFit).not.toHaveBeenCalled();
  expect(emitScoringImpulses).not.toHaveBeenCalled();
  expect(checkAndGenerateTasks).not.toHaveBeenCalled();
});

it('requires the S1 operator boundary before reading preview inputs', async () => {
  jest.mocked(requireLocalDashboardRequest).mockResolvedValueOnce(Response.json(
    { error: 'Operator session required' }, { status: 401 }
  ) as Awaited<ReturnType<typeof requireLocalDashboardRequest>>);
  const response = await previewGet(new Request(`http://localhost/api/scoring/context-preview?contactId=${contactId}&targetId=${targetA}`) as NextRequest);
  expect(response.status).toBe(401);
  expect(mockedLens).not.toHaveBeenCalled();
  expect(mockedQueries.getContactScoringData).not.toHaveBeenCalled();
});

it('rejects a hostile contact or target before lens and scoring lookups', async () => {
  // Override the boundary response while retaining the normal snapshot mock.
  const original = snapshotClient.query.getMockImplementation()!;
  snapshotClient.query.mockImplementation(async (sql: string, params?: unknown[]) =>
    sql.includes('FROM tenants tenant') ? { rows: [] } : original(sql, params));
  const response = await previewGet(new Request(`http://localhost/api/scoring/context-preview?contactId=${contactId}&targetId=${targetA}`) as NextRequest);
  expect(response.status).toBe(404);
  expect(mockedLens).not.toHaveBeenCalled();
  expect(mockedQueries.getContactScoringData).not.toHaveBeenCalled();
  expect(mockedQueries.getScoringBaselines).not.toHaveBeenCalled();
});

it('rejects a lens owned by another operator before ICP resolution', async () => {
  mockedLens.mockResolvedValueOnce({
    id: 'foreign-lens', tenantId: 'tenant-a', userId: 'owner-b', primaryTargetId: targetA,
    updatedAt: '2026-09-01T00:00:00Z',
  } as Awaited<ReturnType<typeof getActiveLensForTarget>>);
  await expect(previewContactForTarget(contactId, targetA)).rejects.toMatchObject({ status: 404 });
  expect(mockedQueries.getContactScoringData).not.toHaveBeenCalled();
  expect(resolveTaxonomyChain).not.toHaveBeenCalled();
});

it('rejects targetId from both mutation routes before any side effects', async () => {
  const run = await runPost(new Request(`http://localhost/api/scoring/run?targetId=${targetA}`, {
    method: 'POST', body: JSON.stringify({ contactId }),
  }) as NextRequest);
  const rescore = await rescorePost(new Request('http://localhost/api/scoring/rescore-all', {
    method: 'POST', body: JSON.stringify({ targetId: targetA }),
  }) as NextRequest);
  expect(run.status).toBe(422);
  expect(rescore.status).toBe(422);
  expect(mockedQueries.getContactScoringData).not.toHaveBeenCalled();
  expect(mockedQueries.getAllContactIds).not.toHaveBeenCalled();
  expect(mockedQueries.createScoringRun).not.toHaveBeenCalled();
  expect(createCausalNode).not.toHaveBeenCalled();
});

it.each(['{broken', 'null', '[]', '"text"', ''])('rejects malformed run bodies before scoring: %s', async raw => {
  const response = await runPost(new Request('http://localhost/api/scoring/run', {
    method: 'POST', body: raw,
  }) as NextRequest);
  expect(response.status).toBe(400);
  expect(mockedQueries.getAllContactIds).not.toHaveBeenCalled();
  expect(mockedQueries.getContactScoringData).not.toHaveBeenCalled();
  expect(mockedQueries.upsertContactScore).not.toHaveBeenCalled();
  expect(createCausalNode).not.toHaveBeenCalled();
});

it.each(['{broken', 'null', '[]', '"text"', ' '])('rejects malformed nonempty rescore bodies before run creation: %s', async raw => {
  const response = await rescorePost(new Request('http://localhost/api/scoring/rescore-all', {
    method: 'POST', body: raw,
  }) as NextRequest);
  expect(response.status).toBe(400);
  expect(mockedQueries.getAllContactIds).not.toHaveBeenCalled();
  expect(mockedQueries.createScoringRun).not.toHaveBeenCalled();
});

it('accepts the bodyless POST sent by the Rescore All button', async () => {
  const response = await rescorePost(new Request('http://localhost/api/scoring/rescore-all', {
    method: 'POST',
  }) as NextRequest);
  expect(response.status).toBe(200);
  expect((await response.json()).data.runId).toBe('run-1');
  expect(mockedQueries.createScoringRun).toHaveBeenCalledWith('rescore-all', 0);
});

it('routes an ordinary batch run through one captured owner basis', async () => {
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([{
    id: 'owner-icp', name: 'Owner', description: null, isActive: true,
    criteria: { roles: ['Engineer'] }, weightOverrides: {},
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  }]);
  const response = await runPost(new Request('http://localhost/api/scoring/run', {
    method: 'POST', body: JSON.stringify({ contactIds: [contactId] }),
  }) as NextRequest);

  expect(response.status).toBe(200);
  expect((await response.json()).data.scored).toBe(1);
  expect(mockedQueries.upsertContactIcpFit.mock.calls.map(call => call[1])).toEqual(['owner-icp']);
  expect(mockedQueries.getDefaultWeightProfile).toHaveBeenCalledTimes(1);
  expect(mockedQueries.getActiveIcpProfiles).toHaveBeenCalledTimes(1);
  expect(mockedQueries.getScoringBaselines).toHaveBeenCalledTimes(1);
  expect(checkAndGenerateTasks).toHaveBeenCalledWith(contactId, null, expect.any(Object), true,
    expect.objectContaining({ client: snapshotClient, forceInline: true, identityOnly: false }));
  expect(recordScoringImpulses).toHaveBeenCalledWith(snapshotClient, contactId, null, expect.any(Object), 1);
  expect(drainScoringImpulses).toHaveBeenCalledWith(contactId);
});

it('rejects invalid run fields before dispatch', async () => {
  const response = await runPost(new Request('http://localhost/api/scoring/run', {
    method: 'POST', body: JSON.stringify({ contactIds: 'all' }),
  }) as NextRequest);
  expect(response.status).toBe(400);
  expect(mockedQueries.getAllContactIds).not.toHaveBeenCalled();
});

it('guards internal mutation entry points before reads, runs, or causal nodes', async () => {
  ECC_FLAGS.causalGraph = true;
  await expect(scoreContact(contactId, undefined, targetA)).rejects.toBeInstanceOf(TargetScopedScoreError);
  await expect(scoreBatch([contactId], undefined, targetA)).rejects.toBeInstanceOf(TargetScopedScoreError);
  await expect(triggerRescoreAll(targetA)).rejects.toBeInstanceOf(TargetScopedScoreError);
  await expect(scoreContactWithProvenance(contactId, undefined, targetA)).rejects.toThrow('targetId is only supported');
  expect(mockedQueries.getContactScoringData).not.toHaveBeenCalled();
  expect(mockedQueries.getAllContactIds).not.toHaveBeenCalled();
  expect(createCausalNode).not.toHaveBeenCalled();
});

it('rescores only with the owner ICP basis across contacts', async () => {
  mockedQueries.getAllContactIds.mockResolvedValue([contactId, `${contactId.slice(0, -1)}4`]);
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([{
    id: 'owner-icp', name: 'Owner', description: null, isActive: true,
    criteria: { roles: ['Engineer'] }, weightOverrides: {},
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  }]);
  mockedQueries.getScoringBaselines.mockResolvedValue({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5 });
  mockedQueries.createScoringRun.mockResolvedValue('run-1');
  mockedQueries.updateScoringRun.mockResolvedValue(undefined);
  mockedQueries.getContactScoreBreakdown.mockResolvedValue(null);
  jest.mocked(emitScoringImpulses).mockResolvedValue(undefined);
  jest.mocked(checkAndGenerateTasks).mockResolvedValue(undefined);

  const runId = await triggerRescoreAll();
  expect(runId).toBe('run-1');
  await new Promise(resolve => setImmediate(resolve));
  expect(mockedQueries.upsertContactScore).toHaveBeenCalledTimes(2);
  expect(mockedQueries.upsertContactIcpFit).toHaveBeenCalledTimes(2);
  expect(mockedQueries.upsertContactIcpFit.mock.calls.map(call => call[1])).toEqual(['owner-icp', 'owner-icp']);
  expect(mockedQueries.getActiveIcpProfiles).toHaveBeenCalledTimes(1);
  expect(mockedQueries.getDefaultWeightProfile).toHaveBeenCalledTimes(1);
  expect(mockedQueries.getScoringBaselines).toHaveBeenCalledTimes(1);
  expect(resolveTaxonomyChain).toHaveBeenCalledTimes(1);
  expect(mockedLens).not.toHaveBeenCalled();
  expect(mockedQuery).not.toHaveBeenCalled();
});

it('does not compare an unverified legacy score to the first owner score', async () => {
  mockedQueries.getContactScoreBreakdown.mockResolvedValue({
    compositeScore: 0.99, tier: 'gold', persona: 'buyer', behavioralPersona: 'super-connector',
    scoredAt: '2026-09-01T00:00:00Z', dimensions: [], referralLikelihood: null,
    referralTier: null, referralPersona: null, referralDimensions: [],
    behavioralSignals: null, referralSignals: null, basisKind: 'legacy-unverified', basisHash: null,
  });
  mockedQueries.upsertContactScore.mockResolvedValue({ comparable: false, previous: null });

  await scoreContact(contactId);

  expect(mockedQueries.upsertContactScore).toHaveBeenCalledTimes(1);
  expect(emitScoringImpulses).not.toHaveBeenCalled();
  expect(checkAndGenerateTasks).toHaveBeenCalledWith(contactId, null, expect.any(Object), true,
    expect.objectContaining({ client: snapshotClient, forceInline: true, identityOnly: true }));
  expect(recordScoringImpulses).not.toHaveBeenCalled();
});

it('does not compare owner scores with different basis hashes even at scoring version 1', async () => {
  mockedQueries.getContactScoreBreakdown.mockResolvedValue({
    compositeScore: 0.99, tier: 'gold', persona: 'buyer', behavioralPersona: 'super-connector',
    scoredAt: '2026-09-01T00:00:00Z', dimensions: [], referralLikelihood: null,
    referralTier: null, referralPersona: null, referralDimensions: [],
    behavioralSignals: null, referralSignals: null,
    basisKind: 'owner', basisHash: '0'.repeat(64),
  });
  mockedQueries.upsertContactScore.mockResolvedValue({ comparable: false, previous: null });

  const result = await scoreContact(contactId);

  expect(result.score.scoringVersion).toBe(1);
  expect(mockedQueries.upsertContactScore.mock.calls[0][2]).not.toBe('0'.repeat(64));
  expect(emitScoringImpulses).not.toHaveBeenCalled();
  expect(checkAndGenerateTasks).toHaveBeenCalledWith(contactId, null, expect.any(Object), true,
    expect.objectContaining({ client: snapshotClient, forceInline: true, identityOnly: true }));
  expect(recordScoringImpulses).not.toHaveBeenCalled();
});

it('emits transitions from the predecessor returned by the locked write', async () => {
  const previous = {
    compositeScore: 0.4, tier: 'silver' as const, persona: 'warm-lead' as const,
    behavioralPersona: 'passive-observer' as const, dimensions: [], scoringVersion: 1,
    referralLikelihood: null, referralTier: null, referralPersona: null,
    referralDimensions: null, behavioralSignals: null, referralSignals: null,
  };
  mockedQueries.getContactScoreBreakdown.mockRejectedValue(new Error('Unprotected predecessor read'));
  mockedQueries.upsertContactScore.mockResolvedValue({ comparable: true, previous, revision: 7 });

  await scoreContact(contactId);

  expect(mockedQueries.getContactScoreBreakdown).not.toHaveBeenCalled();
  expect(recordScoringImpulses).toHaveBeenCalledWith(snapshotClient, contactId, previous, expect.any(Object), 7);
  expect(checkAndGenerateTasks).toHaveBeenCalledWith(contactId, previous, expect.any(Object), true,
    expect.objectContaining({ client: snapshotClient, forceInline: true }));
  expect(drainScoringImpulses).toHaveBeenCalledWith(contactId);
});

it('hashes equivalent key orders identically and changes hash with owner criteria', async () => {
  const profile = {
    id: 'weight-a', name: 'default', description: null, isDefault: true,
    weights: { icp_fit: 0.7, relationship_strength: 0.3 },
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  };
  const icp = {
    id: 'owner-icp', name: 'Owner', description: null, isActive: true,
    criteria: { roles: ['Engineer'], industries: ['Software'] }, weightOverrides: {},
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  };
  mockedQueries.getDefaultWeightProfile.mockResolvedValue(profile);
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([icp]);
  const first = await captureOwnerScoringBasis();
  mockedQueries.getDefaultWeightProfile.mockResolvedValue({
    ...profile, weights: { relationship_strength: 0.3, icp_fit: 0.7 },
  });
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([{
    ...icp, criteria: { industries: ['Software'], roles: ['Engineer'] },
  }]);
  const reordered = await captureOwnerScoringBasis();
  expect(reordered.basisHash).toBe(first.basisHash);

  mockedQueries.getActiveIcpProfiles.mockResolvedValue([{
    ...icp, criteria: { roles: ['Sales'], industries: ['Software'] },
  }]);
  const changed = await captureOwnerScoringBasis();
  expect(changed.basisHash).not.toBe(first.basisHash);

  mockedQueries.getActiveIcpProfiles.mockResolvedValue([icp]);
  mockedQueries.getDefaultWeightProfile.mockResolvedValue({
    ...profile, weights: { icp_fit: 0.6, relationship_strength: 0.4 },
  });
  expect((await captureOwnerScoringBasis()).basisHash).not.toBe(first.basisHash);
  mockedQueries.getDefaultWeightProfile.mockResolvedValue(profile);
  mockedQueries.getScoringBaselines.mockResolvedValue({ p90Mutuals: 40, p90Edges: 10, totalClusters: 5 });
  expect((await captureOwnerScoringBasis()).basisHash).not.toBe(first.basisHash);
});

it('keeps one immutable owner basis throughout a batch run', async () => {
  const secondId = `${contactId.slice(0, -1)}4`;
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([{
    id: 'icp-old', name: 'Owner', description: null, isActive: true,
    criteria: { roles: ['Engineer'] }, weightOverrides: {},
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  }]);
  mockedQueries.getDefaultWeightProfile.mockResolvedValue({
    id: 'weight-old', name: 'default', description: null, isDefault: true,
    weights: { icp_fit: 1, relationship_strength: 0 },
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  });
  let release!: () => void;
  let reached!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const firstStored = new Promise<void>(resolve => { reached = resolve; });
  mockedQueries.upsertContactScore.mockImplementationOnce(async () => {
    reached();
    await hold;
    return { comparable: true, previous: null, revision: 1 };
  });

  const pending = scoreBatch([contactId, secondId]);
  await firstStored;
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([{
    id: 'icp-new', name: 'Changed', description: null, isActive: true,
    criteria: { roles: ['Sales'] }, weightOverrides: {},
    createdAt: '2026-09-02', updatedAt: '2026-09-02',
  }]);
  mockedQueries.getDefaultWeightProfile.mockResolvedValue({
    id: 'weight-new', name: 'default', description: null, isDefault: true,
    weights: { icp_fit: 0, relationship_strength: 1 },
    createdAt: '2026-09-02', updatedAt: '2026-09-02',
  });
  release();
  const results = await pending;

  expect(results).toHaveLength(2);
  expect(results[0].score.compositeScore).toBe(results[1].score.compositeScore);
  expect(mockedQueries.upsertContactIcpFit.mock.calls.map(call => call[1]))
    .toEqual(['icp-old', 'icp-old']);
  expect(mockedQueries.getActiveIcpProfiles).toHaveBeenCalledTimes(1);
  expect(mockedQueries.getDefaultWeightProfile).toHaveBeenCalledTimes(1);
  expect(mockedQueries.getScoringBaselines).toHaveBeenCalledTimes(1);
  const hashes = mockedQueries.upsertContactScore.mock.calls.map(call => call[2]);
  expect(hashes).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/), hashes[0]]);
});

it('keeps one immutable owner basis when weights, ICP, and taxonomy change mid-run', async () => {
  const ids = [contactId, `${contactId.slice(0, -1)}4`];
  const originalProfile = {
    id: 'weight-old', name: 'default', description: null, isDefault: true,
    weights: { icp_fit: 1, relationship_strength: 0 },
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  };
  const originalIcp = {
    id: 'icp-old', name: 'Owner', description: null, isActive: true,
    criteria: { roles: ['Engineer'], industries: ['Software'] }, weightOverrides: {},
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  };
  mockedQueries.getAllContactIds.mockResolvedValue(ids);
  mockedQueries.getDefaultWeightProfile.mockResolvedValue(originalProfile);
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([originalIcp]);
  jest.mocked(resolveTaxonomyChain).mockResolvedValue({
    industry: { name: 'Software' }, niche: null,
  } as Awaited<ReturnType<typeof resolveTaxonomyChain>>);

  let releaseFirst!: () => void;
  let firstStored!: () => void;
  let runCompleted!: () => void;
  const hold = new Promise<void>(resolve => { releaseFirst = resolve; });
  const first = new Promise<void>(resolve => { firstStored = resolve; });
  const completed = new Promise<void>(resolve => { runCompleted = resolve; });
  mockedQueries.upsertContactScore.mockImplementationOnce(async () => {
    firstStored();
    await hold;
    return { comparable: true, previous: null };
  });
  mockedQueries.updateScoringRun.mockImplementation(async (_runId, updates) => {
    if (updates.status === 'completed') runCompleted();
  });

  expect(await triggerRescoreAll()).toBe('run-1');
  await first;
  originalProfile.weights.icp_fit = 0;
  originalIcp.criteria.roles[0] = 'Sales';
  mockedQueries.getDefaultWeightProfile.mockResolvedValue({ ...originalProfile, id: 'weight-new' });
  mockedQueries.getActiveIcpProfiles.mockResolvedValue([{
    ...originalIcp, id: 'icp-new', criteria: { roles: ['Sales'], industries: ['Finance'] },
  }]);
  jest.mocked(resolveTaxonomyChain).mockResolvedValue({
    industry: { name: 'Finance' }, niche: null,
  } as Awaited<ReturnType<typeof resolveTaxonomyChain>>);
  releaseFirst();
  await completed;

  const scores = mockedQueries.upsertContactScore.mock.calls.map(call => call[1]);
  expect(scores).toHaveLength(2);
  expect(scores[0].compositeScore).toBe(1);
  expect(scores[1].compositeScore).toBe(scores[0].compositeScore);
  expect(mockedQueries.upsertContactIcpFit.mock.calls.map(call => call[1])).toEqual(['icp-old', 'icp-old']);
  expect(mockedQueries.getDefaultWeightProfile).toHaveBeenCalledTimes(1);
  expect(mockedQueries.getActiveIcpProfiles).toHaveBeenCalledTimes(1);
  expect(mockedQueries.getScoringBaselines).toHaveBeenCalledTimes(1);
  expect(resolveTaxonomyChain).toHaveBeenCalledTimes(1);
});

it('fails closed when the target flag is disabled', async () => {
  RESEARCH_FLAGS.targets = false;
  const response = await previewGet(new Request(`http://localhost/api/scoring/context-preview?contactId=${contactId}&targetId=${targetA}`) as NextRequest);
  expect(response.status).toBe(422);
  expect(mockedLens).not.toHaveBeenCalled();
});

it('serves a validated read-only preview with explicit basis', async () => {
  const invalid = await previewGet(new Request(`http://localhost/api/scoring/context-preview?contactId=bad&targetId=${targetA}`) as NextRequest);
  expect(invalid.status).toBe(400);
  expect(mockedLens).not.toHaveBeenCalled();

  const response = await previewGet(new Request(`http://localhost/api/scoring/context-preview?contactId=${contactId}&targetId=${targetA}`) as NextRequest);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.basis).toMatchObject({
    kind: 'lens-preview', targetId: targetA, lensId: 'lens-a', selectedIcpId: 'icp-a',
    weightProfileId: 'default', scoringVersion: 1,
  });
  expect(mockedQueries.upsertContactScore).not.toHaveBeenCalled();
  expect(mockedQueries.upsertContactIcpFit).not.toHaveBeenCalled();
});
