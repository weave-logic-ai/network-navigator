import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/extension/capture/route';
import { transaction } from '@/lib/db/client';
import { storePageCache } from '@/lib/capture/capture-store';
import { wsServer } from '@/lib/websocket/ws-server';
import { triggerAutoScore } from '@/lib/scoring/auto-score';

let principal = 'extension-a';
jest.mock('next/server', () => ({
  NextResponse: { json: (body: object, options?: ResponseInit) => Response.json(body, options) },
}), { virtual: true });
jest.mock('@/lib/middleware/extension-auth-middleware', () => ({
  withExtensionAuth: (req: NextRequest, handler: (req: NextRequest, id: string) => Promise<Response>) =>
    handler(req, principal),
}));
jest.mock('@/lib/db/client', () => ({ transaction: jest.fn() }));
jest.mock('@/lib/capture/capture-store', () => ({ storePageCache: jest.fn() }));
jest.mock('@/lib/scoring/auto-score', () => ({ triggerAutoScore: jest.fn() }));
jest.mock('@/lib/websocket/ws-server', () => ({
  wsServer: { isRunning: true, pushToExtension: jest.fn() },
}));
jest.mock('@/lib/websocket/ws-events', () => ({
  createCaptureConfirmedEvent: jest.fn(() => ({ type: 'confirmed' })),
}));

const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;
const mockStore = storePageCache as jest.MockedFunction<typeof storePageCache>;
const captureId = '64539dd9-6646-4b29-856a-b16b8d899ded';
const body = {
  captureId,
  url: 'https://www.linkedin.com/search/results/people/?page=1',
  pageType: 'SEARCH_PEOPLE',
  html: '<html>' + 'x'.repeat(120) + '</html>',
  scrollDepth: 0.5,
  viewportHeight: 800,
  documentHeight: 1600,
  capturedAt: '2026-01-01T00:00:00Z',
  extensionVersion: '1.0',
  sessionId: 'session',
  triggerMode: 'manual',
};

function request(payload = body) {
  return { json: async () => payload } as NextRequest;
}

describe('extension capture replay', () => {
  const receipts = new Map<string, { request_hash: string; response: object }>();
  const statements: string[] = [];
  let chain: Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    receipts.clear();
    statements.length = 0;
    principal = 'extension-a';
    chain = Promise.resolve();
    mockStore.mockResolvedValue({ id: 'cache-row', storedBytes: Buffer.byteLength(body.html), compressionRatio: 0 });
    // Serialize fake transactions as PostgreSQL does for a conflicting unique key.
    mockTransaction.mockImplementation((fn) => {
      const run = chain.then(async () => {
        const before = new Map(receipts);
        const client = {
          query: jest.fn(async (sql: string, params: unknown[] = []) => {
            statements.push(sql);
            const key = `${params[0]}:${params[1]}`;
            if (sql.includes('INSERT INTO extension_capture_receipts')) {
              if (receipts.has(key)) return { rowCount: 0, rows: [] };
              receipts.set(key, { request_hash: params[2] as string, response: {} });
              return { rowCount: 1, rows: [{ capture_id: params[1] }] };
            }
            if (sql.includes('SELECT request_hash, response')) return { rows: [receipts.get(key)] };
            if (sql.includes('UPDATE extension_capture_receipts')) {
              receipts.get(key)!.response = JSON.parse(params[2] as string);
              return { rows: [] };
            }
            if (sql.includes('UPDATE tasks')) return { rows: [{ goal_id: null }] };
            if (sql.includes('SELECT id FROM tasks')) return { rows: [] };
            return { rows: [] };
          }),
        };
        try {
          return await fn(client as never);
        } catch (error) {
          receipts.clear();
          for (const [key, value] of before) receipts.set(key, value);
          throw error;
        }
      });
      chain = run.catch(() => undefined);
      return run;
    });
  });

  it('returns the committed result for concurrent and later retries without repeating effects', async () => {
    const [first, concurrent] = await Promise.all([POST(request()), POST(request())]);
    const later = await POST(request());
    expect([first.status, concurrent.status, later.status]).toEqual([200, 200, 200]);
    expect(await first.json()).toEqual(await concurrent.json());
    expect(await later.json()).toMatchObject({ success: true, captureId });
    expect(mockStore).toHaveBeenCalledTimes(1);
    expect(statements.filter((sql) => sql.includes('UPDATE tasks'))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes('INSERT INTO tasks'))).toHaveLength(1);
    expect(wsServer.pushToExtension).toHaveBeenCalledTimes(1);
    expect(triggerAutoScore).not.toHaveBeenCalled();
  });

  it('rejects a changed payload while allowing the same ID for another authenticated extension', async () => {
    expect((await POST(request())).status).toBe(200);
    const changed = await POST(request({ ...body, html: body.html + 'changed' }));
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: 'CAPTURE_ID_CONFLICT' });
    principal = 'extension-b';
    expect((await POST(request())).status).toBe(200);
    expect(mockStore).toHaveBeenCalledTimes(2);
  });

  it('does not trigger profile scoring or a WebSocket confirmation on replay', async () => {
    const profile = {
      ...body,
      pageType: 'PROFILE',
      url: 'https://www.linkedin.com/in/example/',
    };
    mockTransaction.mockImplementationOnce(async (fn) => {
      const client = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
          if (sql.includes('INSERT INTO extension_capture_receipts')) {
            receipts.set(`${params[0]}:${params[1]}`, { request_hash: params[2] as string, response: {} });
            return { rowCount: 1, rows: [{ capture_id: params[1] }] };
          }
          if (sql.includes('SELECT id FROM contacts')) return { rows: [{ id: 'contact-1' }] };
          if (sql.includes('UPDATE extension_capture_receipts')) {
            receipts.get(`${params[0]}:${params[1]}`)!.response = JSON.parse(params[2] as string);
          }
          return { rows: [] };
        }),
      };
      return fn(client as never);
    });
    expect((await POST(request(profile))).status).toBe(200);
    expect((await POST(request(profile))).status).toBe(200);
    expect(triggerAutoScore).toHaveBeenCalledTimes(1);
    expect(wsServer.pushToExtension).toHaveBeenCalledTimes(1);
    expect(mockStore).toHaveBeenCalledTimes(1);
  });

  it('rolls back a failed cache insert so a retry can claim and store the capture', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockStore.mockRejectedValueOnce(new Error('database write failed'));
    try {
      const failed = await POST(request());
      expect(failed.status).toBe(500);
      expect(receipts).toHaveProperty('size', 0);
      const retry = await POST(request());
      expect(retry.status).toBe(200);
      expect(mockStore).toHaveBeenCalledTimes(2);
      expect(wsServer.pushToExtension).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
