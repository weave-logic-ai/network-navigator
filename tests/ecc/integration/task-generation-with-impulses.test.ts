// Regression coverage for task durability with ECC_IMPULSES on and off.
// Exercises the real scoreContact pipeline with mocked database boundaries:
// task inserts and impulse records run on the score transaction client, and
// the ordered dispatcher observes tasks already present before handlers run.

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

function namedIdentity(fullName: string) {
  return {
    full_name: fullName, first_name: null, last_name: null,
    linkedin_url: 'https://www.linkedin.com/in/ada-lovelace/',
    degree: 1, is_archived: false,
  };
}

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

    jest.doMock('@/lib/db/client', () => {
      const query = jest.fn();
      const client = { query, release: jest.fn() };
      return {
        query,
        transaction: jest.fn(async fn => fn(client)),
        healthCheck: jest.fn(),
        getPool: jest.fn(() => ({ connect: async () => client })),
        shutdown: jest.fn(),
      };
    });

    jest.doMock('@/lib/db/queries/scoring', () => ({
      getDefaultWeightProfile: jest.fn().mockResolvedValue(null),
      getWeightProfileByName: jest.fn().mockResolvedValue(null),
      getContactScoringData: jest.fn().mockResolvedValue(fullContact()),
      isOwnerScorableContact: jest.fn().mockResolvedValue(true),
      getActiveIcpProfiles: jest.fn().mockResolvedValue([]),
      getScoringBaselines: jest.fn().mockResolvedValue({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5, graphCentralityDistribution: [] }),
      getContactScoreBreakdown: jest.fn().mockResolvedValue({
        basisKind: 'owner', basisHash: null,
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
      upsertContactScore: jest.fn().mockResolvedValue({
        comparable: true, revision: 1,
        previous: fixedComposite({ compositeScore: 0.5, tier: 'silver', persona: 'warm-lead' }),
      }),
      upsertContactIcpFit: jest.fn().mockResolvedValue(undefined),
    }));

    // Composite/referral math is exercised elsewhere; pin output to test the
    // transaction and dispatch plumbing here.
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
    const acknowledgments: string[] = [];
    let impulseSeq = 0;
    const insertedTasks: Array<{ sql: string; params: unknown[] }> = [];

    mockQuery.mockImplementation(((sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      const p = (params ?? []) as unknown[];

      if (text.includes('obj_description(to_regclass')) {
        return mockRows([{ repair_ready: true, recommendation_ready: true }]);
      }
      if (text.includes('txid_current_snapshot')) return mockRows([{ snapshot_id: '1:2:' }]);
      if (text.includes('SELECT owner.id AS owner_id')) {
        return mockRows([{ owner_id: 'owner-1', tenant_id: TENANT_ID }]);
      }
      if (text.includes('SELECT id FROM contacts WHERE id = $1 FOR UPDATE')) return mockRows([{ id: 'c1' }]);

      if (text.includes(`FROM tenants WHERE slug = 'default'`)) {
        return mockRows([{ id: TENANT_ID }]);
      }

      if (text.includes('INSERT INTO impulses')) {
        const [tenantId, impulseType, sourceEntityId, payloadJson, revision, order] = p as string[];
        const id = `imp-${++impulseSeq}`;
        const row = {
          id, tenant_id: tenantId, impulse_type: impulseType,
          source_entity_type: 'contact', source_entity_id: sourceEntityId,
          payload: JSON.parse(payloadJson), score_revision: revision,
          score_event_order: order, score_dispatched_at: null, created_at: '2026-01-01',
        };
        impulseStore[id] = row;
        return mockRows([row]);
      }

      if (text.includes('SELECT * FROM impulses WHERE id')) {
        const id = p[0] as string;
        return mockRows(impulseStore[id] ? [impulseStore[id]] : []);
      }

      if (text.includes('SELECT id FROM impulses') && text.includes('score_dispatched_at IS NULL')) {
        return mockRows(Object.values(impulseStore)
          .filter(row => row.score_dispatched_at === null)
          .sort((a, b) => Number(a.score_event_order) - Number(b.score_event_order))
          .map(row => ({ id: row.id })));
      }
      if (text.includes('UPDATE impulses SET score_dispatched_at')) {
        impulseStore[p[0] as string].score_dispatched_at = '2026-01-01';
        return mockRows([]);
      }

      if (text.includes('FROM impulse_handlers')) {
        const impulseType = p[1] as string;
        if (['score_computed', 'tier_changed', 'persona_assigned'].includes(impulseType)) {
          return mockRows([{
            id: `h-${impulseType}`, tenant_id: TENANT_ID, impulse_type: impulseType,
            handler_type: 'task_generator', config: {}, enabled: true, priority: 0,
            created_at: 'x', updated_at: 'x',
          }]);
        }
        return mockRows([]);
      }

      if (text.includes('INSERT INTO impulse_acks')) {
        acknowledgments.push(text.includes("'success'") ? 'success' : 'failed');
        return mockRows([]);
      }

      if (text.includes('FROM contacts WHERE id = $1')) {
        return mockRows([namedIdentity('Ada Lovelace')]);
      }

      if (text.includes('SELECT id FROM tasks')) {
        return mockRows(insertedTasks.some(task => task.params[2] === p[0] && task.params[5] === p[2])
          ? [{ id: 'existing-task' }] : []);
      }

      if (text.includes('INSERT INTO tasks')) {
        insertedTasks.push({ sql: text, params: p });
        return text.includes('RETURNING id') ? mockRows([{ id: 'created-task' }]) : mockRows([]);
      }

      return mockRows([]);
    }) as typeof mockQuery);

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { captureOwnerScoringBasis, scoreContact } = await import('@/lib/scoring/pipeline');
    const basis = await captureOwnerScoringBasis();
    const scoring = await import('@/lib/db/queries/scoring');
    const old = await scoring.getContactScoreBreakdown('c1');
    jest.mocked(scoring.getContactScoreBreakdown).mockResolvedValue({ ...old!, basisHash: basis.basisHash });
    const result = await scoreContact('c1', undefined, undefined, basis);
    expect(result.score.tier).toBe('gold');

    // The score transaction creates these tasks before impulse dispatch.
    expect(insertedTasks.length).toBe(2);
    const taskTypes = insertedTasks.map(t => t.params[2]);
    expect(taskTypes).toContain('SEND_MESSAGE'); // gold-tier intro task
    expect(taskTypes).toContain('RESEARCH'); // buyer-persona research task
    expect(Object.values(impulseStore)).toHaveLength(3);
    expect(Object.values(impulseStore).every(row => row.score_dispatched_at !== null &&
      (row.payload as Record<string, unknown>).scoreTasksCommitted === true)).toBe(true);
    expect(acknowledgments).toHaveLength(3);
    expect(acknowledgments.every(status => status === 'success')).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();

    // The legacy misconfiguration guard must not fire on the transactional path.
    const guardCalls = errSpy.mock.calls.filter(c =>
      String(c[0]).includes('no impulse emitter ran')
    );
    expect(guardCalls.length).toBe(0);

    errSpy.mockRestore();
  });

  it('preserves the legacy inline task path exactly when ECC_IMPULSES is off', async () => {
    // ECC_IMPULSES intentionally left unset (false).

    jest.doMock('@/lib/db/client', () => {
      const query = jest.fn();
      const client = { query, release: jest.fn() };
      return {
        query,
        transaction: jest.fn(async fn => fn(client)),
        healthCheck: jest.fn(),
        getPool: jest.fn(() => ({ connect: async () => client })),
        shutdown: jest.fn(),
      };
    });

    jest.doMock('@/lib/db/queries/scoring', () => ({
      getDefaultWeightProfile: jest.fn().mockResolvedValue(null),
      getWeightProfileByName: jest.fn().mockResolvedValue(null),
      getContactScoringData: jest.fn().mockResolvedValue(fullContact()),
      isOwnerScorableContact: jest.fn().mockResolvedValue(true),
      getActiveIcpProfiles: jest.fn().mockResolvedValue([]),
      getScoringBaselines: jest.fn().mockResolvedValue({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5, graphCentralityDistribution: [] }),
      getContactScoreBreakdown: jest.fn().mockResolvedValue({
        basisKind: 'owner', basisHash: null,
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
      upsertContactScore: jest.fn().mockResolvedValue({
        comparable: true, revision: 1,
        previous: fixedComposite({ compositeScore: 0.5, tier: 'silver', persona: 'warm-lead' }),
      }),
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

      if (text.includes('obj_description(to_regclass')) {
        return mockRows([{ repair_ready: true, recommendation_ready: true }]);
      }

      if (text.includes('txid_current_snapshot')) return mockRows([{ snapshot_id: '1:2:' }]);
      if (text.includes('SELECT owner.id AS owner_id')) {
        return mockRows([{ owner_id: 'owner-1', tenant_id: TENANT_ID }]);
      }
      if (text.includes('SELECT id FROM contacts WHERE id = $1 FOR UPDATE')) return mockRows([{ id: 'c1' }]);

      if (text.includes('FROM contacts WHERE id = $1')) {
        return mockRows([namedIdentity('Ada Lovelace')]);
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

    const { captureOwnerScoringBasis, scoreContact } = await import('@/lib/scoring/pipeline');
    const basis = await captureOwnerScoringBasis();
    const scoring = await import('@/lib/db/queries/scoring');
    const old = await scoring.getContactScoreBreakdown('c1');
    jest.mocked(scoring.getContactScoreBreakdown).mockResolvedValue({ ...old!, basisHash: basis.basisHash });
    await scoreContact('c1', undefined, undefined, basis);
    expect(insertedTasks.length).toBe(2);
    expect(insertedTasks.every(task => task.params[6] === 'auto-score')).toBe(true);

    // No ECC impulse plumbing was touched at all.
    const sql = mockQuery.mock.calls.map(c => String(c[0])).join('\n');
    expect(sql).not.toMatch(/INSERT INTO impulses/);
    expect(sql).not.toMatch(/FROM impulse_handlers/);
  });

  it.each([
    ['legacy', false, 'unknown', false],
    ['ECC', true, 'unknown', false],
    ['legacy', false, 'self', true],
    ['ECC', true, 'self', true],
  ])('%s pipeline handles %s identity without outreach', async (_mode, enabled, _identity, self) => {
    if (enabled) process.env.ECC_IMPULSES = 'true';

    jest.doMock('@/lib/db/client', () => {
      const query = jest.fn();
      const client = { query, release: jest.fn() };
      return {
        query, transaction: jest.fn(async fn => fn(client)),
        healthCheck: jest.fn(), getPool: jest.fn(() => ({ connect: async () => client })),
        shutdown: jest.fn(),
      };
    });
    jest.doMock('@/lib/db/queries/scoring', () => ({
      getDefaultWeightProfile: jest.fn().mockResolvedValue(null),
      getWeightProfileByName: jest.fn().mockResolvedValue(null),
      getContactScoringData: jest.fn().mockResolvedValue(fullContact({ degree: 1 })),
      isOwnerScorableContact: jest.fn().mockResolvedValue(true),
      getActiveIcpProfiles: jest.fn().mockResolvedValue([]),
      getScoringBaselines: jest.fn().mockResolvedValue({ p90Mutuals: 20, p90Edges: 10, totalClusters: 5, graphCentralityDistribution: [] }),
      getContactScoreBreakdown: jest.fn().mockResolvedValue({
        compositeScore: 0.5, tier: 'silver', persona: 'warm-lead',
        behavioralPersona: 'engaged-professional', scoredAt: null,
        dimensions: [], referralLikelihood: null, referralTier: null,
        referralPersona: null, referralDimensions: [], behavioralSignals: null,
        referralSignals: null,
      }),
      upsertContactScore: jest.fn().mockResolvedValue({
        comparable: true, revision: 1,
        previous: fixedComposite({ compositeScore: 0.5, tier: 'silver', persona: 'warm-lead' }),
      }),
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

    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    const impulses: Record<string, Record<string, unknown>> = {};
    const acknowledgments: string[] = [];
    const inserted: unknown[][] = [];
    const pending = new Set<string>();
    let nextImpulse = 0;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockQuery.mockImplementation(((sql: unknown, params?: unknown[]) => {
      const statement = String(sql);
      const values = (params ?? []) as unknown[];
      if (statement.includes('obj_description(to_regclass')) {
        return mockRows([{ repair_ready: true, recommendation_ready: true }]);
      }
      if (statement.includes('txid_current_snapshot')) return mockRows([{ snapshot_id: '1:2:' }]);
      if (statement.includes('SELECT owner.id AS owner_id')) {
        return mockRows([{ owner_id: 'owner-1', tenant_id: TENANT_ID }]);
      }
      if (statement.includes('SELECT id FROM contacts WHERE id = $1 FOR UPDATE')) return mockRows([{ id: 'c1' }]);
      if (statement.includes("FROM tenants WHERE slug = 'default'")) return mockRows([{ id: TENANT_ID }]);
      if (statement.includes('INSERT INTO impulses')) {
        const id = `imp-${++nextImpulse}`;
        const row = {
          id, tenant_id: values[0], impulse_type: values[1],
          source_entity_type: 'contact', source_entity_id: values[2],
          payload: JSON.parse(values[3] as string), score_revision: values[4],
          score_event_order: values[5], score_dispatched_at: null,
          created_at: '2026-01-01',
        };
        impulses[id] = row;
        return mockRows([row]);
      }
      if (statement.includes('SELECT * FROM impulses WHERE id')) return mockRows([impulses[values[0] as string]]);
      if (statement.includes('SELECT id FROM impulses') && statement.includes('score_dispatched_at IS NULL')) {
        return mockRows(Object.values(impulses)
          .filter(row => row.score_dispatched_at === null)
          .sort((a, b) => Number(a.score_event_order) - Number(b.score_event_order))
          .map(row => ({ id: row.id })));
      }
      if (statement.includes('UPDATE impulses SET score_dispatched_at')) {
        impulses[values[0] as string].score_dispatched_at = '2026-01-01';
        return mockRows([]);
      }
      if (statement.includes('FROM impulse_handlers')) return mockRows([{
        id: `h-${values[1]}`, tenant_id: TENANT_ID, impulse_type: values[1],
        handler_type: 'task_generator', config: {}, enabled: true, priority: 0,
        created_at: 'x', updated_at: 'x',
      }]);
      if (statement.includes('INSERT INTO impulse_acks')) {
        acknowledgments.push(statement.includes("'success'") ? 'success' : 'failed');
        return mockRows([]);
      }
      if (statement.includes('FROM contacts WHERE id = $1')) {
        return mockRows([{ ...namedIdentity('Unknown Person'), linkedin_url: self ? 'self:c1' : namedIdentity('Unknown Person').linkedin_url }]);
      }
      if (statement.includes('SELECT id FROM tasks')) {
        return mockRows(pending.has(values[0] as string) ? [{ id: 'existing' }] : []);
      }
      if (statement.includes('INSERT INTO tasks')) {
        if (pending.has(values[2] as string)) return mockRows([]);
        inserted.push(values);
        pending.add(values[2] as string);
        return statement.includes('RETURNING id') ? mockRows([{ id: 'repair-task' }]) : mockRows([]);
      }
      return mockRows([]);
    }) as typeof mockQuery);

    const { scoreContact } = await import('@/lib/scoring/pipeline');
    await scoreContact('c1');
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    if (enabled) {
      expect(Object.values(impulses)).toHaveLength(3);
      expect(Object.values(impulses).every(row => row.score_dispatched_at !== null &&
        (row.payload as Record<string, unknown>).scoreTasksCommitted === true)).toBe(true);
      expect(acknowledgments).toHaveLength(3);
      expect(acknowledgments.every(status => status === 'success')).toBe(true);
    }

    expect(inserted).toHaveLength(self ? 0 : 1);
    if (!self) {
      expect(inserted[0][0]).toBe('Verify identity for contact');
      expect(inserted[0][2]).toBe('REPAIR_IDENTITY');
      expect(inserted[0][5]).toBe('/contacts/c1');
    }
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

  it('checks U1 task indexes and inserts on the score transaction client', async () => {
    const globalQuery = jest.fn(() => { throw new Error('unexpected second pool connection'); });
    jest.doMock('@/lib/db/client', () => ({ query: globalQuery }));
    const transactionQuery = jest.fn(async (sql: string) => {
      if (sql.includes('FROM contacts WHERE id')) return mockRows([namedIdentity('Ada Lovelace')]);
      if (sql.includes('obj_description(to_regclass')) {
        return mockRows([{ repair_ready: true, recommendation_ready: true }]);
      }
      return mockRows([]);
    });
    const { checkAndGenerateTasks } = await import('@/lib/scoring/task-triggers');
    type CompositeScore = Parameters<typeof checkAndGenerateTasks>[2];
    type ScoreClient = NonNullable<Parameters<typeof checkAndGenerateTasks>[4]>['client'];
    await checkAndGenerateTasks(
      'c1',
      fixedComposite({ tier: 'silver', persona: 'warm-lead' }) as unknown as CompositeScore,
      fixedComposite() as unknown as CompositeScore,
      true,
      { client: { query: transactionQuery } as unknown as ScoreClient, forceInline: true }
    );
    expect(transactionQuery.mock.calls.some(([sql]) => sql.includes('obj_description(to_regclass'))).toBe(true);
    expect(transactionQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO tasks'))).toHaveLength(2);
    expect(globalQuery).not.toHaveBeenCalled();
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
