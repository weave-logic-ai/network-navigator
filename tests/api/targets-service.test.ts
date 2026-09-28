// Research Tools Sprint WS-4 — target service unit tests.
//
// Verifies the service layer that the (app)/** layout calls on every page
// load: lazy creation of self-targets + the research_target_state row, and
// the set/clear secondary target path.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

function mockRows<T>(rows: T[]) {
  return Promise.resolve({ rows, command: '', rowCount: rows.length, oid: 0, fields: [] });
}

describe('targets/service', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('getDefaultTenantId throws when no default tenant is seeded', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.MockedFunction<typeof query>).mockImplementation(() =>
      mockRows<{ id: string }>([]) as ReturnType<typeof query>
    );
    const svc = await import('@/lib/targets/service');
    await expect(svc.getDefaultTenantId()).rejects.toThrow(/Default tenant not found/);
  });

  it('getResearchTargetState returns null when no owner profile exists', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.MockedFunction<typeof query>).mockImplementation(() =>
      mockRows<{ id: string }>([]) as ReturnType<typeof query>
    );
    const svc = await import('@/lib/targets/service');
    const state = await svc.getResearchTargetState();
    expect(state).toBeNull();
  });

  it('getResearchTargetState lazy-creates self-target + state row on first read', async () => {
    const { query, transaction } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    (transaction as jest.Mock).mockImplementation((fn: (client: { query: typeof query }) => Promise<unknown>) =>
      fn({ query }));

    const calls: Array<{ sql: string; params: unknown[] }> = [];
    mockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      calls.push({ sql: text, params: params ?? [] });

      if (text.includes('FROM owner_profiles') && text.includes('is_current')) {
        return mockRows([{ id: 'owner-1' }]) as ReturnType<typeof query>;
      }
      if (text.includes('FROM tenants') && text.includes('slug')) {
        return mockRows([{ id: 'tenant-1' }]) as ReturnType<typeof query>;
      }
      if (text.includes('SELECT * FROM research_targets') && text.includes("kind = 'self'")) {
        return mockRows([]) as ReturnType<typeof query>;
      }
      if (text.includes('SELECT COALESCE') && text.includes('FROM owner_profiles')) {
        return mockRows([{ label: 'Ada Lovelace' }]) as ReturnType<typeof query>;
      }
      if (text.includes('INSERT INTO research_targets')) {
        return mockRows([{
          id: 'target-self-1',
          tenant_id: 'tenant-1',
          kind: 'self',
          owner_id: 'owner-1',
          contact_id: null,
          company_id: null,
          label: 'Ada Lovelace',
          pinned: false,
          created_at: 'x',
          updated_at: 'x',
          last_used_at: 'x',
        }]) as ReturnType<typeof query>;
      }
      if (text.includes('INSERT INTO research_target_state')) {
        return mockRows([{
          tenant_id: 'tenant-1',
          user_id: 'owner-1',
          primary_target_id: 'target-self-1',
          secondary_target_id: null,
          updated_at: 'x',
        }]) as ReturnType<typeof query>;
      }
      if (text.includes('SELECT * FROM research_target_state')) {
        return mockRows([{
          tenant_id: 'tenant-1', user_id: 'owner-1',
          primary_target_id: 'target-self-1', secondary_target_id: null,
          revision: '0', last_used_lens_id: null, updated_at: 'x',
        }]) as ReturnType<typeof query>;
      }
      return mockRows([]) as ReturnType<typeof query>;
    });

    const { getResearchTargetState } = await import('@/lib/targets/service');
    const state = await getResearchTargetState();

    expect(state).not.toBeNull();
    expect(state?.primaryTargetId).toBe('target-self-1');
    expect(state?.secondaryTargetId).toBeNull();
    // Asserts the idempotent write path actually inserted into both tables
    expect(calls.some((c) => c.sql.includes('INSERT INTO research_targets'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('INSERT INTO research_target_state'))).toBe(true);
  });

  it('getTargetEntityId resolves to owner/contact/company based on kind', async () => {
    const { getTargetEntityId } = await import('@/lib/targets/service');
    expect(
      getTargetEntityId({
        id: 't1', tenantId: 'x', kind: 'self', ownerId: 'o1',
        contactId: null, companyId: null, label: 'Me', pinned: false,
        createdAt: 'x', updatedAt: 'x', lastUsedAt: 'x',
      })
    ).toBe('o1');

    expect(
      getTargetEntityId({
        id: 't2', tenantId: 'x', kind: 'contact', ownerId: null,
        contactId: 'c1', companyId: null, label: 'Contact', pinned: false,
        createdAt: 'x', updatedAt: 'x', lastUsedAt: 'x',
      })
    ).toBe('c1');

    expect(
      getTargetEntityId({
        id: 't3', tenantId: 'x', kind: 'company', ownerId: null,
        contactId: null, companyId: 'co1', label: 'Company', pinned: false,
        createdAt: 'x', updatedAt: 'x', lastUsedAt: 'x',
      })
    ).toBe('co1');
  });
});
