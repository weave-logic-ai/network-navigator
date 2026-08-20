// Parser telemetry daily roll-up — ADR-031 Decision point 2.
//
// Covers the pure aggregation math and, specifically, idempotency: running
// the roll-up twice for the same day must produce the same bucket values,
// not doubled counts. That property is the whole point of the job (see
// app/src/lib/parser/rollup.ts).

import {
  aggregateOutcomesForDay,
  defaultRollupDay,
  type RawOutcomeRow,
} from '@/lib/parser/rollup';

const TENANT = '00000000-0000-0000-0000-000000000001';

function row(overrides: Partial<RawOutcomeRow> = {}): RawOutcomeRow {
  return {
    tenant_id: TENANT,
    page_type: 'PROFILE',
    field_name: 'name',
    parser_version: '2.0.0',
    value_present: true,
    confidence: 0.9,
    source: 'selector',
    ...overrides,
  };
}

describe('aggregateOutcomesForDay', () => {
  it('groups by tenant/page_type/field_name/parser_version', () => {
    const buckets = aggregateOutcomesForDay([
      row({ field_name: 'name' }),
      row({ field_name: 'name' }),
      row({ field_name: 'headline' }),
    ]);
    expect(buckets).toHaveLength(2);
    const name = buckets.find((b) => b.fieldName === 'name');
    const headline = buckets.find((b) => b.fieldName === 'headline');
    expect(name?.nSamples).toBe(2);
    expect(headline?.nSamples).toBe(1);
  });

  it('counts n_present only for value_present rows', () => {
    const buckets = aggregateOutcomesForDay([
      row({ value_present: true }),
      row({ value_present: false }),
      row({ value_present: true }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].nSamples).toBe(3);
    expect(buckets[0].nPresent).toBe(2);
  });

  it('averages confidence, ignoring nulls', () => {
    const buckets = aggregateOutcomesForDay([
      row({ confidence: 0.8 }),
      row({ confidence: 1.0 }),
      row({ confidence: null }),
    ]);
    expect(buckets[0].avgConfidence).toBeCloseTo(0.9);
    expect(buckets[0].nSamples).toBe(3);
  });

  it('avgConfidence is null when every row lacks a confidence value', () => {
    const buckets = aggregateOutcomesForDay([
      row({ confidence: null }),
      row({ confidence: null }),
    ]);
    expect(buckets[0].avgConfidence).toBeNull();
  });

  it('builds a source_breakdown keyed by extraction source', () => {
    const buckets = aggregateOutcomesForDay([
      row({ source: 'selector' }),
      row({ source: 'selector' }),
      row({ source: 'fallback' }),
    ]);
    expect(buckets[0].sourceBreakdown).toEqual({ selector: 2, fallback: 1 });
  });

  it('separates buckets by parser_version even for the same field', () => {
    const buckets = aggregateOutcomesForDay([
      row({ parser_version: '2.0.0' }),
      row({ parser_version: '2.1.0' }),
    ]);
    expect(buckets).toHaveLength(2);
  });

  it('separates buckets by tenant_id', () => {
    const otherTenant = '00000000-0000-0000-0000-000000000002';
    const buckets = aggregateOutcomesForDay([
      row({ tenant_id: TENANT }),
      row({ tenant_id: otherTenant }),
    ]);
    expect(buckets).toHaveLength(2);
  });

  it('returns an empty array for no rows', () => {
    expect(aggregateOutcomesForDay([])).toEqual([]);
  });

  it('is idempotent: aggregating the same raw rows twice yields identical buckets, not doubled counts', () => {
    const rawRows = [
      row({ field_name: 'name', value_present: true, confidence: 0.9, source: 'selector' }),
      row({ field_name: 'name', value_present: false, confidence: null, source: 'fallback' }),
      row({ field_name: 'headline', value_present: true, confidence: 0.7, source: 'heuristic' }),
    ];

    const first = aggregateOutcomesForDay(rawRows);
    const second = aggregateOutcomesForDay(rawRows);

    expect(second).toEqual(first);

    const nameBucket = second.find((b) => b.fieldName === 'name');
    // Critically: re-aggregating the SAME raw window must not double
    // n_samples/n_present — this is what the upsert in runParserRollup
    // relies on (DO UPDATE SET n_samples = EXCLUDED.n_samples, not +=).
    expect(nameBucket?.nSamples).toBe(2);
    expect(nameBucket?.nPresent).toBe(1);
  });
});

describe('defaultRollupDay', () => {
  it('returns UTC yesterday as YYYY-MM-DD', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    expect(defaultRollupDay(now)).toBe('2026-08-19');
  });

  it('rolls back across a UTC month boundary', () => {
    const now = new Date('2026-09-01T00:30:00.000Z');
    expect(defaultRollupDay(now)).toBe('2026-08-31');
  });
});

describe('runParserRollup', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('upserts via ON CONFLICT DO UPDATE against the uq_pfod_bucket columns, and re-running the same day produces identical upsert values', async () => {
    jest.resetModules();
    jest.doMock('@/lib/db/client', () => ({
      query: (...args: unknown[]) => mockQuery(...args),
    }));
    const { runParserRollup: run } = await import('@/lib/parser/rollup');

    const rawRows: RawOutcomeRow[] = [
      row({ field_name: 'name', value_present: true, confidence: 0.9, source: 'selector' }),
      row({ field_name: 'name', value_present: true, confidence: 0.8, source: 'selector' }),
    ];

    mockQuery.mockResolvedValue({ rows: rawRows });

    const first = await run('2026-08-19');
    const firstUpsertCall = mockQuery.mock.calls[1]; // [0] = SELECT, [1] = upsert
    expect(firstUpsertCall[0]).toContain('ON CONFLICT (tenant_id, day, page_type, field_name, parser_version)');
    expect(firstUpsertCall[0]).toContain('DO UPDATE SET');
    expect(firstUpsertCall[0]).not.toMatch(/n_samples\s*=\s*.*\+\s*EXCLUDED/); // no accumulation

    mockQuery.mockClear();
    mockQuery.mockResolvedValue({ rows: rawRows });
    const second = await run('2026-08-19');
    const secondUpsertCall = mockQuery.mock.calls[1];

    expect(second).toEqual(first);
    // Same raw data in -> same params out, both times. A buggy incremental
    // implementation would double n_samples/n_present on the second run.
    expect(secondUpsertCall[1]).toEqual(firstUpsertCall[1]);
  });

  it('short-circuits without an upsert when there are no raw rows for the day', async () => {
    jest.resetModules();
    jest.doMock('@/lib/db/client', () => ({
      query: (...args: unknown[]) => mockQuery(...args),
    }));
    const { runParserRollup: run } = await import('@/lib/parser/rollup');

    mockQuery.mockResolvedValue({ rows: [] });
    const result = await run('2026-08-19');

    expect(result.bucketsUpserted).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT, no upsert
  });
});
