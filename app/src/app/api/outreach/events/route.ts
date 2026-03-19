// POST /api/outreach/events - record an outreach event

import { NextRequest, NextResponse } from 'next/server';
import {
  recordOutreachEvent,
  upsertOutreachState,
  getOutreachState,
} from '@/lib/db/queries/outreach';

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
  meeting_booked: 'meeting_booked',
  accepted: 'accepted',
  declined: 'declined',
  bounced: 'bounced',
  opted_out: 'opted_out',
};

export async function POST(request: NextRequest) {
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

    // Ensure outreach state exists for this contact
    let state = await getOutreachState(body.contact_id, body.campaign_id);
    if (!state) {
      state = await upsertOutreachState({
        contact_id: body.contact_id,
        campaign_id: body.campaign_id,
        state: 'not_started',
      });
    }

    // Record the event
    const event = await recordOutreachEvent({
      outreach_state_id: state.id,
      event_type: body.event_type,
      event_data: body.event_data,
    });

    // Transition the state based on the event
    const newState = EVENT_TO_STATE[body.event_type];
    if (newState) {
      await upsertOutreachState({
        contact_id: body.contact_id,
        campaign_id: body.campaign_id,
        state: newState,
        last_action_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ data: event }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to record event', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
