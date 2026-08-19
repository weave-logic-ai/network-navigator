// Signal Boost checks (Engine 4): role-change-detected, content-engagement.
// hiring-signal is intentionally not implemented (see signal-checks.ts) — no
// job-posting/hiring-keyword data exists anywhere in the schema.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
}));

import { query } from '@/lib/db/client';
import { signalChecks } from '@/lib/goals/checks/signal-checks';

const mockQuery = query as jest.MockedFunction<typeof query>;
const [roleChangeDetected, contentEngagement] = signalChecks;

function mockRows<T>(rows: T[]): ReturnType<typeof query> {
  return Promise.resolve({ rows, command: '', rowCount: rows.length, oid: 0, fields: [] }) as ReturnType<typeof query>;
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('roleChangeDetected', () => {
  it('returns no candidate when there is no recent title/company change', async () => {
    mockQuery.mockReturnValueOnce(mockRows([]));

    const result = await roleChangeDetected({ page: 'dashboard' });

    expect(result).toEqual([]);
  });

  it('returns no candidate when only the company changed (no new title)', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{
      id: 'c1', name: 'Jane Doe', new_title: null, old_title: null, new_company: 'Acme',
    }]));

    const result = await roleChangeDetected({ page: 'dashboard' });

    expect(result).toEqual([]);
  });

  it('produces a candidate when a contact recently got a new title', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{
      id: 'c1', name: 'Jane Doe', new_title: 'VP Engineering', old_title: 'Director of Engineering', new_company: 'Acme',
    }]));

    const result = await roleChangeDetected({ page: 'dashboard' });

    expect(result).toHaveLength(1);
    expect(result[0].goalType).toBe('role-change-detected');
    expect(result[0].title).toBe('Jane Doe is now VP Engineering at Acme — outreach window');
    expect(result[0].metadata.engine).toBe('signal_boost');
    expect(result[0].metadata.checkType).toBe('role-change-detected');
    expect(result[0].metadata.suggestedTasks).toHaveLength(1);
    expect(result[0].metadata.suggestedTasks[0].contactId).toBe('c1');
  });

  it('queries import_change_log for recent title/company field changes', async () => {
    mockQuery.mockReturnValueOnce(mockRows([]));

    await roleChangeDetected({ page: 'dashboard' });

    const [sql] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/FROM import_change_log/);
    expect(String(sql)).toMatch(/field_changes @> '\["title"\]'/);
  });
});

describe('contentEngagement', () => {
  it('returns no candidate when no contact content matches an offering', async () => {
    mockQuery.mockReturnValueOnce(mockRows([]));

    const result = await contentEngagement({ page: 'contacts' });

    expect(result).toEqual([]);
  });

  it('produces a candidate when a contact posts about offering-aligned topics', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{
      id: 'c1', name: 'Sam Lee', topics: ['automation', 'ai agents'],
      offering_id: 'o1', offering_name: 'Automation Assessment',
    }]));

    const result = await contentEngagement({ page: 'contacts' });

    expect(result).toHaveLength(1);
    expect(result[0].goalType).toBe('content-engagement');
    expect(result[0].title).toBe('Sam Lee is posting about topics that fit "Automation Assessment"');
    expect(result[0].metadata.engine).toBe('signal_boost');
    expect(result[0].metadata.suggestedTasks[0].taskType).toBe('engage_content');
  });
});
