// task-generator handler tests

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));
jest.mock('@/lib/contacts/task-schema', () => ({ requireIdentityTaskIndexes: jest.fn().mockResolvedValue(undefined) }));

import { query } from '@/lib/db/client';
import { executeTaskGenerator } from '@/lib/ecc/impulses/handlers/task-generator';
import type { Impulse } from '@/lib/ecc/types';

const mockQuery = query as jest.MockedFunction<typeof query>;

function mockRows<T>(rows: T[]): ReturnType<typeof query> {
  return Promise.resolve({ rows, command: '', rowCount: rows.length, oid: 0, fields: [] }) as ReturnType<typeof query>;
}

function baseImpulse(overrides: Partial<Impulse> = {}): Impulse {
  return {
    id: 'imp-1', tenantId: 't', impulseType: 'tier_changed',
    sourceEntityType: 'contact', sourceEntityId: 'c1',
    payload: { from: 'silver', to: 'gold' },
    createdAt: '2026-01-01',
    ...overrides,
  };
}

function namedContact(fullName: string) {
  return {
    full_name: fullName,
    first_name: null,
    last_name: null,
    linkedin_url: 'https://www.linkedin.com/in/example/',
    degree: 1,
    is_archived: false,
  };
}

describe('executeTaskGenerator', () => {
  beforeEach(() => mockQuery.mockReset());

  it('creates a SEND_MESSAGE task when tier_changed to gold', async () => {
    mockQuery.mockReturnValueOnce(mockRows([namedContact('Jane Smith')]));
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'created-task' }])); // INSERT ... RETURNING

    const result = await executeTaskGenerator(baseImpulse(), {});
    expect(result).toEqual({ tasksCreated: 1, tasksSkipped: 0 });

    const insertCall = mockQuery.mock.calls[1];
    expect(String(insertCall[0])).toMatch(/INSERT INTO tasks/);
    expect(String(insertCall[0])).toContain('c.linkedin_url ~*');
    const params = insertCall[1] as unknown[];
    expect(params[0]).toContain('Jane Smith');
    expect(params[2]).toBe('SEND_MESSAGE');
    // INSERT positional args: [title, description, taskType, priority, contactId, contactUrl]
    // (status='pending' and source='impulse' are literals in the SQL.)
    expect(params[4]).toBe('c1');
    expect(params[5]).toBe('/contacts/c1');
  });

  it('deduplicates when a pending task already exists', async () => {
    mockQuery.mockReturnValueOnce(mockRows([namedContact('Jane Smith')]));
    mockQuery.mockReturnValueOnce(mockRows([])); // ON CONFLICT DO NOTHING

    const result = await executeTaskGenerator(baseImpulse(), {});
    expect(result).toEqual({ tasksCreated: 0, tasksSkipped: 1 });

    // The atomic INSERT attempts the write; Postgres handles the conflict.
    const inserts = mockQuery.mock.calls.filter(c => String(c[0]).includes('INSERT INTO tasks'));
    expect(inserts).toHaveLength(1);
    expect(String(inserts[0][0])).toContain('ON CONFLICT (contact_id, source, task_type)');
  });

  it('does not regenerate a task from a replayed scoring impulse after the score transaction committed it', async () => {
    const result = await executeTaskGenerator(baseImpulse({
      payload: { from: 'silver', to: 'gold', scoreTasksCommitted: true },
    }), {});
    expect(result).toEqual({ tasksCreated: 0, reason: 'committed_with_score' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('creates RESEARCH task when persona_assigned to buyer', async () => {
    mockQuery.mockReturnValueOnce(mockRows([namedContact('John Buyer')]));
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'created-task' }])); // INSERT ... RETURNING

    const imp = baseImpulse({
      impulseType: 'persona_assigned',
      payload: { to: 'buyer' },
    });
    const result = await executeTaskGenerator(imp, {});
    expect(result.tasksCreated).toBe(1);
    const insertCall = mockQuery.mock.calls[1];
    const params = insertCall[1] as unknown[];
    expect(params[2]).toBe('RESEARCH');
  });

  it('creates warm-introducer task when score_computed referralPersona is warm-introducer', async () => {
    mockQuery.mockReturnValueOnce(mockRows([namedContact('Nora Node')]));
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'created-task' }])); // INSERT ... RETURNING

    const imp = baseImpulse({
      impulseType: 'score_computed',
      payload: { referralPersona: 'warm-introducer' },
    });
    const result = await executeTaskGenerator(imp, {});
    expect(result.tasksCreated).toBe(1);
  });

  it('creates ENGAGE_CONTENT task when behavioralPersona=super-connector', async () => {
    mockQuery.mockReturnValueOnce(mockRows([namedContact('Super C.')]));
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'created-task' }])); // INSERT ... RETURNING

    const imp = baseImpulse({
      impulseType: 'score_computed',
      payload: { behavioralPersona: 'super-connector' },
    });
    const result = await executeTaskGenerator(imp, {});
    expect(result.tasksCreated).toBe(1);
    const insertCall = mockQuery.mock.calls[1];
    const params = insertCall[1] as unknown[];
    expect(params[2]).toBe('ENGAGE_CONTENT');
  });

  it('returns no_matching_rules when impulse type has no task rules', async () => {
    const imp = baseImpulse({ impulseType: 'contact_created', payload: {} });
    const result = await executeTaskGenerator(imp, {});
    expect(result).toEqual({ tasksCreated: 0, reason: 'no_matching_rules' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['tier_changed', { from: 'silver', to: 'gold' }],
    ['persona_assigned', { to: 'buyer' }],
    ['score_computed', { referralPersona: 'warm-introducer', behavioralPersona: 'super-connector' }],
  ])('creates only identity repair for unknown contact on %s', async (impulseType, payload) => {
    mockQuery.mockReturnValueOnce(mockRows([{ ...namedContact('Unknown'), first_name: null }]));
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'repair-task' }]));

    const result = await executeTaskGenerator(baseImpulse({ impulseType, payload }), {});
    expect(result.tasksCreated).toBe(1);
    const insertCall = mockQuery.mock.calls[1];
    const params = insertCall[1] as unknown[];
    expect(params[0]).toBe('Verify identity for contact');
    expect(params[2]).toBe('REPAIR_IDENTITY');
    expect(params[5]).toBe('/contacts/c1');
    expect(mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks'))).toHaveLength(1);
    expect(String(insertCall[0])).toContain('ON CONFLICT (contact_id)');
  });

  it('repairs a named contact with a placeholder profile', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ ...namedContact('Jane Smith'), linkedin_url: 'snippet-created://id' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'repair-task' }]));
    await executeTaskGenerator(baseImpulse(), {});
    expect(mockQuery.mock.calls[1][1]?.[2]).toBe('REPAIR_IDENTITY');
  });

  it('does not generate tasks for self or a missing contact', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ ...namedContact('Owner'), degree: 0 }]));
    expect(await executeTaskGenerator(baseImpulse(), {})).toEqual({ tasksCreated: 0, reason: 'ineligible_contact' });
    mockQuery.mockReturnValueOnce(mockRows([]));
    expect(await executeTaskGenerator(baseImpulse(), {})).toEqual({ tasksCreated: 0, reason: 'ineligible_contact' });
    expect(mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks'))).toHaveLength(0);
  });

  it('recognizes the importer self marker at degree one', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ ...namedContact('Owner'), linkedin_url: 'self:c1' }]));
    expect(await executeTaskGenerator(baseImpulse(), {})).toEqual({ tasksCreated: 0, reason: 'ineligible_contact' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('counts no task when insert-time identity eligibility has changed', async () => {
    mockQuery.mockReturnValueOnce(mockRows([namedContact('Jane Smith')]));
    mockQuery.mockReturnValueOnce(mockRows([])); // guarded INSERT ... SELECT returns nothing
    expect(await executeTaskGenerator(baseImpulse(), {})).toEqual({ tasksCreated: 0, tasksSkipped: 1 });
  });
});
