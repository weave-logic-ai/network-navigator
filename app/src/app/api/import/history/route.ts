// GET /api/import/history - list past import sessions

import { NextRequest, NextResponse } from 'next/server';
import { listImportSessions } from '@/lib/db/queries/import';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    const result = await listImportSessions(page, limit);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list import sessions', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
