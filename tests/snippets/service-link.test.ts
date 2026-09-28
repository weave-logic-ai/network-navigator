// Link snippet service tests — mocked DB + injected fetcher/writer.
//
// Pins the Phase 1.5 WS-3 closure invariants:
//   1. `saveLinkSnippet` rejects non-http hrefs loudly.
//   2. On fetch success, a `source_records` row is written with source_type='link'
//      and the resulting id lands in `causal_nodes.output.content.sourceRecordId`.
//   3. On fetch failure (robots, HTTP error), the snippet still saves but
//      `sourceRecordId` is null and a warning is surfaced.
//   4. ExoChain append uses the `snippet:<kind>:<target_id>` shape.
//   5. Unknown tag slugs are filtered into warnings.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  withQuerySavepoint: (_name: string, fn: () => Promise<unknown>) => fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

import { query } from '@/lib/db/client';
import { saveLinkSnippet } from '@/lib/snippets/service-link';
import { SourceFetchError } from '@/lib/sources/service';

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
    return mockRows([{ slug: 'provenance/wayback' }]);
  }
  if (/entity_type = 'target'/.test(sql) && /SELECT/.test(sql)) {
    return mockRows([{ id: 'target-node-1' }]);
  }
  if (/INSERT INTO causal_nodes/.test(sql)) {
    return mockRows([
      {
        id: 'node-xyz',
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

function observeQueries(): Array<{ sql: string; params: unknown[] }> {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
    log.push({ sql: String(sql), params: params ?? [] });
    return programmedResponses(String(sql));
  });
  return log;
}

const okFetcher = jest.fn(async () => ({
  bytes: Buffer.from('<html>ok</html>'),
  status: 200,
  contentType: 'text/html; charset=utf-8',
  finalUrl: 'https://web.archive.org/web/2024/https://example.com/press',
}));

const okWriter = jest.fn(async () => ({
  id: 'src-record-1',
  isNew: true,
  bytes: 15,
}));

describe('saveLinkSnippet', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    okFetcher.mockClear();
    okWriter.mockClear();
  });

  it('rejects empty href loudly', async () => {
    await expect(
      saveLinkSnippet({
        tenantId: 'tenant-1',
        targetKind: 'contact',
        targetId: 'target-1',
        href: '',
        sourceUrl: 'https://example.com',
      })
    ).rejects.toThrow(/href must be a non-empty/);
  });

  it('rejects non-http href (file:/// etc)', async () => {
    await expect(
      saveLinkSnippet({
        tenantId: 'tenant-1',
        targetKind: 'contact',
        targetId: 'target-1',
        href: 'file:///etc/passwd',
        sourceUrl: 'https://example.com',
      })
    ).rejects.toThrow(/http\(s\) URL/);
  });

  it('writes a source_records row with source_type=link on fetch success', async () => {
    observeQueries();
    const result = await saveLinkSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 'target-1',
      href: 'https://example.com/press-release',
      linkText: 'Jane joins Acme',
      sourceUrl: 'https://news.example.com/article',
      tagSlugs: ['provenance/wayback'],
      fetcher: okFetcher,
      writer: okWriter,
    });
    expect(result.sourceRecordId).toBe('src-record-1');
    expect(result.sourceRecordNew).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(okWriter).toHaveBeenCalledTimes(1);
    const writeArgs = okWriter.mock.calls[0][0] as { sourceType: string };
    expect(writeArgs.sourceType).toBe('link');
  });

  it('emits chain_id of the expected shape', async () => {
    observeQueries();
    const result = await saveLinkSnippet({
      tenantId: 'tenant-1',
      targetKind: 'company',
      targetId: 'company-7',
      href: 'https://example.com/about',
      sourceUrl: 'https://example.com',
      fetcher: okFetcher,
      writer: okWriter,
    });
    expect(result.chainId).toBe('snippet:company:company-7');
    expect(result.chainSequence).toBe(0);
  });

  it('saves the snippet even when gatedFetch throws, surfacing a warning', async () => {
    observeQueries();
    const failingFetcher = jest.fn(async () => {
      throw new SourceFetchError('robots.txt disallows', 'ROBOTS_DISALLOW');
    });
    const result = await saveLinkSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 'target-1',
      href: 'https://example.com/denied',
      sourceUrl: 'https://example.com',
      fetcher: failingFetcher as unknown as typeof okFetcher,
      writer: okWriter,
    });
    expect(result.sourceRecordId).toBeNull();
    expect(result.warnings[0]).toMatch(/ROBOTS_DISALLOW/);
    expect(okWriter).not.toHaveBeenCalled();
    // snippet still lands as a causal_node
    expect(result.snippetId).toMatch(/^[0-9a-f-]+$/);
  });

  it('filters unknown tag slugs and surfaces them as a warning', async () => {
    mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
      void params;
      const s = String(sql);
      if (/snippet_tags/.test(s) && /SELECT/.test(s)) {
        return mockRows([]); // nothing matches
      }
      return programmedResponses(s);
    });
    const result = await saveLinkSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 'target-1',
      href: 'https://example.com/p',
      sourceUrl: 'https://example.com',
      tagSlugs: ['not-a-real-tag'],
      fetcher: okFetcher,
      writer: okWriter,
    });
    expect(result.warnings).toContain(
      'Ignored unknown tag slugs: not-a-real-tag'
    );
  });

  it('treats chain append failure as non-fatal', async () => {
    mockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql);
      if (/INSERT INTO exo_chain_entries/.test(s)) {
        return Promise.reject(new Error('chain-down'));
      }
      return programmedResponses(s);
    });
    const result = await saveLinkSnippet({
      tenantId: 'tenant-1',
      targetKind: 'self',
      targetId: 'owner-5',
      href: 'https://example.com/x',
      sourceUrl: 'https://example.com',
      fetcher: okFetcher,
      writer: okWriter,
    });
    expect(result.chainSequence).toBe(-1);
    expect(result.warnings[result.warnings.length - 1]).toMatch(
      /ExoChain append failed/
    );
  });
});
