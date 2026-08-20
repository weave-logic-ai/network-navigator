// POST /api/sources/cron/parser-rollup
//
// ADR-031 Decision point 2 — nightly roll-up of `parse_field_outcomes` into
// `parse_field_outcomes_daily`. Rolls up UTC "yesterday" by default; pass
// `?day=YYYY-MM-DD` to backfill or re-run a specific day.
//
// Idempotent: see app/src/lib/parser/rollup.ts — each bucket is recomputed
// from raw and upserted via ON CONFLICT DO UPDATE, so re-running for the
// same day overwrites rather than double-counts.
//
// Protected by the `X-Cron-Secret` header. Gated on
// RESEARCH_FLAGS.parserTelemetry (the flag that governs the whole
// parse_field_outcomes surface).

import { NextRequest, NextResponse } from 'next/server';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { isCronAuthorized } from '@/lib/sources/cron-auth';
import { runParserRollup } from '@/lib/parser/rollup';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  if (!RESEARCH_FLAGS.parserTelemetry) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const dayParam = req.nextUrl.searchParams.get('day') ?? undefined;
  if (dayParam && !DAY_PATTERN.test(dayParam)) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', message: 'day must be YYYY-MM-DD' },
      { status: 400 }
    );
  }

  try {
    const result = await runParserRollup(dayParam);
    return NextResponse.json({
      success: true,
      day: result.day,
      rawRowsScanned: result.rawRowsScanned,
      bucketsUpserted: result.bucketsUpserted,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'ROLLUP_FAILED', message: (err as Error).message },
      { status: 500 }
    );
  }
}
