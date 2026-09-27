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
    expect(allSql).toMatch(/LEFT JOIN contact_scores cs ON cs\.contact_id = c\.id/);
    expect(allSql).toMatch(/cs\.tier/);
    expect(allSql).toMatch(/cs\.composite_score/);
    expect(allSql).not.toMatch(/c\.tier|c\.composite_score/);
  });

  it('still attaches clusterId on the nicheId-filtered path', async () => {
    const mockQuery = setupMockQuery();
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
    const nodesSql = mockQuery.mock.calls.map((c) => String(c[0]))
      .find((sql) => sql.includes('cluster_memberships'));
    expect(nodesSql).toMatch(/FROM contact_icp_fits cif/);
    expect(nodesSql).toMatch(/JOIN icp_profiles ip ON ip\.id = cif\.icp_profile_id/);
    expect(nodesSql).not.toMatch(/niche_memberships/);
  });
});

// ADR-027 graph re-rooting — `?primaryTargetId=<research_targets.id>` ports
// the neighborhood-CTE re-root SQL from `/api/graph/data/route.ts` (the
// unwired implementation) onto this route, which is the one the live Graph
// tab actually calls. See the route's file-header comment for why the wire
// param keeps the `primaryTargetId` name even though the caller is
// conceptually passing the current *secondary* target.
describe('/api/graph/sigma-data re-rooting (?primaryTargetId=)', () => {
  function targetRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 't1',
      tenant_id: 'tenant-1',
      kind: 'contact',
      owner_id: null,
      contact_id: 'c1',
      company_id: null,
      label: 'Alice',
      pinned: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      last_used_at: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  function setupMockQueryWithTarget(
    row: Record<string, unknown> | null,
    nodeRows = NODE_ROWS
  ) {
    const mockQuery = jest.requireMock('@/lib/db/client').query as jest.Mock;
    mockQuery.mockReset();
    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM research_targets WHERE id')) {
        return mockRows(row ? [row] : []);
      }
      if (text.includes('cluster_memberships')) {
        // Both the re-rooted and default nodes queries join
        // cluster_memberships, so this one mock covers either shape.
        return mockRows(nodeRows);
      }
      if (text.includes('FROM companies WHERE id')) {
        return mockRows([{ id: 'co-1', name: 'Acme' }]);
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

  beforeEach(() => {
    jest.resetModules();
  });

  it('re-roots on a contact target: neighborhood CTE, keyed on the resolved contact id', async () => {
    const mockQuery = setupMockQueryWithTarget(targetRow());
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request(
      'http://x/api/graph/sigma-data?limit=10&primaryTargetId=t1',
      { method: 'GET' }
    );
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const nodesCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes('WITH neighborhood')
    );
    expect(nodesCall).toBeDefined();
    expect(String(nodesCall![0])).toMatch(/INNER JOIN neighborhood/);
    expect(String(nodesCall![0])).toMatch(
      /source_contact_id = \$1 OR target_contact_id = \$1/
    );
    // rootContactId (resolved from the target's contact_id), minPagerank, limit
    expect(nodesCall![1]).toEqual(['c1', 0, 10]);
    const edgeCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes('SELECT id, source_contact_id, target_contact_id, edge_type, weight')
    );
    expect(String(edgeCall?.[0])).toContain('source_contact_id = ANY($2::uuid[])');
    expect(edgeCall?.[1]).toEqual([
      expect.any(Array),
      ['c1', 'c2'],
    ]);
    expect((await res.json()).data.focusNodeId).toBe('c1');
  });

  it('falls through to the default top-PageRank listing for kind="self"', async () => {
    const mockQuery = setupMockQueryWithTarget(
      targetRow({ kind: 'self', contact_id: null, owner_id: 'owner-1' })
    );
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request(
      'http://x/api/graph/sigma-data?limit=10&primaryTargetId=t1',
      { method: 'GET' }
    );
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const neighborhoodCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes('WITH neighborhood')
    );
    expect(neighborhoodCall).toBeUndefined();
    expect((await res.json()).data.focusNodeId).toBeNull();
  });

  it('restores the default self graph after secondary is cleared', async () => {
    const mockQuery = setupMockQueryWithTarget(null);
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const res = await GET(new Request(
      'http://x/api/graph/sigma-data?limit=10',
    ) as unknown as import('next/server').NextRequest);
    const data = (await res.json()).data;
    expect(data.focusNodeId).toBeNull();
    expect(data.nodes.every((node: { attributes: { kind: string } }) => node.attributes.kind === 'contact')).toBe(true);
    expect(mockQuery.mock.calls.find((call) => String(call[0]).includes('WITH neighborhood'))).toBeUndefined();
  });

  it('centers a company and returns its linked contacts as visible graph nodes', async () => {
    const mockQuery = setupMockQueryWithTarget(
      targetRow({ kind: 'company', contact_id: null, company_id: 'co-1' })
    );
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request(
      'http://x/api/graph/sigma-data?limit=10&primaryTargetId=t1',
      { method: 'GET' }
    );
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const neighborhoodCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes('WITH neighborhood')
    );
    expect(neighborhoodCall).toBeDefined();
    expect(neighborhoodCall![1]).toEqual(['co-1', 0, 10]);
    expect(String(neighborhoodCall![0])).toMatch(/current_company_id = \$1/);
    expect(String(neighborhoodCall![0])).toMatch(/FROM work_history WHERE company_id = \$1/);
    expect(String(neighborhoodCall![0])).toMatch(/target_company_id = \$1/);
    expect(String(neighborhoodCall![0])).toMatch(/INNER JOIN neighborhood/);
    const data = (await res.json()).data;
    expect(data.focusNodeId).toBe('co-1');
    expect(data.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'co-1', attributes: expect.objectContaining({ label: 'Acme', kind: 'company' }) }),
      expect.objectContaining({ key: 'c1', attributes: expect.objectContaining({ kind: 'contact' }) }),
    ]));
    expect(data.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'co-1', target: 'c1', attributes: { type: 'company-context', weight: 1 } }),
    ]));
  });

  it('keeps a company focal node visible when it has no linked contacts', async () => {
    setupMockQueryWithTarget(
      targetRow({ kind: 'company', contact_id: null, company_id: 'co-1' }),
      []
    );
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const res = await GET(new Request(
      'http://x/api/graph/sigma-data?primaryTargetId=t1',
    ) as unknown as import('next/server').NextRequest);
    const data = (await res.json()).data;
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0].key).toBe('co-1');
    expect(data.edges).toHaveLength(0);
  });

  it('falls through to the default listing when the target id does not resolve', async () => {
    const mockQuery = setupMockQueryWithTarget(null);
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request(
      'http://x/api/graph/sigma-data?limit=10&primaryTargetId=missing',
      { method: 'GET' }
    );
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const neighborhoodCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes('WITH neighborhood')
    );
    expect(neighborhoodCall).toBeUndefined();
  });

  it('re-rooting still attaches the dominant cluster id to the returned nodes', async () => {
    setupMockQueryWithTarget(targetRow());
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request(
      'http://x/api/graph/sigma-data?limit=10&primaryTargetId=t1',
      { method: 'GET' }
    );
    const res = await GET(req as unknown as import('next/server').NextRequest);
    const json = await res.json();
    const alice = json.data.nodes.find((n: { key: string }) => n.key === 'c1');
    expect(alice.attributes.clusterId).toBe('cluster-a');
  });

  it('re-rooting takes precedence over nicheId when both are passed', async () => {
    const mockQuery = setupMockQueryWithTarget(targetRow());
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request(
      'http://x/api/graph/sigma-data?limit=10&primaryTargetId=t1&nicheId=niche-1',
      { method: 'GET' }
    );
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const nodesCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes('cluster_memberships')
    );
    expect(nodesCall).toBeDefined();
    expect(String(nodesCall![0])).toMatch(/WITH neighborhood/);
    expect(String(nodesCall![0])).not.toMatch(/niche_memberships/);
  });
});
