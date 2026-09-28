// Cron endpoint gating tests for /api/sources/cron/parser-rollup.
// Mirrors the guard-testing pattern used for the other cron routes
// (tests/sources/cron-rls.test.ts) but lives under tests/parser/ since this
// route is owned by the parser telemetry surface (ADR-031).

jest.mock('@/lib/db/client', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
}));

const buildReq = (secret?: string, day?: string): unknown => ({
  headers: {
    get: (k: string) => {
      if (k.toLowerCase() === 'x-cron-secret') return secret ?? null;
      return null;
    },
  },
  nextUrl: {
    searchParams: new URLSearchParams(day ? { day } : {}),
  },
});

const PREV_ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...PREV_ENV };
  process.env.CRON_SECRET = 'test-cron-secret';
});

afterAll(() => {
  process.env = PREV_ENV;
});

describe('POST /api/sources/cron/parser-rollup', () => {
  it('returns 404 when RESEARCH_PARSER_TELEMETRY flag is off', async () => {
    process.env.RESEARCH_PARSER_TELEMETRY = 'false';
    const mod = await import('@/app/api/sources/cron/parser-rollup/route');
    const res = await mod.POST(buildReq('test-cron-secret') as never);
    expect(res.status).toBe(404);
  });

  it('returns 401 when the cron secret is wrong', async () => {
    process.env.RESEARCH_PARSER_TELEMETRY = 'true';
    const mod = await import('@/app/api/sources/cron/parser-rollup/route');
    const res = await mod.POST(buildReq('wrong-secret') as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when the cron secret header is absent', async () => {
    process.env.RESEARCH_PARSER_TELEMETRY = 'true';
    const mod = await import('@/app/api/sources/cron/parser-rollup/route');
    const res = await mod.POST(buildReq() as never);
    expect(res.status).toBe(401);
  });

  it('returns 400 for a malformed day param', async () => {
    process.env.RESEARCH_PARSER_TELEMETRY = 'true';
    const mod = await import('@/app/api/sources/cron/parser-rollup/route');
    const res = await mod.POST(buildReq('test-cron-secret', 'not-a-date') as never);
    expect(res.status).toBe(400);
  });

  it('returns 200 with a rollup summary when flag on, auth correct, and day valid', async () => {
    process.env.RESEARCH_PARSER_TELEMETRY = 'true';
    const mod = await import('@/app/api/sources/cron/parser-rollup/route');
    const res = await mod.POST(buildReq('test-cron-secret', '2026-08-19') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.day).toBe('2026-08-19');
    expect(body.bucketsUpserted).toBe(0); // mocked query returns no raw rows
  });
});
