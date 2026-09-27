// GET /api/outreach/campaigns - list campaigns
// POST /api/outreach/campaigns - create campaign

import { NextRequest, NextResponse } from 'next/server';
import { listCampaigns, createCampaign } from '@/lib/db/queries/outreach';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ data: campaigns });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list campaigns', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const campaign = await createCampaign({
      name: body.name,
      description: body.description,
      status: body.status,
      target_count: body.target_count,
    });

    return NextResponse.json({ data: campaign }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create campaign', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
