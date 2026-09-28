jest.mock('@/lib/db/client', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('@/lib/graph/knowledge-local', () => ({
  buildKnowledgeGraph: jest.fn(),
  getCachedSnapshot: jest.fn(),
  saveSnapshot: jest.fn(),
}));
jest.mock('@/lib/auth/operator-session', () => ({ hasOperatorSession: jest.fn() }));
jest.mock('@/lib/db/queries/action-log', () => ({ recordAction: jest.fn() }));

import { NextRequest } from '../../app/node_modules/next/server';
import { query, transaction } from '@/lib/db/client';
import { buildKnowledgeGraph, getCachedSnapshot, saveSnapshot } from '@/lib/graph/knowledge-local';
import { hasOperatorSession } from '@/lib/auth/operator-session';
import { recordAction } from '@/lib/db/queries/action-log';
import { GET as conversations } from '@/app/api/graph/conversations/route';
import { GET as knowledge, POST as refreshKnowledge } from '@/app/api/graph/knowledge/route';
import { POST as eraseContact } from '@/app/api/admin/erasure/route';

const queryMock = query as jest.Mock;
const buildMock = buildKnowledgeGraph as jest.Mock;
const cacheMock = getCachedSnapshot as jest.Mock;
const saveMock = saveSnapshot as jest.Mock;
const sessionMock = hasOperatorSession as jest.Mock;
const transactionMock = transaction as jest.Mock;
const recordActionMock = recordAction as jest.Mock;
const graph = { nodes: [], edges: [], clusters: [] };

function request(path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3750${path}`, {
    method,
    headers: {
      host: 'localhost:3750',
      origin: 'http://localhost:3750',
      'sec-fetch-site': 'same-origin',
      ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(method !== 'GET' ? { body: '{}' } : {}),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionMock.mockResolvedValue(true);
  transactionMock.mockImplementation(async (fn: (client: { query: jest.Mock }) => Promise<unknown>) =>
    fn({ query: jest.fn().mockResolvedValue({ rows: [] }) }));
});

describe('conversation graph endpoint', () => {
  it('uses message rows across imports, preserving old activity on a recently created edge', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{
        id: 'edge-1', source_contact_id: 'self', target_contact_id: 'other',
        weight: 2, properties: { message_count: 1 }, message_count: 3,
        last_message_at: new Date('2019-01-02T03:04:05.000Z'),
      }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'self', full_name: 'Self' }, { id: 'other', full_name: 'Other' },
      ] });

    const response = await conversations(request('/api/graph/conversations'));
    expect(response.status).toBe(200);
    const edge = (await response.json()).data.edges[0];
    expect(edge.lastActivity).toBe('2019-01-02T03:04:05.000Z');
    expect(edge.messageCount).toBe(3);
    expect(queryMock.mock.calls[0][0]).toContain('MAX(unique_messages.sent_at)');
    expect(queryMock.mock.calls[0][0]).toContain('SELECT DISTINCT direction, subject, content, conversation_id, sent_at, source');
    expect(queryMock.mock.calls[0][0]).toContain('DISTINCT ON (e.target_contact_id)');
    expect(queryMock.mock.calls[0][0]).not.toContain('e.updated_at');
  });

  it('returns an empty graph and reports query failure', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect((await (await conversations(request('/api/graph/conversations'))).json()).data).toEqual({ nodes: [], edges: [] });
    queryMock.mockRejectedValueOnce(new Error('synthetic failure'));
    expect((await conversations(request('/api/graph/conversations'))).status).toBe(500);
  });
});

describe('knowledge graph endpoint', () => {
  const knowledgeRequest = (suffix = '', method = 'GET', headers: Record<string, string> = {}) =>
    request(`/api/graph/knowledge${suffix}`, method, headers);

  it('returns a valid cached graph without rebuilding', async () => {
    cacheMock.mockResolvedValueOnce(graph);
    const response = await knowledge(knowledgeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: graph, cached: true });
    expect(buildMock).not.toHaveBeenCalled();
  });

  it('builds and caches an uncached graph', async () => {
    cacheMock.mockResolvedValueOnce(null);
    buildMock.mockResolvedValueOnce(graph);
    const response = await knowledge(knowledgeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: graph, cached: false });
    const client = buildMock.mock.calls[0][1];
    expect(client.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(1733164046, 1)');
    expect(buildMock).toHaveBeenCalledWith(undefined, client);
    expect(saveMock).toHaveBeenCalledWith(graph, null, client);
  });

  it('rejects GET refresh but allows an authorized POST rebuild', async () => {
    expect((await knowledge(knowledgeRequest('?refresh=true'))).status).toBe(405);
    expect(buildMock).not.toHaveBeenCalled();
    buildMock.mockResolvedValueOnce(graph);
    const response = await refreshKnowledge(knowledgeRequest('', 'POST'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: graph, cached: false });
    expect(cacheMock).not.toHaveBeenCalled();
    expect(saveMock).toHaveBeenCalledWith(graph, null, expect.objectContaining({ query: expect.any(Function) }));
  });

  it('rejects malformed niche IDs and reports builder failure', async () => {
    expect((await knowledge(knowledgeRequest('?nicheId=bad'))).status).toBe(400);
    expect((await refreshKnowledge(knowledgeRequest('?nicheId=bad', 'POST'))).status).toBe(400);
    cacheMock.mockResolvedValueOnce(null);
    buildMock.mockRejectedValueOnce(new Error('synthetic failure'));
    expect((await knowledge(knowledgeRequest())).status).toBe(500);
  });

  it('returns 404 for a well-formed missing niche before cache or snapshot writes', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    queryMock.mockResolvedValue({ rows: [] });
    expect((await knowledge(knowledgeRequest(`?nicheId=${id}`))).status).toBe(404);
    expect((await refreshKnowledge(knowledgeRequest(`?nicheId=${id}`, 'POST'))).status).toBe(404);
    expect(cacheMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('denies direct graph handlers before reads or snapshot writes', async () => {
    sessionMock.mockResolvedValue(false);
    expect((await conversations(request('/api/graph/conversations'))).status).toBe(401);
    expect((await knowledge(knowledgeRequest())).status).toBe(401);
    expect((await refreshKnowledge(knowledgeRequest('', 'POST'))).status).toBe(401);
    sessionMock.mockResolvedValue(true);
    expect((await refreshKnowledge(knowledgeRequest('', 'POST', {
      origin: 'https://foreign.example', 'sec-fetch-site': 'cross-site',
    }))).status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
    expect(cacheMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('does not report success when snapshot persistence fails', async () => {
    buildMock.mockResolvedValueOnce(graph);
    saveMock.mockRejectedValueOnce(new Error('synthetic write failure'));
    expect((await refreshKnowledge(knowledgeRequest('', 'POST'))).status).toBe(500);
  });
});

it('removes affected knowledge snapshots within contact erasure transaction', async () => {
  const contactId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  queryMock.mockResolvedValueOnce({ rows: [{ id: contactId, full_name: 'Synthetic Contact' }] });
  recordActionMock.mockResolvedValue(undefined);
  const clientQuery = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  transactionMock.mockImplementation(async (fn: (client: { query: jest.Mock }) => Promise<void>) =>
    fn({ query: clientQuery }));
  const erasureRequest = new NextRequest('http://localhost:3750/api/admin/erasure', {
    method: 'POST',
    headers: {
      host: 'localhost:3750', origin: 'http://localhost:3750',
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
    },
    body: JSON.stringify({ contactId, confirmToken: 'CONFIRM_ERASURE' }),
  });
  expect((await eraseContact(erasureRequest)).status).toBe(200);
  expect(clientQuery).toHaveBeenCalledWith(
    expect.stringContaining('DELETE FROM knowledge_snapshots'), [contactId]
  );
  const snapshotCall = clientQuery.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM knowledge_snapshots'));
  const lockCall = clientQuery.mock.calls.find(([sql]) => String(sql).includes('pg_advisory_xact_lock(1733164046, 1)'));
  const contactCall = clientQuery.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM contacts WHERE id'));
  expect(lockCall).toBeDefined();
  expect(snapshotCall).toBeDefined();
  expect(contactCall).toBeDefined();
  expect(clientQuery.mock.calls.indexOf(lockCall)).toBeLessThan(clientQuery.mock.calls.indexOf(snapshotCall));
  expect(clientQuery.mock.calls.indexOf(snapshotCall)).toBeLessThan(clientQuery.mock.calls.indexOf(contactCall));
});
