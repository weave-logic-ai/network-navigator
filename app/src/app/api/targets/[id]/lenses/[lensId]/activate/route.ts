import { NextRequest, NextResponse } from 'next/server';
import { commandTargetState, getCurrentOwnerProfileId, TargetStateCommandError } from '@/lib/targets/service';
import { invalidateForOwner } from '@/lib/graph/data-cache';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const headers = { 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(request: NextRequest,
  { params }: { params: Promise<{ id: string; lensId: string }> }) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers });
  }
  const { id, lensId } = await params;
  if (!uuid.test(id) || !uuid.test(lensId) || !body || typeof body !== 'object' ||
      Array.isArray(body) || Object.keys(body).some(key => key !== 'expectedRevision')) {
    return NextResponse.json({ error: 'Invalid activation command' }, { status: 400, headers });
  }
  const expectedRevision = (body as Record<string, unknown>).expectedRevision;
  if (expectedRevision === undefined) {
    return NextResponse.json({ error: 'expectedRevision is required' }, { status: 428, headers });
  }
  if (typeof expectedRevision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(expectedRevision)) {
    return NextResponse.json({ error: 'Invalid expectedRevision' }, { status: 400, headers });
  }
  try {
    const ownerId = await getCurrentOwnerProfileId();
    if (!ownerId) return NextResponse.json({ error: 'No owner profile configured' }, { status: 400, headers });
    const state = await commandTargetState(ownerId, expectedRevision,
      { type: 'activateLens', targetId: id, lensId });
    invalidateForOwner(ownerId);
    return NextResponse.json({ data: state }, { headers });
  } catch (error) {
    if (error instanceof TargetStateCommandError) {
      return NextResponse.json({ error: error.message, ...(error.current ? { data: error.current } : {}) },
        { status: error.status, headers });
    }
    return NextResponse.json({ error: 'Failed to activate lens' }, { status: 500, headers });
  }
}
