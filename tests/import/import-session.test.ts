import { completeSession } from '@/lib/import/import-session';
import type { PoolClient } from 'pg';

it('persists the final error count alongside errors at completion', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const client = { query } as unknown as PoolClient;
  const errors = [{ file: 'Connections.csv', row: 2, message: 'Bad row' },
    { message: 'Embedding generation failed (non-critical)' }];
  await completeSession(client, 'session-1', 'completed', errors);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining('error_count = CASE WHEN $3::jsonb IS NULL THEN error_count ELSE jsonb_array_length($3::jsonb) END'),
    ['completed', 'session-1', JSON.stringify(errors)]
  );
});
