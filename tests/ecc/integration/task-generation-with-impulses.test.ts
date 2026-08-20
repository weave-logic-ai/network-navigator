// Regression coverage for the ECC_IMPULSES=true task-generation gap.
//
// Bug: task-triggers.ts early-returns when ECC_IMPULSES=true with a comment
// claiming the impulse scoring-adapter (`emitScoringImpulses`) picks up task
// generation instead. That wiring did not exist anywhere in production —
// `emitScoringImpulses` had zero production callers — so flipping the flag
// silently disabled ALL automatic task generation and replaced it with
// nothing. `tests/ecc/integration/feature-flags.test.ts` never caught this
// because it calls `emitScoringImpulses` directly rather than through the
// real scoring pipeline.
//
// This file exercises the REAL `scoreContact` pipeline (app/src/lib/scoring/
// pipeline.ts is NOT mocked) with ECC_IMPULSES=true and asserts tasks are
// still generated end-to-end: pipeline -> emitScoringImpulses -> emitImpulse
// -> dispatchImpulse -> executeTaskGenerator -> INSERT INTO tasks.
//
// Note: this test registers `impulse_handlers` rows for the tenant, matching
// what a configured tenant looks like. There is currently no seed data or
// admin surface anywhere in the codebase that provisions `impulse_handlers`
// rows automatically — a fresh/default tenant has none. That is a real,
// separate gap (impulses are emitted into a void until a handler is
// registered) flagged in the handoff report; it is out of scope for this
// wiring fix, which is specifically about the emitter never being called.

const ORIGINAL_ENV = { ...process.env };

const ALL_ECC_FLAGS = [
  'ECC_CAUSAL_GRAPH',
  'ECC_EXO_CHAIN',
  'ECC_IMPULSES',
  'ECC_COGNITIVE_TICK',
  'ECC_CROSS_REFS',
];

function clearEccFlags() {
  for (const f of ALL_ECC_FLAGS) delete process.env[f];
}

function mockRows<T>(rows: T[]) {
  return Promise.resolve({ rows, command: '', rowCount: rows.length, oid: 0, fields: [] });
}

const TENANT_ID = 'tenant-default-uuid';

function fixedComposite(overrides: Record<string, unknown> = {}) {
  return {
    compositeScore: 0.9,
    tier: 'gold',
    persona: 'buyer',
    behavioralPersona: 'engaged-professional',
    dimensions: [],
    scoringVersion: 1,
    referralLikelihood: null,
    referralTier: null,
    referralPersona: null,
    referralDimensions: null,
    behavioralSignals: null,
    referralSignals: null,
    ...overrides,
  };
}

function fullContact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    degree: 1,
    title: 'VP of Sales',
    headline: 'Helping teams grow',
    about: 'Long-time operator',
    currentCompany: 'Acme Corp',
    connectionsCount: 600,
    tags: ['sales', 'saas'],
    location: 'NYC',
    companyIndustry: 'Software',
    companySizeRange: '51-200',
    mutualConnectionCount: 5,
    edgeCount: 10,
    skills: ['sales', 'saas'],
    pagerank: 0.5,
    betweenness: 0.2,
    degreeCentrality: 0.3,
    observationCount: 2,
    contentTopics: ['sales'],
    postingFrequency: 'weekly',
    avgEngagement: 0.1,
    connectedAt: '2025-01-01',
    connectionCountRaw: '600',
    discoveredVia: [],
    clusterIds: [],
    ...overrides,
  };
}

describe('ECC_IMPULSES=true task generation — real pipeline', () => {
  beforeEach(() => {
    jest.resetModules();
    clearEccFlags();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('generates tasks via the real scoring pipeline when ECC_IMPULSES=true and a handler is registered', async () => {
    process.env.ECC_IMPULSES = 'true';

    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));

    jest.doMock('@/lib/db/queries/scoring', () => ({
      getDefaultWeightProfile: jest.fn().mockResolvedValue(null),
      getWeightProfileByName: jest.fn().mockResolvedValue(null),
      getContactScoringData: jest.fn().mockResolvedValue(fullContact()),
      getActiveIcpProfiles: jest.fn().mockResolvedValue([]),
      getScoringBaselines: jest.fn().mockResolvedValue({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5 }),
      getContactScoreBreakdown: jest.fn().mockResolvedValue({
        compositeScore: 0.5,
        tier: 'silver',
        persona: 'warm-lead',
        behavioralPersona: 'engaged-professional',
        scoredAt: null,
        dimensions: [],
        referralLikelihood: null,
        referralTier: null,
        referralPersona: null,
        referralDimensions: [],
        behavioralSignals: null,
        referralSignals: null,
      }),
      upsertContactScore: jest.fn().mockResolvedValue(undefined),
      upsertContactIcpFit: jest.fn().mockResolvedValue(undefined),
    }));

    // Composite/referral scoring math is exercised elsewhere (tests/scoring/).
    // Here we pin the output so the test asserts the plumbing — pipeline ->
    // emitScoringImpulses -> emitImpulse -> dispatchImpulse ->
    // executeTaskGenerator -> INSERT INTO tasks — not the scoring algorithm.
    jest.doMock('@/lib/scoring/composite', () => ({
      computeCompositeScore: jest.fn().mockReturnValue(fixedComposite()),
    }));
    jest.doMock('@/lib/scoring/referral/referral-pipeline', () => ({
      computeReferralScore: jest.fn().mockReturnValue({
        likelihood: 0.1, tier: null, persona: null, dimensions: [], signals: null,
      }),
    }));

    const dbModule = await import('@/lib/db/client');
    const mockQuery = dbModule.query as jest.MockedFunction<typeof dbModule.query>;

    const impulseStore: Record<string, Record<string, unknown>> = {};
    let impulseSeq = 0;
    const insertedTasks: Array<{ sql: string; params: unknown[] }> = [];

    mockQuery.mockImplementation(((sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      const p = (params ?? []) as unknown[];

      if (text.includes(`FROM tenants WHERE slug = 'default'`)) {
        return mockRows([{ id: TENANT_ID }]);
      }

      if (text.includes('INSERT INTO impulses')) {
        const [tenantId, impulseType, sourceEntityType, sourceEntityId, payloadJson] = p as string[];
        const id = `imp-${++impulseSeq}`;
        const row = {
          id, tenant_id: tenantId, impulse_type: impulseType,
          source_entity_type: sourceEntityType, source_entity_id: sourceEntityId,
          payload: JSON.parse(payloadJson), created_at: '2026-01-01',
        };
        impulseStore[id] = row;
        return mockRows([row]);
      }

      if (text.includes('SELECT * FROM impulses WHERE id')) {
        const id = p[0] as string;
        return mockRows(impulseStore[id] ? [impulseStore[id]] : []);
      }

      if (text.includes('FROM impulse_handlers')) {
        const impulseType = p[1] as string;
        if (impulseType === 'tier_changed' || impulseType === 'persona_assigned') {
          return mockRows([{
            id: `h-${impulseType}`, tenant_id: TENANT_ID, impulse_type: impulseType,
            handler_type: 'task_generator', config: {}, enabled: true, priority: 0,
            created_at: 'x', updated_at: 'x',
          }]);
        }
        return mockRows([]); // score_computed: no handler registered — legitimate no-op
      }

      if (text.includes('INSERT INTO impulse_acks')) {
        return mockRows([]);
      }

      if (text.includes('SELECT full_name FROM contacts WHERE id')) {
        return mockRows([{ full_name: 'Ada Lovelace' }]);
      }

      if (text.includes('SELECT id FROM tasks')) {
        return mockRows([]); // no pre-existing pending task — dedup passes through
      }

      if (text.includes('INSERT INTO tasks')) {
        insertedTasks.push({ sql: text, params: p });
        return mockRows([]);
      }

      return mockRows([]);
    }) as typeof mockQuery);

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { scoreContact } = await import('@/lib/scoring/pipeline');
    const result = await scoreContact('c1');
    expect(result.score.tier).toBe('gold');

    // Flush the fire-and-forget impulse emission + dispatch chain. Every
    // step here is promise/microtask-based (mocked query, no real timers or
    // I/O), so the microtask queue fully drains before this callback runs.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // The tier_changed (silver -> gold) and persona_assigned (warm-lead ->
    // buyer) impulses must each have produced a task via the real
    // task-generator handler — the same tasks the legacy inline path in
    // task-triggers.ts would have created directly.
    expect(insertedTasks.length).toBe(2);
    const taskTypes = insertedTasks.map(t => t.params[2]);
    expect(taskTypes).toContain('SEND_MESSAGE'); // gold-tier intro task
    expect(taskTypes).toContain('RESEARCH'); // buyer-persona research task

    // The misconfiguration guard must NOT have fired — the emitter really ran.
    const guardCalls = errSpy.mock.calls.filter(c =>
      String(c[0]).includes('no impulse emitter ran')
    );
    expect(guardCalls.length).toBe(0);

    errSpy.mockRestore();
  });

  it('preserves the legacy inline task path exactly when ECC_IMPULSES is off', async () => {
    // ECC_IMPULSES intentionally left unset (false).

    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));

    jest.doMock('@/lib/db/queries/scoring', () => ({
      getDefaultWeightProfile: jest.fn().mockResolvedValue(null),
      getWeightProfileByName: jest.fn().mockResolvedValue(null),
      getContactScoringData: jest.fn().mockResolvedValue(fullContact()),
      getActiveIcpProfiles: jest.fn().mockResolvedValue([]),
      getScoringBaselines: jest.fn().mockResolvedValue({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5 }),
      getContactScoreBreakdown: jest.fn().mockResolvedValue({
        compositeScore: 0.5,
        tier: 'silver',
        persona: 'warm-lead',
        behavioralPersona: 'engaged-professional',
        scoredAt: null,
        dimensions: [],
        referralLikelihood: null,
        referralTier: null,
        referralPersona: null,
        referralDimensions: [],
        behavioralSignals: null,
        referralSignals: null,
      }),
      upsertContactScore: jest.fn().mockResolvedValue(undefined),
      upsertContactIcpFit: jest.fn().mockResolvedValue(undefined),
    }));

    jest.doMock('@/lib/scoring/composite', () => ({
      computeCompositeScore: jest.fn().mockReturnValue(fixedComposite()),
    }));
    jest.doMock('@/lib/scoring/referral/referral-pipeline', () => ({
      computeReferralScore: jest.fn().mockReturnValue({
        likelihood: 0.1, tier: null, persona: null, dimensions: [], signals: null,
      }),
    }));

    const dbModule = await import('@/lib/db/client');
    const mockQuery = dbModule.query as jest.MockedFunction<typeof dbModule.query>;

    const insertedTasks: Array<{ params: unknown[] }> = [];
    mockQuery.mockImplementation(((sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      const p = (params ?? []) as unknown[];

      if (text.includes('SELECT full_name FROM contacts WHERE id')) {
        return mockRows([{ full_name: 'Ada Lovelace' }]);
      }
      if (text.includes('SELECT id FROM tasks')) {
        return mockRows([]);
      }
      if (text.includes('INSERT INTO tasks')) {
        insertedTasks.push({ params: p });
        return mockRows([]);
      }
      // No impulses/impulse_handlers/tenants queries are expected on this path.
      return mockRows([]);
    }) as typeof mockQuery);

    const { scoreContact } = await import('@/lib/scoring/pipeline');
    await scoreContact('c1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(insertedTasks.length).toBe(2);
    const taskSources = mockQuery.mock.calls
      .filter(c => String(c[0]).includes('INSERT INTO tasks'))
      .map(c => String(c[0]));
    expect(taskSources.every(sql => sql.includes("'auto-score'"))).toBe(true);

    // No ECC impulse plumbing was touched at all.
    const sql = mockQuery.mock.calls.map(c => String(c[0])).join('\n');
    expect(sql).not.toMatch(/INSERT INTO impulses/);
    expect(sql).not.toMatch(/FROM impulse_handlers/);
  });
});

describe('checkAndGenerateTasks — misconfiguration guard (unit)', () => {
  beforeEach(() => {
    jest.resetModules();
    clearEccFlags();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('logs an explicit error when ECC_IMPULSES is on but no emitter was invoked', async () => {
    process.env.ECC_IMPULSES = 'true';

    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));

    const dbModule = await import('@/lib/db/client');
    const mockQuery = dbModule.query as jest.MockedFunction<typeof dbModule.query>;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { checkAndGenerateTasks } = await import('@/lib/scoring/task-triggers');
    type CompositeScore = Parameters<typeof checkAndGenerateTasks>[2];
    await checkAndGenerateTasks('c1', null, fixedComposite() as unknown as CompositeScore);
    // impulsesEmitterInvoked omitted -> defaults false

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('no impulse emitter ran'));
    // Still a no-op on the DB — this is a guard/log, not a fallback write path.
    expect(mockQuery).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('stays silent when the caller confirms the emitter ran', async () => {
    process.env.ECC_IMPULSES = 'true';

    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { checkAndGenerateTasks } = await import('@/lib/scoring/task-triggers');
    type CompositeScore = Parameters<typeof checkAndGenerateTasks>[2];
    await checkAndGenerateTasks('c1', null, fixedComposite() as unknown as CompositeScore, true);

    const guardCalls = errSpy.mock.calls.filter(c => String(c[0]).includes('no impulse emitter ran'));
    expect(guardCalls.length).toBe(0);

    errSpy.mockRestore();
  });
});
