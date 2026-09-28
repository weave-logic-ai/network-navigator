jest.mock('@/lib/targets/service', () => ({
  getCurrentOwnerProfileId: jest.fn(), getResearchTargetState: jest.fn(), getTargetById: jest.fn(),
}));
jest.mock('@/lib/targets/lens-service', () => ({ getLensById: jest.fn(), softDeleteLens: jest.fn(),
  listLensesForTarget: jest.fn(), getActiveLensForTarget: jest.fn(), createLensForTarget: jest.fn() }));
jest.mock('@/lib/auth/local-request-boundary', () => ({
  requireLocalDashboardRequest: jest.fn().mockResolvedValue(null),
}));
import { GET, DELETE } from '@/app/api/targets/[id]/lenses/[lensId]/route';
import { GET as LIST, POST } from '@/app/api/targets/[id]/lenses/route';
import { getCurrentOwnerProfileId, getResearchTargetState, getTargetById } from '@/lib/targets/service';
import { getLensById, softDeleteLens, listLensesForTarget, getActiveLensForTarget,
  createLensForTarget } from '@/lib/targets/lens-service';

const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LENS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = () => GET({} as import('next/server').NextRequest,
  { params: Promise.resolve({ id: TARGET, lensId: LENS }) });

describe('authorized lens detail status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentOwnerProfileId as jest.Mock).mockResolvedValue('owner');
    (getResearchTargetState as jest.Mock).mockResolvedValue({ tenantId: 'tenant' });
    (getTargetById as jest.Mock).mockResolvedValue({ tenantId: 'tenant' });
    (getLensById as jest.Mock).mockResolvedValue({ id: LENS, tenantId: 'tenant',
      userId: 'owner', primaryTargetId: TARGET, deletedAt: null, name: 'Saved' });
  });
  it.each([
    ['available', { primaryTargetId: TARGET, deletedAt: null }, 200],
    ['deleted', { primaryTargetId: TARGET, deletedAt: '2026-01-01' }, 200],
    ['wrongTarget', { primaryTargetId: OTHER, deletedAt: null }, 200],
  ])('reports %s for an authorized lens', async (status, change, code) => {
    (getLensById as jest.Mock).mockResolvedValue({ id: LENS, tenantId: 'tenant',
      userId: 'owner', name: 'Saved', ...change });
    const res = await request();
    expect(res.status).toBe(code);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).status).toBe(status);
  });
  it('hides a missing or foreign lens', async () => {
    (getLensById as jest.Mock).mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
    (getLensById as jest.Mock).mockResolvedValueOnce({ id: LENS, tenantId: 'foreign', userId: 'owner' });
    expect((await request()).status).toBe(404);
  });

  it.each([
    ['foreign tenant', { tenantId: 'other-tenant', kind: 'contact' }, { tenantId: 'tenant' }],
    ['other owner self target', { tenantId: 'tenant', kind: 'self', ownerId: 'other-owner' },
      { tenantId: 'tenant' }],
  ])('denies every lens route for a %s without returning config', async (_label, target, state) => {
    (getTargetById as jest.Mock).mockResolvedValue(target);
    (getResearchTargetState as jest.Mock).mockResolvedValue(state);
    const params = { params: Promise.resolve({ id: TARGET }) };
    const body = { json: async () => ({ name: 'Attempt' }) } as import('next/server').NextRequest;
    const results = await Promise.all([
      LIST({} as import('next/server').NextRequest, params), POST(body, params),
      GET({} as import('next/server').NextRequest,
        { params: Promise.resolve({ id: TARGET, lensId: LENS }) }),
      DELETE({} as import('next/server').NextRequest,
        { params: Promise.resolve({ id: TARGET, lensId: LENS }) }),
    ]);
    for (const result of results) {
      expect(result.status).toBe(404);
      expect(JSON.stringify(await result.json())).not.toContain('private-config');
    }
    expect(listLensesForTarget).not.toHaveBeenCalled();
    expect(getActiveLensForTarget).not.toHaveBeenCalled();
    expect(createLensForTarget).not.toHaveBeenCalled();
    expect(getLensById).not.toHaveBeenCalled();
    expect(softDeleteLens).not.toHaveBeenCalled();
  });

  it('hides a known lens owned by another profile before deletion', async () => {
    (getLensById as jest.Mock).mockResolvedValue({ tenantId: 'tenant', userId: 'other-owner',
      primaryTargetId: TARGET, config: { secret: 'private-config' } });
    expect((await request()).status).toBe(404);
    (softDeleteLens as jest.Mock).mockResolvedValue(null);
    const response = await DELETE({} as import('next/server').NextRequest,
      { params: Promise.resolve({ id: TARGET, lensId: LENS }) });
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('private-config');
    expect(softDeleteLens).toHaveBeenCalledWith(TARGET, LENS,
      { tenantId: 'tenant', ownerId: 'owner' });
  });
});
