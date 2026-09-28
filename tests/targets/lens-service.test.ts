// Research Tools Sprint — WS-4 Phase 1.5 lens-service unit tests.
//
// Exercises lens resolution and canonical ICP associations against a mocked
// pg client, including two lenses on one target and legacy null-lens rows.

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

describe('targets/lens-service', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('getActiveLensForTarget returns null when no lenses exist', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.MockedFunction<typeof query>).mockImplementation(() =>
      mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>
    );
    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.getActiveLensForTarget('target-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(lens).toBeNull();
  });

  it('lists canonical ICP associations even when JSON config has stale IDs', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: unknown) => {
      expect(String(sql)).toContain('rti.lens_id = lens.id');
      return mockRows([{ id: 'lens-a', tenant_id: 'tenant', name: 'First',
        primary_target_id: 'target-1', config: { icpProfileIds: ['stale'] },
        icp_profile_ids: ['icp-a', 'icp-b'], created_at: 'x', updated_at: 'x' }]) as ReturnType<typeof query>;
    });
    const svc = await import('@/lib/targets/lens-service');
    expect((await svc.listLensesForTarget('target-1', { tenantId: 't', ownerId: 'owner-1' }))[0]).toMatchObject({
      icpProfileIds: ['icp-a', 'icp-b'], config: { icpProfileIds: ['stale'] },
    });
  });

  it('getActiveLensForTarget picks the default lens first, then oldest', async () => {
    const { query } = await import('@/lib/db/client');
    // After migration 045 the service first checks
    // research_target_state.last_used_lens_id (returns null here so we
    // exercise the fall-through path) then ORDER BYs is_default DESC,
    // created_at ASC.
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('last_used_lens_id')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: null },
        ]) as ReturnType<typeof query>;
      }
      return mockRows<Record<string, unknown>>([
        {
          id: 'lens-default',
          tenant_id: 't',
          user_id: null,
          name: 'As consultant',
          primary_target_id: 'target-1',
          secondary_target_id: null,
          config: { icpProfileIds: ['icp-1', 'icp-2'] },
          is_default: true,
          created_at: 'a',
          updated_at: 'a',
        },
        {
          id: 'lens-older',
          tenant_id: 't',
          user_id: null,
          name: 'As board member',
          primary_target_id: 'target-1',
          secondary_target_id: null,
          config: { icpProfileIds: ['icp-3'] },
          is_default: false,
          created_at: 'b',
          updated_at: 'b',
        },
      ]) as ReturnType<typeof query>;
    });
    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.getActiveLensForTarget('target-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(lens?.id).toBe('lens-default');
    expect(lens?.isDefault).toBe(true);
  });

  it('getActiveLensIcps reads only the selected lens association and filters inactive', async () => {
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('last_used_lens_id')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: null },
        ]) as ReturnType<typeof query>;
      }
      if (text.includes('FROM research_lenses')) {
        return mockRows<Record<string, unknown>>([
          {
            id: 'lens-1',
            tenant_id: 't',
            user_id: null,
            name: 'As candidate',
            primary_target_id: 'target-1',
            secondary_target_id: null,
            config: { icpProfileIds: ['icp-a', 'icp-b'] },
            is_default: true,
            created_at: 'x',
            updated_at: 'x',
          },
        ]) as ReturnType<typeof query>;
      }
      if (text.includes('JOIN icp_profiles ip')) {
        // Return only the active ICP so we verify the filter fires.
        return mockRows<Record<string, unknown>>([
          {
            id: 'icp-a',
            name: 'Active ICP',
            description: null,
            is_active: true,
            criteria: { roles: ['CTO'] },
            weight_overrides: {},
            created_at: 'x',
            updated_at: 'x',
          },
        ]) as ReturnType<typeof query>;
      }
      return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/targets/lens-service');
    const icps = await svc.getActiveLensIcps('target-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(icps).toHaveLength(1);
    expect(icps[0].id).toBe('icp-a');
    expect(icps[0].isActive).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('rti.target_id = $1 AND rti.lens_id = $2'),
      ['target-1', 'lens-1', 't', 'owner-1']
    );
  });

  it('selects different ICPs for two lenses on the same target', async () => {
    const { query } = await import('@/lib/db/client');
    let selectedLens = 'lens-a';
    const observed: string[] = [];
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('last_used_lens_id')) {
        return mockRows([{ last_used_lens_id: selectedLens }]) as ReturnType<typeof query>;
      }
      if (text.includes('FROM research_lenses')) {
        return mockRows([{
          id: selectedLens,
          tenant_id: 'tenant',
          user_id: null,
          name: selectedLens,
          primary_target_id: 'target-1',
          secondary_target_id: null,
          config: { icpProfileIds: ['wrong-json-icp'] },
          is_default: selectedLens === 'lens-a',
          created_at: 'x',
          updated_at: 'x',
        }]) as ReturnType<typeof query>;
      }
      if (text.includes('JOIN icp_profiles ip')) {
        expect(text).toContain('rti.target_id = $1 AND rti.lens_id = $2');
        expect(params?.[0]).toBe('target-1');
        const lensId = params?.[1] as string;
        observed.push(lensId);
        const id = lensId === 'lens-a' ? 'icp-a' : 'icp-b';
        return mockRows([{
          id,
          name: id,
          description: null,
          is_active: true,
          criteria: {},
          weight_overrides: {},
          created_at: 'x',
          updated_at: 'x',
        }]) as ReturnType<typeof query>;
      }
      return mockRows([]) as ReturnType<typeof query>;
    });
    const svc = await import('@/lib/targets/lens-service');
    expect((await svc.getActiveLensIcps('target-1', { tenantId: 't', ownerId: 'owner-1' })).map((icp) => icp.id)).toEqual(['icp-a']);
    selectedLens = 'lens-b';
    expect((await svc.getActiveLensIcps('target-1', { tenantId: 't', ownerId: 'owner-1' })).map((icp) => icp.id)).toEqual(['icp-b']);
    expect(observed).toEqual(['lens-a', 'lens-b']);
  });

  it('getActiveLensIcps ignores a legacy null-lens ICP when the lens has no association', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('last_used_lens_id')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: null },
        ]) as ReturnType<typeof query>;
      }
      if (text.includes('JOIN icp_profiles ip')) {
        expect(text).toContain('rti.lens_id = $2');
        return mockRows([]) as ReturnType<typeof query>;
      }
      return mockRows<Record<string, unknown>>([
        {
          id: 'lens-1',
          tenant_id: 't',
          user_id: null,
          name: 'Empty lens',
          primary_target_id: 'target-1',
          secondary_target_id: null,
          config: {},
          is_default: true,
          created_at: 'x',
          updated_at: 'x',
        },
      ]) as ReturnType<typeof query>;
    });
    const svc = await import('@/lib/targets/lens-service');
    const icps = await svc.getActiveLensIcps('target-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(icps).toEqual([]);
  });

  it('createLensForTarget writes the lens and its ICPs in one transaction', async () => {
    const { query, transaction } = await import('@/lib/db/client');
    const insertCalls: Array<{ sql: string; params: unknown[] }> = [];
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT *') && text.includes('FROM research_lenses')) {
        return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
      }
      return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
    });
    const clientStub = {
      query: (sql: string, params?: unknown[]) => {
        insertCalls.push({ sql, params: params ?? [] });
        const text = String(sql);
        if (text.includes('FROM research_targets')) return mockRows([{ id: 'target-1' }]);
        if (text.includes('INSERT INTO research_lenses')) {
          return mockRows<Record<string, unknown>>([
            {
              id: 'lens-new',
              tenant_id: 't',
              user_id: null,
              name: 'First lens',
              primary_target_id: 'target-1',
              secondary_target_id: null,
              config: { color: 'blue' },
              is_default: (params?.[6] as boolean) ?? false,
              created_at: 'x',
              updated_at: 'x',
            },
          ]);
        }
        if (text.includes('INSERT INTO research_target_icps')) return mockRows([{}, {}]);
        return mockRows([]);
      },
    };
    (transaction as jest.MockedFunction<typeof transaction>).mockImplementation(
      async (fn) => fn(clientStub as unknown as Parameters<typeof fn>[0])
    );

    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.createLensForTarget({
      targetId: 'target-1',
      tenantId: 't',
      name: 'First lens',
      icpProfileIds: ['icp-1', 'icp-2'],
      configExtras: { color: 'blue', icpProfileIds: ['stale'] },
    });
    expect(lens.isDefault).toBe(true);
    expect(lens.icpProfileIds).toEqual(['icp-1', 'icp-2']);
    expect(insertCalls).toHaveLength(4);
    expect(insertCalls[0].sql).toContain('FOR UPDATE');
    expect(insertCalls[2].params[6]).toBe(true);
    expect(JSON.parse(insertCalls[2].params[5] as string)).toEqual({ color: 'blue' });
    expect(insertCalls[3].sql).toContain('INSERT INTO research_target_icps');
    expect(insertCalls[3].params).toEqual(['target-1', 'lens-new', ['icp-1', 'icp-2']]);
  });

  it('rejects legacy activation without a revision', async () => {
    const { transaction } = await import('@/lib/db/client');
    const svc = await import('@/lib/targets/lens-service');
    await expect(svc.activateLensForTarget('target-1', 'lens-2'))
      .rejects.toThrow(/revisioned target state/);
    expect(transaction).not.toHaveBeenCalled();
  });

});
