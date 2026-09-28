import { NextRequest, NextResponse } from 'next/server';
import { movePipelineStage, PIPELINE_STAGES, type PipelineStage } from '@/lib/db/queries/outreach';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid outreach state ID' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const stage = typeof body === 'object' && body !== null && 'stage' in body
    ? (body as { stage: unknown }).stage : undefined;
  if (typeof stage !== 'string' || !PIPELINE_STAGES.includes(stage as PipelineStage)) {
    return NextResponse.json({ error: 'Invalid pipeline stage' }, { status: 400 });
  }
  const campaignId = typeof body === 'object' && body !== null && 'campaign_id' in body
    ? (body as { campaign_id: unknown }).campaign_id : undefined;
  if (campaignId !== null && (typeof campaignId !== 'string' || !UUID_REGEX.test(campaignId))) {
    return NextResponse.json({ error: 'Valid campaign_id or null is required' }, { status: 400 });
  }
  const version = typeof body === 'object' && body !== null && 'event_version' in body
    ? (body as { event_version: unknown }).event_version : undefined;
  if (!Number.isSafeInteger(version) || (version as number) < 0) {
    return NextResponse.json({ error: 'Valid event_version is required' }, { status: 400 });
  }
  try {
    const result = await movePipelineStage(id, stage as PipelineStage, campaignId, version as number);
    if (result === 'stale') {
      return NextResponse.json({ error: 'Pipeline changed. Refresh and try again.' }, { status: 409 });
    }
    if (result === 'terminal') {
      return NextResponse.json({ error: 'Terminal outreach state cannot be moved' }, { status: 409 });
    }
    if (result === 'not_found') {
      return NextResponse.json({ error: 'Outreach state is not in the selected campaign' }, { status: 409 });
    }
    return NextResponse.json({ data: { outreach_state_id: id, stage } });
  } catch {
    return NextResponse.json({ error: 'Failed to move pipeline stage' }, { status: 500 });
  }
}
