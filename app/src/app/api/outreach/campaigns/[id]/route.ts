// GET /api/outreach/campaigns/:id - get campaign
// PUT /api/outreach/campaigns/:id - update campaign

import { NextRequest, NextResponse } from 'next/server';
import { getCampaign, updateCampaign } from '@/lib/db/queries/outreach';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
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
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
  }

  try {
    const body = await request.json();
    if (!body || typeof body.name !== 'string' || !body.name.trim() ||
        (body.description != null && typeof body.description !== 'string')) {
      return NextResponse.json({ error: 'Valid name and description required' }, { status: 400 });
    }
    const campaign = await updateCampaign(id, { name: body.name.trim(), description: body.description ?? null });
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
