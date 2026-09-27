// WS-3 Phase 6 §9 — end-to-end: saveTextSnippet scrubs PII before the
// causal_nodes INSERT and flips output.meta.piiScrubbed.

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

function programmedResponses(sql: string): ReturnType<typeof query> {
  if (/snippet_tags/.test(sql) && /SELECT/.test(sql)) {
    return mockRows([{ slug: 'provenance/user-note' }]);
  }
  if (/entity_type = 'target'/.test(sql) && /SELECT/.test(sql)) {
    return mockRows([{ id: 'target-node-1' }]);
  }
  if (/entity_type IN \('score', 'enrichment'\)/.test(sql)) {
    return mockRows([]);
  }
  if (/INSERT INTO causal_nodes/.test(sql)) {
    return mockRows([
      {
        id: 'node-1',
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
    return mockRows([{ id: 'edge-1' }]);
  }
  if (/exo_chain_entries/.test(sql) && /MAX\(sequence\)/.test(sql)) {
    return mockRows([{ max: null }]);
  }
  if (/INSERT INTO exo_chain_entries/.test(sql)) {
    return mockRows([{ id: 'chain-1', sequence: 0 }]);
  }
  return mockRows([]);
}

function observeQueries(): Array<{ sql: string; params: unknown[] }> {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
    log.push({ sql: String(sql), params: params ?? [] });
    return programmedResponses(String(sql));
  });
  return log;
}

describe('saveTextSnippet — PII scrub', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('flips piiScrubbed=true and writes the scrubbed text when PII is present', async () => {
    const log = observeQueries();
    const result = await saveTextSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 'contact-1',
      text: 'Email jane@example.com · Phone 415-555-2671',
      sourceUrl: 'https://example.com/a',
      tagSlugs: ['provenance/user-note'],
    });

    const insertNode = log.find((q) => /INSERT INTO causal_nodes/.test(q.sql));
    expect(insertNode).toBeDefined();
    // The params layout on causal_nodes INSERT has the `output` JSON at one
    // of the later positions. We scan for the params that look like the
    // output JSON.
    const serialized = (insertNode!.params as unknown[])
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join('\n');
    expect(serialized).toContain('[email]');
    expect(serialized).toContain('[phone]');
    expect(serialized).toContain('"piiScrubbed":true');
    // The original PII must NOT appear in the INSERT params.
    expect(serialized).not.toContain('jane@example.com');
    expect(serialized).not.toContain('415-555-2671');

    expect(
      result.warnings.some((w) => /PII scrubbed/.test(w))
    ).toBe(true);
  });

  it('leaves piiScrubbed=false and preserves text when no PII is present', async () => {
    const log = observeQueries();
    await saveTextSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 'contact-1',
      text: 'Jane leads the revenue team at Acme.',
      sourceUrl: 'https://example.com/a',
      tagSlugs: ['provenance/user-note'],
    });
    const insertNode = log.find((q) => /INSERT INTO causal_nodes/.test(q.sql));
    const serialized = (insertNode!.params as unknown[])
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join('\n');
    expect(serialized).toContain('"piiScrubbed":false');
    expect(serialized).toContain('Jane leads the revenue team at Acme.');
  });
});
