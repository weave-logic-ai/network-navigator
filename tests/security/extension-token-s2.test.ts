import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import { NextRequest, NextResponse } from '../../app/node_modules/next/server';
import { middleware } from '../../app/src/middleware';
import { GET as list, POST as mint } from '../../app/src/app/api/extension/tokens/route';
import { DELETE as revoke } from '../../app/src/app/api/extension/tokens/[extensionId]/route';
import { POST as register } from '../../app/src/app/api/extension/register/route';
import { validateExtensionToken, EXTENSION_TOKEN_LIFETIME_MS } from '@/lib/auth/extension-auth';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { resetRateLimits } from '@/lib/middleware/extension-rate-limiter';
import { wsServer } from '@/lib/websocket/ws-server';
import { query } from '@/lib/db/client';

jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));

type Row = { token_hash: string; extension_id: string; display_prefix: string;
  created_at: Date; last_used_at: null; user_agent: null; is_revoked: boolean };
const rows = new Map<string, Row>();
const dbQuery = query as jest.Mock;
const origin = `chrome-extension://${'a'.repeat(32)}`;
const foreign = `chrome-extension://${'b'.repeat(32)}`;
const local = { origin: 'http://localhost:3750', 'sec-fetch-site': 'same-origin' };
const priorSecret = process.env.LOCAL_OPERATOR_SECRET;
const priorOrigins = process.env.EXTENSION_ALLOWED_ORIGINS;
const root = `${__dirname}/../..`;

function req(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  return new NextRequest(`http://localhost:3750${path}`, {
    method, headers: { host: 'localhost:3750', ...headers }, body,
  });
}

async function operator() {
  const cookie = await createOperatorSession();
  return { ...local, cookie: `${OPERATOR_COOKIE}=${cookie}` };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  rows.clear();
  process.env.LOCAL_OPERATOR_SECRET = 'synthetic-operator-secret-for-token-tests';
  process.env.EXTENSION_ALLOWED_ORIGINS = origin;
  dbQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('INSERT INTO extension_tokens')) {
      const [tokenHash, extensionId, displayPrefix] = params as string[];
      rows.set(tokenHash, { token_hash: tokenHash, extension_id: extensionId,
        display_prefix: displayPrefix, created_at: new Date(), last_used_at: null,
        user_agent: null, is_revoked: false });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('WHERE token_hash = $1')) {
      const found = rows.get(params?.[0] as string);
      return { rows: found ? [found] : [] };
    }
    if (sql.includes('SET is_revoked = true')) {
      const found = [...rows.values()].find(row => row.extension_id === params?.[0] && !row.is_revoked);
      if (found) found.is_revoked = true;
      return { rows: found ? [{ token_hash: found.token_hash }] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.includes('ORDER BY created_at DESC')) return { rows: [...rows.values()] };
    throw new Error(`Unexpected synthetic query: ${sql}`);
  });
});

afterAll(() => {
  if (priorSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
  else process.env.LOCAL_OPERATOR_SECRET = priorSecret;
  if (priorOrigins === undefined) delete process.env.EXTENSION_ALLOWED_ORIGINS;
  else process.env.EXTENSION_ALLOWED_ORIGINS = priorOrigins;
});

test('token GET/POST/DELETE require operator session before any database effect', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const params = { params: Promise.resolve({ extensionId: id }) };
  expect((await list(req('/api/extension/tokens', 'GET', local))).status).toBe(401);
  expect((await mint(req('/api/extension/tokens', 'POST', local))).status).toBe(401);
  expect((await revoke(req(`/api/extension/tokens/${id}`, 'DELETE', local), params)).status).toBe(401);
  expect((await list(req('/api/extension/tokens', 'GET', { ...local, origin: foreign }))).status).toBe(403);
  expect((await list(req('/api/extension/tokens', 'GET', { origin }))).status).toBe(403);
  expect(dbQuery).not.toHaveBeenCalled();
  expect(rows.size).toBe(0);
  expect((await middleware(req('/api/extension/tokens', 'GET', { origin }))).status).toBe(403);
});

test('operator mints, lists masked token, registers full token, and revokes it', async () => {
  const auth = await operator();
  const created = await mint(req('/api/extension/tokens', 'POST', auth));
  expect(created.status).toBe(201);
  expect(created.headers.get('cache-control')).toBe('no-store');
  const { token, extensionId, displayToken } = (await created.json()).data;
  expect(token).toMatch(/^ext_[A-Za-z0-9_-]{43}$/);
  expect(displayToken).toBe(token.slice(0, 12));
  expect(rows.size).toBe(1);
  const listed = await list(req('/api/extension/tokens', 'GET', auth));
  expect(listed.status).toBe(200);
  expect((await listed.json()).data[0].token).toBe(`${displayToken}...`);
  expect(JSON.stringify(await list(req('/api/extension/tokens', 'GET', auth)).then(r => r.json()))).not.toContain(token);

  const registration = await register(req('/api/extension/register', 'POST', {
    origin, 'content-type': 'application/json',
  }, JSON.stringify({ displayToken: token })));
  expect(registration.status).toBe(200);
  expect((await registration.json()).extensionId).toBe(extensionId);
  const permitted = await withExtensionAuth(req('/api/extension/health', 'GET', {
    origin, 'x-extension-token': token,
  }), async () => NextResponse.json({ ok: true }));
  expect(permitted.status).toBe(200);

  const socket = { extensionId, expiresAt: Date.now() + 60_000,
    readyState: 1, close: jest.fn(), send: jest.fn() };
  const clients = (wsServer as unknown as { clients: Map<string, typeof socket> }).clients;
  clients.set(extensionId, socket);

  const deleted = await revoke(req(`/api/extension/tokens/${extensionId}`, 'DELETE', auth),
    { params: Promise.resolve({ extensionId }) });
  expect(deleted.status).toBe(200);
  expect(socket.close).toHaveBeenCalledWith(4002, 'Token revoked');
  expect(wsServer.isClientConnected(extensionId)).toBe(false);
  expect((await validateExtensionToken(token)).error).toBe('REVOKED_TOKEN');
  expect((await register(req('/api/extension/register', 'POST', {
    origin, 'content-type': 'application/json',
  }, JSON.stringify({ displayToken: token })))).status).toBe(401);
  expect((await revoke(req(`/api/extension/tokens/${extensionId}`, 'DELETE', auth),
    { params: Promise.resolve({ extensionId }) })).status).toBe(404);
});

test('expired established sockets cannot receive pushes or remain connected', () => {
  const extensionId = '11111111-1111-4111-8111-111111111111';
  const socket = { extensionId, expiresAt: Date.now() - 1,
    readyState: 1, close: jest.fn(), send: jest.fn() };
  const clients = (wsServer as unknown as { clients: Map<string, typeof socket> }).clients;
  clients.set(extensionId, socket);
  const event = { type: 'TASK_CREATED' as const, payload: {}, timestamp: new Date().toISOString() };
  expect(wsServer.pushToExtension(extensionId, event)).toBe(false);
  wsServer.pushToAll(event);
  expect(socket.send).not.toHaveBeenCalled();
  expect(socket.close).toHaveBeenCalledWith(4002, 'Token expired');
  expect(wsServer.getConnectedClients()).not.toContain(extensionId);
});

test('prefix, expired, and foreign-origin credentials fail without protected effects', async () => {
  const auth = await operator();
  const { token } = (await (await mint(req('/api/extension/tokens', 'POST', auth))).json()).data;
  dbQuery.mockClear();
  expect((await validateExtensionToken(token.slice(0, 12))).valid).toBe(false);
  expect(dbQuery).not.toHaveBeenCalled();
  const handler = jest.fn(async () => NextResponse.json({ ok: true }));
  const prefix = req('/api/extension/tasks', 'GET', { origin, 'x-extension-token': token.slice(0, 12) });
  expect((await withExtensionAuth(prefix, handler)).status).toBe(401);
  expect(handler).not.toHaveBeenCalled();
  expect((await register(req('/api/extension/register', 'POST', {
    origin, 'content-type': 'application/json',
  }, JSON.stringify({ displayToken: token.slice(0, 12) })))).status).toBe(401);
  expect((await withExtensionAuth(req('/api/extension/tasks', 'GET', {
    origin: foreign, 'x-extension-token': token,
  }), handler)).status).toBe(401);
  expect((await register(req('/api/extension/register', 'POST', {
    origin: foreign, 'content-type': 'application/json',
  }, JSON.stringify({ displayToken: token })))).status).toBe(403);
  expect(handler).not.toHaveBeenCalled();
  expect(dbQuery.mock.calls.some(([sql]) => String(sql).includes('display_prefix ='))).toBe(false);

  const row = rows.get(createHash('sha256').update(token).digest('hex'))!;
  row.created_at = new Date(Date.now() - EXTENSION_TOKEN_LIFETIME_MS - 1000);
  expect((await validateExtensionToken(token)).error).toBe('EXPIRED_TOKEN');
  expect((await withExtensionAuth(req('/api/extension/tasks', 'GET', {
    origin, 'x-extension-token': token,
  }), handler)).status).toBe(401);
  expect(handler).not.toHaveBeenCalled();
});

test('operator can revoke a legacy text extension ID without accepting arbitrary paths', async () => {
  const auth = await operator();
  const legacyId = 'ext-my-browser-001';
  const hash = createHash('sha256').update(`ext_${'B'.repeat(43)}`).digest('hex');
  rows.set(hash, { token_hash: hash, extension_id: legacyId, display_prefix: 'ext_BBBBBBBB',
    created_at: new Date(), last_used_at: null, user_agent: null, is_revoked: false });
  expect((await revoke(req(`/api/extension/tokens/${legacyId}`, 'DELETE', auth),
    { params: Promise.resolve({ extensionId: legacyId }) })).status).toBe(200);
  expect(rows.get(hash)?.is_revoked).toBe(true);
  const before = dbQuery.mock.calls.length;
  expect((await revoke(req('/api/extension/tokens/bad', 'DELETE', auth),
    { params: Promise.resolve({ extensionId: '../bad' }) })).status).toBe(400);
  expect(dbQuery).toHaveBeenCalledTimes(before);
});

test('extension preflight is allowlisted; token management preflight stays operator-only', async () => {
  const allowed = await middleware(req('/api/extension/tasks', 'OPTIONS', {
    origin, 'access-control-request-method': 'GET',
  }));
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get('access-control-allow-headers')).toContain('X-Extension-Token');
  expect((await middleware(req('/api/extension/tasks', 'OPTIONS', {
    origin: foreign, 'access-control-request-method': 'GET',
  }))).status).toBe(403);
  expect((await middleware(req('/api/extension/tokens', 'OPTIONS', {
    origin, 'access-control-request-method': 'POST',
  }))).status).toBe(403);
  expect((await middleware(req('/api/extension/tokens', 'OPTIONS', {
    origin: local.origin, 'access-control-request-method': 'POST',
  }))).status).toBe(204);
  expect(dbQuery).not.toHaveBeenCalled();
});

test('WebSocket upgrade rejects foreign origin and prefix before handshake', async () => {
  const server = new EventEmitter();
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  wsServer.init(server as Server);
  const socket = { write: jest.fn(), destroy: jest.fn() };
  server.emit('upgrade', { url: '/ws/extension?token=ext_short',
    headers: { host: 'localhost:3750', origin } }, socket, Buffer.alloc(0));
  await new Promise(resolve => setImmediate(resolve));
  expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
  expect(socket.destroy).toHaveBeenCalled();
  socket.write.mockClear();
  server.emit('upgrade', { url: '/ws/extension?token=ext_short',
    headers: { host: 'localhost:3750', origin: foreign } }, socket, Buffer.alloc(0));
  await new Promise(resolve => setImmediate(resolve));
  expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
  expect(dbQuery).not.toHaveBeenCalled();
  const fullToken = `ext_${'A'.repeat(43)}`;
  const hash = createHash('sha256').update(fullToken).digest('hex');
  const row: Row = { token_hash: hash, extension_id: '11111111-1111-4111-8111-111111111111',
    display_prefix: fullToken.slice(0, 12), created_at: new Date(), last_used_at: null,
    user_agent: null, is_revoked: true };
  rows.set(hash, row);
  for (const state of ['revoked', 'expired']) {
    if (state === 'expired') {
      row.is_revoked = false;
      row.created_at = new Date(Date.now() - EXTENSION_TOKEN_LIFETIME_MS - 1000);
    }
    socket.write.mockClear();
    server.emit('upgrade', { url: `/ws/extension?token=${fullToken}`,
      headers: { host: 'localhost:3750', origin } }, socket, Buffer.alloc(0));
    await new Promise(resolve => setImmediate(resolve));
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
  }
  wsServer.shutdown();
  log.mockRestore();
});

test('revocation during WebSocket upgrade prevents socket installation', async () => {
  const server = new EventEmitter();
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  wsServer.init(server as Server);
  const token = `ext_${'C'.repeat(43)}`;
  const hash = createHash('sha256').update(token).digest('hex');
  const row: Row = { token_hash: hash, extension_id: '11111111-1111-4111-8111-111111111111',
    display_prefix: token.slice(0, 12), created_at: new Date(), last_used_at: null,
    user_agent: null, is_revoked: false };
  rows.set(hash, row);
  const upgraded = { close: jest.fn() };
  const wss = (wsServer as unknown as {
    wss: { handleUpgrade: (...args: unknown[]) => void; emit: (...args: unknown[]) => boolean }
  }).wss;
  const connected = jest.spyOn(wss, 'emit');
  jest.spyOn(wss, 'handleUpgrade').mockImplementation((_req, _socket, _head, done) => {
    row.is_revoked = true;
    (done as (socket: typeof upgraded) => void)(upgraded);
  });
  const socket = { write: jest.fn(), destroy: jest.fn() };
  server.emit('upgrade', { url: `/ws/extension?token=${token}`,
    headers: { host: 'localhost:3750', origin } }, socket, Buffer.alloc(0));
  await new Promise(resolve => setImmediate(resolve));
  expect(upgraded.close).toHaveBeenCalledWith(4002, 'Token revoked or expired');
  expect(connected).not.toHaveBeenCalledWith('connection', expect.anything(), expect.anything());
  expect(wsServer.getConnectedClients()).toEqual([]);
  wsServer.shutdown();
  log.mockRestore();
});

test('DELETE 200 fences a pending handshake whose second lookup already read an active row', async () => {
  const auth = await operator();
  const token = `ext_${'D'.repeat(43)}`;
  const hash = createHash('sha256').update(token).digest('hex');
  const extensionId = '22222222-2222-4222-8222-222222222222';
  rows.set(hash, { token_hash: hash, extension_id: extensionId,
    display_prefix: token.slice(0, 12), created_at: new Date(),
    last_used_at: null, user_agent: null, is_revoked: false });

  const normalQuery = dbQuery.getMockImplementation()!;
  let lookupCount = 0;
  let releaseSnapshot!: () => void;
  let snapshotHeld!: () => void;
  const held = new Promise<void>(resolve => { snapshotHeld = resolve; });
  const release = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  dbQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('WHERE token_hash = $1') && params?.[0] === hash && ++lookupCount === 2) {
      const snapshot = { ...rows.get(hash)! };
      snapshotHeld();
      await release;
      return { rows: [snapshot] };
    }
    return normalQuery(sql, params);
  });

  const server = new EventEmitter();
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  wsServer.init(server as Server);
  const upgraded = { close: jest.fn(), send: jest.fn(), readyState: 1 };
  const wss = (wsServer as unknown as {
    wss: { handleUpgrade: (...args: unknown[]) => void; emit: (...args: unknown[]) => boolean }
  }).wss;
  const connected = jest.spyOn(wss, 'emit');
  jest.spyOn(wss, 'handleUpgrade').mockImplementation((_req, _socket, _head, done) => {
    (done as (socket: typeof upgraded) => void)(upgraded);
  });
  server.emit('upgrade', { url: `/ws/extension?token=${token}`,
    headers: { host: 'localhost:3750', origin } },
  { write: jest.fn(), destroy: jest.fn() }, Buffer.alloc(0));
  await held;

  const deleted = await revoke(req(`/api/extension/tokens/${extensionId}`, 'DELETE', auth),
    { params: Promise.resolve({ extensionId }) });
  expect(deleted.status).toBe(200);
  releaseSnapshot();
  await new Promise(resolve => setImmediate(resolve));
  expect(upgraded.close).toHaveBeenCalledWith(4002, 'Token revoked or expired');
  expect(connected).not.toHaveBeenCalledWith('connection', expect.anything(), expect.anything());
  expect(wsServer.pushToExtension(extensionId,
    { type: 'TASK_CREATED', payload: {}, timestamp: new Date().toISOString() })).toBe(false);
  expect(upgraded.send).not.toHaveBeenCalled();
  expect(wsServer.getConnectedClients()).toEqual([]);
  wsServer.shutdown();
  log.mockRestore();
});

test('token route files are visible to git and will survive checkout when integrated', () => {
  const ignored = readFileSync(`${root}/.gitignore`, 'utf8');
  expect(ignored).toContain('!app/src/app/api/extension/tokens/');
  for (const path of ['app/src/app/api/extension/tokens/route.ts',
    'app/src/app/api/extension/tokens/[extensionId]/route.ts']) {
    expect(readFileSync(`${root}/${path}`, 'utf8')).toContain('requireLocalDashboardRequest');
    const check = spawnSync('git', ['check-ignore', '-q', path], { cwd: root });
    expect(check.status).toBe(1);
  }
});
