// GET /api/graph/communities - List communities/clusters

import { NextResponse } from 'next/server';
import * as graphQueries from '@/lib/db/queries/graph';

export async function GET() {
  try {
    const clusters = await graphQueries.listClusters();
    return NextResponse.json({ data: clusters });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list communities', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
