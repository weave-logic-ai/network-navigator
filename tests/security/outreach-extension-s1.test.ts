import { NextRequest } from '../../app/node_modules/next/server';
import { createHash } from 'node:crypto';
import { middleware } from '../../app/src/middleware';
import { GET as templates, POST as create } from '../../app/src/app/api/outreach/templates/route';
import { POST as personalize } from '../../app/src/app/api/claude/personalize/route';
import { POST as register } from '../../app/src/app/api/extension/register/route';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { query } from '@/lib/db/client';
import { listTemplates, createTemplate, getTemplate } from '@/lib/db/queries/outreach';
import { getContactById } from '@/lib/db/queries/contacts';
import { personalizeTemplate } from '@/lib/claude/analyze';
import { resetRateLimits } from '@/lib/middleware/extension-rate-limiter';

jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));
jest.mock('@/lib/db/queries/outreach', () => ({
  listTemplates: jest.fn(), createTemplate: jest.fn(), getTemplate: jest.fn(),
}));
jest.mock('@/lib/db/queries/contacts', () => ({ getContactById: jest.fn() }));
jest.mock('@/lib/claude/analyze', () => ({ personalizeTemplate: jest.fn() }));

const dbQuery = query as jest.Mock;
const list = listTemplates as jest.Mock;
const insert = createTemplate as jest.Mock;
const lookupTemplate = getTemplate as jest.Mock;
const lookupContact = getContactById as jest.Mock;
const provider = personalizeTemplate as jest.Mock;
const origin = `chrome-extension://${'a'.repeat(32)}`;
const token = `ext_${'A'.repeat(43)}`;
const id = '11111111-1111-4111-8111-111111111111';
const tokenRow = { extension_id: id, token_hash: createHash('sha256').update(token).digest('hex'),
  created_at: new Date().toISOString(), is_revoked: false };
const priorOrigins = process.env.EXTENSION_ALLOWED_ORIGINS;
const priorSecret = process.env.LOCAL_OPERATOR_SECRET;

function req(path: string, method: string, headers: Record<string, string>, body?: string) {
  return new NextRequest(`http://localhost:3750${path}`, {
    method, headers: { host: 'localhost:3750', ...headers }, body,
  });
}

const extension = { origin, 'x-extension-token': token, 'content-type': 'application/json' };

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  process.env.EXTENSION_ALLOWED_ORIGINS = origin;
  process.env.LOCAL_OPERATOR_SECRET = 'synthetic-operator-secret-for-outreach-tests';
  dbQuery.mockResolvedValue({ rows: [tokenRow] });
});
afterAll(() => {
  if (priorOrigins === undefined) delete process.env.EXTENSION_ALLOWED_ORIGINS;
  else process.env.EXTENSION_ALLOWED_ORIGINS = priorOrigins;
  if (priorSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
  else process.env.LOCAL_OPERATOR_SECRET = priorSecret;
});

test('middleware admits only extension GET templates and POST personalize', async () => {
  expect((await middleware(req('/api/outreach/templates', 'GET', extension))).status).toBe(200);
  expect((await middleware(req('/api/claude/personalize', 'POST', extension, '{}'))).status).toBe(200);
  expect((await middleware(req('/api/outreach/templates', 'POST', extension, '{}'))).status).toBe(403);
  expect((await middleware(req('/api/claude/personalize', 'GET', extension))).status).toBe(403);
  const allowed = await middleware(req('/api/outreach/templates', 'OPTIONS', {
    origin, 'access-control-request-method': 'GET',
  }));
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get('access-control-allow-headers')).toContain('X-Extension-Token');
  expect((await middleware(req('/api/outreach/templates', 'OPTIONS', {
    origin, 'access-control-request-method': 'POST',
  }))).status).toBe(403);
});

test('registration accepts a full generated-format token for explicit popup re-auth', async () => {
  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] });
  const request = req('/api/extension/register', 'POST', extension,
    JSON.stringify({ displayToken: token }));
  expect((await middleware(request)).status).toBe(200);
  const response = await register(request);
  expect(response.status).toBe(200);
  expect((await response.json()).extensionId).toBe(id);
  expect(dbQuery).toHaveBeenCalledTimes(1);
  expect(String(dbQuery.mock.calls[0][0])).toContain('WHERE token_hash = $1');
});

test('direct handlers reject missing, prefix, revoked, and foreign extension credentials before effects', async () => {
  const body = JSON.stringify({ templateId: id, contactId: id });
  expect((await templates(req('/api/outreach/templates', 'GET', { origin }))).status).toBe(401);
  expect((await personalize(req('/api/claude/personalize', 'POST', {
    origin, 'content-type': 'application/json',
  }, body))).status).toBe(401);
  expect((await create(req('/api/outreach/templates', 'POST', extension, '{}'))).status).toBe(403);
  expect((await templates(req('/api/outreach/templates', 'GET', {
    origin, 'x-extension-token': 'ext_AAAAAAAA',
  }))).status).toBe(401);
  expect(dbQuery).not.toHaveBeenCalled();

  dbQuery.mockResolvedValueOnce({ rows: [{ ...tokenRow, is_revoked: true }] });
  expect((await personalize(req('/api/claude/personalize', 'POST', extension, body))).status).toBe(401);
  dbQuery.mockClear();
  expect((await templates(req('/api/outreach/templates', 'GET', {
    ...extension, origin: `chrome-extension://${'b'.repeat(32)}`,
  }))).status).toBe(403);
  expect(dbQuery).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(lookupTemplate).not.toHaveBeenCalled();
  expect(lookupContact).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});

test('full extension token resolves an exact profile URL before mocked personalization', async () => {
  list.mockResolvedValue([{ id, name: 'Synthetic', category: 'custom', body_template: 'Hello', merge_variables: [] }]);
  lookupTemplate.mockResolvedValue({ id, body_template: 'Hello', subject_template: null, tone: 'friendly' });
  lookupContact.mockResolvedValue({ id, full_name: 'Synthetic Contact' });
  provider.mockResolvedValue({ personalizedContent: 'Hello, Synthetic Contact', mergeFields: {} });

  const listed = await templates(req('/api/outreach/templates', 'GET', extension));
  expect(listed.status).toBe(200);
  expect((await listed.json()).data[0].body_template).toBe('Hello');
  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] })
    .mockResolvedValueOnce({ rows: [{ id }] });
  const response = await personalize(req('/api/claude/personalize', 'POST', extension,
    JSON.stringify({ templateId: id, contactUrl: 'https://www.linkedin.com/in/synthetic-contact/?trk=ignored' })));
  expect(response.status).toBe(200);
  expect((await response.json()).data.personalizedContent).toBe('Hello, Synthetic Contact');
  expect(provider).toHaveBeenCalledTimes(1);
  const exactLookup = dbQuery.mock.calls.find(([sql]) => String(sql).includes('= ANY($1::text[])'));
  expect(exactLookup).toBeDefined();
  expect(exactLookup[0]).not.toContain('LIKE');
  expect(exactLookup[0]).toContain("split_part(split_part(linkedin_url, '?', 1), '#', 1)");
  expect(exactLookup[1][0]).toContain('https://www.linkedin.com/in/synthetic-contact');
  expect(lookupContact).toHaveBeenCalledWith(id);
  expect(insert).not.toHaveBeenCalled();
});

test('unknown, invalid, and ambiguous profile URLs never call the provider', async () => {
  const send = (contactUrl: string) => personalize(req('/api/claude/personalize', 'POST', extension,
    JSON.stringify({ templateId: id, contactUrl })));
  expect((await send('https://www.linkedin.com/in/synthetic/other')).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] })
    .mockResolvedValueOnce({ rows: [] });
  expect((await send('https://www.linkedin.com/in/synthetic')).status).toBe(404);
  expect(provider).not.toHaveBeenCalled();
  dbQuery.mockResolvedValueOnce({ rows: [tokenRow] })
    .mockResolvedValueOnce({ rows: [{ id }, { id: '22222222-2222-4222-8222-222222222222' }] });
  expect((await send('https://www.linkedin.com/in/synthetic')).status).toBe(409);
  expect(lookupContact).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});

test('same-origin operator session can list and create; forged headers alone cannot', async () => {
  const local = { origin: 'http://localhost:3750', 'sec-fetch-site': 'same-origin' };
  expect((await templates(req('/api/outreach/templates', 'GET', local))).status).toBe(401);
  expect((await personalize(req('/api/claude/personalize', 'POST', {
    ...local, 'content-type': 'application/json',
  }, JSON.stringify({ templateId: id, contactId: id })))).status).toBe(401);
  const session = await createOperatorSession();
  const authed = { ...local, cookie: `${OPERATOR_COOKIE}=${session}` };
  list.mockResolvedValue([]);
  insert.mockResolvedValue({ id });
  expect((await templates(req('/api/outreach/templates', 'GET', authed))).status).toBe(200);
  const created = await create(req('/api/outreach/templates', 'POST', {
    ...authed, 'content-type': 'application/json',
  }, JSON.stringify({ name: 'Synthetic', body_template: 'Hello' })));
  expect(created.status).toBe(201);
  expect(insert).toHaveBeenCalledTimes(1);
  lookupTemplate.mockResolvedValue({ id, body_template: 'Hello', subject_template: null, tone: 'friendly' });
  lookupContact.mockResolvedValue({ id, full_name: 'Synthetic Contact' });
  provider.mockResolvedValue({ personalizedContent: 'Hello, Synthetic Contact', mergeFields: {} });
  expect((await personalize(req('/api/claude/personalize', 'POST', {
    ...authed, 'content-type': 'application/json',
  }, JSON.stringify({ templateId: id, contactId: id })))).status).toBe(200);
  expect(provider).toHaveBeenCalledTimes(1);
});
