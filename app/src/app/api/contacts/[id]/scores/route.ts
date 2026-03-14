// GET /api/contacts/[id]/scores - Get contact score breakdown

import { NextRequest, NextResponse } from 'next/server';
import * as scoringQueries from '@/lib/db/queries/scoring';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Contact ID required' }, { status: 400 });
    }

    const breakdown = await scoringQueries.getContactScoreBreakdown(id);
    if (!breakdown) {
      return NextResponse.json({ error: 'No scores found for this contact' }, { status: 404 });
    }

    return NextResponse.json({ data: breakdown });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get scores', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
