import { readFile, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { NextRequest } from '../../app/node_modules/next/server';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { query, shutdown } from '@/lib/db/client';
import * as uploadBoundary from '@/lib/import/upload-boundary';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return { ...actual, rm: jest.fn(actual.rm) };
});
jest.mock('@/lib/import/pipeline', () => ({ runImportPipeline: jest.fn().mockResolvedValue({}) }));

const fixtureUrl = process.env.S3_TEST_DATABASE_URL ? new URL(process.env.S3_TEST_DATABASE_URL) : null;
const runWithDisposableDb = !!fixtureUrl && process.env.DATABASE_URL === fixtureUrl.toString()
  && fixtureUrl.hostname === '127.0.0.1' && fixtureUrl.username === 's3test'
  && fixtureUrl.pathname === '/s3_fixture' && !!fixtureUrl.port;
const integration = runWithDisposableDb ? describe : describe.skip;
const origin = 'http://localhost';
const uploadRoot = join(process.cwd(), 'uploads', 'imports');
const previousSecret = process.env.LOCAL_OPERATOR_SECRET;

async function headers(): Promise<Record<string, string>> {
  const session = await createOperatorSession();
  if (!session) throw new Error('Synthetic operator session was not configured');
  return { host: 'localhost', origin, 'sec-fetch-site': 'same-origin',
    cookie: `${OPERATOR_COOKIE}=${session}` };
}

async function uploadRequest(): Promise<NextRequest> {
  const form = new FormData();
  form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
  form.append('files', new File(['two'], 'Messages.csv', { type: 'text/csv' }));
  return new NextRequest(`${origin}/api/import/upload`, {
    method: 'POST', body: form, headers: await headers(),
  });
}

async function csvRequest(id: string): Promise<NextRequest> {
  return new NextRequest(`${origin}/api/import/csv`, {
    method: 'POST', headers: { ...await headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: id, selfContactId: '550e8400-e29b-41d4-a716-446655440000' }),
  });
}

integration('upload and CSV processing with disposable PostgreSQL', () => {
  beforeAll(async () => {
    process.env.LOCAL_OPERATOR_SECRET = 'synthetic-local-operator-secret-1234567890';
    await query(`CREATE TABLE IF NOT EXISTS import_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'pending',
      total_files integer NOT NULL DEFAULT 0, started_at timestamptz, completed_at timestamptz,
      errors jsonb NOT NULL DEFAULT '[]'::jsonb
    )`);
    await query(`CREATE TABLE IF NOT EXISTS import_files (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL,
      created_at timestamptz DEFAULT now()
    )`);
    await query('DELETE FROM import_files');
    await query('DELETE FROM import_sessions');
  });

  afterEach(async () => {
    const sessions = await query<{ id: string }>('SELECT id FROM import_sessions');
    const actualRm = jest.requireActual<typeof import('fs/promises')>('fs/promises').rm;
    for (const { id } of sessions.rows) {
      await actualRm(join(uploadRoot, id), { recursive: true, force: true });
    }
    await query('DELETE FROM import_files');
    await query('DELETE FROM import_sessions');
    jest.mocked(rm).mockReset().mockImplementation(actualRm);
  });

  afterAll(async () => {
    if (previousSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
    else process.env.LOCAL_OPERATOR_SECRET = previousSecret;
    await shutdown();
  });

  it.each([false, true])('rejects failed upload with cleanup failure=%s', async (cleanupFailure) => {
    const { POST: upload } = await import('@/app/api/import/upload/route');
    const { POST: processCsv } = await import('@/app/api/import/csv/route');
    const originalWrite = uploadBoundary.writeCsvFile;
    let writes = 0;
    const writer = jest.spyOn(uploadBoundary, 'writeCsvFile').mockImplementation((file, dir, name) => {
      if (++writes === 2) return Promise.reject(new Error('synthetic second-file failure'));
      return originalWrite(file, dir, name);
    });
    if (cleanupFailure) {
      jest.mocked(rm).mockRejectedValueOnce(new Error('synthetic cleanup failure'))
        .mockRejectedValueOnce(new Error('synthetic cleanup failure'));
    }
    try {
      expect((await upload(await uploadRequest())).status).toBe(500);
      const sessions = await query<{ id: string; status: string }>('SELECT id, status FROM import_sessions');
      expect(sessions.rows).toHaveLength(1);
      const { id, status } = sessions.rows[0];
      expect(status).toBe('failed');
      const directory = join(uploadRoot, id);
      if (cleanupFailure) expect(await readdir(directory)).toHaveLength(1);
      else await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await processCsv(await csvRequest(id))).status).toBe(409);
      const after = await query<{ status: string }>('SELECT status FROM import_sessions WHERE id = $1', [id]);
      expect(after.rows[0].status).toBe('failed');
    } finally {
      writer.mockRestore();
    }
  });

  it('requires the recorded hashes as well as a complete manifest before processing', async () => {
    const { POST: upload } = await import('@/app/api/import/upload/route');
    const { POST: processCsv } = await import('@/app/api/import/csv/route');
    expect((await upload(await uploadRequest())).status).toBe(201);
    const session = await query<{ id: string; status: string; total_files: number }>(
      'SELECT id, status, total_files FROM import_sessions'
    );
    expect(session.rows).toHaveLength(1);
    const { id } = session.rows[0];
    expect(session.rows[0]).toMatchObject({ status: 'pending', total_files: 2 });
    const directory = join(uploadRoot, id);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    const actualRm = jest.requireActual<typeof import('fs/promises')>('fs/promises').rm;
    await actualRm(join(directory, manifest.files[1].name));
    expect((await processCsv(await csvRequest(id))).status).toBe(409);
    expect((await query<{ status: string }>('SELECT status FROM import_sessions WHERE id = $1', [id])).rows[0].status).toBe('pending');
    await writeFile(join(directory, manifest.files[1].name), 'two', { flag: 'wx' });
    await writeFile(join(directory, manifest.files[0].name), 'Xne');
    expect((await processCsv(await csvRequest(id))).status).toBe(409);
    expect((await query<{ status: string }>('SELECT status FROM import_sessions WHERE id = $1', [id])).rows[0].status).toBe('pending');
    await writeFile(join(directory, manifest.files[0].name), 'one');
    expect((await processCsv(await csvRequest(id))).status).toBe(200);
    expect((await query<{ status: string }>('SELECT status FROM import_sessions WHERE id = $1', [id])).rows[0].status).toBe('processing');
  });
});
