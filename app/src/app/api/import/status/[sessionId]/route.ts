// GET /api/import/status/:sessionId - get import session progress

import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/lib/db/queries/import';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!UUID_REGEX.test(sessionId)) {
    return NextResponse.json(
      { error: 'Invalid session ID format' },
      { status: 400 }
    );
  }

  try {
    const result = await getImportSession(sessionId);

    if (!result) {
      return NextResponse.json(
        { error: 'Import session not found' },
        { status: 404 }
      );
    }

    // Flatten to match ImportSession interface expected by the UI
    const { session, files } = result;
    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      totalFiles: session.total_files,
      processedFiles: session.processed_files,
      totalRecords: session.total_records,
      processedRecords: session.new_records + session.updated_records + session.skipped_records,
      newRecords: session.new_records,
      updatedRecords: session.updated_records,
      skippedRecords: session.skipped_records,
      erroredRecords: session.error_count,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      error: session.errors?.length > 0 ? (session.errors[0] as { message?: string })?.message || null : null,
      files: files.map((f) => ({
        id: f.id,
        fileName: f.filename,
        fileSize: f.file_size_bytes,
        status: f.status,
        recordsTotal: f.record_count,
        recordsProcessed: f.processed_count,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get session status', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
