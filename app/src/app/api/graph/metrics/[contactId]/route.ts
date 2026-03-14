// GET /api/graph/metrics/[contactId] - Contact graph metrics

import { NextRequest, NextResponse } from 'next/server';
import * as graphQueries from '@/lib/db/queries/graph';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  try {
    const { contactId } = await params;

    const metrics = await graphQueries.getGraphMetrics(contactId);
    if (!metrics) {
      return NextResponse.json({ error: 'No metrics found for this contact' }, { status: 404 });
    }

    return NextResponse.json({ data: metrics });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get graph metrics', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
