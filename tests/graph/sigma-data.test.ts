// /api/graph/sigma-data membership contract and re-rooting.
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
    current_company_id: 'co-1',
    canonical_company_name: 'Acme Inc',
    industry_key: 'software',
    title: 'CEO',
    pagerank: 0.02,
    betweenness_centrality: 0.1,
  },
  {
    id: 'c2',
    full_name: 'Bob',
    tier: 'silver',
    degree: 1,
    composite_score: 0.4,
    current_company: null,
    current_company_id: null,
    canonical_company_name: null,
    industry_key: null,
    title: null,
    pagerank: 0.01,
    betweenness_centrality: 0,
  },
];

const STORED_ROWS = [
  { contact_id: 'c1', cluster_id: 'cluster-a', label: 'Community A', algorithm: 'spectral-ruvector', total_count: 3 },
  { contact_id: 'c1', cluster_id: 'cluster-b', label: 'Community B', algorithm: 'spectral-ruvector', total_count: 2 },
  { contact_id: 'c1', cluster_id: 'legacy-a', label: 'Imported', algorithm: 'legacy-import', total_count: 5 },
];
const OUTSIDE_GROUP_ID = '11111111-1111-4111-8111-111111111111';

function setupMockQuery(nodeRows = NODE_ROWS, storedRows = STORED_ROWS) {
  const mockQuery = jest.requireMock('@/lib/db/client').query as jest.Mock;
  const mockTransaction = jest.requireMock('@/lib/db/client').transaction as jest.Mock;
  mockTransaction.mockImplementation((fn: (client: { query: jest.Mock }) => Promise<unknown>) => fn({ query: mockQuery }));
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql: unknown) => {
    const text = String(sql);
    if (text.includes("to_regclass('public.idx_cluster_memberships_cluster_id')")) {
      return mockRows([{ membership_index: 'idx_cluster_memberships_cluster_id', publication_table: 'graph_compute_state' }]);
    }
    if (text.includes('SELECT EXISTS(SELECT 1 FROM graph_compute_state')) return mockRows([{ present: true }]);
    if (text.includes('SELECT cl.id AS cluster_id')) return mockRows([
      ...storedRows.map(({ cluster_id, label, algorithm, total_count }) => ({ cluster_id, label, algorithm, total_count })),
      { cluster_id: OUTSIDE_GROUP_ID, label: 'Outside view', algorithm: 'spectral-ruvector', total_count: 2 },
    ]);
    if (text.includes('SELECT cm.contact_id, cm.cluster_id')) return mockRows(storedRows);
    if (text.includes("SELECT 'company' AS method")) return mockRows([
      { method: 'company', identity: 'co-1', label: 'Acme Inc', total_count: 4 },
      { method: 'industry', identity: 'software', label: 'Software', total_count: 7 },
    ]);
    if (text.includes('SELECT c.id, c.full_name')) return mockRows(nodeRows);
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

describe('/api/graph/sigma-data groups', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns all inferred, company and industry memberships with distinct counts', async () => {
    setupMockQuery();
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request('http://x/api/graph/sigma-data?limit=10', {
      method: 'GET',
    });
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const json = await res.json();
    const alice = json.data.nodes.find((n: { key: string }) => n.key === 'c1');
    expect(alice.attributes.groupIds).toEqual(expect.arrayContaining([
      'community:cluster-a', 'community:cluster-b', 'company:co-1',
      expect.stringMatching(/^industry:/),
    ]));
    expect(json.data.groups.find((g: { id: string }) => g.id === 'company:co-1'))
      .toMatchObject({ label: 'Acme Inc', method: 'company', totalCount: 4, loadedCount: 1, visibleCount: 1 });
    expect(json.data.groups.find((g: { id: string }) => g.id === 'community:cluster-b'))
      .toMatchObject({ method: 'inferred-community', totalCount: 2, loadedCount: 1 });
    expect(json.data.groups.find((g: { id: string }) => g.id === 'community:legacy-a'))
      .toMatchObject({ method: 'imported-group', totalCount: 5, loadedCount: 1 });
    expect(json.data.groups.find((g: { id: string }) => g.id === `community:${OUTSIDE_GROUP_ID}`))
      .toMatchObject({ totalCount: 2, loadedCount: 0, visibleCount: 0 });
    const { isSelectedGroupRemoved } = await import('@/components/network/cluster-sidebar');
    expect(isSelectedGroupRemoved(json.data.groups, `community:${OUTSIDE_GROUP_ID}`)).toBe(false);
    expect(isSelectedGroupRemoved(json.data.groups, 'community:deleted')).toBe(true);
    expect(isSelectedGroupRemoved(json.data.groups, 'community:deleted', `community:${OUTSIDE_GROUP_ID}`)).toBe(false);
    expect(isSelectedGroupRemoved(json.data.groups, 'community:deleted', 'community:deleted')).toBe(true);
    expect(json.data.nodes.find((n: { key: string }) => n.key === 'c2').attributes.groupIds).toEqual([]);
  });

  it('pages exact members of a group entirely outside the loaded graph', async () => {
    const mockQuery = setupMockQuery();
    const baseline = mockQuery.getMockImplementation()!;
    const groupId = OUTSIDE_GROUP_ID;
    const memberId = '22222222-2222-4222-8222-222222222222';
    mockQuery.mockImplementation((sql: unknown, params: unknown[]) => {
      if (String(sql).includes('FROM contacts c LEFT JOIN companies co') && String(sql).includes('cluster_memberships cm')) {
        expect(params).toEqual([groupId, null, 51]);
        return mockRows([{ id: memberId, full_name: 'Outside Member', title: 'Engineer', company: null }]);
      }
      return baseline(sql, params);
    });
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const graphRes = await GET(new Request('http://x/api/graph/sigma-data?limit=6000') as import('next/server').NextRequest);
    expect((await graphRes.json()).data.groups.find((group: { id: string }) => group.id === `community:${groupId}`))
      .toMatchObject({ loadedCount: 0, totalCount: 2 });
    const res = await GET(new Request(`http://x/api/graph/sigma-data?memberGroupId=community:${groupId}`) as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      members: [{ id: memberId, full_name: 'Outside Member', title: 'Engineer', company: null }],
      nextCursor: null,
    });
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('SELECT c.id, c.full_name') && String(call[0]).includes('LIMIT $3'))).toBe(true);
    expect(mockQuery.mock.calls.filter((call) => String(call[0]).includes('FROM clusters cl'))).toHaveLength(1);
  });

  it('bounds member pages and uses the last delivered ID as the next cursor', async () => {
    const mockQuery = setupMockQuery();
    const baseline = mockQuery.getMockImplementation()!;
    const companyId = '33333333-3333-4333-8333-333333333333';
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
      full_name: `Member ${index}`, title: null, company: 'Example',
    }));
    mockQuery.mockImplementation((sql: unknown, params: unknown[]) =>
      String(sql).includes('FROM contacts c LEFT JOIN companies co') && String(sql).includes('c.current_company_id = $1::uuid')
        ? mockRows(rows) : baseline(sql, params));
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const first = await GET(new Request(`http://x/api/graph/sigma-data?memberGroupId=company:${companyId}`) as import('next/server').NextRequest);
    const page = (await first.json()).data;
    expect(page.members).toHaveLength(50);
    expect(page.nextCursor).toBe(rows[49].id);
    await GET(new Request(`http://x/api/graph/sigma-data?memberGroupId=company:${companyId}&memberCursor=${page.nextCursor}`) as import('next/server').NextRequest);
    const memberCalls = mockQuery.mock.calls.filter((call) => String(call[0]).includes('c.current_company_id = $1::uuid'));
    expect(memberCalls[1][1]).toEqual([companyId, rows[49].id, 51]);
  });

  it('pages the full catalog beyond the graph node cap with bounded rows', async () => {
    const mockQuery = setupMockQuery();
    const baseline = mockQuery.getMockImplementation()!;
    const rows = Array.from({ length: 101 }, (_, index) => ({
      identity: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
      label: `Outside community ${index}`, algorithm: 'spectral-ruvector', total_count: 3,
    }));
    mockQuery.mockImplementation((sql: unknown, params: unknown[]) =>
      String(sql).includes('SELECT cl.id::text AS identity') ? mockRows(rows) : baseline(sql, params));
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const response = await GET(new Request('http://x/api/graph/sigma-data?catalogCursor=community%3A') as import('next/server').NextRequest);
    expect(response.status).toBe(200);
    const page = (await response.json()).data;
    expect(page.groups).toHaveLength(100);
    expect(page.groups[99]).toMatchObject({ id: `community:${rows[99].identity}` });
    expect(page.groups[99]).not.toHaveProperty('loadedCount');
    expect(page.nextCursor).toBe(`community:${rows[99].identity}`);
    const query = mockQuery.mock.calls.find((call) => String(call[0]).includes('SELECT cl.id::text AS identity'));
    expect(query?.[1]).toEqual([null, 101]);
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('SELECT c.id, c.full_name'))).toBe(false);
  });

  it('reconciles a paged catalog row with counts from nodes already loaded on the graph', async () => {
    const { reconcileCatalogGroups } = await import('@/components/network/cluster-sidebar');
    const id = 'community:loaded';
    const groups = reconcileCatalogGroups(
      [{ id, label: 'Loaded', method: 'inferred-community', totalCount: 12 }],
      [{ id, label: 'Loaded', method: 'inferred-community', totalCount: 12, loadedCount: 3, visibleCount: 2 }]
    );
    expect(groups).toEqual([{ id, label: 'Loaded', method: 'inferred-community', totalCount: 12, loadedCount: 3, visibleCount: 2 }]);
  });

  it('includes a loaded group beyond 1000 larger catalog groups for later page reconciliation', async () => {
    const mockQuery = setupMockQuery();
    const baseline = mockQuery.getMockImplementation()!;
    const farId = '88888888-8888-4888-8888-888888888888';
    mockQuery.mockImplementation((sql: unknown, params: unknown[]) => {
      const text = String(sql);
      if (text.includes('SELECT cl.id AS cluster_id')) return mockRows(Array.from({ length: 1000 }, (_, i) => ({
        cluster_id: `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`,
        label: `Larger ${i}`, algorithm: 'spectral-ruvector', total_count: 10000 - i,
      })));
      if (text.includes('SELECT cm.contact_id, cm.cluster_id')) return mockRows([
        { contact_id: 'c1', cluster_id: farId, label: 'Far loaded', algorithm: 'spectral-ruvector' },
      ]);
      if (text.includes('SELECT cl.id::text AS identity, COUNT(c.id)::int AS total_count')) return mockRows([
        { identity: farId, total_count: 2 },
      ]);
      return baseline(sql, params);
    });
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const graph = (await (await GET(new Request('http://x/api/graph/sigma-data?limit=10') as import('next/server').NextRequest)).json()).data;
    expect(graph.groups.length).toBeGreaterThan(1000);
    expect(graph.nodes[0].attributes.groupIds).toContain(`community:${farId}`);
    const { reconcileCatalogGroups } = await import('@/components/network/cluster-sidebar');
    const catalog = [{ id: `community:${farId}`, label: 'Far loaded', method: 'inferred-community' as const, totalCount: 2 }];
    expect(reconcileCatalogGroups(catalog, graph.groups).find((group) => group.id === catalog[0].id))
      .toMatchObject({ loadedCount: 1, visibleCount: 1, totalCount: 2 });
  });

  it('pins a selected zero-loaded group omitted by the capped catalog and drops a deleted one', async () => {
    const mockQuery = setupMockQuery();
    const baseline = mockQuery.getMockImplementation()!;
    const companyId = '66666666-6666-4666-8666-666666666666';
    let exists = true;
    mockQuery.mockImplementation((sql: unknown, params: unknown[]) =>
      String(sql).includes('SELECT co.name AS label, COUNT(c.id)::int AS total_count FROM companies co')
        ? mockRows(exists ? [{ label: 'Far company', total_count: 4 }] : [])
        : baseline(sql, params));
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const request = () => new Request(`http://x/api/graph/sigma-data?limit=6000&selectedGroupId=company:${companyId}`) as import('next/server').NextRequest;
    const first = (await (await GET(request())).json()).data;
    expect(first.groups.find((group: { id: string }) => group.id === `company:${companyId}`))
      .toMatchObject({ loadedCount: 0, totalCount: 4 });
    exists = false;
    const second = (await (await GET(request())).json()).data;
    expect(second.groups.some((group: { id: string }) => group.id === `company:${companyId}`)).toBe(false);
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('SELECT co.name AS label') && call[1]?.[0] === companyId)).toBe(true);
  });

  it('recounts loaded groups that fall outside the catalog cap', async () => {
    const secondCompany = '77777777-7777-4777-8777-777777777777';
    const mockQuery = setupMockQuery([{ ...NODE_ROWS[0], current_company_id: secondCompany, current_company: 'Far company' }]);
    const baseline = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation((sql: unknown, params: unknown[]) => {
      const text = String(sql);
      if (text.includes('SELECT cl.id AS cluster_id')) return mockRows([]);
      if (text.includes('SELECT cl.id::text AS identity, COUNT(c.id)::int AS total_count')) {
        expect(params[0]).toContain('cluster-a');
        return mockRows([{ identity: 'cluster-a', total_count: 3 }, { identity: 'cluster-b', total_count: 2 }, { identity: 'legacy-a', total_count: 5 }]);
      }
      if (text.includes('SELECT c.current_company_id::text AS identity, COUNT(*)::int AS total_count')) {
        expect(params[0]).toEqual([secondCompany]);
        return mockRows([{ identity: secondCompany, total_count: 8 }]);
      }
      return baseline(sql, params);
    });
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const response = await GET(new Request('http://x/api/graph/sigma-data?limit=10') as import('next/server').NextRequest);
    expect(response.status).toBe(200);
    const groups = (await response.json()).data.groups;
    expect(groups.find((group: { id: string }) => group.id === 'community:cluster-a')).toMatchObject({ totalCount: 3, loadedCount: 1 });
    expect(groups.find((group: { id: string }) => group.id === `company:${secondCompany}`)).toMatchObject({ totalCount: 8, loadedCount: 1 });
  });

  it('uses one graph snapshot when a publication lands between node and membership reads', async () => {
    const poolQuery = setupMockQuery();
    const baseline = poolQuery.getMockImplementation()!;
    const transaction = jest.requireMock('@/lib/db/client').transaction as jest.Mock;
    let published = false;
    poolQuery.mockImplementation((sql: unknown, params: unknown[]) => {
      if (String(sql).includes('SELECT cm.contact_id, cm.cluster_id') && published) return mockRows([]);
      return baseline(sql, params);
    });
    const snapshotQuery = jest.fn(async (sql: unknown, params: unknown[]) => {
      const result = await baseline(sql, params);
      if (String(sql).includes('SELECT c.id, c.full_name')) published = true;
      return result;
    });
    transaction.mockImplementation((fn: (client: { query: jest.Mock }) => Promise<unknown>) => fn({ query: snapshotQuery }));
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const res = await GET(new Request('http://x/api/graph/sigma-data?limit=10') as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    expect(published).toBe(true);
    expect((await res.json()).data.nodes[0].attributes.groupIds).toContain('community:cluster-a');
    expect(snapshotQuery.mock.calls.some((call) => String(call[0]).includes('SELECT cm.contact_id, cm.cluster_id'))).toBe(true);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(String(snapshotQuery.mock.calls[0][0])).toContain('REPEATABLE READ READ ONLY');
  });

  it('returns an actionable 503 while the existing-volume graph migrations are missing', async () => {
    const poolQuery = setupMockQuery();
    poolQuery.mockImplementation((sql: unknown) => String(sql).includes("to_regclass('public.idx_cluster_memberships_cluster_id')")
      ? mockRows([{ membership_index: null, publication_table: null }]) : mockRows([]));
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const res = await GET(new Request('http://x/api/graph/sigma-data') as import('next/server').NextRequest);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/059 then 060/);
  });

  it('loads exact inferred membership and canonical company identity', async () => {
    const mockQuery = setupMockQuery();
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request('http://x/api/graph/sigma-data?limit=10', {
      method: 'GET',
    });
    const res = await GET(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);

    const allSql = mockQuery.mock.calls.map((c) => String(c[0])).join('\n---\n');
    expect(allSql).toMatch(/LEFT JOIN companies co ON co.id = c.current_company_id/);
    expect(allSql).toMatch(/FROM cluster_memberships cm/);
    expect(allSql).not.toMatch(/ORDER BY cm\.membership_score DESC/);
    expect(allSql).toMatch(/LEFT JOIN contact_scores cs ON cs\.contact_id = c\.id/);
    expect(allSql).toMatch(/cs\.tier/);
    expect(allSql).toMatch(/cs\.composite_score/);
    expect(allSql).not.toMatch(/c\.tier|c\.composite_score/);
  });

  it('retains all memberships on the nicheId-filtered path', async () => {
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
    expect(alice.attributes.groupIds).toContain('community:cluster-a');
    const nodesSql = mockQuery.mock.calls.map((c) => String(c[0]))
      .find((sql) => sql.includes('FROM contact_icp_fits cif'));
    expect(nodesSql).toMatch(/FROM contact_icp_fits cif/);
    expect(nodesSql).toMatch(/JOIN icp_profiles ip ON ip\.id = cif\.icp_profile_id/);
    expect(nodesSql).not.toMatch(/niche_memberships/);
  });

  it('groups aliases by company UUID and keeps same-name distinct companies separate', async () => {
    setupMockQuery([
      NODE_ROWS[0],
      { ...NODE_ROWS[0], id: 'c3', current_company: 'ACME', current_company_id: 'co-1' },
      { ...NODE_ROWS[0], id: 'c4', current_company: 'Acme', current_company_id: 'co-2' },
    ]);
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const res = await GET(new Request('http://x/api/graph/sigma-data?limit=10') as unknown as import('next/server').NextRequest);
    const data = (await res.json()).data;
    expect(data.nodes.find((n: { key: string }) => n.key === 'c3').attributes.groupIds).toContain('company:co-1');
    expect(data.nodes.find((n: { key: string }) => n.key === 'c4').attributes.groupIds).toContain('company:co-2');
    expect(data.groups.find((g: { id: string }) => g.id === 'company:co-1').loadedCount).toBe(2);
    expect(data.groups.find((g: { id: string }) => g.id === 'company:co-2').loadedCount).toBe(1);
  });

  it('keeps the canonical company label beyond the initial 500-group catalog and into later pages', async () => {
    const lateId = '77777777-7777-4777-8777-777777777777';
    const mockQuery = setupMockQuery([{ ...NODE_ROWS[0], current_company_id: lateId,
      current_company: 'Acme alias from free text', canonical_company_name: 'Canonical Late Co' }]);
    const baseline = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation((sql: unknown, params: unknown[]) => {
      const text = String(sql);
      if (text.includes("SELECT 'company' AS method")) return mockRows([]);
      if (text.includes('SELECT c.current_company_id::text AS identity'))
        return mockRows([{ identity: lateId, total_count: 8 }]);
      if (text.includes('SELECT co.id::text AS identity, co.name AS label')) {
        expect(params).toEqual(['66666666-6666-4666-8666-666666666666', 101]);
        return mockRows([{ identity: lateId, label: 'Canonical Late Co', total_count: 8 }]);
      }
      return baseline(sql, params);
    });
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const graph = (await (await GET(new Request('http://x/api/graph/sigma-data?limit=10') as import('next/server').NextRequest)).json()).data;
    expect(graph.groups.find((group: { id: string }) => group.id === `company:${lateId}`))
      .toMatchObject({ label: 'Canonical Late Co', totalCount: 8, loadedCount: 1 });
    expect(mockQuery.mock.calls.find((call) => String(call[0]).includes('COUNT(*) OVER()::int'))?.[0])
      .toContain('co.name AS canonical_company_name');
    const page = (await (await GET(new Request('http://x/api/graph/sigma-data?catalogCursor=company:66666666-6666-4666-8666-666666666666') as import('next/server').NextRequest)).json()).data;
    expect(page.groups).toContainEqual(expect.objectContaining({ id: `company:${lateId}`, label: 'Canonical Late Co', totalCount: 8 }));
  });

  it('retains a stored company group for a name-only contact without inventing a canonical company ID', async () => {
    setupMockQuery([
      { ...NODE_ROWS[1], id: 'c3', full_name: 'Legacy member', current_company: 'Legacy Acme' },
    ], [
      { contact_id: 'c3', cluster_id: 'old-company', label: 'Legacy Acme', algorithm: 'company-grouping', total_count: 2 },
    ]);
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const res = await GET(new Request('http://x/api/graph/sigma-data?limit=10') as unknown as import('next/server').NextRequest);
    const data = (await res.json()).data;
    expect(data.nodes[0].attributes.groupIds).toEqual(['community:old-company']);
    expect(data.groups.find((g: { id: string }) => g.id === 'community:old-company'))
      .toMatchObject({ method: 'stored-group', totalCount: 2, loadedCount: 1, visibleCount: 1 });
    expect(data.nodes[0].attributes.groupIds).not.toContain('company:co-1');
  });

  it('recounts visible memberships under search, group selection and the focus flash', async () => {
    setupMockQuery();
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const { countVisibleGraphGroups } = await import('@/components/network/sigma-graph');
    const res = await GET(new Request('http://x/api/graph/sigma-data?limit=10') as unknown as import('next/server').NextRequest);
    const data = (await res.json()).data;
    const visible = (search: string, selected: string | null, flashed = new Set<string>()) =>
      countVisibleGraphGroups(data.groups, data.nodes, search, selected, flashed);
    expect(visible('Alice', 'company:co-1').find((g: { id: string }) => g.id === 'community:cluster-a').visibleCount).toBe(1);
    expect(visible('Bob', 'company:co-1').every((g: { visibleCount: number }) => g.visibleCount === 0)).toBe(true);
    expect(visible('Bob', 'company:co-1', new Set(['c1'])).find((g: { id: string }) => g.id === 'company:co-1').visibleCount).toBe(1);
    expect(visible('', null).every((g: { loadedCount: number; visibleCount: number }) => g.visibleCount === g.loadedCount)).toBe(true);
  });

  it('highlights a contact in either overlapping group', async () => {
    const { matchesGraphGroup } = await import('@/components/network/sigma-graph');
    const ids = ['company:co-1', 'industry:software'];
    expect(matchesGraphGroup(ids, 'company:co-1')).toBe(true);
    expect(matchesGraphGroup(ids, 'industry:software')).toBe(true);
    expect(matchesGraphGroup(ids, 'company:co-2')).toBe(false);
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
    const mockTransaction = jest.requireMock('@/lib/db/client').transaction as jest.Mock;
    mockTransaction.mockImplementation((fn: (client: { query: jest.Mock }) => Promise<unknown>) => fn({ query: mockQuery }));
    mockQuery.mockReset();
    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("to_regclass('public.idx_cluster_memberships_cluster_id')")) {
        return mockRows([{ membership_index: 'idx_cluster_memberships_cluster_id', publication_table: 'graph_compute_state' }]);
      }
      if (text.includes('SELECT EXISTS(SELECT 1 FROM graph_compute_state')) return mockRows([{ present: true }]);
      if (text.includes('FROM research_targets WHERE id')) {
        return mockRows(row ? [row] : []);
      }
      if (text.includes('SELECT cl.id AS cluster_id')) return mockRows([]);
      if (text.includes('SELECT cm.contact_id, cm.cluster_id')) return mockRows([]);
      if (text.includes("SELECT 'company' AS method")) return mockRows([]);
      if (text.includes('SELECT c.id, c.full_name')) return mockRows(nodeRows);
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

  it('re-rooting keeps the canonical company group on returned nodes', async () => {
    setupMockQueryWithTarget(targetRow());
    const { GET } = await import('@/app/api/graph/sigma-data/route');
    const req = new Request(
      'http://x/api/graph/sigma-data?limit=10&primaryTargetId=t1',
      { method: 'GET' }
    );
    const res = await GET(req as unknown as import('next/server').NextRequest);
    const json = await res.json();
    const alice = json.data.nodes.find((n: { key: string }) => n.key === 'c1');
    expect(alice.attributes.groupIds).toContain('company:co-1');
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
      String(c[0]).includes('WITH neighborhood')
    );
    expect(nodesCall).toBeDefined();
    expect(String(nodesCall![0])).toMatch(/WITH neighborhood/);
    expect(String(nodesCall![0])).not.toMatch(/niche_memberships/);
  });
});
