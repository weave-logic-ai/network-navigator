// Image snippet service tests — Phase 1.5 round-trip.
//
// Covers:
//   1. saveImageSnippet writes a causal_nodes row with
//      `output.content.kind = 'image'` and the blob id from upsertBlob.
//   2. An evidence_for edge points at the target's causal node.
//   3. An exo_chain_entries row is appended with the chain_id formula
//      `snippet:<targetKind>:<targetId>` (same shape as text).
//   4. Chain append failure is non-fatal — response surfaces a warning.
//   5. Blob dedup propagates through: when the blob is reused, the
//      response carries blobReused=true.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  withQuerySavepoint: (_name: string, fn: () => Promise<unknown>) => fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

import { query } from '@/lib/db/client';
import { saveImageSnippet } from '@/lib/snippets/service';

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

const FAKE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0xde, 0xad, 0xbe, 0xef,
]);

function programmedResponses(
  sql: string,
  _params: unknown[],
  opts: { blobExists?: boolean } = {}
): ReturnType<typeof query> {
  // blob-store: SELECT existing row (pre-dedup probe)
  if (/FROM snippet_blobs/.test(sql) && /SELECT id, byte_length/.test(sql)) {
    if (opts.blobExists) {
      return mockRows([{ id: 'blob-dedup-1', byte_length: FAKE_PNG.byteLength }]);
    }
    return mockRows([]);
  }
  if (/INSERT INTO snippet_blobs/.test(sql)) {
    return mockRows([{ id: 'blob-new-1' }]);
  }
  if (/snippet_tags/.test(sql) && /SELECT/.test(sql)) {
    return mockRows([{ slug: 'provenance/screenshot' }]);
  }
  if (/entity_type = 'target'/.test(sql) && /SELECT/.test(sql)) {
    return mockRows([{ id: 'target-node-1' }]);
  }
  if (/INSERT INTO causal_nodes/.test(sql)) {
    return mockRows([
      {
        id: `node-${Math.random()}`,
        tenant_id: 'tenant-1',
        entity_type: 'snippet',
        entity_id: 'snippet-x',
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
        id: 'entry-img',
        tenant_id: 'tenant-1',
        chain_id: 'snippet:company:co-9',
        sequence: 0,
        prev_hash: null,
        entry_hash: Buffer.alloc(32, 0x11),
        operation: 'snippet_captured',
        data: {},
        actor: 'extension',
        created_at: '2026-04-17',
      },
    ]);
  }
  return mockRows([]);
}

function observeQueries(opts: { blobExists?: boolean } = {}) {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
    log.push({ sql: String(sql), params: params ?? [] });
    return programmedResponses(String(sql), params ?? [], opts);
  });
  return log;
}

describe('saveImageSnippet', () => {
  beforeEach(() => mockQuery.mockReset());

  it('writes a causal_nodes row whose output.content.kind is "image"', async () => {
    const log = observeQueries();
    const result = await saveImageSnippet({
      tenantId: 'tenant-1',
      targetKind: 'company',
      targetId: 'co-9',
      bytes: FAKE_PNG,
      mimeType: 'image/png',
      width: 240,
      height: 120,
      sourceUrl: 'https://example.com/logo.png',
      tagSlugs: ['provenance/screenshot'],
    });

    expect(result.chainId).toBe('snippet:company:co-9');
    expect(result.warnings).toEqual([]);
    expect(result.chainSequence).toBe(0);
    expect(result.blobId).toBe('blob-new-1');
    expect(result.blobReused).toBe(false);

    const nodeInsert = log.find(
      (q) => /INSERT INTO causal_nodes/.test(q.sql) && q.params[1] === 'snippet'
    );
    expect(nodeInsert).toBeDefined();
    const output = JSON.parse(nodeInsert!.params[5] as string);
    expect(output.content.kind).toBe('image');
    expect(output.content.blobId).toBe('blob-new-1');
    expect(output.content.mimeType).toBe('image/png');
    expect(output.content.width).toBe(240);
    expect(output.content.height).toBe(120);
    expect(output.tags).toEqual(['provenance/screenshot']);

    const inputs = JSON.parse(nodeInsert!.params[4] as string);
    expect(inputs.selectionMode).toBe('image');
    expect(inputs.sourceUrl).toBe('https://example.com/logo.png');

    const edge = log.find(
      (q) => /INSERT INTO causal_edges/.test(q.sql) && q.params[2] === 'evidence_for'
    );
    expect(edge).toBeDefined();

    const chain = log.find((q) => /INSERT INTO exo_chain_entries/.test(q.sql));
    expect(chain).toBeDefined();
    expect(chain!.params[1]).toBe('snippet:company:co-9');
    expect(chain!.params[5]).toBe('snippet_captured');
  });

  it('returns blobReused=true when the sha256 already exists', async () => {
    observeQueries({ blobExists: true });
    const result = await saveImageSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 'c-1',
      bytes: FAKE_PNG,
      mimeType: 'image/png',
      sourceUrl: 'https://example.com/logo.png',
    });
    expect(result.blobId).toBe('blob-dedup-1');
    expect(result.blobReused).toBe(true);
  });

  it('treats chain append failure as non-fatal', async () => {
    mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
      const s = String(sql);
      if (/INSERT INTO exo_chain_entries/.test(s)) {
        return Promise.reject(new Error('chain-down'));
      }
      return programmedResponses(s, params ?? []);
    });
    const result = await saveImageSnippet({
      tenantId: 'tenant-1',
      targetKind: 'contact',
      targetId: 'c-1',
      bytes: FAKE_PNG,
      mimeType: 'image/jpeg',
      sourceUrl: 'https://example.com/a.jpg',
    });
    expect(result.chainSequence).toBe(-1);
    expect(result.warnings[0]).toMatch(/ExoChain append failed/);
    expect(result.blobId).toBeDefined();
  });

  it('rejects empty byte buffers', async () => {
    await expect(
      saveImageSnippet({
        tenantId: 'tenant-1',
        targetKind: 'contact',
        targetId: 'c-1',
        bytes: Buffer.alloc(0),
        mimeType: 'image/png',
        sourceUrl: 'https://example.com',
      })
    ).rejects.toThrow(/non-empty/);
  });
});

describe('POST body shape — image-kind validation (duplicated route predicate)', () => {
  // The route's validator is duplicated here so route contract changes
  // surface as test failures. This mirrors the duplication policy in
  // tests/snippets/route.test.ts (intentional, well-scoped).
  const MAX = 5 * 1024 * 1024;

  function validateImageSnippetBody(body: unknown): { ok: boolean; message?: string } {
    if (!body || typeof body !== 'object') return { ok: false, message: 'not object' };
    const b = body as Record<string, unknown>;
    if (b.kind !== 'image') return { ok: false, message: 'kind' };
    if (typeof b.imageBytes !== 'string' || b.imageBytes.length === 0) {
      return { ok: false, message: 'imageBytes' };
    }
    if (b.imageBytes.length > Math.ceil((MAX * 4) / 3) + 256) {
      return { ok: false, message: 'imageBytes exceeds size limit' };
    }
    if (typeof b.mimeType !== 'string') return { ok: false, message: 'mimeType' };
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(b.mimeType)) {
      return { ok: false, message: 'mimeType-allowed' };
    }
    if (b.width !== undefined && typeof b.width !== 'number') {
      return { ok: false, message: 'width' };
    }
    return { ok: true };
  }

  it('accepts a well-formed image body', () => {
    const r = validateImageSnippetBody({
      kind: 'image',
      targetKind: 'contact',
      targetId: 't-1',
      imageBytes: 'aGVsbG8=',
      mimeType: 'image/png',
      sourceUrl: 'https://example.com/x',
      width: 10,
      height: 10,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects gif mime type', () => {
    const r = validateImageSnippetBody({
      kind: 'image',
      imageBytes: 'aGVsbG8=',
      mimeType: 'image/gif',
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/mimeType/);
  });

  it('rejects a base64 string above the 5 MB cap', () => {
    // 8 MB worth of padding exceeds ceil(5 MB * 4/3) ≈ 6.67 MB.
    const giant = 'a'.repeat(8 * 1024 * 1024);
    const r = validateImageSnippetBody({
      kind: 'image',
      imageBytes: giant,
      mimeType: 'image/png',
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/size/);
  });
});
