import { mkdir, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { NextRequest } from '../../app/node_modules/next/server';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import * as uploadBoundary from '@/lib/import/upload-boundary';
import {
  boundedBody, containedPath, MAX_BODY_SIZE, MAX_FILE_SIZE, storedCsvName, UploadLimitError,
  UploadValidationError, isMultipartFormData, validateCsv, validateCsvBatch, writeCsvFile,
} from '@/lib/import/upload-boundary';
import { escapeCsvField } from '@/lib/import/csv-export';

jest.mock('@/lib/db/queries/import', () => ({ createImportSession: jest.fn(), updateImportSession: jest.fn(), getImportSession: jest.fn() }));
jest.mock('@/lib/db/client', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return { ...actual, rm: jest.fn(actual.rm) };
});

const sessionId = 'ee32e714-d400-4b39-bcbf-7d37bb084f20';
const directory = join(process.cwd(), 'uploads', 'imports', sessionId);
const localOrigin = 'http://localhost';
const syntheticSecret = 'synthetic-local-operator-secret-1234567890';
const previousSecret = process.env.LOCAL_OPERATOR_SECRET;

async function signedHeaders(): Promise<Record<string, string>> {
  const session = await createOperatorSession();
  if (!session) throw new Error('Synthetic operator session was not configured');
  return { cookie: `${OPERATOR_COOKIE}=${session}` };
}

async function uploadRequest(form: FormData, headers: Record<string, string> = {}): Promise<NextRequest> {
  return new NextRequest(`${localOrigin}/api/import/upload`, {
    method: 'POST', body: form,
    headers: { host: 'localhost', origin: localOrigin, 'sec-fetch-site': 'same-origin', ...await signedHeaders(), ...headers },
  });
}

async function exportRequest(headers: Record<string, string> = {}): Promise<NextRequest> {
  return new NextRequest(`${localOrigin}/api/admin/export`, {
    headers: { host: 'localhost', origin: localOrigin, 'sec-fetch-site': 'same-origin', ...await signedHeaders(), ...headers },
  });
}

async function csvRequest(id = sessionId): Promise<NextRequest> {
  return new NextRequest(`${localOrigin}/api/import/csv`, {
    method: 'POST', body: JSON.stringify({ sessionId: id, selfContactId: '550e8400-e29b-41d4-a716-446655440000' }),
    headers: { host: 'localhost', origin: localOrigin, 'sec-fetch-site': 'same-origin',
      'content-type': 'application/json', ...await signedHeaders() },
  });
}

beforeAll(() => { process.env.LOCAL_OPERATOR_SECRET = syntheticSecret; });
beforeEach(async () => {
  const { createImportSession, updateImportSession, getImportSession } = await import('@/lib/db/queries/import');
  jest.mocked(createImportSession).mockReset().mockResolvedValue(sessionId);
  jest.mocked(updateImportSession).mockReset().mockResolvedValue({} as never);
  jest.mocked(getImportSession).mockReset();
  const { query, getPool } = await import('@/lib/db/client');
  jest.mocked(query).mockReset();
  jest.mocked(getPool).mockReset();
});
afterAll(() => {
  if (previousSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
  else process.env.LOCAL_OPERATOR_SECRET = previousSecret;
});

describe('upload boundary', () => {
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('denies missing, stale and foreign-origin sessions before either handler has effects', async () => {
    const { POST } = await import('@/app/api/import/upload/route');
    const { GET } = await import('@/app/api/admin/export/route');
    const { createImportSession } = await import('@/lib/db/queries/import');
    const { query } = await import('@/lib/db/client');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() - 9 * 60 * 60 * 1000);
    const stale = await createOperatorSession();
    clock.mockRestore();
    const deniedHeaders = [
      { cookie: '' },
      { cookie: `${OPERATOR_COOKIE}=${stale}` },
      { origin: 'https://foreign.example', 'sec-fetch-site': 'cross-site' },
    ];
    for (const [index, headers] of deniedHeaders.entries()) {
      const form = new FormData();
      form.append('files', new File(['x'], 'Connections.csv', { type: 'text/csv' }));
      expect((await POST(await uploadRequest(form, headers))).status).toBe(index === 2 ? 403 : 401);
      expect((await GET(await exportRequest(headers))).status).toBe(index === 2 ? 403 : 401);
    }
    expect(createImportSession).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects traversal and control-character filenames without reflecting them', () => {
    expect(() => containedPath(directory, '../escape.csv')).toThrow(UploadLimitError);
    expect(() => validateCsv(new File(['x'], '../private.csv', { type: 'text/csv' }))).toThrow(UploadValidationError);
    expect(() => validateCsv(new File(['x'], 'bad\u0000.csv', { type: 'text/csv' }))).toThrow(UploadValidationError);
    expect(() => validateCsv(new File(['x'], 'okay.csv', { type: 'text/html' }))).toThrow(UploadValidationError);
  });

  it('stores distinct source names with server-generated names and no path response', async () => {
    const { createImportSession } = await import('@/lib/db/queries/import');
    jest.mocked(createImportSession).mockResolvedValue(sessionId);
    const { POST } = await import('@/app/api/import/upload/route');
    const form = new FormData();
    form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
    form.append('files', new File(['two'], 'Messages.csv', { type: 'text/csv' }));
    const response = await POST(await uploadRequest(form));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ sessionId, files: [expect.stringMatching(/^Connections-[\w-]+\.csv$/), expect.stringMatching(/^Messages-[\w-]+\.csv$/)] });
    expect(body.files[0]).not.toBe(body.files[1]);
    expect((await readdir(directory)).sort()).toEqual([...body.files, 'manifest.json'].sort());
    expect(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))).toEqual({
      version: 1, files: [
        { name: body.files[0], size: 3, sha256: createHash('sha256').update('one').digest('hex') },
        { name: body.files[1], size: 3, sha256: createHash('sha256').update('two').digest('hex') },
      ],
    });
    expect(await readFile(join(directory, body.files[0]), 'utf8')).toBe('one');
    expect(await readFile(join(directory, body.files[1]), 'utf8')).toBe('two');
  });

  it('rejects duplicate source names before creating a session or writing files', async () => {
    const { createImportSession } = await import('@/lib/db/queries/import');
    jest.mocked(createImportSession).mockClear();
    const { POST } = await import('@/app/api/import/upload/route');
    const form = new FormData();
    form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
    form.append('files', new File(['two'], 'CONNECTIONS.CSV', { type: 'text/csv' }));
    const response = await POST(await uploadRequest(form));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Duplicate CSV filenames are not accepted' });
    expect(createImportSession).not.toHaveBeenCalled();
  });

  it('marks the session failed and removes the first file when the second write fails', async () => {
    const { POST } = await import('@/app/api/import/upload/route');
    const { POST: processCsv } = await import('@/app/api/import/csv/route');
    const { createImportSession, updateImportSession, getImportSession } = await import('@/lib/db/queries/import');
    const { getPool } = await import('@/lib/db/client');
    let dbStatus = 'absent';
    jest.mocked(createImportSession).mockImplementation(async () => {
      dbStatus = 'pending';
      return sessionId;
    });
    jest.mocked(updateImportSession).mockImplementation(async (_id, data) => {
      dbStatus = data.status ?? dbStatus;
      return {} as never;
    });
    jest.mocked(getImportSession).mockImplementation(async () => ({
      session: { status: dbStatus, total_files: 0 }, files: [],
    } as never));
    const originalWrite = uploadBoundary.writeCsvFile;
    let writes = 0;
    const writer = jest.spyOn(uploadBoundary, 'writeCsvFile').mockImplementation((file, dir, name) => {
      if (++writes === 2) return Promise.reject(new Error('synthetic disk failure'));
      return originalWrite(file, dir, name);
    });
    try {
      const form = new FormData();
      form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
      form.append('files', new File(['two'], 'Messages.csv', { type: 'text/csv' }));
      const response = await POST(await uploadRequest(form));
      expect(response.status).toBe(500);
      expect(writes).toBe(2);
      expect(updateImportSession).toHaveBeenCalledWith(sessionId, expect.objectContaining({
        status: 'failed', completed_at: expect.any(Date),
      }));
      expect(dbStatus).toBe('failed');
      await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await processCsv(await csvRequest())).status).toBe(409);
      expect(dbStatus).toBe('failed');
      expect(getPool).not.toHaveBeenCalled();
    } finally {
      writer.mockRestore();
    }
  });

  it('rejects a failed session even when both directory cleanup attempts leave a partial file', async () => {
    const { POST } = await import('@/app/api/import/upload/route');
    const { POST: processCsv } = await import('@/app/api/import/csv/route');
    const { getImportSession, updateImportSession } = await import('@/lib/db/queries/import');
    const { getPool } = await import('@/lib/db/client');
    jest.mocked(getImportSession).mockResolvedValue({
      session: { status: 'failed', total_files: 0 }, files: [],
    } as never);
    const originalWrite = uploadBoundary.writeCsvFile;
    let writes = 0;
    const writer = jest.spyOn(uploadBoundary, 'writeCsvFile').mockImplementation((file, dir, name) => {
      if (++writes === 2) return Promise.reject(new Error('synthetic disk failure'));
      return originalWrite(file, dir, name);
    });
    const remover = jest.mocked(rm);
    remover.mockRejectedValueOnce(new Error('synthetic cleanup failure'))
      .mockRejectedValueOnce(new Error('synthetic cleanup failure'));
    try {
      const form = new FormData();
      form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
      form.append('files', new File(['two'], 'Messages.csv', { type: 'text/csv' }));
      expect((await POST(await uploadRequest(form))).status).toBe(500);
      expect(updateImportSession).toHaveBeenCalledWith(sessionId, expect.objectContaining({ status: 'failed' }));
      expect(await readdir(directory)).toHaveLength(1);
      expect((await processCsv(await csvRequest())).status).toBe(409);
      expect(getPool).not.toHaveBeenCalled();
    } finally {
      writer.mockRestore();
      remover.mockReset().mockImplementation(jest.requireActual('fs/promises').rm);
    }
  });

  it('deletes a pending session if marking it failed also fails', async () => {
    const { POST } = await import('@/app/api/import/upload/route');
    const { updateImportSession } = await import('@/lib/db/queries/import');
    const { query } = await import('@/lib/db/client');
    jest.mocked(updateImportSession).mockRejectedValueOnce(new Error('synthetic update failure'));
    jest.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    const originalWrite = uploadBoundary.writeCsvFile;
    let writes = 0;
    const writer = jest.spyOn(uploadBoundary, 'writeCsvFile').mockImplementation((file, dir, name) => {
      if (++writes === 2) return Promise.reject(new Error('synthetic disk failure'));
      return originalWrite(file, dir, name);
    });
    try {
      const form = new FormData();
      form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
      form.append('files', new File(['two'], 'Messages.csv', { type: 'text/csv' }));
      expect((await POST(await uploadRequest(form))).status).toBe(500);
      expect(query).toHaveBeenCalledWith(
        'DELETE FROM import_sessions WHERE id = $1 AND status = $2', [sessionId, 'pending']
      );
      await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      writer.mockRestore();
    }
  });

  it('rejects a pending session with a missing manifest file before changing its state', async () => {
    const { POST: upload } = await import('@/app/api/import/upload/route');
    const { POST: processCsv } = await import('@/app/api/import/csv/route');
    const { getImportSession, updateImportSession } = await import('@/lib/db/queries/import');
    const { getPool } = await import('@/lib/db/client');
    const form = new FormData();
    form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
    form.append('files', new File(['two'], 'Messages.csv', { type: 'text/csv' }));
    const uploaded = await upload(await uploadRequest(form));
    expect(uploaded.status).toBe(201);
    const { files } = await uploaded.json();
    jest.mocked(getImportSession).mockResolvedValue({
      session: { status: 'pending', total_files: 2 }, files: [],
    } as never);
    await rm(join(directory, files[1]));
    expect((await processCsv(await csvRequest())).status).toBe(409);
    expect(updateImportSession).toHaveBeenCalledTimes(1);
    expect(updateImportSession).toHaveBeenCalledWith(sessionId, { total_files: 2 });
    expect(getPool).not.toHaveBeenCalled();
  });

  it('moves a complete signed upload from pending to processing once', async () => {
    const { POST: upload } = await import('@/app/api/import/upload/route');
    const { POST: processCsv } = await import('@/app/api/import/csv/route');
    const { getImportSession } = await import('@/lib/db/queries/import');
    const { getPool } = await import('@/lib/db/client');
    const pipeline = await import('@/lib/import/pipeline');
    const run = jest.spyOn(pipeline, 'runImportPipeline').mockResolvedValue({} as never);
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: sessionId }] }), release: jest.fn() };
    jest.mocked(getPool).mockReturnValue({ connect: jest.fn().mockResolvedValue(client) } as never);
    jest.mocked(getImportSession).mockResolvedValue({
      session: { status: 'pending', total_files: 1 }, files: [],
    } as never);
    try {
      const form = new FormData();
      form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
      expect((await upload(await uploadRequest(form))).status).toBe(201);
      expect((await processCsv(await csvRequest())).status).toBe(200);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = $1 AND status = 'pending' AND total_files = $3"),
        [sessionId, expect.any(Date), 1]
      );
      expect(run).toHaveBeenCalledWith(client, [expect.stringMatching(/Connections-[\w-]+\.csv$/)],
        '550e8400-e29b-41d4-a716-446655440000', '', sessionId, expect.any(Map));
      const snapshots = jest.mocked(run).mock.calls[0][5]!;
      const snapshot = [...snapshots.values()][0];
      expect(snapshot.bytes.toString('utf8')).toBe('one');
      expect(snapshot.sha256).toBe(createHash('sha256').update('one').digest('hex'));
      await Promise.resolve();
      expect(client.release).toHaveBeenCalledTimes(1);
    } finally {
      run.mockRestore();
    }
  });

  it('rejects traversal and control names through the upload handler', async () => {
    const { POST } = await import('@/app/api/import/upload/route');
    for (const name of ['../../name.csv', 'bad\u0001.csv']) {
      const form = new FormData();
      form.append('files', new File(['one'], name, { type: 'text/csv' }));
      const response = await POST(await uploadRequest(form));
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain(name);
    }
  });

  it('enforces declared length and file count through the upload handler', async () => {
    const { POST } = await import('@/app/api/import/upload/route');
    const tooLarge = await uploadRequest(new FormData());
    tooLarge.headers.set('content-length', String(102 * 1024 * 1024));
    expect((await POST(tooLarge)).status).toBe(413);

    const form = new FormData();
    for (let i = 0; i < 11; i++) form.append('files', new File(['x'], `${i}.csv`, { type: 'text/csv' }));
    expect((await POST(await uploadRequest(form))).status).toBe(413);
  });

  it('accepts charset before boundary through the upload route, while rejecting malformed media types', async () => {
    const { createImportSession } = await import('@/lib/db/queries/import');
    jest.mocked(createImportSession).mockResolvedValue(sessionId);
    const { POST } = await import('@/app/api/import/upload/route');
    const form = new FormData();
    form.append('files', new File(['name'], 'Connections.csv', { type: 'text/csv' }));
    const request = await uploadRequest(form);
    const boundary = request.headers.get('content-type')?.split('boundary=')[1];
    expect(boundary).toBeTruthy();
    request.headers.set('content-type', `multipart/form-data; charset=utf-8; boundary=${boundary}`);
    const response = await POST(request);
    expect(response.status).toBe(201);
    expect((await response.json()).files).toHaveLength(1);

    for (const contentType of ['text/plain; boundary=abc', 'multipart/form-data; charset=utf-8', 'multipart/form-data; boundary=', 'multipart/form-data; boundary=bad; bogus', 'multipart/form-data; boundary=one; boundary=two']) {
      expect(isMultipartFormData(contentType)).toBe(false);
      const malformed = await uploadRequest(new FormData());
      malformed.headers.set('content-type', contentType);
      expect((await POST(malformed)).status).toBe(400);
    }
  });

  it('preserves a late Connections marker through upload and pipeline file-type detection', async () => {
    const { createImportSession } = await import('@/lib/db/queries/import');
    jest.mocked(createImportSession).mockResolvedValue(sessionId);
    const { POST } = await import('@/app/api/import/upload/route');
    const original = `${'x'.repeat(90)}Connections.csv`;
    const form = new FormData();
    form.append('files', new File(['name'], original, { type: 'text/csv' }));
    const response = await POST(await uploadRequest(form));
    expect(response.status).toBe(201);
    const { files } = await response.json();
    expect((await readdir(directory)).sort()).toEqual([...files, 'manifest.json'].sort());
    const { detectFileType } = await import('@/lib/import/pipeline');
    expect(detectFileType(files[0])).toBe('connections');
  });

  it('cuts off an oversized chunked body even without Content-Length', async () => {
    const chunks = [new Uint8Array(4), new Uint8Array(4)];
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    } });
    const reader = boundedBody(stream, 7).getReader();
    expect((await reader.read()).value).toHaveLength(4);
    await expect(reader.read()).rejects.toThrow('Upload body exceeds limit');
  });

  it('returns 413 from the upload handler for an oversized chunked body without Content-Length', async () => {
    const { POST } = await import('@/app/api/import/upload/route');
    const { createImportSession } = await import('@/lib/db/queries/import');
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulls++ === 0) controller.enqueue(new Uint8Array(1));
      else if (pulls === 2) controller.enqueue(new Uint8Array(MAX_BODY_SIZE));
      else controller.close();
    } });
    const request = new NextRequest(`${localOrigin}/api/import/upload`, {
      method: 'POST', body: stream, duplex: 'half',
      headers: { host: 'localhost', origin: localOrigin, 'sec-fetch-site': 'same-origin',
        'content-type': 'multipart/form-data; boundary=synthetic', ...await signedHeaders() },
    } as RequestInit & { duplex: 'half' });
    expect(request.headers.get('content-length')).toBeNull();
    expect((await POST(request)).status).toBe(413);
    expect(createImportSession).not.toHaveBeenCalled();
  });

  it('returns 413 from the CSV processing handler for an oversized chunked JSON body', async () => {
    const { POST } = await import('@/app/api/import/csv/route');
    const { getImportSession } = await import('@/lib/db/queries/import');
    const { getPool } = await import('@/lib/db/client');
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('{'));
      else if (pulls === 2) controller.enqueue(new Uint8Array(16 * 1024));
      else controller.close();
    } });
    const request = new NextRequest(`${localOrigin}/api/import/csv`, {
      method: 'POST', body: stream, duplex: 'half',
      headers: { host: 'localhost', origin: localOrigin, 'sec-fetch-site': 'same-origin',
        'content-type': 'application/json', ...await signedHeaders() },
    } as RequestInit & { duplex: 'half' });
    expect(request.headers.get('content-length')).toBeNull();
    expect((await POST(request)).status).toBe(413);
    expect(getImportSession).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
  });

  it('keeps generated names inside their session directory', () => {
    const name = storedCsvName('Connections.csv');
    expect(containedPath(directory, name)).toBe(join(directory, name));
  });

  it('rejects file count, file size and aggregate size before writing', () => {
    const csv = () => new File(['x'], 'Connections.csv', { type: 'text/csv' });
    expect(() => validateCsvBatch(Array.from({ length: 11 }, csv))).toThrow(UploadLimitError);
    const oversized = csv();
    Object.defineProperty(oversized, 'size', { value: MAX_FILE_SIZE + 1 });
    expect(() => validateCsvBatch([oversized])).toThrow(UploadLimitError);
    const largeFiles = [csv(), csv(), csv()];
    for (const file of largeFiles) Object.defineProperty(file, 'size', { value: 40 * 1024 * 1024 });
    expect(() => validateCsvBatch(largeFiles)).toThrow(UploadLimitError);
  });

  it('uses exclusive writes so a duplicate destination cannot overwrite data', async () => {
    await mkdir(directory, { recursive: true });
    const name = storedCsvName('Connections.csv');
    await writeCsvFile(new File(['original'], 'Connections.csv'), directory, name);
    await expect(writeCsvFile(new File(['replacement'], 'Connections.csv'), directory, name)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(directory, name), 'utf8')).toBe('original');
  });
});

describe('CSV export cells', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-1+2', '@cmd', ' \t=1', '\u0000=1', '\uFEFF=1', '\r\n=1'])(
    'neutralizes formula prefix %j', (input) => {
      expect(escapeCsvField(input)).toBe(input.includes('\r') || input.includes('\n') ? `"'${input}"` : `'${input}`);
    }
  );

  it('keeps CSV quote and comma escaping intact', () => {
    expect(escapeCsvField('=HYPERLINK("x,y")')).toBe('"\'=HYPERLINK(""x,y"")"');
    expect(escapeCsvField('ordinary, "text"')).toBe('"ordinary, ""text"""');
  });

  it('neutralizes formula cells in the actual export response', async () => {
    const { query } = await import('@/lib/db/client');
    jest.mocked(query).mockResolvedValueOnce({ rows: [{
      full_name: '=HYPERLINK("https://example.test","open")', first_name: 'Normal', last_name: null,
      email: '\t@cmd', phone: null, title: '+SUM(A1:A2)', current_company: '-1+2',
      location: ' ordinary', linkedin_url: 'https://example.test/profile', composite_score: 12,
      tier: 'A', persona: null, tags: ['=cmd', 'safe'],
    }] } as never);
    const { GET } = await import('@/app/api/admin/export/route');
    const response = await GET(await exportRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const csv = await response.text();
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"",""open"")"');
    expect(csv).toContain("'\t@cmd");
    expect(csv).toContain("'+SUM(A1:A2)");
    expect(csv).toContain("'-1+2");
    expect(csv).toContain("'=cmd; safe");
    expect(csv).toContain('Normal');
  });
});
