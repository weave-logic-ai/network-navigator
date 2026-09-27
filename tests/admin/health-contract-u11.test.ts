jest.mock('@/lib/db/client', () => ({
  healthCheck: jest.fn(),
  query: jest.fn(),
}));
jest.mock('@/lib/db/queries/enrichment', () => ({ listProviders: jest.fn() }));
jest.mock('@/lib/config/research-flags', () => ({ RESEARCH_FLAGS: { parserTelemetry: true } }));

import { healthCheck, query } from '@/lib/db/client';
import { listProviders } from '@/lib/db/queries/enrichment';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { GET } from '@/app/api/admin/health/route';

const mockHealth = healthCheck as jest.Mock;
const mockQuery = query as jest.Mock;
const mockProviders = listProviders as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  RESEARCH_FLAGS.parserTelemetry = true;
  mockHealth.mockResolvedValue(true);
  mockProviders.mockResolvedValue([{ name: 'Fixture provider', isActive: false }]);
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes('MAX(day)')) return Promise.resolve({ rows: [{ last_rollup_day: null }] });
    if (sql.includes('pg_database_size')) return Promise.resolve({ rows: [{ size_bytes: '1024', size_human: '1024 bytes' }] });
    return Promise.resolve({ rows: [{ count: '2' }] });
  });
});

describe('U11 admin health contract', () => {
  it('returns healthy checks and an explicit empty parser rollup', async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.checks.parser).toEqual({ enabled: true, checked: true, lastRollupDay: null });
    expect(body.checks.providers).toEqual([{ name: 'Fixture provider', active: false }]);
    expect(body.checks.counts.contacts).toBe(2);
  });

  it('keeps a database failure as a readable degraded response', async () => {
    mockHealth.mockResolvedValue(false);
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.db.connected).toBe(false);
    expect(body.checks.parser).toEqual({ enabled: true, checked: false, lastRollupDay: null });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('retains successful checks if provider lookup fails', async () => {
    mockProviders.mockRejectedValue(new Error('provider query failed'));
    const response = await GET();
    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.db.connected).toBe(true);
    expect(body.checks.parser.checked).toBe(false);
    expect(body.error).toContain('provider query failed');
  });

  it('degrades a failed parser check while retaining the connected database detail', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('MAX(day)')) return Promise.reject(new Error('missing telemetry table'));
      return Promise.resolve({ rows: [{ count: '2' }] });
    });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.parser.checked).toBe(true);
    expect(body.checks.parser.error).toContain('rollup status');
  });

  it('reports the last recorded rollup day without implying a scheduler', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('MAX(day)')) return Promise.resolve({ rows: [{ last_rollup_day: '2026-09-25' }] });
      return Promise.resolve({ rows: [{ count: '2' }] });
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).checks.parser).toEqual({ enabled: true, checked: true, lastRollupDay: '2026-09-25' });
  });

  it('reports parser telemetry as disabled without querying its table', async () => {
    RESEARCH_FLAGS.parserTelemetry = false;
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.checks.parser).toEqual({ enabled: false, checked: false, lastRollupDay: null });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('MAX(day)'))).toBe(false);
  });
});
