// GET /api/outreach/pipeline - contacts grouped by outreach stage for Kanban

import { NextRequest, NextResponse } from 'next/server';
import { getPipelineContacts, type PipelineContact } from '@/lib/db/queries/outreach';

const PIPELINE_STAGES = [
  'not_started', 'contacted', 'replied',
  'meeting_booked', 'won', 'lost',
] as const;

// Map DB state values to pipeline stage names (DB uses sent/opened/etc.)
function mapStateToPipelineStage(state: string): string {
  switch (state) {
    case 'not_started':
    case 'queued':
      return 'not_started';
    case 'sent':
    case 'opened':
      return 'contacted';
    case 'replied':
    case 'accepted':
      return 'replied';
    case 'declined':
    case 'bounced':
    case 'opted_out':
      return 'lost';
    default:
      return state;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaign_id') || undefined;

    const contacts = await getPipelineContacts(campaignId);

    // Group contacts by pipeline stage
    const stages: Record<string, PipelineContact[]> = {};
    for (const stage of PIPELINE_STAGES) {
      stages[stage] = [];
    }

    for (const contact of contacts) {
      const stage = mapStateToPipelineStage(contact.state);
      if (stages[stage]) {
        stages[stage].push(contact);
      } else {
        // Fallback for custom states like meeting_booked, won
        stages[stage] = [contact];
      }
    }

    return NextResponse.json({ stages });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get pipeline', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
