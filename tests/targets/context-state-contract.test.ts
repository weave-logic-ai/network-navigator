jest.mock('@/lib/targets/service', () => ({
  getCurrentOwnerProfileId: jest.fn(),
  getTargetStateSnapshot: jest.fn(),
  commandTargetState: jest.fn(),
  TargetStateCommandError: class TargetStateCommandError extends Error {
    constructor(public status: number, message: string, public current?: unknown) { super(message); }
  },
}));
jest.mock('@/lib/graph/data-cache', () => ({ invalidateForOwner: jest.fn() }));
jest.mock('@/lib/auth/local-request-boundary', () => ({
  requireLocalDashboardRequest: jest.fn().mockResolvedValue(null),
}));

import { GET, PUT } from '@/app/api/targets/state/route';
import { POST as legacyHistoryPost } from '@/app/api/targets/state/history/route';
import { PUT as activate } from '@/app/api/targets/[id]/lenses/[lensId]/activate/route';
import { getCurrentOwnerProfileId, getTargetStateSnapshot, commandTargetState,
  TargetStateCommandError } from '@/lib/targets/service';
import { invalidateForOwner } from '@/lib/graph/data-cache';
import { focusScenarioTarget } from '../../app/e2e/scenarios/helpers';

const target = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lens = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const owner = getCurrentOwnerProfileId as jest.Mock;
const read = getTargetStateSnapshot as jest.Mock;
const write = commandTargetState as jest.Mock;
const snapshot = { revision: '1', focusTargetId: target, activeLensId: lens, history: [] };
const request = (body: unknown) => ({ json: async () => body } as import('next/server').NextRequest);

describe('target state CAS routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    owner.mockResolvedValue('owner-1');
    read.mockResolvedValue(snapshot);
    write.mockResolvedValue(snapshot);
  });

  it('returns the revisioned snapshot with no-store', async () => {
    const response = await GET(request({}));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).data).toEqual(snapshot);
  });

  it.each([{}, [], { secondaryTargetId: target },
    { expectedRevision: '0', action: { type: 'focus' } },
    { expectedRevision: '0', action: { type: 'focus', targetId: '' } },
    { expectedRevision: '0', action: { type: 'back', targetId: target } },
    { expectedRevision: '0', action: { type: 'activateLens', targetId: target, lensId: 'bad' } },
    { expectedRevision: 0, action: { type: 'back' } }])
  ('rejects malformed command %j without mutation', async body => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('requires a revision and rejects invalid JSON', async () => {
    expect((await PUT(request({ action: { type: 'back' } }))).status).toBe(428);
    expect((await PUT({ json: async () => { throw new SyntaxError(); } } as
      import('next/server').NextRequest)).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('dispatches typed focus, back and activation commands', async () => {
    for (const action of [
      { type: 'focus', targetId: target }, { type: 'back' },
      { type: 'activateLens', targetId: target, lensId: lens },
    ]) {
      const response = await PUT(request({ expectedRevision: '0', action }));
      expect(response.status).toBe(200);
      expect(write).toHaveBeenLastCalledWith('owner-1', '0', action);
    }
    expect(invalidateForOwner).toHaveBeenCalledTimes(3);
  });

  it('returns the current authorized snapshot on conflict', async () => {
    write.mockRejectedValueOnce(new TargetStateCommandError(409, 'Target state changed', snapshot));
    const response = await PUT(request({ expectedRevision: '0', action: { type: 'back' } }));
    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).data).toEqual(snapshot);
    expect(invalidateForOwner).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected errors', async () => {
    write.mockRejectedValueOnce(new Error('private SQL details'));
    const response = await PUT(request({ expectedRevision: '0', action: { type: 'back' } }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private SQL details');
  });

  it('closes legacy history and lens activation without a revision', async () => {
    expect((await legacyHistoryPost(request({}))).status).toBe(428);
    const response = await activate(request({}), { params: Promise.resolve({ id: target, lensId: lens }) });
    expect(response.status).toBe(428);
    expect(write).not.toHaveBeenCalled();
  });

  it('routes revisioned legacy activation through the same CAS command', async () => {
    const response = await activate(request({ expectedRevision: '0' }),
      { params: Promise.resolve({ id: target, lensId: lens }) });
    expect(response.status).toBe(200);
    expect(write).toHaveBeenCalledWith('owner-1', '0',
      { type: 'activateLens', targetId: target, lensId: lens });
  });

  it('lets scenario focus and cleanup pass the real CAS route parser with fresh revisions', async () => {
    let current = { ...snapshot, revision: '7', secondaryTargetId: null as string | null };
    read.mockImplementation(async () => current);
    write.mockImplementation(async (_ownerId: string, expected: string,
      action: { type: string; targetId: string | null }) => {
      if (expected !== current.revision) {
        throw new TargetStateCommandError(409, 'Target state changed', current);
      }
      current = { ...current, revision: String(Number(current.revision) + 1),
        secondaryTargetId: action.targetId };
      return current;
    });
    const adapt = (response: Response) => ({
      ok: () => response.ok, status: () => response.status, json: () => response.json(),
    });
    const transport = {
      get: jest.fn(async () => adapt(await GET(request({})))),
      put: jest.fn(async (_url: string, options: { data: unknown }) =>
        adapt(await PUT(request(options.data)))),
    };
    const scenarioRequest = transport as unknown as Parameters<typeof focusScenarioTarget>[0];

    expect((await focusScenarioTarget(scenarioRequest, target)).status()).toBe(200);
    expect((await focusScenarioTarget(scenarioRequest, null)).status()).toBe(200);
    expect(transport.get).toHaveBeenCalledTimes(2);
    expect(transport.put.mock.calls.map(([, options]) => options.data)).toEqual([
      { expectedRevision: '7', action: { type: 'focus', targetId: target } },
      { expectedRevision: '8', action: { type: 'focus', targetId: null } },
    ]);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
