jest.mock('@/lib/db/client', () => ({ query: jest.fn(), transaction: jest.fn() }));

type NodeRow = {
  id: string; full_name: string; tier: string; degree: number;
  composite_score: number; current_company: null; title: null;
  pagerank: number; betweenness_centrality: number; cluster_id: null;
  available_nodes?: number;
};
type EdgeRow = {
  id: string; source_contact_id: string; target_contact_id: string;
  edge_type: string; weight: number; available_edges?: number;
};

const node = (id: string, pagerank = 0.1): NodeRow => ({
  id, full_name: id, tier: 'gold', degree: 1, composite_score: 1,
  current_company: null, title: null, pagerank,
  betweenness_centrality: 0, cluster_id: null,
});
const edge = (id: string, edge_type: string, source = 'a', target = 'b'): EdgeRow => ({
  id, source_contact_id: source, target_contact_id: target, edge_type, weight: 1,
});
const rows = <T,>(values: T[]) => ({ rows: values, command: '', rowCount: values.length, oid: 0, fields: [] });
const TYPES = ['CONNECTED_TO', 'MESSAGED', 'same-company', 'INVITED_BY', 'ENDORSED', 'RECOMMENDED'];

function setup(options: { contacts?: NodeRow[]; edges?: EdgeRow[]; target?: boolean | 'company' } = {}) {
  const contacts = options.contacts ?? [node('a'), node('b')];
  const allEdges = options.edges ?? TYPES.map((type, index) => edge(`e${index}`, type));
  const query = jest.requireMock('@/lib/db/client').query as jest.Mock;
  const transaction = jest.requireMock('@/lib/db/client').transaction as jest.Mock;
  transaction.mockImplementation((fn: (client: { query: jest.Mock }) => Promise<unknown>) => fn({ query }));
  query.mockReset();
  query.mockImplementation((sqlValue: unknown, params: unknown[] = []) => {
    const sql = String(sqlValue);
    if (sql.includes("to_regclass('public.idx_cluster_memberships_cluster_id')")) return Promise.resolve(rows([{ membership_index: 'idx_cluster_memberships_cluster_id', publication_table: 'graph_compute_state' }]));
    if (sql.includes('SELECT EXISTS(SELECT 1 FROM graph_compute_state')) return Promise.resolve(rows([{ present: true }]));
    if (sql.includes('FROM research_targets WHERE id')) {
      const target = options.target === 'company'
        ? { id: 't1', kind: 'company', company_id: 'co-1' }
        : { id: 't1', kind: 'contact', contact_id: 'focus' };
      return Promise.resolve(rows(options.target ? [target] : []));
    }
    if (sql.includes('SELECT c.id, c.full_name')) {
      const focused = sql.includes('WITH neighborhood');
      const threshold = Number(params[focused ? 1 : 0]);
      const requestedLimit = Number(params[focused ? 2 : 1]);
      const candidates = contacts.filter((contact) => contact.pagerank >= threshold || (focused && contact.id === 'focus'));
      candidates.sort((a, b) => Number(focused && b.id === 'focus') - Number(focused && a.id === 'focus') || b.pagerank - a.pagerank || a.id.localeCompare(b.id));
      return Promise.resolve(rows(candidates.slice(0, requestedLimit).map((contact) => ({ ...contact, available_nodes: candidates.length }))));
    }
    if (sql.includes('SELECT id, source_contact_id, target_contact_id, edge_type, weight')) {
      const types = params[0] as string[];
      const loaded = new Set(params[1] as string[]);
      // Model the SQL's WHERE/ORDER/LIMIT sequence. Losing either endpoint
      // predicate recreates the old first-20k-rows bug in this fixture.
      const constrained = sql.includes('source_contact_id = ANY($2::uuid[])') &&
        sql.includes('target_contact_id = ANY($2::uuid[])');
      const candidates = allEdges.filter((item) => types.includes(item.edge_type) &&
        (!constrained || (loaded.has(item.source_contact_id) && loaded.has(item.target_contact_id))));
      if (sql.includes('ORDER BY id ASC')) candidates.sort((a, b) => a.id.localeCompare(b.id));
      const selected = candidates.slice(0, 20000).filter((item) => loaded.has(item.source_contact_id) && loaded.has(item.target_contact_id));
      return Promise.resolve(rows(selected.map((item) => ({ ...item, available_edges: candidates.length }))));
    }
    if (sql.includes('SELECT cl.id AS cluster_id')) return Promise.resolve(rows([]));
    if (sql.includes('FROM companies WHERE id')) return Promise.resolve(rows([{ id: 'co-1', name: 'Acme' }]));
    if (sql.includes('FROM contacts WHERE is_archived')) return Promise.resolve(rows([{ cnt: String(contacts.length) }]));
    if (sql.includes('FROM clusters')) return Promise.resolve(rows([{ cnt: '0' }]));
    return Promise.resolve(rows([]));
  });
  return query;
}

async function get(params = '') {
  const { GET } = await import('@/app/api/graph/sigma-data/route');
  const response = await GET(new Request(`http://x/api/graph/sigma-data${params}`) as import('next/server').NextRequest);
  return { response, body: await response.json() };
}

describe('G4 sigma query contract', () => {
  beforeEach(() => jest.resetModules());

  it('treats explicit all-off as zero edges, including when provenance is enabled', async () => {
    const query = setup();
    const { response, body } = await get('?edgeTypes=&includeProvenanceEdges=true');
    expect(response.status).toBe(200);
    expect(body.data.edges).toEqual([]);
    expect(body.data.stats).toMatchObject({ totalEdges: 0, availableEdges: 0, truncatedEdges: 0 });
    expect(query.mock.calls.some((call) => String(call[0]).includes('SELECT id, source_contact_id'))).toBe(false);
  });

  it('honors MESSAGED-only for a company focus without leaking context edges', async () => {
    const query = setup({ target: 'company', edges: [edge('message', 'MESSAGED'), edge('connection', 'CONNECTED_TO')] });
    const { body } = await get('?primaryTargetId=t1&edgeTypes=MESSAGED');
    const edgeCall = query.mock.calls.find((call) => String(call[0]).includes('SELECT id, source_contact_id'));
    expect(edgeCall?.[1]?.[0]).toEqual(['MESSAGED']);
    expect(body.data.focusNodeId).toBe('co-1');
    expect(body.data.nodes.map((item: { key: string }) => item.key)).toEqual(['a', 'b', 'co-1']);
    expect(body.data.edges.map((item: { attributes: { type: string } }) => item.attributes.type)).toEqual(['MESSAGED']);
    expect(body.data.stats).toMatchObject({ totalNodes: 3, loadedNodes: 3, availableNodes: 3, truncatedNodes: 0, totalEdges: 1, availableEdges: 1 });
  });

  it('honors all-off for a company focus and counts an isolated company as one node', async () => {
    const query = setup({ target: 'company', contacts: [] });
    const { body } = await get('?primaryTargetId=t1&edgeTypes=');
    expect(body.data.nodes.map((item: { key: string }) => item.key)).toEqual(['co-1']);
    expect(body.data.edges).toEqual([]);
    expect(body.data.stats).toMatchObject({ totalNodes: 1, loadedNodes: 1, availableNodes: 1, truncatedNodes: 0, totalEdges: 0, availableEdges: 0, truncatedEdges: 0 });
    const { formatGraphCounts } = await import('@/components/network/sigma-graph');
    expect(formatGraphCounts(body.data.stats)).toBe('1/1 nodes, 0/0 edges');
    expect(query.mock.calls.some((call) => String(call[0]).includes('SELECT id, source_contact_id'))).toBe(false);
  });

  it('includes company links only when their own type is selected', async () => {
    const query = setup({ target: 'company' });
    const { body } = await get('?primaryTargetId=t1&edgeTypes=company-context');
    expect(body.data.edges.map((item: { attributes: { type: string } }) => item.attributes.type)).toEqual(['company-context', 'company-context']);
    expect(body.data.stats).toMatchObject({ totalNodes: 3, loadedNodes: 3, availableEdges: 2, totalEdges: 2 });
    expect(query.mock.calls.some((call) => String(call[0]).includes('SELECT id, source_contact_id'))).toBe(false);
  });

  it('shows truncated node and edge counts in the graph label', async () => {
    const { formatGraphCounts } = await import('@/components/network/sigma-graph');
    expect(formatGraphCounts({
      totalNodes: 3, loadedNodes: 2, availableNodes: 3, truncatedNodes: 1,
      totalEdges: 20000, availableEdges: 20002, truncatedEdges: 2, communities: 0,
    })).toBe('2/3 nodes, 20000/20002 edges (1 node, 2 edges truncated)');
  });

  it('filters endpoints before the 20k cap and reports deterministic truncation counts', async () => {
    const unrelated = Array.from({ length: 20001 }, (_, index) => edge(`a${String(index).padStart(5, '0')}`, 'CONNECTED_TO', 'x', 'y'));
    const query = setup({ edges: [...unrelated, edge('z2', 'CONNECTED_TO'), edge('z1', 'CONNECTED_TO')] });
    const { body } = await get('?edgeTypes=CONNECTED_TO&limit=2');
    const edgeCall = query.mock.calls.find((call) => String(call[0]).includes('SELECT id, source_contact_id'));
    expect(String(edgeCall?.[0])).toMatch(/source_contact_id = ANY\(\$2::uuid\[\]\)[\s\S]*target_contact_id = ANY\(\$2::uuid\[\]\)[\s\S]*ORDER BY id ASC[\s\S]*LIMIT 20000/);
    expect(body.data.edges.map((item: { key: string }) => item.key)).toEqual(['z1', 'z2']);
    expect(body.data.stats).toMatchObject({ availableNodes: 2, truncatedNodes: 0, totalEdges: 2, availableEdges: 2, truncatedEdges: 0 });
  });

  it('counts eligible edges beyond the cap and uses stable node ordering for equal ranks', async () => {
    const eligible = Array.from({ length: 20002 }, (_, index) =>
      edge(`e${String(index).padStart(5, '0')}`, 'CONNECTED_TO'));
    setup({ contacts: [node('b'), node('a')], edges: eligible.reverse() });
    const { body } = await get('?edgeTypes=CONNECTED_TO');
    expect(body.data.nodes.map((item: { key: string }) => item.key)).toEqual(['a', 'b']);
    expect(body.data.edges[0].key).toBe('e00000');
    expect(body.data.edges.at(-1).key).toBe('e19999');
    expect(body.data.stats).toMatchObject({ totalEdges: 20000, availableEdges: 20002, truncatedEdges: 2 });
  });

  it('keeps a low-ranked contact focus through minPagerank and a one-node limit', async () => {
    const query = setup({ target: true, contacts: [node('high', 0.9), node('focus', 0.001)] });
    const { body } = await get('?primaryTargetId=t1&minPagerank=0.5&limit=1');
    const nodesSql = String(query.mock.calls.find((call) => String(call[0]).includes('SELECT c.id, c.full_name'))?.[0]);
    expect(nodesSql).toContain('OR c.id = $1');
    expect(nodesSql).toMatch(/ORDER BY \(c.id = \$1\) DESC, COALESCE\(gm.pagerank, 0\) DESC, c.id ASC/);
    expect(body.data.focusNodeId).toBe('focus');
    expect(body.data.nodes.map((item: { key: string }) => item.key)).toEqual(['focus']);
    expect(body.data.stats).toMatchObject({ availableNodes: 2, loadedNodes: 1, truncatedNodes: 1 });
  });

  it.each(TYPES)('returns only the selected supported edge type %s', async (type) => {
    const query = setup();
    const { body } = await get(`?edgeTypes=${encodeURIComponent(type)}`);
    const edgeCall = query.mock.calls.find((call) => String(call[0]).includes('SELECT id, source_contact_id'));
    expect(edgeCall?.[1]?.[0]).toEqual([type]);
    expect(body.data.edges).toHaveLength(1);
    expect(body.data.edges[0].attributes.type).toBe(type);
  });

  it.each(['limit=0', 'limit=1junk', 'minPagerank=NaN', 'edgeTypes=bogus'])('rejects invalid input %s', async (param) => {
    const query = setup();
    const { response } = await get(`?${param}`);
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
