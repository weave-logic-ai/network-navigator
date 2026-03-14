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

    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get session status', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
