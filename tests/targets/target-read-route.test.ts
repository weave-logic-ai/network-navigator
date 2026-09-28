// The breadcrumb's id-only focus event needs a read route to resolve its label.
jest.mock('@/lib/targets/service', () => ({
  getTargetById: jest.fn(),
  getDefaultTenantId: jest.fn(),
  getOrCreateContactTarget: jest.fn(),
  getOrCreateCompanyTarget: jest.fn(),
  getCurrentOwnerProfileId: jest.fn(),
}));
jest.mock('@/lib/auth/local-request-boundary', () => ({
  requireLocalDashboardRequest: jest.fn().mockResolvedValue(null),
}));

import { GET } from '@/app/api/targets/route';
import { getTargetById, getDefaultTenantId, getCurrentOwnerProfileId } from '@/lib/targets/service';

const ID = 'f96e56cb-e599-4960-b82b-6ac1d53ce503';
const getTarget = getTargetById as jest.MockedFunction<typeof getTargetById>;
const getTenant = getDefaultTenantId as jest.MockedFunction<typeof getDefaultTenantId>;

function request(id?: string) {
  return {
    nextUrl: new URL(`http://localhost/api/targets${id ? `?id=${id}` : ''}`),
  } as unknown as import('next/server').NextRequest;
}

describe('GET /api/targets?id=', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTenant.mockResolvedValue('tenant-1');
    (getCurrentOwnerProfileId as jest.Mock).mockResolvedValue('owner-1');
  });

  it('resolves a target label for an id-only focus change', async () => {
    getTarget.mockResolvedValue({
      id: ID, tenantId: 'tenant-1', kind: 'contact', label: 'Prior focus',
      ownerId: null, contactId: ID, companyId: null, pinned: false,
      createdAt: '', updatedAt: '', lastUsedAt: '',
    });
    const response = await GET(request(ID));
    expect(response.status).toBe(200);
    expect((await response.json()).data.label).toBe('Prior focus');
  });

  it('rejects malformed ids before querying the database', async () => {
    const response = await GET(request('not-a-uuid'));
    expect(response.status).toBe(400);
    expect(getTarget).not.toHaveBeenCalled();
  });

  it('does not disclose another tenant\'s target', async () => {
    getTarget.mockResolvedValue({
      id: ID, tenantId: 'tenant-2', kind: 'company', label: 'Other tenant',
      ownerId: null, contactId: null, companyId: ID, pinned: false,
      createdAt: '', updatedAt: '', lastUsedAt: '',
    });
    const response = await GET(request(ID));
    expect(response.status).toBe(404);
  });

  it('does not disclose another owner’s self target in the same tenant', async () => {
    getTarget.mockResolvedValue({
      id: ID, tenantId: 'tenant-1', kind: 'self', label: 'Private self',
      ownerId: 'owner-2', contactId: null, companyId: null, pinned: false,
      createdAt: '', updatedAt: '', lastUsedAt: '',
    });
    const response = await GET(request(ID));
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('Private self');
  });
});
