// POST /api/scoring/rescore-all - Trigger a full rescore of all contacts
// Returns a run ID for status polling
// Persisted scores are owner baseline only.

import { NextRequest, NextResponse } from 'next/server';
import { triggerRescoreAll } from '@/lib/scoring/auto-score';

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let body: unknown;
    try {
      const raw = await request.text();
      body = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 });
    }
    if (searchParams.has('targetId') || Object.hasOwn(body, 'targetId')) {
      return NextResponse.json({ error: 'targetId is only supported by the read-only scoring context preview' }, { status: 422 });
    }
    if (Object.keys(body).length > 0) {
      return NextResponse.json({ error: 'Invalid rescore request body' }, { status: 400 });
    }

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
