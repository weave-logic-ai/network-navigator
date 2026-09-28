const url = process.env.G6_DISPOSABLE_DATABASE_URL;
const disposable = url ? new URL(url) : null;
const allowed = disposable?.hostname === '127.0.0.1' && disposable.port === '55460' && disposable.pathname === '/g6';
const describeDisposable = allowed ? describe : describe.skip;

describeDisposable('G6 disposable PostgreSQL compute publication', () => {
  jest.setTimeout(30_000);
  const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  const oldSpectral = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const historical = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const abandoned = Array.from({ length: 9 }, (_, n) => `contacts_${String(n + 1).padStart(32, '0')}`);
  let pool: ReturnType<typeof import('@/lib/db/client')['getPool']>;
  let compute: () => Promise<unknown>;
  let initialGraph: string;
  let seeded = false;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    pool = (await import('@/lib/db/client')).getPool();
    ({ computeGraphSnapshot: compute } = await import('@/lib/graph/compute-snapshot'));
    const existing = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM contacts');
    if (existing.rows[0].count !== '0') throw new Error('G6 disposable test requires an empty database');
    seeded = true;
    await pool.query(`INSERT INTO companies(id,name,slug,industry) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Acme','g6-acme','Software')`);
    for (const [index, id] of ids.entries()) {
      await pool.query(`INSERT INTO contacts(id,linkedin_url,full_name,current_company,current_company_id)
        VALUES ($1,$2,$3,'Acme',$4)`, [id, `https://example.test/g6/${index}`, `Member ${index + 1}`,
        index === 2 ? null : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    }
    await pool.query(`INSERT INTO edges(source_contact_id,target_contact_id,edge_type) VALUES
      ($1,$2,'CONNECTED_TO'),($2,$3,'CONNECTED_TO')`, ids);
    // Establish a prior native graph, then change source topology. A failed
    // compute must leave this two-edge graph intact as well as SQL rows.
    await compute();
    initialGraph = await (await import('@/lib/graph/ruvector-sync')).getPublishedGraphName();
    await pool.query(`INSERT INTO edges(source_contact_id,target_contact_id,edge_type) VALUES
      ($1,$2,'CONNECTED_TO')`, [ids[0], ids[2]]);
    await pool.query('UPDATE graph_metrics SET pagerank=0.123 WHERE contact_id=$1', [ids[0]]);
    await pool.query(`INSERT INTO clusters(id,label,algorithm,member_count) VALUES
      ($1,'Old spectral','spectral-ruvector',2),($2,'Historical Acme','company-grouping',1)`, [oldSpectral, historical]);
    await pool.query(`INSERT INTO cluster_memberships(contact_id,cluster_id) VALUES ($1,$2),($3,$2),($4,$5)`,
      [ids[0], oldSpectral, ids[1], ids[2], historical]);
    // Empty native graphs model a crash just after create_graph, before any
    // SQL publication. Node-table scans cannot discover this case.
    for (const graph of abandoned) await pool.query('SELECT ruvector_create_graph($1)', [graph]);
  });

  afterAll(async () => {
    if (!pool) return;
    if (!seeded) {
      const { shutdown } = await import('@/lib/db/client');
      await shutdown();
      return;
    }
    const { getPublishedGraphName } = await import('@/lib/graph/ruvector-sync');
    const active = await getPublishedGraphName();
    await pool.query("UPDATE graph_compute_state SET active_graph_name=NULL, published_edges='[]'::jsonb WHERE id=TRUE");
    await pool.query('SELECT ruvector_delete_graph($1)', [active]);
    if (initialGraph !== active) await pool.query('SELECT ruvector_delete_graph($1)', [initialGraph]);
    for (const graph of abandoned) await pool.query('SELECT ruvector_delete_graph($1)', [graph]);
    await pool.query('DROP TRIGGER IF EXISTS g6_fail_delete ON clusters');
    await pool.query('DROP TRIGGER IF EXISTS g6_pause_metrics ON graph_metrics');
    await pool.query('DROP FUNCTION IF EXISTS g6_injected_failure()');
    await pool.query('DROP FUNCTION IF EXISTS g6_injected_pause()');
    await pool.query('DELETE FROM contacts WHERE id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM clusters WHERE id = ANY($1::uuid[])', [[oldSpectral, historical]]);
    await pool.query("DELETE FROM companies WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
    const { shutdown } = await import('@/lib/db/client');
    await shutdown();
  });

  it('rolls metrics back with memberships on late failure, then rejects a concurrent run and publishes once', async () => {
    await pool.query(`CREATE FUNCTION g6_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected community publication failure'; END $$`);
    await pool.query(`CREATE TRIGGER g6_fail_delete BEFORE DELETE ON clusters
      FOR EACH ROW WHEN (OLD.algorithm = 'spectral-ruvector') EXECUTE FUNCTION g6_injected_failure()`);
    await expect(compute()).rejects.toThrow('injected community publication failure');
    const before = await pool.query<{ pagerank: number }>('SELECT pagerank FROM graph_metrics WHERE contact_id=$1', [ids[0]]);
    expect(before.rows[0].pagerank).toBeCloseTo(0.123);
    const old = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM cluster_memberships WHERE cluster_id=$1', [oldSpectral]);
    expect(old.rows[0].count).toBe('2');
    const graph = await import('@/lib/graph/ruvector-sync');
    expect(await graph.getPublishedGraphName()).toBe(initialGraph);
    expect((await graph.getGraphStats(initialGraph)).edgeCount).toBe(2);
    const orphan = await pool.query<{ names: string[] }>('SELECT ruvector_list_graphs() AS names');
    expect(orphan.rows[0].names.filter((name) => abandoned.includes(name))).toHaveLength(1);
    expect(orphan.rows[0].names).toContain(initialGraph);
    await pool.query('DROP TRIGGER g6_fail_delete ON clusters');

    await pool.query(`CREATE FUNCTION g6_injected_pause() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER g6_pause_metrics BEFORE INSERT OR UPDATE ON graph_metrics
      FOR EACH ROW WHEN (NEW.contact_id = '00000000-0000-4000-8000-000000000001')
      EXECUTE FUNCTION g6_injected_pause()`);
    const first = compute();
    let locked = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const locks = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM pg_locks
        WHERE locktype='advisory' AND classid=832781 AND objid=2 AND granted`);
      if (locks.rows[0].count !== '0') { locked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(locked).toBe(true);
    await expect(compute()).rejects.toThrow('already running');
    const result = await first as { metricsComputed: number; communityMethod: string };
    expect(result.metricsComputed).toBe(3);
    expect(result.communityMethod).toBe('linked-company-fallback');
    const published = await graph.getPublishedGraphName();
    expect(published).toMatch(/^contacts_[0-9a-f]{32}$/);
    expect((await graph.getGraphStats(published)).edgeCount).toBe(3);
    const afterRecovery = await pool.query<{ names: string[] }>('SELECT ruvector_list_graphs() AS names');
    expect(afterRecovery.rows[0].names.filter((name) => abandoned.includes(name))).toHaveLength(0);
    expect(afterRecovery.rows[0].names).toContain(published);
    const after = await pool.query<{ pagerank: number }>('SELECT pagerank FROM graph_metrics WHERE contact_id=$1', [ids[0]]);
    expect(after.rows[0].pagerank).not.toBeCloseTo(0.123);
    const groups = await pool.query<{ algorithm: string; count: string }>(`SELECT cl.algorithm,COUNT(cm.contact_id)::text AS count
      FROM clusters cl LEFT JOIN cluster_memberships cm ON cm.cluster_id=cl.id
      WHERE cl.id = ANY($1::uuid[]) GROUP BY cl.algorithm`, [[oldSpectral, historical]]);
    expect(groups.rows).toEqual([{ algorithm: 'company-grouping', count: '1' }]);
  });

  it('keeps a committed stage when its commit acknowledgment is lost', async () => {
    const db = await import('@/lib/db/client');
    const graph = await import('@/lib/graph/ruvector-sync');
    const previous = await graph.getPublishedGraphName();
    const originalTransaction = db.transaction;
    let injected = false;
    const spy = jest.spyOn(db, 'transaction').mockImplementation(async (fn) => {
      const result = await originalTransaction(fn);
      if (!injected) {
        injected = true;
        throw new Error('injected lost COMMIT acknowledgment');
      }
      return result;
    });
    try {
      await expect(compute()).resolves.toMatchObject({ metricsComputed: 3, metricsMethod: 'node-atomic' });
      expect(injected).toBe(true);
      const published = await graph.getPublishedGraphName();
      expect(published).toMatch(/^contacts_[0-9a-f]{32}$/);
      expect(published).not.toBe(previous);
      expect((await graph.getGraphStats(published)).edgeCount).toBeGreaterThan(0);
      const native = await pool.query<{ names: string[] }>('SELECT ruvector_list_graphs() AS names');
      expect(native.rows[0].names).toContain(published);
      expect((await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM graph_metrics')).rows[0].count).toBe('3');
    } finally {
      spy.mockRestore();
    }
  });

  it('serves metrics and group memberships from one snapshot across a concurrent publication', async () => {
    const db = await import('@/lib/db/client');
    const originalTransaction = db.transaction;
    const priorLabel = (await pool.query<{ label: string }>('SELECT label FROM clusters WHERE id=$1', [historical])).rows[0].label;
    const priorRank = (await pool.query<{ pagerank: number }>('SELECT pagerank FROM graph_metrics WHERE contact_id=$1', [ids[0]])).rows[0].pagerank;
    let writerCommitted = false;
    const spy = jest.spyOn(db, 'transaction').mockImplementation((fn) => originalTransaction(async (client) => {
      const wrapped = Object.create(client) as typeof client;
      wrapped.query = (async (sql: string, params?: unknown[]) => {
        const result = await client.query(sql, params);
        if (!writerCommitted && sql.includes('SELECT c.id, c.full_name')) {
          // This separate connection commits after the node/metric read but
          // before the stored-group and count reads on the API connection.
          await pool.query('UPDATE clusters SET label=$1 WHERE id=$2', ['Published later', historical]);
          await pool.query('UPDATE graph_metrics SET pagerank=0.77 WHERE contact_id=$1', [ids[0]]);
          writerCommitted = true;
        }
        return result;
      }) as typeof client.query;
      return fn(wrapped);
    }));
    try {
      const { GET } = await import('@/app/api/graph/sigma-data/route');
      const response = await GET(new Request('http://x/api/graph/sigma-data?limit=10') as import('next/server').NextRequest);
      expect(response.status).toBe(200);
      expect(writerCommitted).toBe(true);
      const data = (await response.json()).data;
      expect(data.nodes.find((node: { key: string }) => node.key === ids[0]).attributes.pagerank).toBeCloseTo(priorRank);
      expect(data.groups.find((group: { id: string }) => group.id === `community:${historical}`).label).toBe(priorLabel);
      expect((await pool.query<{ label: string }>('SELECT label FROM clusters WHERE id=$1', [historical])).rows[0].label).toBe('Published later');
    } finally {
      spy.mockRestore();
    }
  });

  it('publishes linked-company groups after a real PostgreSQL spectral exception with ten eligible edges', async () => {
    for (let n = 0; n < 7; n++) {
      await pool.query("INSERT INTO edges(source_contact_id,target_contact_id,edge_type) VALUES ($1,$2,'MESSAGED')",
        [ids[n % 2], ids[(n % 2) + 1]]);
    }
    const eligible = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM edges WHERE edge_type IN ('CONNECTED_TO','MESSAGED')");
    expect(Number(eligible.rows[0].count)).toBeGreaterThanOrEqual(10);

    const db = await import('@/lib/db/client');
    const originalTransaction = db.transaction;
    let injected = false;
    const spy = jest.spyOn(db, 'transaction').mockImplementation((fn) => originalTransaction(async (client) => {
      const wrapped = Object.create(client) as typeof client;
      wrapped.query = (async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT ruvector_spectral_cluster')) {
          injected = true;
          return client.query('SELECT 1 / 0');
        }
        return client.query(sql, params);
      }) as typeof client.query;
      return fn(wrapped);
    }));
    try {
      const { POST } = await import('@/app/api/graph/compute/route');
      const response = await POST();
      expect(response.status).toBe(200);
      expect(injected).toBe(true);
      expect((await response.json()).data).toMatchObject({ communityMethod: 'linked-company-fallback', communitiesDetected: 1, metricsComputed: 3 });
      const { GET } = await import('@/app/api/graph/sigma-data/route');
      const data = (await (await GET(new Request('http://x/api/graph/sigma-data?limit=10') as import('next/server').NextRequest)).json()).data;
      expect(data.groups.find((group: { id: string }) => group.id === 'company:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').totalCount).toBe(2);
      expect(data.nodes).toHaveLength(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps a pinned native graph through publication and reclaims it after the path finishes', async () => {
    const db = await import('@/lib/db/client');
    const graph = await import('@/lib/graph/ruvector-sync');
    const graphQueries = await import('@/lib/db/queries/graph');
    const { findPath } = await import('@/lib/graph/paths');
    const { computeAllMetrics } = await import('@/lib/graph/metrics');
    const originalTransaction = db.transaction;
    const oldGraph = await graph.getPublishedGraphName();
    expect(await graph.getNodeIdForContact(ids[0], oldGraph)).toEqual(expect.any(Number));
    expect(await graph.getNodeIdForContact(ids[2], oldGraph)).toEqual(expect.any(Number));
    // The pinned graph has a path. The next publication has no edges.
    expect((await graph.getGraphStats(oldGraph)).edgeCount).toBeGreaterThan(0);
    await pool.query('DELETE FROM edges WHERE source_contact_id = ANY($1::uuid[])', [ids]);
    let entered!: () => void;
    let release!: () => void;
    let nativeCalls = 0;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const bfs = jest.spyOn(graphQueries, 'getAllEdges');
    const spy = jest.spyOn(db, 'transaction').mockImplementation((fn) => originalTransaction(async (client) => {
      const wrapped = Object.create(client) as typeof client;
      wrapped.query = (async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT ruvector_shortest_path')) { nativeCalls++; entered(); await pause; }
        return client.query(sql, params);
      }) as typeof client.query;
      return fn(wrapped);
    }));
    try {
      const path = findPath(ids[0], ids[2]);
      await Promise.race([reading, new Promise((_, reject) => setTimeout(() => reject(new Error('Native path was never reached')), 5000))]);
      const published = await computeAllMetrics();
      expect(published).toHaveLength(3);
      const current = await graph.getPublishedGraphName();
      expect(current).not.toBe(oldGraph);
      const during = await pool.query<{ names: string[] }>('SELECT ruvector_list_graphs() AS names');
      expect(during.rows[0].names).toContain(oldGraph);
      expect((await graph.getGraphStats(oldGraph)).nodeCount).toBe(3);
      release();
      const oldPath = await path;
      expect(oldPath?.path[0]).toBe(ids[0]);
      expect(oldPath?.path.at(-1)).toBe(ids[2]);
      expect(nativeCalls).toBe(1);
      expect(bfs).not.toHaveBeenCalled();
      expect(await findPath(ids[0], ids[2])).toBeNull();
      await compute();
      const final = await pool.query<{ names: string[] }>('SELECT ruvector_list_graphs() AS names');
      expect(final.rows[0].names).not.toContain(oldGraph);
      expect(final.rows[0].names.filter((name) => name === 'contacts' || /^contacts_[0-9a-f]{32}$/.test(name))).toHaveLength(1);
    } finally {
      release();
      spy.mockRestore();
      bfs.mockRestore();
    }
  });

  it('releases the native pin after a PostgreSQL error so retirement can reclaim the graph', async () => {
    const db = await import('@/lib/db/client');
    const graph = await import('@/lib/graph/ruvector-sync');
    const { findPath } = await import('@/lib/graph/paths');
    const oldGraph = await graph.getPublishedGraphName();
    const originalTransaction = db.transaction;
    let nativeCalls = 0;
    const spy = jest.spyOn(db, 'transaction').mockImplementation((fn) => originalTransaction(async (client) => {
      const wrapped = Object.create(client) as typeof client;
      wrapped.query = (async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT ruvector_shortest_path')) {
          nativeCalls++;
          return client.query('SELECT 1 / 0');
        }
        return client.query(sql, params);
      }) as typeof client.query;
      return fn(wrapped);
    }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await findPath(ids[0], ids[2])).toBeNull();
      expect(nativeCalls).toBe(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('division by zero'));
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
    await compute();
    const final = await pool.query<{ names: string[] }>('SELECT ruvector_list_graphs() AS names');
    expect(final.rows[0].names).not.toContain(oldGraph);
  });
});
