// GET /api/outreach/campaigns/:id - get campaign
// PUT /api/outreach/campaigns/:id - update campaign

import { NextRequest, NextResponse } from 'next/server';
import { getCampaign, updateCampaign } from '@/lib/db/queries/outreach';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
  }

  try {
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    return NextResponse.json({ data: campaign });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get campaign', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const campaign = await updateCampaign(id, body);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    return NextResponse.json({ data: campaign });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update campaign', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
