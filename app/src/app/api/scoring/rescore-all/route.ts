// POST /api/scoring/rescore-all - Trigger a full rescore of all contacts
// Returns a run ID for status polling

import { NextResponse } from 'next/server';
import { triggerRescoreAll } from '@/lib/scoring/auto-score';

export async function POST() {
  try {
    const runId = await triggerRescoreAll();
    return NextResponse.json({
      data: {
        runId,
        status: 'running',
        message: 'Rescore started. Poll /api/scoring/status?runId= for progress.',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to start rescore', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
