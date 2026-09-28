import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

jest.mock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { snippets: true } }));
jest.mock('@/lib/middleware/extension-auth-middleware', () => ({
  withExtensionAuth: (_req: NextRequest, handler: (req: NextRequest, id: string) => Promise<unknown>) => handler(_req, currentExtensionId),
}));
jest.mock('@/lib/snippets/tenant', () => ({ getDefaultTenantId: jest.fn() }));
jest.mock('@/lib/snippets/service', () => ({ saveTextSnippet: jest.fn(), saveImageSnippet: jest.fn() }));
jest.mock('@/lib/snippets/service-link', () => ({ saveLinkSnippet: jest.fn() }));
jest.mock('@/lib/snippets/blob-store', () => ({
  decodeAndValidateImage: jest.fn(() => Buffer.from('synthetic-image')),
  ALLOWED_IMAGE_MIME_TYPES: new Set(['image/png']), MAX_IMAGE_BYTES: 5242880,
}));
jest.mock('@/lib/db/client', () => ({ transactionWithQueryContext: jest.fn() }));

import { GET, POST } from '@/app/api/extension/snippet/route';
import { getDefaultTenantId } from '@/lib/snippets/tenant';
import { saveTextSnippet, saveImageSnippet } from '@/lib/snippets/service';
import { saveLinkSnippet } from '@/lib/snippets/service-link';
import { transactionWithQueryContext } from '@/lib/db/client';

const tenant = getDefaultTenantId as jest.MockedFunction<typeof getDefaultTenantId>;
const save = saveTextSnippet as jest.MockedFunction<typeof saveTextSnippet>;
const saveImage = saveImageSnippet as jest.MockedFunction<typeof saveImageSnippet>;
const saveLink = saveLinkSnippet as jest.MockedFunction<typeof saveLinkSnippet>;
const transact = transactionWithQueryContext as jest.MockedFunction<typeof transactionWithQueryContext>;
const requestId = '123e4567-e89b-42d3-a456-426614174000';
const body = { kind: 'text', requestId, targetKind: 'contact', targetId: 'target-a',
  sourceUrl: 'https://example.test/', text: 'synthetic evidence' };
let currentExtensionId = 'extension-a';

function request(payload: unknown, expectedTenant?: string) {
  return new Request('http://localhost/api/extension/snippet', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(expectedTenant ? { 'X-Snippet-Tenant-ID': expectedTenant } : {}) }, body: JSON.stringify(payload),
  }) as NextRequest;
}

describe('snippet request receipts', () => {
  const receipts = new Map<string, { tenant_id: string; target_kind: string; target_id: string; request_hash: string; response: unknown }>();

  beforeEach(() => {
    receipts.clear();
    currentExtensionId = 'extension-a';
    jest.clearAllMocks();
    tenant.mockResolvedValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    let created = 0;
    save.mockImplementation(async () => {
      created++;
      return { snippetId: `snippet-${created}`, causalNodeId: `node-${created}`,
        chainId: 'snippet:contact:target-a', chainSequence: 0, warnings: [] };
    });
    saveImage.mockResolvedValue({ snippetId: 'image-1', causalNodeId: 'image-node-1', chainId: 'image-chain', chainSequence: 0, warnings: [] });
    saveLink.mockResolvedValue({ snippetId: 'link-1', causalNodeId: 'link-node-1', chainId: 'link-chain', chainSequence: 0, warnings: [] });
    transact.mockImplementation(async (fn) => fn({
      query: async (sql: string, params: unknown[]) => {
        const key = String(sql.includes('SELECT tenant_id') ? params[0] : params[1]);
        if (sql.includes('INSERT INTO extension_snippet_receipts')) {
          if (receipts.has(key)) return { rowCount: 0, rows: [] };
          receipts.set(key, { tenant_id: String(params[2]), target_kind: String(params[3]),
            target_id: String(params[4]), request_hash: String(params[5]), response: {} });
          return { rowCount: 1, rows: [{ request_id: params[1] }] };
        }
        if (sql.includes('SELECT tenant_id')) return { rowCount: 1, rows: [receipts.get(key)] };
        if (sql.includes('UPDATE extension_snippet_receipts')) {
          receipts.get(key)!.response = JSON.parse(String(params[2]));
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as never));
  });

  test('success followed by lost response and replay returns one saved snippet', async () => {
    const first = await POST(request(body));
    const replay = await POST(request(body));
    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(save).toHaveBeenCalledTimes(1);
    expect(receipts.size).toBe(1);
  });

  test('replacement token returns the same receipt without a second graph write', async () => {
    const first = await POST(request(body));
    currentExtensionId = 'extension-b';
    const replay = await POST(request(body));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(save).toHaveBeenCalledTimes(1);
    expect(receipts.size).toBe(1);
  });

  test('tenant identity is available to authenticated browser and mismatched tenant is rejected before writing', async () => {
    const identity = await GET(new Request('http://localhost/api/extension/snippet') as NextRequest);
    expect(await identity.json()).toEqual({ tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect((await POST(request(body, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))).status).toBe(409);
    expect(save).not.toHaveBeenCalled();
  });

  test('same key cannot cross tenant, target, or payload', async () => {
    await POST(request(body));
    expect((await POST(request({ ...body, targetId: 'target-b' }))).status).toBe(409);
    expect((await POST(request({ ...body, text: 'different synthetic evidence' }))).status).toBe(409);
    tenant.mockResolvedValue('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect((await POST(request(body))).status).toBe(409);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('malformed key fails before a write', async () => {
    expect((await POST(request({ ...body, requestId: 'invalid' }))).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  test.each([
    ['image', { ...body, kind: 'image', imageBytes: 'c3ludGhldGlj', mimeType: 'image/png' }, saveImage],
    ['link', { ...body, kind: 'link', href: 'https://example.test/link' }, saveLink],
  ])('%s direct online save replays under the same request key', async (_kind, payload, service) => {
    const first = await POST(request(payload));
    const replay = await POST(request(payload));
    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(service).toHaveBeenCalledTimes(1);
  });

  test('image replay survives Chrome storage reordering JSON keys', async () => {
    const image = { ...body, kind: 'image', imageBytes: 'c3ludGhldGlj', mimeType: 'image/png',
      note: 'synthetic note' };
    const first = await POST(request(image));
    const reordered = Object.fromEntries(Object.entries(image).sort(([a], [b]) => a.localeCompare(b)));
    const replay = await POST(request(reordered));
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(saveImage).toHaveBeenCalledTimes(1);
    expect(receipts.size).toBe(1);
  });

  test('reordered Chrome replay accepts a receipt written with the old insertion-order hash', async () => {
    const image = { kind: 'image', targetKind: 'contact', targetId: 'target-a',
      imageBytes: 'c3ludGhldGlj', mimeType: 'image/png', sourceUrl: 'https://example.test/',
      tagSlugs: [], note: 'synthetic note', requestId };
    const oldHash = createHash('sha256').update(JSON.stringify(image)).digest('hex');
    receipts.set(requestId, { tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      target_kind: 'contact', target_id: 'target-a', request_hash: oldHash,
      response: { success: true, snippetId: 'old-image', causalNodeId: 'old-node' } });
    const reordered = Object.fromEntries(Object.entries(image).sort(([a], [b]) => a.localeCompare(b)));
    const replay = await POST(request(reordered));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ snippetId: 'old-image' });
    expect(saveImage).not.toHaveBeenCalled();
  });
});
