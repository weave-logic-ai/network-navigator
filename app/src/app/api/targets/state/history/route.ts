import { NextRequest, NextResponse } from 'next/server';
import { getCurrentOwnerProfileId, getTargetStateSnapshot } from '@/lib/targets/service';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  try {
    const ownerId = await getCurrentOwnerProfileId();
    const snapshot = ownerId ? await getTargetStateSnapshot(ownerId) : null;
    const raw = new URL(request.url).searchParams.get('limit');
    const limit = raw && /^[1-9][0-9]*$/.test(raw) ? Math.min(Number(raw), 20) : 5;
    return NextResponse.json({ data: snapshot?.history.slice(0, limit) ?? [] }, { headers });
  } catch {
    return NextResponse.json({ error: 'Failed to read target history' }, { status: 500, headers });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  return NextResponse.json({ error: 'Use revisioned target state commands' }, { status: 428, headers });
}
