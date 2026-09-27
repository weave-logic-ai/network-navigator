import { readFileSync } from 'node:fs';
import { NextRequest } from '../../app/node_modules/next/server';
import { getMiddlewareMatchers } from '../../app/node_modules/next/dist/build/analysis/get-page-static-info';
import { getMiddlewareRouteMatcher } from '../../app/node_modules/next/dist/shared/lib/router/utils/middleware-route-matcher';
import { middleware, config as middlewareConfig } from '../../app/src/middleware';
import { GET, POST as parseCapture } from '../../app/src/app/api/extension/captures/route';
import { DELETE } from '../../app/src/app/api/extension/captures/[id]/route';
import { POST as purge } from '../../app/src/app/api/admin/purge/route';
import { POST as unlock } from '../../app/src/app/api/operator/unlock/route';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { query, transaction } from '@/lib/db/client';
import { parseCachedPage } from '@/lib/parser/parse-engine';

jest.mock('@/lib/db/client', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('@/lib/parser/parse-engine', () => ({ parseCachedPage: jest.fn() }));

const dbQuery = query as jest.Mock;
const dbTransaction = transaction as jest.Mock;
const parse = parseCachedPage as jest.Mock;
const captureId = '11111111-1111-4111-8111-111111111111';
const syntheticSecret = 'synthetic-local-operator-secret-1234567890';
const dashboard = { origin: 'http://localhost:3751', 'sec-fetch-site': 'same-origin' };
const priorSecret = process.env.LOCAL_OPERATOR_SECRET;
const priorOrigins = process.env.EXTENSION_ALLOWED_ORIGINS;

function req(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string, internalHost = 'localhost:3751') {
  return new NextRequest(`http://${internalHost}${path}`, {
    method, headers: { host: 'localhost:3751', ...headers }, body,
  });
}

async function sessionHeaders(): Promise<Record<string, string>> {
  const session = await createOperatorSession();
  if (!session) throw new Error('Synthetic session was not configured');
  return { cookie: `${OPERATOR_COOKIE}=${session}` };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LOCAL_OPERATOR_SECRET = syntheticSecret;
  delete process.env.EXTENSION_ALLOWED_ORIGINS;
});
afterAll(() => {
  if (priorSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
  else process.env.LOCAL_OPERATOR_SECRET = priorSecret;
  if (priorOrigins === undefined) delete process.env.EXTENSION_ALLOWED_ORIGINS;
  else process.env.EXTENSION_ALLOWED_ORIGINS = priorOrigins;
});

test.each([
  ['foreign origin', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
  ['null origin', { origin: 'null' }],
  ['missing provenance', {}],
  ['rebinding host', { ...dashboard, host: 'localhost.evil.example' }],
  ['invalid port', { ...dashboard, host: 'localhost:99999' }],
  ['cross-site metadata', { ...dashboard, 'sec-fetch-site': 'cross-site' }],
])('rejects %s before capture effects', async (_case, headers) => {
  const h = { ...headers, ...await sessionHeaders() };
  expect((await GET(req('/api/extension/captures', 'GET', h))).status).toBe(403);
  expect((await parseCapture(req('/api/extension/captures', 'POST', { ...h, 'content-type': 'application/json' }, JSON.stringify({ captureId })))).status).toBe(403);
  expect((await DELETE(req(`/api/extension/captures/${captureId}`, 'DELETE', h), { params: Promise.resolve({ id: captureId }) })).status).toBe(403);
  expect(dbQuery).not.toHaveBeenCalled();
  expect(parse).not.toHaveBeenCalled();
});

test('forged local headers without cookie cannot read, parse, delete, or purge', async () => {
  const json = { ...dashboard, 'content-type': 'application/json' };
  expect((await middleware(req('/api/dashboard', 'GET', dashboard))).status).toBe(401);
  expect((await GET(req('/api/extension/captures', 'GET', dashboard))).status).toBe(401);
  expect((await parseCapture(req('/api/extension/captures', 'POST', json, JSON.stringify({ captureId })))).status).toBe(401);
  expect((await DELETE(req(`/api/extension/captures/${captureId}`, 'DELETE', dashboard), { params: Promise.resolve({ id: captureId }) })).status).toBe(401);
  expect((await purge(req('/api/admin/purge', 'POST', json, JSON.stringify({ scope: 'all', confirmToken: 'CONFIRM_PURGE' })))).status).toBe(401);
  expect(dbQuery).not.toHaveBeenCalled();
  expect(dbTransaction).not.toHaveBeenCalled();
  expect(parse).not.toHaveBeenCalled();
});

test('operator APIs fail closed when the server secret is missing', async () => {
  const auth = await sessionHeaders();
  delete process.env.LOCAL_OPERATOR_SECRET;
  expect((await middleware(req('/api/dashboard', 'GET', { ...auth, ...dashboard }))).status).toBe(401);
  expect((await GET(req('/api/extension/captures', 'GET', { ...auth, ...dashboard }))).status).toBe(401);
  expect(dbQuery).not.toHaveBeenCalled();
});

test('stale and tampered cookies fail middleware and direct handlers', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now - 9 * 60 * 60 * 1000);
  const stale = await createOperatorSession();
  clock.mockRestore();
  const valid = await createOperatorSession();
  const tampered = `${valid!.slice(0, -1)}${valid!.endsWith('a') ? 'b' : 'a'}`;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = valid!.at(-1)!;
  const nonCanonical = `${valid!.slice(0, -1)}${alphabet[alphabet.indexOf(last) ^ 1]}`;
  for (const token of [stale!, tampered, nonCanonical]) {
    const headers = { ...dashboard, cookie: `${OPERATOR_COOKIE}=${token}` };
    expect((await middleware(req('/api/dashboard', 'GET', headers))).status).toBe(401);
    expect((await GET(req('/api/extension/captures', 'GET', headers))).status).toBe(401);
  }
  expect(dbQuery).not.toHaveBeenCalled();
});

test('unlock fails closed and issues signed HttpOnly SameSite cookie only for correct secret', async () => {
  const headers = { ...dashboard, 'content-type': 'application/json' };
  const body = JSON.stringify({ secret: syntheticSecret });
  delete process.env.LOCAL_OPERATOR_SECRET;
  expect((await unlock(req('/api/operator/unlock', 'POST', headers, body))).status).toBe(503);
  process.env.LOCAL_OPERATOR_SECRET = syntheticSecret;
  expect((await unlock(req('/api/operator/unlock', 'POST', headers, JSON.stringify({ secret: 'wrong' })))).status).toBe(401);
  expect((await unlock(req('/api/operator/unlock', 'POST', headers,
    JSON.stringify({ secret: 'x'.repeat(5000) })))).status).toBe(413);
  const response = await unlock(req('/api/operator/unlock', 'POST', headers, body));
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie') ?? '';
  expect(cookie).toContain(`${OPERATOR_COOKIE}=`);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Strict/i);
  expect(cookie).toContain('Max-Age=28800');
  expect(cookie).not.toContain(syntheticSecret);
  const issued = response.cookies.get(OPERATOR_COOKIE)?.value;
  expect(issued).toBeTruthy();
  const unlocked = { ...dashboard, cookie: `${OPERATOR_COOKIE}=${issued}` };
  expect((await middleware(req('/api/dashboard', 'GET', unlocked))).status).toBe(200);
  dbQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }).mockResolvedValueOnce({ rows: [] });
  expect((await GET(req('/api/extension/captures', 'GET', unlocked))).status).toBe(200);
});

test('valid session permits dashboard read and mocked mutations behind internal Next URL', async () => {
  const auth = await sessionHeaders();
  dbQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValue({ rowCount: 1 });
  parse.mockResolvedValue({ captureId });
  dbTransaction.mockImplementation(async () => undefined);
  const get = req('/api/extension/captures', 'GET', { ...auth, 'sec-fetch-site': 'same-origin' }, undefined, '0.0.0.0:3000');
  expect((await middleware(get)).status).toBe(200);
  expect((await GET(get)).status).toBe(200);
  expect((await middleware(req('/dashboard', 'GET', { ...auth, 'sec-fetch-site': 'same-origin' }))).status).toBe(200);
  expect((await middleware(req('/dashboard', 'GET', { 'sec-fetch-site': 'same-origin' }))).status).toBe(307);
  expect((await parseCapture(req('/api/extension/captures', 'POST', { ...auth, ...dashboard, 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ captureId }), '0.0.0.0:3000'))).status).toBe(200);
  expect(parse).toHaveBeenCalledWith(captureId);
  expect((await DELETE(req(`/api/extension/captures/${captureId}`, 'DELETE', { ...auth, ...dashboard }), { params: Promise.resolve({ id: captureId }) })).status).toBe(200);
  expect((await purge(req('/api/admin/purge', 'POST', { ...auth, ...dashboard, 'content-type': 'application/json' }, JSON.stringify({ scope: 'contacts', confirmToken: 'CONFIRM_PURGE' })))).status).toBe(200);
  expect(dbTransaction).toHaveBeenCalledTimes(1);
});

test('non-JSON bodies fail before parse or purge effects', async () => {
  const auth = await sessionHeaders();
  expect((await middleware(req('/api/scoring/run', 'POST', { ...auth, ...dashboard, 'content-type': 'text/plain' }, '{}'))).status).toBe(415);
  expect((await middleware(req('/api/import/upload', 'POST', {
    ...auth, ...dashboard, 'content-type': 'multipart/form-data; boundary=synthetic',
  }, '--synthetic--'))).status).toBe(200);
  expect((await purge(req('/api/admin/purge', 'POST', { ...auth, ...dashboard, 'content-type': 'text/plain' }, JSON.stringify({ scope: 'all', confirmToken: 'CONFIRM_PURGE' })))).status).toBe(415);
  expect((await parseCapture(req('/api/extension/captures', 'POST', { ...auth, ...dashboard, 'content-type': 'text/plain' }, JSON.stringify({ captureId })))).status).toBe(415);
  expect(dbTransaction).not.toHaveBeenCalled();
  expect(parse).not.toHaveBeenCalled();
});

test('extension preflight needs configured origin and only token routes bypass operator session', async () => {
  const allowed = `chrome-extension://${'a'.repeat(32)}`;
  const foreign = `chrome-extension://${'b'.repeat(32)}`;
  expect((await middleware(req('/api/extension/capture', 'OPTIONS', { origin: allowed }))).status).toBe(403);
  process.env.EXTENSION_ALLOWED_ORIGINS = allowed;
  const preflight = await middleware(req('/api/extension/capture', 'OPTIONS', { origin: allowed, 'access-control-request-method': 'POST' }));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe(allowed);
  expect((await middleware(req('/api/extension/capture', 'POST', { origin: allowed }))).status).toBe(200);
  expect((await middleware(req('/api/extension/register', 'POST', { origin: allowed }))).status).toBe(200);
  expect((await middleware(req('/api/extension/captures', 'GET', { origin: allowed }))).status).toBe(403);
  expect((await middleware(req('/api/extension/capture', 'OPTIONS', { origin: foreign }))).status).toBe(403);
  expect((await middleware(req('/api/extension/tokens', 'GET', dashboard))).status).toBe(401);
  expect((await middleware(req('/api/extension/health-internal', 'GET', dashboard))).status).toBe(401);
});

test('health and cron keep their auth paths; Compose binds local ports and forwards secrets', async () => {
  expect((await middleware(req('/api/health'))).status).toBe(200);
  expect((await middleware(req('/api/sources/cron/rss-poll', 'POST'))).status).toBe(200);
  expect((await middleware(req('/api/sources/cron/future', 'POST'))).status).toBe(401);
  const compose = readFileSync(`${__dirname}/../../docker-compose.yml`, 'utf8');
  expect(compose).toContain('127.0.0.1:3750:3000');
  expect(compose).toContain('127.0.0.1:5432:5432');
  expect(compose).toContain('LOCAL_OPERATOR_SECRET: ${LOCAL_OPERATOR_SECRET:?LOCAL_OPERATOR_SECRET is required}');
  expect(compose).toContain('EXTENSION_ALLOWED_ORIGINS: ${EXTENSION_ALLOWED_ORIGINS}');
});

test('Next compiles the matcher for pages and APIs while excluding unlock and assets', () => {
  const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(middlewareConfig.matcher, {}));
  for (const path of ['/', '/dashboard', '/contacts/abc', '/contacts/alice.example', '/api/dashboard', '/api/operator/unlock']) {
    expect(matches(path, {}, {})).toBe(true);
  }
  for (const path of ['/operator/unlock', '/_next/static/chunks/app.js', '/_next/static/css/app.css', '/favicon.ico']) {
    expect(matches(path, {}, {})).toBe(false);
  }
});

test('target-state reads, writes, history, and lens activation stay operator-private', async () => {
  const auth = await sessionHeaders();
  const paths = [
    ['/api/targets/state', 'GET'], ['/api/targets/state', 'PUT'],
    ['/api/targets/state/history', 'GET'],
    ['/api/targets/11111111-1111-4111-8111-111111111111/lenses/22222222-2222-4222-8222-222222222222/activate', 'PUT'],
  ];
  for (const [path, method] of paths) {
    const body = method === 'PUT' ? '{}' : undefined;
    const headers = { ...dashboard, ...(body ? { 'content-type': 'application/json' } : {}) };
    expect((await middleware(req(path, method, headers, body))).status).toBe(401);
    expect((await middleware(req(path, method, { ...headers, origin: `chrome-extension://${'a'.repeat(32)}` }, body))).status).toBe(403);
    expect((await middleware(req(path, method, { ...auth, ...headers, host: 'localhost.evil.example' }, body))).status).toBe(403);
    expect((await middleware(req(path, method, { ...auth, 'sec-fetch-site': 'cross-site' }, body))).status).toBe(403);
    const allowed = await middleware(req(path, method, { ...auth, ...headers }, body));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('cache-control')).toBe('private, no-store');
  }
  expect(dbQuery).not.toHaveBeenCalled();
});
