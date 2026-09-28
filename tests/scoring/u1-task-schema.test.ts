jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));

import { query } from '@/lib/db/client';
import { requireIdentityTaskIndexes } from '@/lib/contacts/task-schema';

const mockQuery = query as jest.MockedFunction<typeof query>;

function rows(value: unknown[]) {
  return { rows: value, rowCount: value.length, command: '', oid: 0, fields: [] };
}

beforeEach(() => mockQuery.mockReset());

it('fails with an actionable migration path on an existing unupgraded volume', async () => {
  mockQuery.mockResolvedValueOnce(rows([{ repair_ready: false, recommendation_ready: false }]) as never);
  await expect(requireIdentityTaskIndexes()).rejects.toThrow('056-pending-identity-repair-unique.sql');
});

it('allows generation after both versioned indexes are installed', async () => {
  mockQuery.mockResolvedValueOnce(rows([{ repair_ready: true, recommendation_ready: true }]) as never);
  await expect(requireIdentityTaskIndexes()).resolves.toBeUndefined();
});
