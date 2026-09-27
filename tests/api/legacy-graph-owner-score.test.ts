import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({ NextResponse: { json: Response.json } }), { virtual: true });

const queryMock = jest.fn();
const releaseMock = jest.fn();
const createJobMock = jest.fn();
const drainMock = jest.fn();
const importContactsMock = jest.fn();
jest.mock('@/lib/db/client', () => ({ getPool: () => ({ connect: async () => ({ query: queryMock, release: releaseMock }) }) }));
jest.mock('@/lib/import/legacy-contacts', () => ({
  importLegacyContacts: (...args: unknown[]) => importContactsMock(...args),
}));
jest.mock('@/lib/scoring/import-job', () => ({
  createLegacyImportScoreJob: (...args: unknown[]) => createJobMock(...args),
  drainPendingImportScoreJobs: (...args: unknown[]) => drainMock(...args),
}));
jest.mock('fs/promises', () => ({ stat: jest.fn().mockResolvedValue({}), readFile: jest.fn() }));

import { readFile } from 'fs/promises';
import { POST } from '@/app/api/import/legacy-graph/route';

const graph = {
  contacts: { 'https://example.test/person': {
    profileUrl: 'https://example.test/person', name: 'Ada Example', degree: 1,
    mutualConnections: 4, scores: { goldScore: 95, tier: 'gold', networkHub: 70 },
    activity: { topics: ['AI'], posts: [{ text: 'post' }] },
  } }, companies: {}, clusters: {}, edges: [],
};

describe('legacy graph import owner score boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryMock.mockReset();
    releaseMock.mockReset();
    createJobMock.mockReset().mockResolvedValue('550e8400-e29b-41d4-a716-446655440099');
    drainMock.mockReset().mockResolvedValue(1);
    importContactsMock.mockReset().mockResolvedValue({
      urlToUuid: new Map([['https://example.test/person', '550e8400-e29b-41d4-a716-446655440003']]),
      importedIds: ['550e8400-e29b-41d4-a716-446655440003'],
    });
    (readFile as jest.Mock).mockResolvedValue(JSON.stringify(graph));
    queryMock.mockImplementation(async (sql: string) => ({
      rows: sql.includes('RETURNING id') ? [{ id: '550e8400-e29b-41d4-a716-446655440003' }] : [],
    }));
  });

  it.each([false, true])('ignores unverified legacy scores with rescore=%s', async rescore => {
    const response = await POST(new Request('http://localhost/api/import/legacy-graph', {
      method: 'POST', body: JSON.stringify({ graphPath: '/data/graph.json', rescore }),
    }) as NextRequest);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imported.scores).toBe(0);
    expect(body.imported.legacyScoresIgnored).toBe(1);
    expect(importContactsMock).toHaveBeenCalledWith(expect.anything(), graph.contacts, expect.any(Map));
    const sql = queryMock.mock.calls.map(call => String(call[0])).join('\n');
    expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?(?:contact_scores|score_dimensions|referral_dimensions)/i);
    expect(sql).toContain('INSERT INTO graph_metrics');
    expect(sql).toContain('INSERT INTO behavioral_observations');
    expect(sql).toContain('COMMIT');
    expect(createJobMock).toHaveBeenCalledTimes(rescore ? 1 : 0);
    expect(drainMock).toHaveBeenCalledTimes(rescore ? 1 : 0);
    if (rescore) {
      expect(createJobMock).toHaveBeenCalledWith(expect.anything(),
        ['550e8400-e29b-41d4-a716-446655440003']);
      expect(body.rescoreJobId).toBe('550e8400-e29b-41d4-a716-446655440099');
      const commitOrder = queryMock.mock.invocationCallOrder[queryMock.mock.calls.findIndex(
        call => call[0] === 'COMMIT'
      )];
      expect(createJobMock.mock.invocationCallOrder[0]).toBeLessThan(commitOrder);
      expect(queryMock.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    }
  });

  it('rejects invalid request before reading graph or opening a transaction', async () => {
    const response = await POST(new Request('http://localhost/api/import/legacy-graph', {
      method: 'POST', body: JSON.stringify({ graphPath: '/data/graph.json', rescore: 'yes' }),
    }) as NextRequest);
    expect(response.status).toBe(400);
    expect(readFile).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before reading graph or opening a transaction', async () => {
    const response = await POST(new Request('http://localhost/api/import/legacy-graph', {
      method: 'POST', body: '{bad',
    }) as NextRequest);
    expect(response.status).toBe(400);
    expect(readFile).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});
