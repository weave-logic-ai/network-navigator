// POST /api/import/csv - trigger CSV processing for a session

import { NextRequest, NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { getPool } from '@/lib/db/client';
import { getImportSession, updateImportSession } from '@/lib/db/queries/import';
import { runImportPipeline } from '@/lib/import/pipeline';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_DIR = join(process.env.NODE_ENV === 'production' ? '/data' : process.cwd(), 'uploads', 'imports');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, selfContactId, selfName } = body;

    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return NextResponse.json(
        { error: 'Valid sessionId (UUID) is required' },
        { status: 400 }
      );
    }

    if (!selfContactId || !UUID_REGEX.test(selfContactId)) {
      return NextResponse.json(
        { error: 'Valid selfContactId (UUID) is required' },
        { status: 400 }
      );
    }

    // Verify session exists
    const session = await getImportSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Import session not found' },
        { status: 404 }
      );
    }

    if (session.session.status === 'processing') {
      return NextResponse.json(
        { error: 'Session is already being processed' },
        { status: 409 }
      );
    }

    // Mark as processing
    await updateImportSession(sessionId, {
      status: 'processing',
      started_at: new Date(),
    });

    // Get file paths
    const sessionDir = join(UPLOAD_DIR, sessionId);
    let fileNames: string[];
    try {
      fileNames = await readdir(sessionDir);
    } catch {
      return NextResponse.json(
        { error: 'No uploaded files found for this session' },
        { status: 404 }
      );
    }

    const filePaths = fileNames
      .filter((f) => f.endsWith('.csv'))
      .map((f) => join(sessionDir, f));

    // Run pipeline asynchronously (non-blocking)
    const pool = getPool();
    const client = await pool.connect();

    // Fire-and-forget: process in background
    (async () => {
      try {
        await runImportPipeline(client, filePaths, selfContactId, selfName || '', sessionId);
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
