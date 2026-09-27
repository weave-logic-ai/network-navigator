// GET /api/outreach/pipeline - contacts grouped by outreach stage for Kanban

import { NextRequest, NextResponse } from 'next/server';
import { getPipelineContacts, type PipelineContact, PIPELINE_STAGES } from '@/lib/db/queries/outreach';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaign_id') || undefined;
    if (campaignId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId)) {
      return NextResponse.json({ error: 'Invalid campaign ID' }, { status: 400 });
    }

    const contacts = await getPipelineContacts(campaignId);

    // Group contacts by pipeline stage
    const stages: Record<string, PipelineContact[]> = {};
    for (const stage of PIPELINE_STAGES) {
      stages[stage] = [];
    }

    for (const contact of contacts) {
      const stage = contact.pipeline_stage;
      if (stages[stage]) {
        stages[stage].push(contact);
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
