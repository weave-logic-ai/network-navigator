// GET /api/scoring/context-preview?contactId=...&targetId=...
// Read-only score under the target's currently active lens.

import { NextRequest, NextResponse } from 'next/server';
import { LensPreviewError, previewContactForTarget } from '@/lib/scoring/pipeline';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const contactId = searchParams.get('contactId');
  const targetId = searchParams.get('targetId');
  const profileName = searchParams.get('profileName') ?? undefined;

  if (!contactId || !UUID.test(contactId) || !targetId || !UUID.test(targetId)) {
    return NextResponse.json({ error: 'Valid contactId and targetId UUIDs are required' }, { status: 400 });
  }
  if (profileName !== undefined && (profileName.length === 0 || profileName.length > 100)) {
    return NextResponse.json({ error: 'Invalid profileName' }, { status: 400 });
  }

  try {
    const data = await previewContactForTarget(contactId, targetId, profileName);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof LensPreviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to preview scoring context' }, { status: 500 });
  }
}
