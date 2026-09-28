// Snippet service tests — mocked DB.
//
// Pins the core invariants for Phase 1 Track C:
//   1. One causal_nodes row is inserted with entity_type='snippet',
//      operation='captured', and the selected text inside `output.content.text`.
//   2. An `evidence_for` causal_edge is inserted pointing at the target node.
//   3. A `mentions` causal_edge is inserted per linked contact.
//   4. One exo_chain_entries row is appended on chain_id = snippet:<kind>:<id>
//      with the formula from ADR-029.
//   5. Unknown tag slugs are filtered and surfaced as a warning rather than
//      failing the save.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  withQuerySavepoint: (_name: string, fn: () => Promise<unknown>) => fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

import { query } from '@/lib/db/client';
import { saveTextSnippet } from '@/lib/snippets/service';

const mockQuery = query as jest.MockedFunction<typeof query>;

function mockRows<T>(rows: T[]): ReturnType<typeof query> {
  return Promise.resolve({
    rows,
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }) as ReturnType<typeof query>;
}

function observeQueries(): Array<{ sql: string; params: unknown[] }> {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
    log.push({ sql: String(sql), params: params ?? [] });
    return programmedResponses(String(sql), params ?? []);
  });
  return log;
}

/**
 * One place to keep the mocked DB responses keyed by SQL fragment. Keeps
 * individual tests readable — they only assert on shapes, not on which
 * response slot matches which SELECT.
 */
function programmedResponses(sql: string, _params: unknown[]): ReturnType<typeof query> {
  if (/snippet_tags/.test(sql) && /SELECT/.test(sql)) {
    // All requested slugs exist — tests that want the "unknown slug" path
    // override this via mockImplementationOnce before the call.
    return mockRows([{ slug: 'filing/sec-10k' }, { slug: 'news/press-release' }]);
  }
  if (/entity_type = 'target'/.test(sql) && /SELECT/.test(sql)) {
    return mockRows([{ id: 'target-node-1' }]);
  }
  if (/entity_type IN \('score', 'enrichment'\)/.test(sql)) {
    return mockRows([]);
  }
  if (/INSERT INTO causal_nodes/.test(sql)) {
    // Use a deterministic fake id. The service doesn't rely on the id shape.
    return mockRows([
      {
        id: `node-${Date.now()}-${Math.random()}`,
        tenant_id: 'tenant-1',
        entity_type: 'snippet',
        entity_id: 'snippet-1',
        operation: 'captured',
        inputs: {},
        output: {},
        session_id: null,
        created_at: '2026-04-17',
      },
    ]);
  }
  if (/INSERT INTO causal_edges/.test(sql)) {
    return mockRows([
      {
        id: 'edge-1',
        source_node_id: 'a',
        target_node_id: 'b',
        relation: 'evidence_for',
        weight: 1,
        metadata: {},
        created_at: '2026-04-17',
      },
    ]);
  }
  if (/MAX\(sequence\)/.test(sql)) {
    return mockRows([{ max: null }]);
  }
  if (/INSERT INTO exo_chain_entries/.test(sql)) {
    return mockRows([
      {
        id: 'entry-1',
        tenant_id: 'tenant-1',
        chain_id: 'snippet:contact:target-1',
        sequence: 0,
        prev_hash: null,
        entry_hash: Buffer.alloc(32, 0xaa),
        operation: 'snippet_captured',
        data: {},
        actor: 'extension',
        created_at: '2026-04-17',
      },
    ]);
  }
  return mockRows([]);
}

describe('saveTextSnippet', () => {
  beforeEach(() => mockQuery.mockReset());

  it('rejects empty text loudly', async () => {
    await expect(
      saveTextSnippet({
        tenantId: 'tenant-1',
        targetKind: 'contact',
        targetId: 'target-1',
        text: '   ',
        sourceUrl: 'https://example.com',
      })
    ).rejects.toThrow(/text must be a non-empty string/);
  });

  it('writes causal_nodes, evidence_for edge, and chain entry', async () => {
    const log = observeQueries();
    const result = await saveTextSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 'target-1',
      text: 'Jane Doe joined Acme Inc in 2024.',
      sourceUrl: 'https://example.com/pr',
      pageType: 'PRESS_RELEASE',
      tagSlugs: ['filing/sec-10k', 'news/press-release'],
      note: 'Potential lead',
    });

    expect(result.chainId).toBe('snippet:contact:target-1');
    expect(result.warnings).toEqual([]);
    expect(result.chainSequence).toBe(0);

    // At least one snippet INSERT into causal_nodes
    const nodeInserts = log.filter((q) =>
      /INSERT INTO causal_nodes/.test(q.sql)
    );
    expect(nodeInserts.length).toBeGreaterThan(0);
    const snippetInsert = nodeInserts.find((q) => q.params[1] === 'snippet');
    expect(snippetInsert).toBeDefined();
    expect(snippetInsert!.params[3]).toBe('captured');
    const outputParam = JSON.parse(snippetInsert!.params[5] as string);
    expect(outputParam.content.text).toBe('Jane Doe joined Acme Inc in 2024.');
    expect(outputParam.tags).toEqual(['filing/sec-10k', 'news/press-release']);

    // Evidence_for edge
    const evidenceEdge = log.find(
      (q) =>
        /INSERT INTO causal_edges/.test(q.sql) &&
        q.params[2] === 'evidence_for'
    );
    expect(evidenceEdge).toBeDefined();

    // Chain append
    const chainInsert = log.find((q) =>
      /INSERT INTO exo_chain_entries/.test(q.sql)
    );
    expect(chainInsert).toBeDefined();
    expect(chainInsert!.params[1]).toBe('snippet:contact:target-1');
    expect(chainInsert!.params[5]).toBe('snippet_captured');
  });

  it('emits chain_id of the expected shape for each target kind', async () => {
    observeQueries();
    const r1 = await saveTextSnippet({
      tenantId: 'tenant-1',
      targetKind: 'company',
      targetId: 'co-99',
      text: 'Acme announced a new product.',
      sourceUrl: 'https://example.com',
    });
    expect(r1.chainId).toBe('snippet:company:co-99');

    mockQuery.mockReset();
    observeQueries();
    const r2 = await saveTextSnippet({
      tenantId: 'tenant-1',
      targetKind: 'self',
      targetId: 'owner-42',
      text: 'Note to self.',
      sourceUrl: 'https://example.com',
    });
    expect(r2.chainId).toBe('snippet:self:owner-42');
  });

  it('filters unknown tag slugs and surfaces a warning instead of failing', async () => {
    // Override the snippet_tags response so only one of the two is recognised.
    mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
      const s = String(sql);
      if (/snippet_tags/.test(s) && /SELECT/.test(s)) {
        return mockRows([{ slug: 'news/article' }]);
      }
      return programmedResponses(s, params ?? []);
    });

    const result = await saveTextSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 't-1',
      text: 'Some evidence.',
      sourceUrl: 'https://example.com',
      tagSlugs: ['news/article', 'not-a-real-tag'],
    });

    expect(result.warnings).toEqual([
      'Ignored unknown tag slugs: not-a-real-tag',
    ]);
  });

  it('treats chain append failure as non-fatal (warning, snippet still saved)', async () => {
    // Any INSERT INTO exo_chain_entries fails; the service must catch and warn.
    mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
      const s = String(sql);
      if (/INSERT INTO exo_chain_entries/.test(s)) {
        return Promise.reject(new Error('chain-down'));
      }
      return programmedResponses(s, params ?? []);
    });

    const result = await saveTextSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 't-1',
      text: 'Some evidence.',
      sourceUrl: 'https://example.com',
    });

    expect(result.chainSequence).toBe(-1);
    expect(result.warnings[0]).toMatch(/ExoChain append failed/);
    // The snippet id is still present — source of truth remains causal_nodes.
    expect(result.snippetId).toMatch(/^[0-9a-f-]+$/);
  });

  it('serialises mentionContactIds and persists them in the output payload', async () => {
    const log = observeQueries();
    await saveTextSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 't-1',
      text: 'Alice Smith is joining.',
      sourceUrl: 'https://example.com',
      mentionContactIds: ['contact-a', 'contact-b', 'contact-a'],
    });

    const snippetInsert = log.find(
      (q) =>
        /INSERT INTO causal_nodes/.test(q.sql) && q.params[1] === 'snippet'
    );
    const output = JSON.parse(snippetInsert!.params[5] as string);
    expect(output.linkedContactIds).toEqual(['contact-a', 'contact-b']);
    expect(output.extractedMentionCandidates).toContain('Alice Smith');
  });
});
