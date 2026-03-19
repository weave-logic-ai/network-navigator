// GET /api/scoring/status - Get scoring run status
// Query param: runId (specific run) or omit for latest

import { NextRequest, NextResponse } from 'next/server';
import { getScoringRunStatus, getLatestScoringRun } from '@/lib/db/queries/scoring';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    const status = runId
      ? await getScoringRunStatus(runId)
      : await getLatestScoringRun();

    if (!status) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({ data: status });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get scoring status', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
