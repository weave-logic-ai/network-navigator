// POST /api/import/upload - accept multipart CSV file upload

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createImportSession, updateImportSession } from '@/lib/db/queries/import';
import { query } from '@/lib/db/client';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import {
  boundedBody, containedPath, MAX_BODY_SIZE,
  isMultipartFormData, storedCsvName, UploadLimitError, UploadValidationError, validateCsvBatch, writeCsvFile,
} from '@/lib/import/upload-boundary';

const UPLOAD_DIR = join(process.env.NODE_ENV === 'production' ? '/data' : process.cwd(), 'uploads', 'imports');

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  let sessionId: string | undefined;
  let sessionDir: string | undefined;
  let createdSessionDir = false;
  try {
    const contentType = request.headers.get('content-type');
    if (!isMultipartFormData(contentType) || !request.body) {
      return NextResponse.json({ error: 'Multipart CSV upload required' }, { status: 400 });
    }
    const declaredLength = request.headers.get('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_SIZE)) {
      return NextResponse.json({ error: 'Upload body exceeds limit' }, { status: 413 });
    }

    // Next/Undici formData() may buffer multipart parts before exposing file count
    // and sizes. Cap the raw stream first, even without a truthful Content-Length.
    let bodyLimitExceeded = false;
    const boundedRequest = new Request(request.url, {
      method: 'POST', headers: request.headers, body: boundedBody(request.body, MAX_BODY_SIZE, () => { bodyLimitExceeded = true; }), duplex: 'half',
    } as RequestInit);
    let formData: FormData;
    try {
      formData = await boundedRequest.formData();
    } catch {
      if (bodyLimitExceeded) throw new UploadLimitError('Upload body exceeds limit');
      throw new UploadValidationError('Malformed multipart upload');
    }
    const files = formData.getAll('files');

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided. Use "files" field for multipart upload.' },
        { status: 400 }
      );
    }

    const validFiles = validateCsvBatch(files);
    const sourceNames = new Set<string>();
    for (const file of validFiles) {
      const name = file.name.normalize('NFKC').toLowerCase();
      if (sourceNames.has(name)) {
        throw new UploadValidationError('Duplicate CSV filenames are not accepted');
      }
      sourceNames.add(name);
    }

    sessionId = await createImportSession();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
      throw new Error('Invalid generated session ID');
    }
    await mkdir(UPLOAD_DIR, { recursive: true });
    sessionDir = containedPath(UPLOAD_DIR, sessionId);
    await mkdir(sessionDir, { mode: 0o700 });
    createdSessionDir = true;
    const names: string[] = [];
    const manifestFiles: Array<{ name: string; size: number; sha256: string }> = [];
    for (const file of validFiles) {
      const name = storedCsvName(file.name);
      await writeCsvFile(file, sessionDir, name);
      names.push(name);
      manifestFiles.push({ name, size: file.size, sha256: await sha256File(file) });
    }
    await writeFile(containedPath(sessionDir, 'manifest.json'), JSON.stringify({ version: 1, files: manifestFiles }), {
      flag: 'wx', mode: 0o600,
    });
    if (!await updateImportSession(sessionId, { total_files: names.length })) {
      throw new Error('Import session disappeared before upload completed');
    }

    return NextResponse.json(
      { sessionId, files: names },
      { status: 201 }
    );
  } catch (error) {
    // Both cleanup actions are idempotent; attempt both even if one fails.
    const [sessionCleanup, fileCleanup] = await Promise.allSettled([
      sessionId ? updateImportSession(sessionId, {
        status: 'failed', completed_at: new Date(),
        errors: [{ message: 'Upload failed before processing' }],
      }) : Promise.resolve(),
      sessionDir && createdSessionDir ? rm(sessionDir, { recursive: true, force: true }) : Promise.resolve(),
    ]);
    if (sessionCleanup.status === 'rejected' && sessionId) {
      // Roll back a still-pending session if recording failure did not work.
      await query('DELETE FROM import_sessions WHERE id = $1 AND status = $2', [sessionId, 'pending'])
        .catch(() => console.error('Import session cleanup failed'));
    }
    if (fileCleanup.status === 'rejected' && sessionDir && createdSessionDir) {
      await rm(sessionDir, { recursive: true, force: true })
        .catch(() => console.error('Import upload directory cleanup failed'));
    }
    const limit = error instanceof UploadLimitError || (error instanceof Error && error.message.includes('Upload body exceeds limit'));
    const invalid = error instanceof UploadValidationError;
    return NextResponse.json(
      { error: limit ? 'Upload exceeds allowed limits' : invalid ? error.message : 'Upload failed' },
      { status: limit ? 413 : invalid ? 400 : 500 }
    );
  }
}

async function sha256File(file: File): Promise<string> {
  const hash = createHash('sha256');
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return hash.digest('hex');
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
}
