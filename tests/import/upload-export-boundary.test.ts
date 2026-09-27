import { mkdir, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import {
  boundedBody, containedPath, MAX_FILE_SIZE, storedCsvName, UploadLimitError,
  UploadValidationError, isMultipartFormData, validateCsv, validateCsvBatch, writeCsvFile,
} from '@/lib/import/upload-boundary';
import { escapeCsvField } from '@/lib/import/csv-export';

jest.mock('next/server', () => ({ NextResponse: { json: (data: unknown, init: ResponseInit) => Response.json(data, init) } }), { virtual: true });
jest.mock('@/lib/db/queries/import', () => ({ createImportSession: jest.fn() }));

const sessionId = 'ee32e714-d400-4b39-bcbf-7d37bb084f20';
const directory = join(process.cwd(), 'uploads', 'imports', sessionId);

describe('upload boundary', () => {
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('rejects traversal and control-character filenames without reflecting them', () => {
    expect(() => containedPath(directory, '../escape.csv')).toThrow(UploadLimitError);
    expect(() => validateCsv(new File(['x'], '../private.csv', { type: 'text/csv' }))).toThrow(UploadValidationError);
    expect(() => validateCsv(new File(['x'], 'bad\u0000.csv', { type: 'text/csv' }))).toThrow(UploadValidationError);
    expect(() => validateCsv(new File(['x'], 'okay.csv', { type: 'text/html' }))).toThrow(UploadValidationError);
  });

  it('stores duplicate source names separately with server-generated names and no path response', async () => {
    const { createImportSession } = await import('@/lib/db/queries/import');
    jest.mocked(createImportSession).mockResolvedValue(sessionId);
    const { POST } = await import('@/app/api/import/upload/route');
    const form = new FormData();
    form.append('files', new File(['one'], 'Connections.csv', { type: 'text/csv' }));
    form.append('files', new File(['two'], 'Connections.csv', { type: 'text/csv' }));
    const response = await POST(new Request('http://localhost/api/import/upload', { method: 'POST', body: form }) as never);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ sessionId, files: [expect.stringMatching(/^Connections-[\w-]+\.csv$/), expect.stringMatching(/^Connections-[\w-]+\.csv$/)] });
    expect(body.files[0]).not.toBe(body.files[1]);
    expect((await readdir(directory)).sort()).toEqual([...body.files].sort());
    expect(await readFile(join(directory, body.files[0]), 'utf8')).toBe('one');
    expect(await readFile(join(directory, body.files[1]), 'utf8')).toBe('two');
  });

  it('accepts charset before boundary through the upload route, while rejecting malformed media types', async () => {
    const { createImportSession } = await import('@/lib/db/queries/import');
    jest.mocked(createImportSession).mockResolvedValue(sessionId);
    const { POST } = await import('@/app/api/import/upload/route');
    const form = new FormData();
    form.append('files', new File(['name'], 'Connections.csv', { type: 'text/csv' }));
    const request = new Request('http://localhost/api/import/upload', { method: 'POST', body: form });
    const boundary = request.headers.get('content-type')?.split('boundary=')[1];
    expect(boundary).toBeTruthy();
    request.headers.set('content-type', `multipart/form-data; charset=utf-8; boundary=${boundary}`);
    const response = await POST(request as never);
    expect(response.status).toBe(201);
    expect((await response.json()).files).toHaveLength(1);

    for (const contentType of ['text/plain; boundary=abc', 'multipart/form-data; charset=utf-8', 'multipart/form-data; boundary=', 'multipart/form-data; boundary=bad; bogus', 'multipart/form-data; boundary=one; boundary=two']) {
      expect(isMultipartFormData(contentType)).toBe(false);
      const malformed = new Request('http://localhost/api/import/upload', { method: 'POST', body: new FormData() });
      malformed.headers.set('content-type', contentType);
      expect((await POST(malformed as never)).status).toBe(400);
    }
  });

  it('preserves a late Connections marker through upload and pipeline file-type detection', async () => {
    const { createImportSession } = await import('@/lib/db/queries/import');
    jest.mocked(createImportSession).mockResolvedValue(sessionId);
    const { POST } = await import('@/app/api/import/upload/route');
    const original = `${'x'.repeat(90)}Connections.csv`;
    const form = new FormData();
    form.append('files', new File(['name'], original, { type: 'text/csv' }));
    const response = await POST(new Request('http://localhost/api/import/upload', { method: 'POST', body: form }) as never);
    expect(response.status).toBe(201);
    const { files } = await response.json();
    expect((await readdir(directory))).toEqual(files);
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
});
