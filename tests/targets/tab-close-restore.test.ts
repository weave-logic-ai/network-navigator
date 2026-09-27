// Valid reads retain the stored revision. Legacy unauthorized pointers are
// repaired under the state lock and advance the revision.
jest.mock('@/lib/db/client', () => ({
  query: jest.fn(), transaction: jest.fn(), healthCheck: jest.fn(),
  getPool: jest.fn(), shutdown: jest.fn(),
}));

import { query, transaction } from '@/lib/db/client';

const mockQuery = query as jest.MockedFunction<typeof query>;
const rows = <T,>(items: T[]) => Promise.resolve({
  rows: items, command: '', rowCount: items.length, oid: 0, fields: [],
}) as ReturnType<typeof query>;

describe('target state read after tab restore', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    (transaction as jest.Mock).mockImplementation(
      (fn: (client: { query: typeof query }) => Promise<unknown>) => fn({ query }));
  });

  it('returns the stored revision without updating an existing state row', async () => {
    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM tenants WHERE slug = 'default'")) {
        return rows([{ id: 'tenant-1' }]);
      }
      if (text.includes('SELECT * FROM research_targets') && text.includes("kind = 'self'")) {
        return rows([{
          id: 'self-target', tenant_id: 'tenant-1', kind: 'self', owner_id: 'owner-1',
          contact_id: null, company_id: null, label: 'Self', pinned: false,
          created_at: 'x', updated_at: 'x', last_used_at: 'x',
        }]);
      }
      if (text.includes('SELECT * FROM research_target_state')) {
        return rows([{
          tenant_id: 'tenant-1', user_id: 'owner-1', primary_target_id: 'self-target',
          secondary_target_id: null, last_used_lens_id: null, revision: '7', updated_at: 'x',
        }]);
      }
      return rows([]);
    });

    const { getResearchTargetState } = await import('@/lib/targets/service');
    expect(await getResearchTargetState('owner-1')).toMatchObject({
      secondaryTargetId: null, activeLensId: null, revision: '7',
    });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE research_target_state'))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('ON CONFLICT (tenant_id, user_id) DO NOTHING'))).toBe(true);
  });
});
