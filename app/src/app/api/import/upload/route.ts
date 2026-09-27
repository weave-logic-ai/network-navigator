// POST /api/import/upload - accept multipart CSV file upload

import { NextRequest, NextResponse } from 'next/server';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { createImportSession } from '@/lib/db/queries/import';
import {
  boundedBody, containedPath, MAX_BODY_SIZE,
  isMultipartFormData, storedCsvName, UploadLimitError, UploadValidationError, validateCsvBatch, writeCsvFile,
} from '@/lib/import/upload-boundary';

const UPLOAD_DIR = join(process.env.NODE_ENV === 'production' ? '/data' : process.cwd(), 'uploads', 'imports');

export async function POST(request: NextRequest) {
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

    const sessionId = await createImportSession();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
      throw new Error('Invalid generated session ID');
    }
    await mkdir(UPLOAD_DIR, { recursive: true });
    sessionDir = containedPath(UPLOAD_DIR, sessionId);
    await mkdir(sessionDir, { mode: 0o700 });
    createdSessionDir = true;
    const names: string[] = [];
    for (const file of validFiles) {
      const name = storedCsvName(file.name);
      await writeCsvFile(file, sessionDir, name);
      names.push(name);
    }

    return NextResponse.json(
      { sessionId, files: names },
      { status: 201 }
    );
  } catch (error) {
    if (sessionDir && createdSessionDir) await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
    const limit = error instanceof UploadLimitError || (error instanceof Error && error.message.includes('Upload body exceeds limit'));
    const invalid = error instanceof UploadValidationError;
    return NextResponse.json(
      { error: limit ? 'Upload exceeds allowed limits' : invalid ? error.message : 'Upload failed' },
      { status: limit ? 413 : invalid ? 400 : 500 }
    );
  }
}
