// ExoChain enrichment-adapter tests:
// Verify it wraps the waterfall and appends chain entries per step when the flag is on.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

jest.mock('@/lib/enrichment/waterfall', () => ({
  enrichContact: jest.fn(),
}));

jest.mock('@/lib/db/queries/enrichment', () => ({
  getActiveBudget: jest.fn(),
}));

function baseContact() {
  return {
    id: 'c1', linkedinUrl: 'https://linkedin.com/in/c1',
    firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe',
    email: null, currentCompany: 'Acme', title: 'VP',
  };
}

describe('ExoChain enrichment-adapter', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns waterfall results without _chainId when flag off', async () => {
    delete process.env.ECC_EXO_CHAIN;

    const waterfallModule = await import('@/lib/enrichment/waterfall');
    const mockEnrich = waterfallModule.enrichContact as jest.MockedFunction<typeof waterfallModule.enrichContact>;
    mockEnrich.mockResolvedValue([
      { providerName: 'clearbit', success: true, costCents: 10, fields: [], error: null } as unknown as Awaited<ReturnType<typeof waterfallModule.enrichContact>>[number],
    ]);

    const { enrichContactWithChain } = await import('@/lib/ecc/exo-chain/enrichment-adapter');
    const result = await enrichContactWithChain(baseContact());
    expect(result._chainId).toBeUndefined();
    expect(result.results).toHaveLength(1);
  });

  it('returns _chainId and appends chain entries when flag on', async () => {
    process.env.ECC_EXO_CHAIN = 'true';

    const waterfallModule = await import('@/lib/enrichment/waterfall');
    const mockEnrich = waterfallModule.enrichContact as jest.MockedFunction<typeof waterfallModule.enrichContact>;
    mockEnrich.mockResolvedValue([
      { providerName: 'clearbit', success: true, costCents: 10, fields: [{ field: 'email' }], error: null } as unknown as Awaited<ReturnType<typeof waterfallModule.enrichContact>>[number],
      { providerName: 'apollo', success: false, costCents: 0, fields: [], error: 'no_match' } as unknown as Awaited<ReturnType<typeof waterfallModule.enrichContact>>[number],
    ]);

    const budgetModule = await import('@/lib/db/queries/enrichment');
    (budgetModule.getActiveBudget as jest.Mock).mockResolvedValue({ budgetCents: 1000, spentCents: 500 });

    const dbModule = await import('@/lib/db/client');
    const mockQuery = dbModule.query as jest.MockedFunction<typeof dbModule.query>;
    mockQuery.mockImplementation(() => Promise.resolve({
      rows: [{
        id: 'x', tenant_id: 'default', chain_id: 'any', sequence: 0,
        prev_hash: null, entry_hash: Buffer.from('aa'.repeat(16), 'hex'),
        operation: 'budget_check', data: {}, actor: 'system', created_at: 'x',
      }],
      command: '', rowCount: 1, oid: 0, fields: [],
    }) as unknown as ReturnType<typeof dbModule.query>);

    const { enrichContactWithChain } = await import('@/lib/ecc/exo-chain/enrichment-adapter');
    const result = await enrichContactWithChain(baseContact(), { targetFields: ['email'] });

    expect(result._chainId).toBeDefined();
    expect(typeof result._chainId).toBe('string');

    // Each appended entry produces one INSERT into exo_chain_entries.
    const inserts = mockQuery.mock.calls.filter(c => String(c[0]).includes('exo_chain_entries'));
    // Expected entries: budget_check + field_check + (provider_select + enrich_result + budget_debit) for clearbit
    //   + (provider_select + enrich_result) for apollo (no budget_debit since cost=0) + waterfall_complete
    // = 1 + 1 + 3 + 2 + 1 = 8
    expect(inserts.length).toBe(8);
  });

  it('swallows append errors without breaking the return', async () => {
    process.env.ECC_EXO_CHAIN = 'true';

    const waterfallModule = await import('@/lib/enrichment/waterfall');
    const mockEnrich = waterfallModule.enrichContact as jest.MockedFunction<typeof waterfallModule.enrichContact>;
    mockEnrich.mockResolvedValue([]);

    const budgetModule = await import('@/lib/db/queries/enrichment');
    (budgetModule.getActiveBudget as jest.Mock).mockRejectedValue(new Error('db down'));

    const dbModule = await import('@/lib/db/client');
    const mockQuery = dbModule.query as jest.MockedFunction<typeof dbModule.query>;
    // Always throw on append
    mockQuery.mockRejectedValue(new Error('db unavailable'));

    const { enrichContactWithChain } = await import('@/lib/ecc/exo-chain/enrichment-adapter');
    const result = await enrichContactWithChain(baseContact());

    // Chain was attempted but all entries failed; adapter must still return with chainId.
    expect(result._chainId).toBeDefined();
    expect(result.results).toEqual([]);
  });

  it('resolves tenant via getDefaultTenantId when no tenantId override is passed', async () => {
    process.env.ECC_EXO_CHAIN = 'true';

    const waterfallModule = await import('@/lib/enrichment/waterfall');
    (waterfallModule.enrichContact as jest.Mock).mockResolvedValue([]);

    const budgetModule = await import('@/lib/db/queries/enrichment');
    (budgetModule.getActiveBudget as jest.Mock).mockResolvedValue(null);

    const dbModule = await import('@/lib/db/client');
    const mockQuery = dbModule.query as jest.MockedFunction<typeof dbModule.query>;
    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM tenants')) {
        return Promise.resolve({ rows: [{ id: 'real-tenant-uuid' }], command: '', rowCount: 1, oid: 0, fields: [] }) as unknown as ReturnType<typeof dbModule.query>;
      }
      // exo_chain_entries insert
      return Promise.resolve({
        rows: [{
          id: 'e', tenant_id: 'real-tenant-uuid', chain_id: 'x', sequence: 0,
          prev_hash: null, entry_hash: Buffer.from('cd'.repeat(16), 'hex'),
          operation: 'budget_check', data: {}, actor: 'system', created_at: 'x',
        }],
        command: '', rowCount: 1, oid: 0, fields: [],
      }) as unknown as ReturnType<typeof dbModule.query>;
    });

    const { enrichContactWithChain } = await import('@/lib/ecc/exo-chain/enrichment-adapter');
    await enrichContactWithChain(baseContact());

    // Every exo_chain_entries insert must carry the resolved UUID, never the
    // literal 'default' string (exo_chain_entries.tenant_id is a UUID column).
    const inserts = mockQuery.mock.calls.filter(c => String(c[0]).includes('exo_chain_entries'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const call of inserts) {
      const params = call[1] as unknown[];
      expect(params[0]).toBe('real-tenant-uuid');
    }
  });

  it('uses a caller-supplied tenantId override without querying the tenants table', async () => {
    process.env.ECC_EXO_CHAIN = 'true';

    const waterfallModule = await import('@/lib/enrichment/waterfall');
    (waterfallModule.enrichContact as jest.Mock).mockResolvedValue([]);

    const budgetModule = await import('@/lib/db/queries/enrichment');
    (budgetModule.getActiveBudget as jest.Mock).mockResolvedValue(null);

    const dbModule = await import('@/lib/db/client');
    const mockQuery = dbModule.query as jest.MockedFunction<typeof dbModule.query>;
    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM tenants')) {
        throw new Error('should not resolve default tenant when override is provided');
      }
      return Promise.resolve({
        rows: [{
          id: 'e', tenant_id: 'override-tenant', chain_id: 'x', sequence: 0,
          prev_hash: null, entry_hash: Buffer.from('ef'.repeat(16), 'hex'),
          operation: 'budget_check', data: {}, actor: 'system', created_at: 'x',
        }],
        command: '', rowCount: 1, oid: 0, fields: [],
      }) as unknown as ReturnType<typeof dbModule.query>;
    });

    const { enrichContactWithChain } = await import('@/lib/ecc/exo-chain/enrichment-adapter');
    await enrichContactWithChain(baseContact(), {}, 'override-tenant');

    const inserts = mockQuery.mock.calls.filter(c => String(c[0]).includes('exo_chain_entries'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const call of inserts) {
      const params = call[1] as unknown[];
      expect(params[0]).toBe('override-tenant');
    }
  });
});
