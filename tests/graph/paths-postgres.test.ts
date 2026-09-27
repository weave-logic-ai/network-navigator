import { readFileSync } from 'node:fs';

const url = process.env.G6_DISPOSABLE_DATABASE_URL;
const disposable = url ? new URL(url) : null;
const allowed = disposable?.hostname === '127.0.0.1' && disposable.port === '55460' && disposable.pathname === '/g6';
const describeDisposable = allowed ? describe : describe.skip;

describeDisposable('published native and fallback edge parity on disposable PostgreSQL', () => {
  jest.setTimeout(30_000);
  const ids = [11, 12, 13, 14].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  let graphName: string;
  let db: typeof import('@/lib/db/client');

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = await import('@/lib/db/client');
    const pool = db.getPool();
    const existing = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM contacts');
    if (existing.rows[0].count !== '0') throw new Error('Edge parity test requires the empty disposable database');
    for (const [index, id] of ids.entries()) {
      await pool.query('INSERT INTO contacts(id,linkedin_url,full_name,is_archived) VALUES ($1,$2,$3,$4)',
        [id, `https://example.test/parity/${index}`, `Parity ${index}`, index === 3]);
    }
    await pool.query(`INSERT INTO edges(source_contact_id,target_contact_id,edge_type) VALUES
      ($1,$2,'CONNECTED_TO'),($2,$3,'MESSAGED'),($1,$3,'WORKED_AT'),($1,$4,'CONNECTED_TO')`, ids);
  });

  afterAll(async () => {
    if (!db) return;
    const pool = db.getPool();
    try {
      if (graphName) {
        await pool.query("UPDATE graph_compute_state SET active_graph_name=NULL, published_edges='[]'::jsonb WHERE id=TRUE");
        await pool.query('SELECT ruvector_delete_graph($1)', [graphName]);
      }
      await pool.query('DELETE FROM contacts WHERE id = ANY($1::uuid[])', [ids]);
    } finally {
      await db.shutdown();
    }
  });

  it('gives fallback exactly the native edges, excluding unsupported types and archived contacts', async () => {
    const { computeGraphSnapshot } = await import('@/lib/graph/compute-snapshot');
    const { getPublishedGraphName, syncContactsGraph, getGraphStats } = await import('@/lib/graph/ruvector-sync');
    const { getAllEdges } = await import('@/lib/db/queries/graph');
    const { PUBLISHED_GRAPH_EDGE_TYPES } = await import('@/lib/graph/edge-policy');
    // The legacy name can contain an extra real relationship type. Migration
    // must retire its pointer even when that graph exists and has data.
    await db.transaction(async (client) => syncContactsGraph(client, 'contacts', [...PUBLISHED_GRAPH_EDGE_TYPES, 'WORKED_AT']));
    expect((await getGraphStats('contacts')).edgeCount).toBe(3);
    await db.getPool().query("UPDATE graph_compute_state SET active_graph_name='contacts' WHERE id=TRUE");
    await db.getPool().query(readFileSync('../data/db/init/060-graph-compute-publication.sql', 'utf8'));
    await expect(getPublishedGraphName()).rejects.toThrow('No native graph has been published');
    expect(await getAllEdges({ publishedGraphOnly: true })).toEqual([]);
    await computeGraphSnapshot();
    graphName = await getPublishedGraphName();
    const nativeNodes = await db.getPool().query<{ node_id: string; contact_id: string }>(
      "SELECT id::text AS node_id, properties->>'contact_id' AS contact_id FROM _ruvector_nodes WHERE graph_name=$1", [graphName]);
    expect(nativeNodes.rows.map((row) => row.contact_id).sort()).toEqual(ids.slice(0, 3).sort());
    const native = await db.getPool().query<{ source: string; target: string; edge_type: string }>(
      'SELECT source::text,target::text,edge_type FROM _ruvector_edges WHERE graph_name=$1', [graphName]);
    const byNode = new Map(nativeNodes.rows.map((row) => [row.node_id, row.contact_id]));
    const nativeEdges = native.rows.map((edge) =>
      [byNode.get(edge.source), byNode.get(edge.target), edge.edge_type].join(':')).sort();
    const fallback = await getAllEdges({ publishedGraphOnly: true });
    const fallbackEdges = fallback.map((edge) =>
      [edge.sourceContactId, edge.targetContactId, edge.edgeType].join(':')).sort();
    expect(fallbackEdges).toEqual(nativeEdges);
    expect(fallbackEdges).toEqual([
      `${ids[0]}:${ids[1]}:CONNECTED_TO`, `${ids[1]}:${ids[2]}:MESSAGED`,
    ]);
    const { findPath } = await import('@/lib/graph/paths');
    // Probe the installed native primitive, not a mocked path implementation.
    expect(await findPath(ids[1], ids[0])).toBeNull();
    const original = await import('@/lib/graph/ruvector-sync');
    const reverseFailure = jest.spyOn(original, 'computeRuVectorShortestPath').mockRejectedValueOnce(new Error('injected native failure'));
    const reverseWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await findPath(ids[1], ids[0])).toBeNull();
    } finally {
      reverseFailure.mockRestore();
      reverseWarn.mockRestore();
    }
    await db.getPool().query("INSERT INTO edges(source_contact_id,target_contact_id,edge_type) VALUES ($1,$2,'CONNECTED_TO')", [ids[0], ids[2]]);
    await db.getPool().query('UPDATE contacts SET is_archived=TRUE WHERE id=$1', [ids[1]]);
    const afterMutation = await getAllEdges({ publishedGraphOnly: true });
    expect(afterMutation.map((edge) => [edge.sourceContactId, edge.targetContactId, edge.edgeType].join(':')).sort()).toEqual(nativeEdges);
    const failure = jest.spyOn(original, 'computeRuVectorShortestPath').mockRejectedValueOnce(new Error('injected native failure'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await findPath(ids[0], ids[2]))?.path).toEqual([ids[0], ids[1], ids[2]]);
    } finally {
      failure.mockRestore();
      warn.mockRestore();
    }
  });
});
