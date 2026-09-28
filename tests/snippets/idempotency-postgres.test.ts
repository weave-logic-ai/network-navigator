import type { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: object, options?: ResponseInit) => Response.json(body, options) },
}), { virtual: true });
jest.mock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { snippets: true } }));
jest.mock('@/lib/middleware/extension-auth-middleware', () => ({
  withExtensionAuth: (req: NextRequest, handler: (req: NextRequest, id: string) => Promise<Response>) =>
    handler(req, currentExtensionId),
}));
jest.mock('@/lib/snippets/tenant', () => ({
  getDefaultTenantId: async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}));

import { POST } from '@/app/api/extension/snippet/route';
import { query, shutdown } from '@/lib/db/client';

const integration = process.env.SNIPPET_PG_TEST === '1' ? describe : describe.skip;
const body = {
  kind: 'text', requestId: '123e4567-e89b-42d3-a456-426614174000',
  targetKind: 'contact', targetId: 'synthetic-target',
  text: 'Synthetic evidence with no personal data.', sourceUrl: 'https://example.test/synthetic',
};
let currentExtensionId = 'extension-synthetic';

function request(payload: unknown) {
  return { json: async () => payload } as NextRequest;
}

integration('snippet receipt and graph writes on PostgreSQL', () => {
  beforeAll(async () => {
    await query('CREATE TABLE tenants (id UUID PRIMARY KEY)');
    await query('INSERT INTO tenants (id) VALUES ($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    for (const migration of ['025-ecc-causal-graph.sql', '026-ecc-exo-chain.sql']) {
      await query(readFileSync(`${process.cwd()}/../data/db/init/${migration}`, 'utf8'));
    }
    await query('CREATE TABLE snippet_tags (tenant_id UUID NOT NULL, slug TEXT NOT NULL, PRIMARY KEY (tenant_id, slug))');
    await query(readFileSync(`${process.cwd()}/../data/db/init/062-extension-snippet-receipts.sql`, 'utf8'));
  });

  afterAll(async () => { await shutdown(); });

  test('concurrent POST and lost-response replay commit only one snippet and evidence edge', async () => {
    const [first, concurrent] = await Promise.all([POST(request(body)), POST(request(body))]);
    expect(first.status).toBe(200);
    expect(await concurrent.json()).toEqual(await first.clone().json());
    const replay = await POST(request(body));
    expect(await replay.json()).toEqual(await first.json());
    const nodes = await query<{ count: string }>("SELECT count(*) FROM causal_nodes WHERE entity_type = 'snippet'");
    const edges = await query<{ count: string }>("SELECT count(*) FROM causal_edges WHERE relation = 'evidence_for'");
    const receipts = await query<{ count: string }>('SELECT count(*) FROM extension_snippet_receipts');
    expect([nodes.rows[0].count, edges.rows[0].count, receipts.rows[0].count]).toEqual(['1', '1', '1']);
    expect((await POST(request({ ...body, targetId: 'different-target' }))).status).toBe(409);
    expect((await POST(request({ ...body, text: 'Different synthetic text' }))).status).toBe(409);
    const unchanged = await query<{ count: string }>("SELECT count(*) FROM causal_nodes WHERE entity_type = 'snippet'");
    expect(unchanged.rows[0].count).toBe('1');
  });

  test('lost response replay with a replacement token does not create a second node or edge', async () => {
    const rotatedBody = { ...body, requestId: '123e4567-e89b-42d3-a456-426614174002' };
    const beforeNodes = await query<{ count: string }>("SELECT count(*) FROM causal_nodes WHERE entity_type = 'snippet'");
    const beforeEdges = await query<{ count: string }>("SELECT count(*) FROM causal_edges WHERE relation = 'evidence_for'");
    const first = await POST(request(rotatedBody));
    currentExtensionId = 'extension-replacement';
    const replay = await POST(request(rotatedBody));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    const nodes = await query<{ count: string }>("SELECT count(*) FROM causal_nodes WHERE entity_type = 'snippet'");
    const edges = await query<{ count: string }>("SELECT count(*) FROM causal_edges WHERE relation = 'evidence_for'");
    expect(Number(nodes.rows[0].count) - Number(beforeNodes.rows[0].count)).toBe(1);
    expect(Number(edges.rows[0].count) - Number(beforeEdges.rows[0].count)).toBe(1);
    currentExtensionId = 'extension-synthetic';
  });

  test('failed evidence write rolls back receipt and snippet, then the same key can retry', async () => {
    const retryBody = { ...body, requestId: '123e4567-e89b-42d3-a456-426614174001' };
    const baseline = await query<{ count: string }>("SELECT count(*) FROM causal_nodes WHERE entity_type = 'snippet'");
    await query(`CREATE FUNCTION fail_snippet_edge() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic edge failure'; END $$`);
    await query(`CREATE TRIGGER fail_snippet_edge BEFORE INSERT ON causal_edges
      FOR EACH ROW EXECUTE FUNCTION fail_snippet_edge()`);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await POST(request(retryBody))).status).toBe(500);
    } finally {
      errorLog.mockRestore();
      await query('DROP TRIGGER fail_snippet_edge ON causal_edges');
      await query('DROP FUNCTION fail_snippet_edge()');
    }
    const partial = await query<{ count: string }>(
      'SELECT count(*) FROM extension_snippet_receipts WHERE request_id = $1', [retryBody.requestId]);
    expect(partial.rows[0].count).toBe('0');
    const nodesBefore = await query<{ count: string }>("SELECT count(*) FROM causal_nodes WHERE entity_type = 'snippet'");
    expect(nodesBefore.rows[0].count).toBe(baseline.rows[0].count);
    expect((await POST(request(retryBody))).status).toBe(200);
    const nodesAfter = await query<{ count: string }>("SELECT count(*) FROM causal_nodes WHERE entity_type = 'snippet'");
    expect(Number(nodesAfter.rows[0].count) - Number(baseline.rows[0].count)).toBe(1);
  });
});
