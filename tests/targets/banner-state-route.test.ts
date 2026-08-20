// ADR-032 gap 2 — /api/targets/[id]/banner-state route.
//
// Covers:
//   1. Feature-flag gate (404 when RESEARCH_FLAGS.sources is off).
//   2. GET 404s for an unknown target.
//   3. GET returns persisted dismissals for a known target.
//   4. POST validates fieldName/fingerprint and upserts a dismissal.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

let researchFlags = { sources: true };
jest.mock('@/lib/config/research-flags', () => ({
  get RESEARCH_FLAGS() {
    return researchFlags;
  },
}));

import { query } from '@/lib/db/client';
import { GET, POST } from '@/app/api/targets/[id]/banner-state/route';

type QueryMock = jest.MockedFunction<typeof query>;
const mockQuery = query as QueryMock;

function mockRows<T>(rows: T[]) {
  return Promise.resolve({
    rows,
    rowCount: rows.length,
    fields: [],
    command: '',
    oid: 0,
  }) as ReturnType<typeof query>;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(body?: unknown): import('next/server').NextRequest {
  return {
    json: async () => body ?? {},
  } as unknown as import('next/server').NextRequest;
}

describe('GET/POST /api/targets/[id]/banner-state', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    researchFlags = { sources: true };
  });

  it('404s when RESEARCH_FLAGS.sources is off', async () => {
    researchFlags = { sources: false };
    const res = await GET(req(), ctx('target-1'));
    expect(res.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('GET 404s for an unknown target', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ id: 't1' }])); // tenant lookup
    mockQuery.mockReturnValueOnce(mockRows([])); // target lookup: none

    const res = await GET(req(), ctx('missing'));
    expect(res.status).toBe(404);
  });

  it('GET returns persisted dismissals for a known target', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ id: 't1' }])); // tenant lookup
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'target-1' }])); // target exists
    mockQuery.mockReturnValueOnce(
      mockRows([
        {
          id: 'bs-1',
          tenant_id: 't1',
          target_id: 'target-1',
          field_name: 'title',
          conflict_fingerprint: 'a b',
          dismissed_by_user_id: 'u1',
          dismissed_at: '2026-08-01T00:00:00Z',
        },
      ])
    );

    const res = await GET(req(), ctx('target-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dismissals).toHaveLength(1);
    expect(body.dismissals[0].fieldName).toBe('title');
  });

  it('POST validates fieldName is required', async () => {
    const res = await POST(req({ fingerprint: 'a b' }), ctx('target-1'));
    expect(res.status).toBe(400);
  });

  it('POST validates fingerprint must be a string', async () => {
    const res = await POST(req({ fieldName: 'title' }), ctx('target-1'));
    expect(res.status).toBe(400);
  });

  it('POST upserts a dismissal for a known target', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ id: 't1' }])); // tenant lookup
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'target-1' }])); // target exists
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'u1' }])); // getCurrentOwnerProfileId
    mockQuery.mockReturnValueOnce(
      mockRows([
        {
          id: 'bs-1',
          tenant_id: 't1',
          target_id: 'target-1',
          field_name: 'title',
          conflict_fingerprint: 'a b',
          dismissed_by_user_id: 'u1',
          dismissed_at: '2026-08-01T00:00:00Z',
        },
      ])
    ); // dismissBanner upsert

    const res = await POST(
      req({ fieldName: 'title', fingerprint: 'a b' }),
      ctx('target-1')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dismissal.fieldName).toBe('title');
    expect(body.dismissal.conflictFingerprint).toBe('a b');

    const [sql] = mockQuery.mock.calls[3];
    expect(sql).toMatch(/INSERT INTO banner_state/);
  });
});
