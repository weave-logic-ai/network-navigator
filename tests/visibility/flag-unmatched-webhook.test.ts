// WS-2 §14 — verify the flag-unmatched route fires the GitHub webhook after
// the DB insert succeeds, tolerates webhook failures silently, and returns
// the dispatched flag in the response.

import { NextRequest } from '../../app/node_modules/next/server';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
}));
jest.mock('@/lib/config/research-flags', () => ({
  RESEARCH_FLAGS: {
    parserTelemetry: true,
    snippets: false,
    targets: false,
    sources: false,
  },
}));

// Mock the webhook module at boundary — we don't want the real fetch path
// running under jest.
jest.mock('@/lib/analytics/github-webhook', () => ({
  buildRegressionPayload: jest.fn((input) => ({
    title: `Parser regression: ${input.pageType}`,
    body: `path=${input.domPath}`,
    labels: ['parser-regression', input.pageType.toLowerCase()],
  })),
  dispatchRegressionToGithub: jest.fn(),
}));

describe('POST /api/parser/flag-unmatched — webhook dispatch', () => {
  const priorSecret = process.env.LOCAL_OPERATOR_SECRET;
  let cookie: string;

  beforeAll(async () => {
    process.env.LOCAL_OPERATOR_SECRET = 'synthetic-operator-secret-for-parser-webhook-tests';
    const session = await createOperatorSession();
    if (!session) throw new Error('Synthetic operator session was not created');
    cookie = `${OPERATOR_COOKIE}=${session}`;
  });
  afterAll(() => {
    if (priorSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
    else process.env.LOCAL_OPERATOR_SECRET = priorSecret;
  });
  beforeEach(() => {
    jest.resetModules();
  });

  function buildRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost:3750/api/parser/flag-unmatched', {
      method: 'POST',
      headers: {
        host: 'localhost:3750', origin: 'http://localhost:3750',
        'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie,
      },
      body: JSON.stringify(body),
    });
  }

  async function seedTenant() {
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    // 1st: tenant lookup, 2nd: insert, 3rd+4th: analytics.
    mockQuery.mockResolvedValueOnce({
      rows: [{ tid: '00000000-0000-0000-0000-0000000000aa' }],
    } as unknown as Awaited<ReturnType<typeof query>>);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '33333333-3333-3333-3333-333333333333' }],
    } as unknown as Awaited<ReturnType<typeof query>>);
    mockQuery.mockResolvedValueOnce({
      rows: [{ tid: '00000000-0000-0000-0000-0000000000aa' }],
    } as unknown as Awaited<ReturnType<typeof query>>);
    mockQuery.mockResolvedValueOnce({ rows: [] } as unknown as Awaited<
      ReturnType<typeof query>
    >);
  }

  it('fires the webhook after a successful insert and surfaces dispatched=true', async () => {
    await seedTenant();
    const { dispatchRegressionToGithub, buildRegressionPayload } =
      await import('@/lib/analytics/github-webhook');
    (dispatchRegressionToGithub as jest.Mock).mockResolvedValueOnce({
      dispatched: true,
      status: 201,
      attempts: 1,
    });

    const route = await import('@/app/api/parser/flag-unmatched/route');
    const res = await route.POST(
      buildRequest({
        captureId: '11111111-1111-1111-1111-111111111111',
        pageType: 'PROFILE',
        domPath: 'main > section',
        domHtmlExcerpt: '<div>x</div>',
        textPreview: 'preview',
        userNote: 'heuristic miss',
      })
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.stored).toBe(true);
    expect(j.webhookDispatched).toBe(true);
    expect(dispatchRegressionToGithub).toHaveBeenCalledTimes(1);
    // The payload builder was handed the original fields.
    expect(buildRegressionPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        captureId: '11111111-1111-1111-1111-111111111111',
        pageType: 'PROFILE',
        domPath: 'main > section',
      })
    );
  });

  it('tolerates a webhook failure silently — stored=true, webhookDispatched=false', async () => {
    await seedTenant();
    const { dispatchRegressionToGithub } = await import(
      '@/lib/analytics/github-webhook'
    );
    (dispatchRegressionToGithub as jest.Mock).mockResolvedValueOnce({
      dispatched: false,
      status: 502,
      attempts: 3,
      error: 'Bad Gateway',
    });

    const route = await import('@/app/api/parser/flag-unmatched/route');
    const res = await route.POST(
      buildRequest({
        captureId: '11111111-1111-1111-1111-111111111111',
        pageType: 'PROFILE',
        domPath: 'main > section',
        domHtmlExcerpt: '<div/>',
      })
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.stored).toBe(true);
    expect(j.webhookDispatched).toBe(false);
  });

  it('tolerates a webhook throw silently', async () => {
    await seedTenant();
    const { dispatchRegressionToGithub } = await import(
      '@/lib/analytics/github-webhook'
    );
    (dispatchRegressionToGithub as jest.Mock).mockImplementationOnce(() => {
      throw new Error('unexpected');
    });

    const route = await import('@/app/api/parser/flag-unmatched/route');
    const res = await route.POST(
      buildRequest({
        captureId: '11111111-1111-1111-1111-111111111111',
        pageType: 'PROFILE',
        domPath: 'main > section',
        domHtmlExcerpt: '<div/>',
      })
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.stored).toBe(true);
    expect(j.webhookDispatched).toBe(false);
  });
});
