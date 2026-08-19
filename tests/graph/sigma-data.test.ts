// /api/graph/sigma-data route tests — cluster-id join for the
// ClusterSidebar "highlight" feature (Sigma.js cutover follow-up).
//
// `cluster_memberships` is many-to-many (a contact can score into several
// clusters via `membership_score`), so the route picks the
// highest-`membership_score` row per contact as "the" cluster for that
// node — the same dominant-value pattern already used elsewhere in this
// route for pagerank-driven sizing. These tests pin that choice at the SQL
// level (LATERAL join, ORDER BY membership_score DESC, LIMIT 1) so a future
// change to the join can't silently drop it, and pin the response contract
// (clusterId present, null for unclustered contacts) that sigma-graph.tsx's
// node reducer depends on.
//
// Follows the mocked-`@/lib/db/client` + direct route-import pattern
// established in tests/perf/graph-data.test.ts — `next/server`'s
// NextResponse/NextRequest work fine against a plain `Request` in this
// jest environment.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

function mockRows<T>(rows: T[]) {
  return Promise.resolve({ rows, command: '', rowCount: rows.length, oid: 0, fields: [] });
}

const NODE_ROWS = [
  {
    id: 'c1',
    full_name: 'Alice',
    tier: 'gold',
    degree: 3,
    composite_score: 0.8,
    current_company: 'Acme',
    title: 'CEO',
    pagerank: 0.02,
    betweenness_centrality: 0.1,
    cluster_id: 'cluster-a',
  },
  {
    id: 'c2',
    full_name: 'Bob',
    tier: 'silver',
    degree: 1,
    composite_score: 0.4,
    current_company: null,
    title: null,
    pagerank: 0.01,
    betweenness_centrality: 0,
    cluster_id: null, // unclustered contact — the LEFT JOIN LATERAL must not drop it
  },
];

function setupMockQuery() {
  const mockQuery = jest.requireMock('@/lib/db/client').query as jest.Mock;
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql: unknown) => {
    const text = String(sql);
    if (text.includes('cluster_memberships')) {
      // The only query that joins cluster_memberships is the nodes query.
      return mockRows(NODE_ROWS);
    }
    if (text.includes('FROM edges')) {
      return mockRows([]);
    }
    if (text.includes('FROM contacts WHERE is_archived')) {
      return mockRows([{ cnt: String(NODE_ROWS.length) }]);
    }
    if (text.includes('FROM clusters')) {
      return mockRows([{ cnt: '1' }]);
    }
    return mockRows([]);
  });
  return mockQuery;
}

describe('/api/graph/sigma-data cluster id', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('attaches the dominant cluster id to each node, null for unclustered contacts', async () => {
    setupMockQuery();
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request('http://x/api/graph/sigma-data?limit=10', {
      method: 'GET',
    });
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const json = await res.json();
    const attrsById = new Map<string, { clusterId: string | null }>(
      json.data.nodes.map((n: { key: string; attributes: { clusterId: string | null } }) => [
        n.key,
        n.attributes,
      ])
    );
    expect(attrsById.get('c1')?.clusterId).toBe('cluster-a');
    expect(attrsById.get('c2')?.clusterId).toBeNull();
  });

  it('picks the highest-membership_score cluster via a LATERAL join (SQL-shape proxy)', async () => {
    const mockQuery = setupMockQuery();
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request('http://x/api/graph/sigma-data?limit=10', {
      method: 'GET',
    });
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const allSql = mockQuery.mock.calls.map((c) => String(c[0])).join('\n---\n');
    expect(allSql).toMatch(/LEFT JOIN LATERAL/);
    expect(allSql).toMatch(/FROM cluster_memberships cm/);
    expect(allSql).toMatch(/ORDER BY cm\.membership_score DESC/);
    expect(allSql).toMatch(/LIMIT 1/);
  });

  it('still attaches clusterId on the nicheId-filtered path', async () => {
    setupMockQuery();
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request(
      'http://x/api/graph/sigma-data?limit=10&nicheId=niche-1',
      { method: 'GET' }
    );
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const json = await res.json();
    const alice = json.data.nodes.find(
      (n: { key: string }) => n.key === 'c1'
    );
    expect(alice.attributes.clusterId).toBe('cluster-a');
  });
});
