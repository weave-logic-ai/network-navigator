// Research Tools Sprint — WS-4 Phase 4 Track H: lens soft-delete tests.
//
// `softDeleteLens` sets deleted_at + clears is_default; `listLensesForTarget`
// filters them out; `getLensById` still returns them (banner path). Ensures
// the deleted lens surfaces only through the banner channel.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

function mockRows<T>(rows: T[]) {
  return Promise.resolve({
    rows,
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  });
}

describe('targets/lens-service soft-delete', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('listLensesForTarget issues a query that filters deleted_at IS NULL', async () => {
    const { query } = await import('@/lib/db/client');
    let issuedSql = '';
    (query as jest.MockedFunction<typeof query>).mockImplementation(
      (sql: unknown) => {
        issuedSql = String(sql);
        return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
      }
    );
    const svc = await import('@/lib/targets/lens-service');
    await svc.listLensesForTarget('target-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(issuedSql).toMatch(/deleted_at IS NULL/);
  });

  it('softDeleteLens returns the deleted row with deletedAt populated', async () => {
    const { transaction } = await import('@/lib/db/client');
    const issued: string[] = [];
    (transaction as jest.MockedFunction<typeof transaction>).mockImplementation(async fn =>
      fn({ query: (sql: string) => {
        issued.push(sql);
        if (sql.includes('SELECT lens.tenant_id FROM research_lenses')) {
          return mockRows([{ tenant_id: 't' }]);
        }
        if (sql.includes('SELECT tenant_id, user_id FROM research_target_state')) {
          return mockRows([{ tenant_id: 't', user_id: 'owner-1' }]);
        }
        if (sql.includes('UPDATE research_lenses')) return mockRows([{
          id: 'lens-1',
          tenant_id: 't',
          user_id: null,
          name: 'Deleted lens',
          primary_target_id: 'target-1',
          secondary_target_id: null,
          config: {},
          is_default: false,
          created_at: 'x',
          updated_at: 'y',
          deleted_at: '2026-04-17T12:34:56.000Z',
        }]);
        return mockRows([]);
      } } as unknown as Parameters<typeof fn>[0])
    );
    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.softDeleteLens('target-1', 'lens-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(lens?.id).toBe('lens-1');
    expect(lens?.deletedAt).toBe('2026-04-17T12:34:56.000Z');
    expect(lens?.isDefault).toBe(false);
    expect(issued.findIndex(sql => sql.includes('FOR UPDATE')))
      .toBeLessThan(issued.findIndex(sql => sql.includes('UPDATE research_lenses')));
    expect(issued.some(sql => sql.includes('SET last_used_lens_id = NULL'))).toBe(true);
  });

  it('softDeleteLens returns null when the row does not exist or is already deleted', async () => {
    const { transaction } = await import('@/lib/db/client');
    (transaction as jest.MockedFunction<typeof transaction>).mockImplementation(async fn =>
      fn({ query: () => mockRows([]) } as unknown as Parameters<typeof fn>[0])
    );
    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.softDeleteLens('target-1', 'missing', { tenantId: 't', ownerId: 'owner-1' });
    expect(lens).toBeNull();
  });

  it('getLensById returns a soft-deleted row (banner path)', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.MockedFunction<typeof query>).mockImplementation(() =>
      mockRows<Record<string, unknown>>([
        {
          id: 'lens-gone',
          tenant_id: 't',
          user_id: null,
          name: 'Gone but queryable',
          primary_target_id: 'target-1',
          secondary_target_id: null,
          config: { icpProfileIds: [] },
          is_default: false,
          created_at: 'x',
          updated_at: 'y',
          deleted_at: '2026-04-17T00:00:00.000Z',
        },
      ]) as ReturnType<typeof query>
    );
    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.getLensById('lens-gone', { tenantId: 't', ownerId: 'owner-1' });
    expect(lens?.deletedAt).toBe('2026-04-17T00:00:00.000Z');
  });
});
