// GET /api/enrichment/history - Transaction history

import { NextRequest, NextResponse } from 'next/server';
import * as enrichmentQueries from '@/lib/db/queries/enrichment';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

    const result = await enrichmentQueries.listTransactions(page, limit);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get transaction history', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
