// GET /api/enrichment/budget - Budget status

import { NextResponse } from 'next/server';
import { getBudgetStatus } from '@/lib/enrichment/budget';

export async function GET() {
  try {
    const status = await getBudgetStatus();
    return NextResponse.json({ data: status });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get budget status', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
