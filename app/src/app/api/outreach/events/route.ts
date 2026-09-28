// POST /api/outreach/events - record an outreach event

import { NextRequest, NextResponse } from 'next/server';
import { recordEventAndTransition, TemplateUnavailableError } from '@/lib/db/queries/outreach';
import { processOutreachFeedback } from '@/lib/scoring/outreach-feedback';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_EVENT_TYPES = [
  'sent', 'opened', 'replied', 'meeting_booked',
  'accepted', 'declined', 'bounced', 'opted_out',
];

// Map event types to the outreach state they should transition to
const EVENT_TO_STATE: Record<string, string> = {
  sent: 'sent',
  opened: 'opened',
  replied: 'replied',
  // The schema has no meeting_booked state; the event supplies the pipeline stage.
  meeting_booked: 'replied',
  accepted: 'accepted',
  declined: 'declined',
  bounced: 'bounced',
  opted_out: 'opted_out',
};

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  try {
    const body = await request.json();

    if (!body.contact_id || !UUID_REGEX.test(body.contact_id)) {
      return NextResponse.json({ error: 'Valid contact_id is required' }, { status: 400 });
    }

    if (!body.event_type || !VALID_EVENT_TYPES.includes(body.event_type)) {
      return NextResponse.json(
        { error: `event_type must be one of: ${VALID_EVENT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }
    if (typeof body.campaign_id !== 'string' || !UUID_REGEX.test(body.campaign_id)) {
      return NextResponse.json({ error: 'Valid campaign_id is required' }, { status: 400 });
    }
    if (body.event_data !== undefined && (body.event_data === null || Array.isArray(body.event_data) ||
      typeof body.event_data !== 'object')) {
      return NextResponse.json({ error: 'event_data must be an object' }, { status: 400 });
    }
    if (body.event_data?.template_id !== undefined &&
      (typeof body.event_data.template_id !== 'string' || !UUID_REGEX.test(body.event_data.template_id))) {
      return NextResponse.json({ error: 'Valid template_id is required' }, { status: 400 });
    }
    const event = await recordEventAndTransition({
      contact_id: body.contact_id,
      campaign_id: body.campaign_id,
      event_type: body.event_type,
      event_data: body.event_data,
      state: EVENT_TO_STATE[body.event_type],
    });

    // Feed outreach outcome back into scoring (fire-and-forget)
    processOutreachFeedback(body.contact_id, body.event_type).catch((err) => {
      console.error('[outreach-events] Feedback processing failed:', err);
    });

    return NextResponse.json({ data: event }, { status: 201 });
  } catch (error) {
    if (error instanceof TemplateUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Failed to record event', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
