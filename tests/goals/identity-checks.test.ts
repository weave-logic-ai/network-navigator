jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));

import { query } from '@/lib/db/client';
import { relationshipChecks } from '@/lib/goals/checks/relationship-checks';
import { hubChecks } from '@/lib/goals/checks/hub-checks';
import type { GoalCheck, TickContext } from '@/lib/goals/types';

const mockQuery = query as jest.MockedFunction<typeof query>;
const contact = {
  id: 'c1', full_name: 'Ada Lovelace', first_name: null, last_name: null,
  linkedin_url: 'https://www.linkedin.com/in/ada-lovelace/',
  degree: 1, is_archived: false, title: 'Founder',
  connected_days: '2', tier: 'gold', days_since: '45',
  connections_count: 600, last_msg: null, days_dormant: '70',
};

function rows(value: unknown[]) {
  return { rows: value, rowCount: value.length, command: '', oid: 0, fields: [] };
}

const checks: Array<[string, GoalCheck, TickContext]> = [
  ['new connections', relationshipChecks[0], { page: 'contacts' }],
  ['cooling leads', relationshipChecks[1], { page: 'dashboard' }],
  ['unexplored hubs', hubChecks[0], { page: 'network' }],
  ['dormant hubs', hubChecks[1], { page: 'contacts' }],
];

describe.each(checks)('%s goal check', (_label, check, context) => {
  beforeEach(() => mockQuery.mockReset());

  it('retains a valid contact and filters before LIMIT', async () => {
    mockQuery.mockResolvedValueOnce(rows([contact]) as never);
    const result = await check(context);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.suggestedTasks.every((task) => task.contactId === 'c1')).toBe(true);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('c.linkedin_url ~*');
    expect(sql.indexOf('c.linkedin_url ~*')).toBeLessThan(sql.indexOf('LIMIT'));
  });

  it.each([
    ['self marker', { linkedin_url: 'self:c1' }],
    ['unknown name', { full_name: 'Unknown Person' }],
    ['unknown profile', { linkedin_url: 'https://www.linkedin.com/in/unknown' }],
    ['archived', { is_archived: true }],
  ])('does not suggest %s', async (_reason, change) => {
    mockQuery.mockResolvedValueOnce(rows([{ ...contact, ...change }]) as never);
    expect(await check(context)).toEqual([]);
  });
});
