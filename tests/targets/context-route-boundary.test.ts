jest.mock('@/lib/targets/service', () => ({
  getCurrentOwnerProfileId: jest.fn(), getTargetStateSnapshot: jest.fn(),
  commandTargetState: jest.fn(), getResearchTargetState: jest.fn(), getTargetById: jest.fn(),
  getDefaultTenantId: jest.fn(), getOrCreateContactTarget: jest.fn(),
  getOrCreateCompanyTarget: jest.fn(),
  TargetStateCommandError: class TargetStateCommandError extends Error {},
}));
jest.mock('@/lib/targets/lens-service', () => ({
  listLensesForTarget: jest.fn(), getActiveLensForTarget: jest.fn(),
  createLensForTarget: jest.fn(), getLensById: jest.fn(), softDeleteLens: jest.fn(),
}));
jest.mock('@/lib/graph/data-cache', () => ({ invalidateForOwner: jest.fn() }));

import { NextRequest } from '../../app/node_modules/next/server';
import * as service from '@/lib/targets/service';
import * as lenses from '@/lib/targets/lens-service';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { GET as stateGet, PUT as statePut } from '@/app/api/targets/state/route';
import { GET as historyGet, POST as historyPost } from '@/app/api/targets/state/history/route';
import { GET as targetGet, POST as targetPost } from '@/app/api/targets/route';
import { GET as listGet, POST as listPost } from '@/app/api/targets/[id]/lenses/route';
import { GET as detailGet, DELETE as detailDelete } from '@/app/api/targets/[id]/lenses/[lensId]/route';
import { PUT as activate } from '@/app/api/targets/[id]/lenses/[lensId]/activate/route';

const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LENS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secret = 'synthetic-local-operator-secret-1234567890';
const priorSecret = process.env.LOCAL_OPERATOR_SECRET;
const targetParams = { params: Promise.resolve({ id: TARGET }) };
const lensParams = { params: Promise.resolve({ id: TARGET, lensId: LENS }) };
const stateBody = JSON.stringify({ expectedRevision: '0', action: { type: 'back' } });

function req(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  return new NextRequest(`http://localhost:3751${path}`, { method,
    headers: { host: 'localhost:3751', 'sec-fetch-site': 'same-origin',
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), ...headers }, body });
}

beforeEach(() => { jest.clearAllMocks(); process.env.LOCAL_OPERATOR_SECRET = secret; });
afterAll(() => {
  if (priorSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
  else process.env.LOCAL_OPERATOR_SECRET = priorSecret;
});

const handlers = [
  () => stateGet(req('/api/targets/state')),
  () => statePut(req('/api/targets/state', 'PUT', {}, stateBody)),
  () => historyGet(req('/api/targets/state/history')),
  () => historyPost(req('/api/targets/state/history', 'POST', {}, '{}')),
  () => targetGet(req(`/api/targets?id=${TARGET}`)),
  () => targetPost(req('/api/targets', 'POST', {}, JSON.stringify({ kind: 'contact', id: TARGET }))),
  () => listGet(req(`/api/targets/${TARGET}/lenses`), targetParams),
  () => listPost(req(`/api/targets/${TARGET}/lenses`, 'POST', {}, '{}'), targetParams),
  () => detailGet(req(`/api/targets/${TARGET}/lenses/${LENS}`), lensParams),
  () => detailDelete(req(`/api/targets/${TARGET}/lenses/${LENS}`, 'DELETE'), lensParams),
  () => activate(req(`/api/targets/${TARGET}/lenses/${LENS}/activate`, 'PUT', {},
    JSON.stringify({ expectedRevision: '0' })), lensParams),
];

it('denies every direct target state and lens handler before touching services', async () => {
  for (const handle of handlers) expect((await handle()).status).toBe(401);
  expect((await stateGet(req('/api/targets/state'))).headers.get('Cache-Control')).toBe('no-store');
  for (const fn of Object.values(service).concat(Object.values(lenses))) {
    if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  }
});

it('rejects foreign origin on state GET/PUT and activation with a valid session', async () => {
  const session = await createOperatorSession();
  expect(session).toBeTruthy();
  const headers = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site',
    cookie: `${OPERATOR_COOKIE}=${session}` };
  expect((await stateGet(req('/api/targets/state', 'GET', headers))).status).toBe(403);
  expect((await statePut(req('/api/targets/state', 'PUT', headers, stateBody))).status).toBe(403);
  expect((await activate(req(`/api/targets/${TARGET}/lenses/${LENS}/activate`, 'PUT', headers,
    JSON.stringify({ expectedRevision: '0' })), lensParams)).status).toBe(403);
  expect(service.getCurrentOwnerProfileId).not.toHaveBeenCalled();
  expect(service.commandTargetState).not.toHaveBeenCalled();
});

it('returns 400 for a JSON null lens create body', async () => {
  const session = await createOperatorSession();
  (service.getCurrentOwnerProfileId as jest.Mock).mockResolvedValue('owner-a');
  (service.getResearchTargetState as jest.Mock).mockResolvedValue({ tenantId: 'tenant-a' });
  (service.getTargetById as jest.Mock).mockResolvedValue({ tenantId: 'tenant-a', kind: 'contact' });
  const response = await listPost(req(`/api/targets/${TARGET}/lenses`, 'POST',
    { cookie: `${OPERATOR_COOKIE}=${session}` }, 'null'), targetParams);
  expect(response.status).toBe(400);
  expect(lenses.createLensForTarget).not.toHaveBeenCalled();
});
