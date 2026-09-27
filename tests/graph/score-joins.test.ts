jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));

import { query } from '@/lib/db/client';
import { GET } from '@/app/api/graph/ego/route';
import { syncContactsGraph, computeRuVectorPageRank, computeRuVectorCentrality } from '@/lib/graph/ruvector-sync';
import type { PoolClient } from 'pg';
import { PUBLISHED_GRAPH_EDGE_TYPES } from '@/lib/graph/edge-policy';

const mockQuery = query as jest.MockedFunction<typeof query>;

function rows(values: unknown[]) {
  return { rows: values } as never;
}

const contacts = [
  {
    id: 'scored', full_name: 'Scored Contact', tier: 'gold', degree: 1,
    composite_score: 0.8, current_company: 'Acme', title: 'Engineer',
  },
  {
    id: 'unscored', full_name: 'Unscored Contact', tier: null, degree: 2,
    composite_score: null, current_company: null, title: null,
  },
];

beforeEach(() => {
  mockQuery.mockReset();
});

it('loads ego nodes through the unique score join and retains contacts without scores', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('CASE WHEN source_contact_id')) return rows([{ neighbor_id: 'unscored', edge_type: 'CONNECTED_TO', weight: 1 }]);
    if (sql.includes('FROM contacts c')) return rows(contacts);
    return rows([]);
  });

  const response = await GET(new Request('http://localhost/api/graph/ego?contactId=scored&depth=1') as import('next/server').NextRequest);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.nodes).toHaveLength(2);
  const unscored = body.data.nodes.find((node: { key: string }) => node.key === 'unscored');
  expect(unscored.attributes).toMatchObject({ tier: 'unscored', score: 0, color: '#d1d5db' });

  const nodeSql = mockQuery.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('FROM contacts c'));
  expect(nodeSql).toContain('LEFT JOIN contact_scores cs ON cs.contact_id = c.id');
  expect(nodeSql).toContain('cs.tier');
  expect(nodeSql).toContain('cs.composite_score');
  expect(nodeSql).not.toMatch(/c\.(tier|composite_score)/);
});

it('syncs scored and unscored contacts using score columns from contact_scores', async () => {
  let nextNodeId = 1;
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM contacts c')) return rows(contacts);
    if (sql.includes('ruvector_add_node')) return rows([{ ruvector_add_node: nextNodeId++ }]);
    return rows([]);
  });
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const ids = await syncContactsGraph({ query: mockQuery } as unknown as PoolClient);
    expect([...ids.keys()]).toEqual(['scored', 'unscored']);
    const nodeCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes('ruvector_add_node'));
    expect(nodeCalls).toHaveLength(2);
    expect(nodeCalls[0][1]?.[1]).toEqual(['gold']);
    expect(JSON.parse(String(nodeCalls[0][1]?.[2]))).toMatchObject({ tier: 'gold', score: 0.8 });
    expect(nodeCalls[1][1]?.[1]).toEqual(['unscored']);
    expect(JSON.parse(String(nodeCalls[1][1]?.[2]))).toMatchObject({ tier: 'unscored', score: 0 });

    const contactSql = mockQuery.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('FROM contacts c'));
    expect(contactSql).toContain('LEFT JOIN contact_scores cs ON cs.contact_id = c.id');
    expect(contactSql).toContain('cs.tier');
    expect(contactSql).toContain('cs.composite_score');
    expect(contactSql).not.toMatch(/c\.(tier|composite_score)/);
    const edgeRead = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM edges'));
    expect(edgeRead?.[1]).toEqual([PUBLISHED_GRAPH_EDGE_TYPES]);
    expect(contactSql).toContain('WHERE c.is_archived = FALSE');
  } finally {
    logSpy.mockRestore();
  }
});

it('refuses direct or duplicate graph sync before any graph mutation', async () => {
  await expect(syncContactsGraph()).rejects.toThrow('Direct graph sync is retired');
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('ruvector_list_graphs')) return rows([{ exists: true }]);
    return rows([]);
  });
  await expect(syncContactsGraph({ query: mockQuery } as unknown as PoolClient)).rejects.toThrow('already exists');
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('ruvector_create_graph'))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('ruvector_add_node'))).toBe(false);
});

it('direct native metric helpers give a migration error without reading retired contacts', async () => {
  await expect(computeRuVectorPageRank()).rejects.toThrow('computeGraphSnapshot()');
  await expect(computeRuVectorCentrality()).rejects.toThrow('computeGraphSnapshot()');
  expect(mockQuery).not.toHaveBeenCalled();
});
