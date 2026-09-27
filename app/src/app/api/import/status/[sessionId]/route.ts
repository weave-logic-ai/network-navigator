// GET /api/import/status/:sessionId - get import session progress

import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/lib/db/queries/import';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VISIBLE_ERRORS = 20;

function visibleError(value: unknown, fallbackFile?: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const error = value as Record<string, unknown>;
  if (typeof error.message !== 'string' || !error.message.trim()) return null;
  return {
    ...(typeof error.file === 'string' && error.file.trim() ? { file: error.file.slice(0, 160) }
      : fallbackFile ? { file: fallbackFile.slice(0, 160) } : {}),
    ...(typeof error.row === 'number' && Number.isInteger(error.row) && error.row > 0 ? { row: error.row } : {}),
    message: error.message.slice(0, 500),
  };
}

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
    const fileErrors = files.flatMap(file => (Array.isArray(file.errors) ? file.errors : [])
      .map(error => visibleError(error, file.filename)).filter((error): error is NonNullable<typeof error> => error !== null));
    const sessionErrors = (Array.isArray(session.errors) ? session.errors : [])
      .map(error => visibleError(error)).filter((error): error is NonNullable<typeof error> => error !== null);
    const errors = [...fileErrors];
    for (const error of sessionErrors) {
      if (!fileErrors.some(fileError => fileError.message === error.message && fileError.row === error.row
        && (!error.file || error.file === fileError.file))) errors.push(error);
    }
    const errorTotal = Math.max(session.error_count ?? 0, errors.length);
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
      error: errors[0]?.message ?? null,
      errors: errors.slice(0, MAX_VISIBLE_ERRORS),
      errorTotal,
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
