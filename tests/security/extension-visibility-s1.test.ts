import { NextRequest } from '../../app/node_modules/next/server';
import { createHash } from 'node:crypto';
import { middleware } from '../../app/src/middleware';
import { GET as analyticsProbe, POST as analytics } from '../../app/src/app/api/extension/analytics/route';
import { GET as entityDiff } from '../../app/src/app/api/extension/entity-diff/route';
import { POST as flagUnmatched } from '../../app/src/app/api/parser/flag-unmatched/route';
import { POST as regressionReport } from '../../app/src/app/api/parser/regression-report/route';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { query } from '@/lib/db/client';
import { recordEvent } from '@/lib/analytics/events';
import { loadContactProjection } from '@/lib/projections/contact';
import { dispatchRegressionToGithub } from '@/lib/analytics/github-webhook';
import { checkRateLimit, resetRateLimits } from '@/lib/middleware/extension-rate-limiter';

jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));
jest.mock('@/lib/analytics/events', () => ({ recordEvent: jest.fn() }));
jest.mock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { parserTelemetry: true } }));
jest.mock('@/lib/projections/contact', () => ({
  loadContactProjection: jest.fn(), loadContactProjectionFromCapture: jest.fn(),
}));
jest.mock('@/lib/projections/company', () => ({
  loadCompanyProjection: jest.fn(), loadCompanyProjectionFromCapture: jest.fn(),
}));
jest.mock('@/lib/analytics/github-webhook', () => ({
  buildRegressionPayload: jest.fn(() => ({})),
  dispatchRegressionToGithub: jest.fn(),
}));

const dbQuery = query as jest.Mock;
const event = recordEvent as jest.Mock;
const projection = loadContactProjection as jest.Mock;
const webhook = dispatchRegressionToGithub as jest.Mock;
const origin = `chrome-extension://${'a'.repeat(32)}`;
const foreign = `chrome-extension://${'b'.repeat(32)}`;
const token = `ext_${'A'.repeat(43)}`;
const id = '11111111-1111-4111-8111-111111111111';
const tokenRow = { extension_id: id, token_hash: createHash('sha256').update(token).digest('hex'),
  created_at: new Date().toISOString(), is_revoked: false };
const priorOrigins = process.env.EXTENSION_ALLOWED_ORIGINS;
const priorSecret = process.env.LOCAL_OPERATOR_SECRET;

function req(path: string, method: string, headers: Record<string, string>, body?: string): NextRequest {
  return new NextRequest(`http://localhost:3750${path}`, {
    method, headers: { host: 'localhost:3750', ...headers }, body,
  });
}

const extensionHeaders = { origin, 'x-extension-token': token, 'content-type': 'application/json' };

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  process.env.EXTENSION_ALLOWED_ORIGINS = origin;
  process.env.LOCAL_OPERATOR_SECRET = 'synthetic-operator-secret-for-visibility-tests';
  dbQuery.mockResolvedValue({ rows: [tokenRow], rowCount: 1 });
  event.mockResolvedValue({ written: true });
  webhook.mockResolvedValue({ dispatched: false });
  projection.mockResolvedValue(null);
});
afterAll(() => {
  if (priorOrigins === undefined) delete process.env.EXTENSION_ALLOWED_ORIGINS;
  else process.env.EXTENSION_ALLOWED_ORIGINS = priorOrigins;
  if (priorSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
  else process.env.LOCAL_OPERATOR_SECRET = priorSecret;
});

test('only named visibility routes admit configured extension origin in middleware', async () => {
  for (const path of ['/api/extension/analytics', '/api/extension/entity-diff',
    '/api/parser/flag-unmatched', '/api/parser/regression-report']) {
    const method = path.endsWith('entity-diff') ? 'GET' : 'POST';
    const request = req(path, method, extensionHeaders, method === 'POST' ? '{}' : undefined);
    expect((await middleware(request)).status).toBe(200);
  }
  expect((await middleware(req('/api/extension/captures', 'GET', extensionHeaders))).status).toBe(403);
  expect((await middleware(req('/api/extension/health-internal', 'GET', extensionHeaders))).status).toBe(403);
  expect((await middleware(req('/api/parser/other', 'POST', extensionHeaders, '{}'))).status).toBe(403);
  expect((await middleware(req('/api/extension/analytics', 'POST', { ...extensionHeaders, origin: foreign }, '{}'))).status).toBe(403);
  const preflight = await middleware(req('/api/parser/flag-unmatched', 'OPTIONS', { origin }));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-headers')).toContain('X-Extension-Token');
});

test('missing, prefix, revoked, and foreign extension credentials have zero effects', async () => {
  const routes = [
    () => analytics(req('/api/extension/analytics', 'POST', { origin, 'content-type': 'application/json' }, '{"event":"parse_panel_viewed"}')),
    () => entityDiff(req(`/api/extension/entity-diff?kind=contact&id=${id}`, 'GET', { origin })),
    () => flagUnmatched(req('/api/parser/flag-unmatched', 'POST', { origin, 'content-type': 'application/json' }, '{}')),
    () => regressionReport(req('/api/parser/regression-report', 'POST', { origin, 'content-type': 'application/json' }, '{}')),
  ];
  for (const call of routes) expect((await call()).status).toBe(401);
  expect(dbQuery).not.toHaveBeenCalled();
  expect(event).not.toHaveBeenCalled();
  expect(projection).not.toHaveBeenCalled();
  expect(webhook).not.toHaveBeenCalled();

  expect((await analytics(req('/api/extension/analytics', 'POST', {
    origin, 'x-extension-token': 'ext_AAAAAAAA', 'content-type': 'application/json',
  }, '{"event":"parse_panel_viewed"}'))).status).toBe(401);
  expect(dbQuery).not.toHaveBeenCalled();

  dbQuery.mockResolvedValue({ rows: [{ ...tokenRow, is_revoked: true }] });
  expect((await analytics(req('/api/extension/analytics', 'POST', extensionHeaders, '{"event":"parse_panel_viewed"}'))).status).toBe(401);
  expect(event).not.toHaveBeenCalled();
  dbQuery.mockClear();
  expect((await analytics(req('/api/extension/analytics', 'POST', {
    ...extensionHeaders, origin: foreign,
  }, '{"event":"parse_panel_viewed"}'))).status).toBe(403);
  expect(dbQuery).not.toHaveBeenCalled();
});

test('full token runs the four guarded handlers against synthetic mocks', async () => {
  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] });
  dbQuery.mockResolvedValueOnce({ rows: [{ extension_id: id }], rowCount: 1 });
  expect((await analytics(req('/api/extension/analytics', 'POST', extensionHeaders,
    '{"event":"parse_panel_viewed"}'))).status).toBe(200);
  expect(event).toHaveBeenCalledTimes(1);

  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] });
  dbQuery.mockResolvedValueOnce({ rows: [{ extension_id: id }], rowCount: 1 });
  expect((await entityDiff(req(`/api/extension/entity-diff?kind=contact&id=${id}`, 'GET', extensionHeaders))).status).toBe(404);
  expect(projection).toHaveBeenCalledWith(id);

  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] })
    .mockResolvedValueOnce({ rows: [{ extension_id: id }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ tid: id }] })
    .mockResolvedValueOnce({ rows: [{ id }] });
  const flag = JSON.stringify({ captureId: id, pageType: 'PROFILE', domPath: 'html>body', domHtmlExcerpt: '<p>synthetic</p>' });
  expect((await flagUnmatched(req('/api/parser/flag-unmatched', 'POST', extensionHeaders, flag))).status).toBe(200);
  expect(dbQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO parser_selector_flags'))).toBe(true);
  expect(webhook).toHaveBeenCalledTimes(1);

  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] });
  dbQuery.mockResolvedValueOnce({ rows: [{ extension_id: id }], rowCount: 1 });
  expect((await regressionReport(req('/api/parser/regression-report', 'POST', extensionHeaders,
    '{"pageType":"INVALID","rawHtml":"<p>synthetic</p>"}'))).status).toBe(400);
});

test('authenticated feature probe is read-only and survives exhausted POST rate limit', async () => {
  for (let i = 0; i < 30; i++) checkRateLimit(id, '/api/extension/analytics');
  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] });
  dbQuery.mockResolvedValueOnce({ rows: [{ extension_id: id }], rowCount: 1 });
  expect((await middleware(req('/api/extension/analytics', 'GET', extensionHeaders))).status).toBe(200);
  const response = await analyticsProbe(req('/api/extension/analytics', 'GET', extensionHeaders));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled: true });
  expect(event).not.toHaveBeenCalled();
  expect((await analyticsProbe(req('/api/extension/analytics', 'GET', { origin }))).status).toBe(401);
});

test('originless MV3 feature probe needs a full token and stays on the named read route', async () => {
  const headers = { 'x-extension-token': token, 'sec-fetch-site': 'none' };
  const request = req('/api/extension/analytics', 'GET', headers);
  expect((await middleware(request)).status).toBe(200);
  expect((await analyticsProbe(request)).status).toBe(200);
  expect((await middleware(req('/api/parser/flag-unmatched', 'GET', headers))).status).toBe(401);
  expect((await analyticsProbe(req('/api/extension/analytics', 'GET', {
    ...headers, 'sec-fetch-site': 'same-origin',
  }))).status).toBe(401);
});

test('same-origin visibility reads need operator session, including direct handler invocation', async () => {
  const path = `/api/extension/entity-diff?kind=contact&id=${id}`;
  const local = { origin: 'http://localhost:3750', 'sec-fetch-site': 'same-origin' };
  expect((await entityDiff(req(path, 'GET', local))).status).toBe(401);
  expect(projection).not.toHaveBeenCalled();
  const session = await createOperatorSession();
  expect(session).not.toBeNull();
  const authed = { ...local, cookie: `${OPERATOR_COOKIE}=${session}` };
  expect((await middleware(req(path, 'GET', authed))).status).toBe(200);
  expect((await entityDiff(req(path, 'GET', authed))).status).toBe(404);
  expect(projection).toHaveBeenCalledWith(id);
});
