// ADR-032 gap 2 — server-side banner dismissal persistence.
//
// Covers:
//   1. conflictFingerprint is order-independent (candidate re-ordering
//      shouldn't invalidate a dismissal).
//   2. dismissBanner upserts on (tenant_id, target_id, field_name).
//   3. listDismissals maps rows correctly.
//   4. clearDismissal issues the expected DELETE.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

import { query } from '@/lib/db/client';
import {
  conflictFingerprint,
  dismissBanner,
  listDismissals,
  clearDismissal,
} from '@/lib/targets/banner-state-service';

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

describe('conflictFingerprint', () => {
  it('is order-independent', () => {
    expect(conflictFingerprint(['b', 'a'])).toBe(conflictFingerprint(['a', 'b']));
  });

  it('changes when the candidate set changes', () => {
    expect(conflictFingerprint(['a', 'b'])).not.toBe(conflictFingerprint(['a', 'c']));
  });

  it('does not mutate its input', () => {
    const input = ['b', 'a'];
    conflictFingerprint(input);
    expect(input).toEqual(['b', 'a']);
  });
});

describe('banner-state-service', () => {
  beforeEach(() => mockQuery.mockReset());

  it('dismissBanner upserts with the tenant/target/field unique key', async () => {
    mockQuery.mockReturnValueOnce(
      mockRows([
        {
          id: 'bs-1',
          tenant_id: 't1',
          target_id: 'target-1',
          field_name: 'title',
          conflict_fingerprint: 'a b',
          dismissed_by_user_id: 'u1',
          dismissed_at: '2026-08-01T00:00:00Z',
        },
      ])
    );

    const result = await dismissBanner('t1', 'target-1', 'title', 'a b', 'u1');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO banner_state/);
    expect(sql).toMatch(/ON CONFLICT \(tenant_id, target_id, field_name\)/);
    expect(params).toEqual(['t1', 'target-1', 'title', 'a b', 'u1']);
    expect(result).toEqual({
      id: 'bs-1',
      tenantId: 't1',
      targetId: 'target-1',
      fieldName: 'title',
      conflictFingerprint: 'a b',
      dismissedByUserId: 'u1',
      dismissedAt: '2026-08-01T00:00:00Z',
    });
  });

  it('listDismissals maps every row for the target', async () => {
    mockQuery.mockReturnValueOnce(
      mockRows([
        {
          id: 'bs-1',
          tenant_id: 't1',
          target_id: 'target-1',
          field_name: 'title',
          conflict_fingerprint: 'a b',
          dismissed_by_user_id: null,
          dismissed_at: '2026-08-01T00:00:00Z',
        },
      ])
    );

    const result = await listDismissals('t1', 'target-1');

    expect(result).toHaveLength(1);
    expect(result[0].fieldName).toBe('title');
    expect(result[0].dismissedByUserId).toBeNull();
  });

  it('clearDismissal issues a DELETE scoped to tenant/target/field', async () => {
    mockQuery.mockReturnValueOnce(mockRows([]));

    await clearDismissal('t1', 'target-1', 'title');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM banner_state/);
    expect(params).toEqual(['t1', 'target-1', 'title']);
  });
});
