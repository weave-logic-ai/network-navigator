// POST /api/extension/analytics
//
// WS-2 Phase 2 Track D. Per `08-phased-delivery.md` §4.1 analytics events and
// `02-visibility-and-feedback.md` §11. Sidebar posts one of
//   parse_panel_viewed | capture_diff_opened | unmatched_flagged |
//   regression_run
// with a small properties bag; we write it to `analytics_events`
// (migration 040). Flag-gated behind RESEARCH_PARSER_TELEMETRY.

import { NextResponse, type NextRequest } from 'next/server';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { recordEvent, type AnalyticsEventName } from '@/lib/analytics/events';
import { requireVisibilityPrincipal } from '@/lib/auth/extension-visibility-boundary';

const KNOWN_EVENTS: ReadonlyArray<AnalyticsEventName> = [
  'parse_panel_viewed',
  'capture_diff_opened',
  'unmatched_flagged',
  'regression_run',
];

interface AnalyticsBody {
  event: string;
  properties?: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  // Read-only feature probe: authenticate without spending a POST rate-limit
  // slot or recording a synthetic analytics event.
  const denied = await requireVisibilityPrincipal(request, false, false);
  if (denied) return denied;
  if (!RESEARCH_FLAGS.parserTelemetry) {
    return NextResponse.json({ enabled: false }, { status: 404 });
  }
  return NextResponse.json({ enabled: true }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const denied = await requireVisibilityPrincipal(request, true);
  if (denied) return denied;
  if (!RESEARCH_FLAGS.parserTelemetry) {
    return NextResponse.json(
      { error: 'RESEARCH_PARSER_TELEMETRY is off' },
      { status: 404 }
    );
  }

  let body: AnalyticsBody;
  try {
    body = (await request.json()) as AnalyticsBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.event || typeof body.event !== 'string') {
    return NextResponse.json(
      { error: 'event is required' },
      { status: 400 }
    );
  }
  // Soft allow-list: accept any snake_case event name, but warn on unknown
  // ones via an X-Unknown-Event header so the sidebar dev surface spots
  // typos.
  const known = KNOWN_EVENTS.includes(body.event as AnalyticsEventName);

  const result = await recordEvent({
    event: body.event,
    properties: body.properties,
  });

  if (!result.written) {
    return NextResponse.json(
      { written: false, reason: result.reason ?? null, known },
      { status: result.reason === 'invalid-event' ? 400 : 200 }
    );
  }
  return NextResponse.json({ written: true, known });
}
