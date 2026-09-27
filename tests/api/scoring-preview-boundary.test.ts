jest.mock('@/lib/auth/local-request-boundary', () => ({ requireLocalDashboardRequest: jest.fn(async () => null) }));
jest.mock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { targets: true } }));
jest.mock('@/lib/targets/service', () => ({
  getCurrentOwnerProfileId: jest.fn(async () => 'owner-a'),
  getResearchTargetState: jest.fn(async () => ({ tenantId: 'tenant-a' })),
  getTargetById: jest.fn(async () => ({ tenantId: 'tenant-a', kind: 'contact' })),
}));
jest.mock('@/lib/targets/lens-service', () => ({ getActiveLensIcps: jest.fn(async () => []) }));
jest.mock('@/lib/db/queries/scoring', () => ({
  getAllContactIds: jest.fn(async () => []), getActiveIcpProfiles: jest.fn(async () => []),
}));
jest.mock('@/lib/scoring/weight-manager', () => ({ WeightManager: jest.fn().mockImplementation(() => ({
  loadProfile: jest.fn(async () => undefined), getWeights: jest.fn(() => ({})),
})) }));

import { NextRequest } from '../../app/node_modules/next/server';
import { GET } from '@/app/api/scoring/preview/route';
import * as targets from '@/lib/targets/service';
import { getActiveLensIcps } from '@/lib/targets/lens-service';

const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function request(id = targetId) {
  return new NextRequest(`http://localhost:3751/api/scoring/preview?targetId=${id}&weights=%7B%7D`);
}

beforeEach(() => jest.clearAllMocks());

it('rejects malformed and foreign-tenant target IDs without selecting a lens', async () => {
  expect((await GET(request('invalid'))).status).toBe(400);
  (targets.getTargetById as jest.Mock).mockResolvedValueOnce({ tenantId: 'tenant-b', kind: 'contact' });
  expect((await GET(request())).status).toBe(404);
  expect(getActiveLensIcps).not.toHaveBeenCalled();
});

it('rejects another owner’s self target and scopes authorized lens selection', async () => {
  (targets.getTargetById as jest.Mock).mockResolvedValueOnce({
    tenantId: 'tenant-a', kind: 'self', ownerId: 'owner-b',
  });
  expect((await GET(request())).status).toBe(404);
  expect(getActiveLensIcps).not.toHaveBeenCalled();
  expect((await GET(request())).status).toBe(200);
  expect(getActiveLensIcps).toHaveBeenCalledWith(targetId, {
    tenantId: 'tenant-a', ownerId: 'owner-a',
  });
});
