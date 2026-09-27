jest.mock('@/lib/targets/service', () => ({
  getCurrentOwnerProfileId: jest.fn(),
  getResearchTargetState: jest.fn(),
  getTargetById: jest.fn(),
  setSecondaryTarget: jest.fn(),
}));
jest.mock('@/lib/graph/data-cache', () => ({ invalidateForOwner: jest.fn() }));
jest.mock('@/lib/targets/history-service', () => ({ pushTargetHistory: jest.fn() }));

import { PUT } from '@/app/api/targets/state/route';
import {
  getCurrentOwnerProfileId, getResearchTargetState,
  getTargetById, setSecondaryTarget,
} from '@/lib/targets/service';
import { invalidateForOwner } from '@/lib/graph/data-cache';
import { pushTargetHistory } from '@/lib/targets/history-service';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SELF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const state = (secondaryTargetId: string | null) => ({
  tenantId: 'tenant-1', userId: 'owner-1', primaryTargetId: SELF,
  secondaryTargetId, updatedAt: '',
});
const owner = getCurrentOwnerProfileId as jest.MockedFunction<typeof getCurrentOwnerProfileId>;
const read = getResearchTargetState as jest.MockedFunction<typeof getResearchTargetState>;
const target = getTargetById as jest.MockedFunction<typeof getTargetById>;
const write = setSecondaryTarget as jest.MockedFunction<typeof setSecondaryTarget>;

function req(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest;
}

describe('target state context contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pushTargetHistory as jest.Mock).mockResolvedValue(undefined);
    owner.mockResolvedValue('owner-1');
    read.mockResolvedValue(state(null));
    target.mockImplementation(async (id) => ({
      id, tenantId: 'tenant-1', kind: 'contact', label: id === A ? 'A' : 'B',
      ownerId: null, contactId: id, companyId: null, pinned: false,
      createdAt: '', updatedAt: '', lastUsedAt: '',
    }));
    write.mockImplementation(async (_owner, id) => state(id));
  });

  it.each([{}, [], { secondaryTargetId: undefined }, { secondaryTargetId: 1 },
    { secondaryTargetId: '' }, { secondaryTargetId: 'bad' }, { primaryTargetId: A },
    { secondaryTargetId: null, primaryTargetId: A }])
  ('returns 400 before any state mutation for malformed body %j', async (body) => {
    expect((await PUT(req(body))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
    expect(invalidateForOwner).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON without reading state', async () => {
    const request = { json: async () => { throw new SyntaxError('bad JSON'); } } as unknown as import('next/server').NextRequest;
    expect((await PUT(request)).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it('selects A, then B, then clears while preserving immutable self', async () => {
    for (const [before, next] of [[null, A], [A, B], [B, null]] as const) {
      read.mockResolvedValueOnce(state(before));
      const response = await PUT(req({ secondaryTargetId: next }));
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({
        primaryTargetId: SELF, secondaryTargetId: next,
      });
      expect(write).toHaveBeenLastCalledWith('owner-1', next);
    }
    expect(invalidateForOwner).toHaveBeenCalledTimes(3);
  });

  it('rejects self and another tenant without changing the last good state', async () => {
    target.mockResolvedValueOnce({
      id: SELF, tenantId: 'tenant-1', kind: 'self', ownerId: 'owner-1',
      contactId: null, companyId: null, label: 'Self', pinned: false,
      createdAt: '', updatedAt: '', lastUsedAt: '',
    });
    expect((await PUT(req({ secondaryTargetId: SELF }))).status).toBe(400);
    target.mockResolvedValueOnce({
      id: B, tenantId: 'other-tenant', kind: 'contact', ownerId: null,
      contactId: B, companyId: null, label: 'B', pinned: false,
      createdAt: '', updatedAt: '', lastUsedAt: '',
    });
    expect((await PUT(req({ secondaryTargetId: B }))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('does not publish success when storage fails', async () => {
    write.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await PUT(req({ secondaryTargetId: A }))).status).toBe(500);
    expect(invalidateForOwner).not.toHaveBeenCalled();
  });

  it('does not publish success when storage returns no updated state', async () => {
    write.mockResolvedValueOnce(null);
    expect((await PUT(req({ secondaryTargetId: A }))).status).toBe(500);
    expect(invalidateForOwner).not.toHaveBeenCalled();
  });
});
