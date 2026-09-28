import { query } from '@/lib/db/client';
import { getCurrentOwnerProfileId, getOrCreateSelfTarget } from '@/lib/targets/service';
import { seedResearchLensesForCurrentOwner } from '@/lib/targets/seed-lenses';

jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));
jest.mock('@/lib/targets/service', () => ({
  getCurrentOwnerProfileId: jest.fn(),
  getOrCreateSelfTarget: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockOwnerId = getCurrentOwnerProfileId as jest.MockedFunction<typeof getCurrentOwnerProfileId>;
const mockSelfTarget = getOrCreateSelfTarget as jest.MockedFunction<typeof getOrCreateSelfTarget>;

describe('seedResearchLensesForCurrentOwner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnerId.mockResolvedValue('owner-id');
    mockSelfTarget.mockResolvedValue({ id: 'target-id' } as Awaited<ReturnType<typeof getOrCreateSelfTarget>>);
  });

  it('inserts unscoped associations against the partial unique index without updating scoped rows', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('SELECT id FROM icp_profiles')) return { rows: [{ id: 'icp-id' }] } as never;
      return { rows: [] } as never;
    });

    const result = await seedResearchLensesForCurrentOwner();

    expect(result).toEqual({
      created: [],
      existing: ['As consultant', 'As board member', 'As candidate'],
      selfTargetId: 'target-id',
    });
    const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO research_target_icps'));
    expect(inserts).toHaveLength(3);
    for (const [sql, params] of inserts) {
      expect(sql).toMatch(/VALUES \(\$1, \$2, NULL, FALSE\)/);
      expect(sql).toMatch(/ON CONFLICT \(target_id, icp_profile_id\) WHERE lens_id IS NULL DO NOTHING/);
      expect(sql).not.toMatch(/DO UPDATE/i);
      expect(params).toEqual(['target-id', 'icp-id']);
    }
  });
});
