// GET /api/enrichment/providers - List providers with status

import { NextResponse } from 'next/server';
import * as enrichmentQueries from '@/lib/db/queries/enrichment';

export async function GET() {
  try {
    const providers = await enrichmentQueries.listProviders();
    return NextResponse.json({ data: providers });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list providers', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
