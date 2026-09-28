// POST /api/import/csv - trigger CSV processing for a session

import { NextRequest, NextResponse } from 'next/server';
import { lstat, open, readFile, readdir } from 'fs/promises';
import { constants } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { getPool } from '@/lib/db/client';
import { getImportSession, updateImportSession } from '@/lib/db/queries/import';
import { runImportPipeline } from '@/lib/import/pipeline';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { boundedBody, containedPath, MAX_FILES, MAX_FILE_SIZE, MAX_TOTAL_SIZE } from '@/lib/import/upload-boundary';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CSV_BODY_SIZE = 16 * 1024;
const UPLOAD_DIR = join(process.env.NODE_ENV === 'production' ? '/data' : process.cwd(), 'uploads', 'imports');
interface VerifiedCsvFile { path: string; bytes: Buffer; sha256: string }

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  try {
    const declaredLength = request.headers.get('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_CSV_BODY_SIZE)) {
      return NextResponse.json({ error: 'CSV processing request exceeds limit' }, { status: 413 });
    }
    if (!request.body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
    let bodyLimitExceeded = false;
    const boundedRequest = new Request(request.url, {
      method: 'POST', headers: request.headers,
      body: boundedBody(request.body, MAX_CSV_BODY_SIZE, () => { bodyLimitExceeded = true; }),
      duplex: 'half',
    } as RequestInit);
    let body: unknown;
    try {
      body = await boundedRequest.json();
    } catch {
      return NextResponse.json(
        { error: bodyLimitExceeded ? 'CSV processing request exceeds limit' : 'Malformed JSON body' },
        { status: bodyLimitExceeded ? 413 : 400 }
      );
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'JSON object required' }, { status: 400 });
    }
    const { sessionId, selfContactId, selfName } = body as Record<string, unknown>;

    if (typeof sessionId !== 'string' || !UUID_REGEX.test(sessionId)) {
      return NextResponse.json(
        { error: 'Valid sessionId (UUID) is required' },
        { status: 400 }
      );
    }

    if (typeof selfContactId !== 'string' || !UUID_REGEX.test(selfContactId)) {
      return NextResponse.json(
        { error: 'Valid selfContactId (UUID) is required' },
        { status: 400 }
      );
    }
    if (selfName !== undefined && typeof selfName !== 'string') {
      return NextResponse.json({ error: 'selfName must be a string' }, { status: 400 });
    }

    // Verify session exists
    const session = await getImportSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Import session not found' },
        { status: 404 }
      );
    }

    if (session.session.status !== 'pending') {
      return NextResponse.json(
        { error: 'Import session is not pending' },
        { status: 409 }
      );
    }

    const sessionDir = join(UPLOAD_DIR, sessionId);
    const verifiedFiles = await verifiedUploadFiles(sessionDir, session.session.total_files);
    if (!verifiedFiles) {
      return NextResponse.json(
        { error: 'Import upload is incomplete' },
        { status: 409 }
      );
    }
    const filePaths = verifiedFiles.map(file => file.path);
    const snapshots = new Map(verifiedFiles.map(file => [file.path, { bytes: file.bytes, sha256: file.sha256 }]));

    const pool = getPool();
    const client = await pool.connect();
    try {
      const transitioned = await client.query<{ id: string }>(
        `UPDATE import_sessions SET status = 'processing', started_at = $2
         WHERE id = $1 AND status = 'pending' AND total_files = $3 RETURNING id`,
        [sessionId, new Date(), filePaths.length]
      );
      if (transitioned.rows.length !== 1) {
        client.release();
        return NextResponse.json({ error: 'Import session is not pending' }, { status: 409 });
      }
    } catch (error) {
      client.release();
      throw error;
    }

    // Fire-and-forget: process in background
    (async () => {
      try {
        await runImportPipeline(client, filePaths, selfContactId, selfName || '', sessionId, snapshots);
      } catch (err) {
        await updateImportSession(sessionId, {
          status: 'failed',
          completed_at: new Date(),
          errors: [{ message: err instanceof Error ? err.message : 'Processing failed' }],
        });
      } finally {
        client.release();
      }
    })();

    return NextResponse.json({
      sessionId,
      status: 'processing',
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to start processing', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

async function verifiedUploadFiles(directory: string, expectedCount: number): Promise<VerifiedCsvFile[] | null> {
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > MAX_FILES) return null;
  try {
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return null;
    const manifestPath = containedPath(directory, 'manifest.json');
    const manifestStat = await lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 4096) return null;
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || !('version' in manifest) || manifest.version !== 1
      || !('files' in manifest) || !Array.isArray(manifest.files) || manifest.files.length !== expectedCount) return null;

    const names = new Set<string>();
    const files: VerifiedCsvFile[] = [];
    let totalSize = 0;
    for (const entry of manifest.files) {
      if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string'
        || !/^[A-Za-z0-9_-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv$/.test(entry.name)
        || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_SIZE
        || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)
        || names.has(entry.name)) return null;
      names.add(entry.name);
      totalSize += entry.size;
      if (totalSize > MAX_TOTAL_SIZE) return null;
      const path = containedPath(directory, entry.name);
      const bytes = await readSnapshot(path, entry.size);
      if (!bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) return null;
      files.push({ path, bytes, sha256: entry.sha256 });
    }
    const actualNames = await readdir(directory);
    if (actualNames.length !== names.size + 1 || !actualNames.includes('manifest.json')
      || actualNames.some(name => name !== 'manifest.json' && !names.has(name))) return null;
    return files;
  } catch {
    return null;
  }
}

async function readSnapshot(path: string, expectedSize: number): Promise<Buffer | null> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== expectedSize) return null;
    const bytes = Buffer.alloc(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const result = await handle.read(bytes, offset, expectedSize - offset, offset);
      if (result.bytesRead === 0) return null;
      offset += result.bytesRead;
    }
    const trailing = Buffer.alloc(1);
    if ((await handle.read(trailing, 0, 1, expectedSize)).bytesRead !== 0) return null;
    return bytes;
  } finally {
    await handle.close();
  }
}
