// ADR-032 gap 1 — field-override audit trail.
//
// Before this fix, neither `setFieldOverride` nor `clearFieldOverride`
// wrote anything to `causal_nodes`, despite ADR-032 explicitly claiming
// clearing an override is audited via
// `operation='user_override'` / `operation='user_override_cleared'`
// causal nodes. This test pins the fixed behavior: both set and clear now
// write a causal node, keyed on the override's (entityKind, entityId), and
// clearing a field with no active override writes nothing (there is
// nothing to audit).

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

import { query } from '@/lib/db/client';
import {
  setFieldOverride,
  clearFieldOverride,
} from '@/lib/sources/field-override-service';

type QueryMock = jest.MockedFunction<typeof query>;
const mockQuery = query as QueryMock;

function mockRows<T>(rows: T[]) {
  return Promise.resolve({
    rows,
    rowCount: rows.length,
    fields: [],
    command: '',
    oid: 0,
  }) as ReturnType<typeof query>;
}

function overrideRow(partial: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ov-1',
    tenant_id: 't1',
    entity_kind: 'contact',
    entity_id: 'c1',
    field_name: 'title',
    value: 'VP Engineering',
    set_by_user_id: 'u1',
    set_at: '2026-08-01T00:00:00Z',
    cleared_at: null,
    note: null,
    ...partial,
  };
}

describe('field-override-service audit trail', () => {
  beforeEach(() => mockQuery.mockReset());

  it('setFieldOverride writes a user_override causal_node after the insert', async () => {
    // 1st call: UPDATE to clear any prior active row (no rows returned)
    mockQuery.mockReturnValueOnce(mockRows([]));
    // 2nd call: INSERT ... RETURNING *
    mockQuery.mockReturnValueOnce(mockRows([overrideRow()]));
    // 3rd call: createCausalNode's INSERT INTO causal_nodes ... RETURNING *
    mockQuery.mockReturnValueOnce(
      mockRows([
        {
          id: 'cn-1',
          tenant_id: 't1',
          entity_type: 'contact',
          entity_id: 'c1',
          operation: 'user_override',
          inputs: { fieldName: 'title' },
          output: { overrideId: 'ov-1', value: 'VP Engineering', note: null, setByUserId: 'u1' },
          session_id: null,
          created_at: '2026-08-01T00:00:00Z',
        },
      ])
    );

    await setFieldOverride({
      tenantId: 't1',
      entityKind: 'contact',
      entityId: 'c1',
      fieldName: 'title',
      value: 'VP Engineering',
      setByUserId: 'u1',
    });

    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [causalSql, causalParams] = mockQuery.mock.calls[2];
    expect(causalSql).toMatch(/INSERT INTO causal_nodes/);
    // tenant_id, entity_type, entity_id, operation, inputs, output, session_id
    expect(causalParams).toEqual([
      't1',
      'contact',
      'c1',
      'user_override',
      JSON.stringify({ fieldName: 'title' }),
      JSON.stringify({
        overrideId: 'ov-1',
        value: 'VP Engineering',
        note: null,
        setByUserId: 'u1',
      }),
      null,
    ]);
  });

  it('clearFieldOverride writes a user_override_cleared causal_node when a row was cleared', async () => {
    // 1st call: UPDATE ... RETURNING * (the cleared row)
    mockQuery.mockReturnValueOnce(
      mockRows([overrideRow({ cleared_at: '2026-08-02T00:00:00Z', cleared_by_user_id: 'u2' })])
    );
    // 2nd call: createCausalNode's INSERT
    mockQuery.mockReturnValueOnce(
      mockRows([
        {
          id: 'cn-2',
          tenant_id: 't1',
          entity_type: 'contact',
          entity_id: 'c1',
          operation: 'user_override_cleared',
          inputs: {},
          output: {},
          session_id: null,
          created_at: '2026-08-02T00:00:00Z',
        },
      ])
    );

    const result = await clearFieldOverride('t1', 'contact', 'c1', 'title', 'u2');

    expect(result).not.toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [causalSql, causalParams] = mockQuery.mock.calls[1];
    expect(causalSql).toMatch(/INSERT INTO causal_nodes/);
    expect(causalParams).toEqual([
      't1',
      'contact',
      'c1',
      'user_override_cleared',
      JSON.stringify({ fieldName: 'title', overrideId: 'ov-1', clearedValue: 'VP Engineering' }),
      JSON.stringify({ clearedByUserId: 'u2', originallySetByUserId: 'u1' }),
      null,
    ]);
  });

  it('clearFieldOverride writes no causal_node when nothing was active to clear', async () => {
    // UPDATE ... RETURNING * matches zero rows (no active override)
    mockQuery.mockReturnValueOnce(mockRows([]));

    const result = await clearFieldOverride('t1', 'contact', 'c1', 'title', 'u2');

    expect(result).toBeNull();
    // Only the UPDATE ran — no causal_nodes INSERT for a no-op clear.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
