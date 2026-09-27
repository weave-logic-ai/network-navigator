// DELETE /api/targets/:id/lenses/:lensId — soft-delete a lens
//
// Phase 4 Track H. Sets `deleted_at` via `softDeleteLens` so shared deep-link
// URLs can render a "this lens was deleted" banner instead of a 404. See
// `app/src/lib/targets/lens-service.ts` for the soft-delete semantics.

import { NextRequest, NextResponse } from 'next/server';
import { getLensById, softDeleteLens } from '@/lib/targets/lens-service';
import { getCurrentOwnerProfileId, getResearchTargetState, getTargetById } from '@/lib/targets/service';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const noStore = { 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lensId: string }> }
) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  try {
    const { id, lensId } = await params;
    if (!uuid.test(id) || !uuid.test(lensId)) {
      return NextResponse.json({ error: 'Invalid lens reference' }, { status: 400, headers: noStore });
    }
    const ownerId = await getCurrentOwnerProfileId();
    const [state, target] = ownerId
      ? await Promise.all([getResearchTargetState(ownerId), getTargetById(id)])
      : [null, null];
    if (!state || !target || state.tenantId !== target.tenantId ||
        (target.kind === 'self' && target.ownerId !== ownerId)) {
      return NextResponse.json({ status: 'missing' }, { status: 404, headers: noStore });
    }
    const lens = await getLensById(lensId, { tenantId: state.tenantId, ownerId: ownerId! });
    if (!lens || lens.tenantId !== state.tenantId ||
        (lens.userId !== null && lens.userId !== ownerId)) {
      return NextResponse.json({ status: 'missing' }, { status: 404, headers: noStore });
    }
    const status = lens.primaryTargetId !== id ? 'wrongTarget' :
      lens.deletedAt ? 'deleted' : 'available';
    return NextResponse.json({ status, ...(status === 'available' ? { name: lens.name } : {}) },
      { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Failed to read lens' }, { status: 500, headers: noStore });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lensId: string }> }
) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  try {
    const { id, lensId } = await params;
    if (!uuid.test(id) || !uuid.test(lensId)) {
      return NextResponse.json({ error: 'Invalid lens reference' }, { status: 400, headers: noStore });
    }
    const ownerId = await getCurrentOwnerProfileId();
    const [state, target] = ownerId
      ? await Promise.all([getResearchTargetState(ownerId), getTargetById(id)])
      : [null, null];
    if (!state || !target || state.tenantId !== target.tenantId ||
        (target.kind === 'self' && target.ownerId !== ownerId)) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }
    const lens = await softDeleteLens(id, lensId, { tenantId: state.tenantId, ownerId: ownerId! });
    if (!lens) {
      return NextResponse.json(
        { error: 'Lens not found or already deleted' },
        { status: 404 }
      );
    }
    return NextResponse.json({ data: lens });
  } catch {
    return NextResponse.json(
      {
        error: 'Failed to delete lens',
      },
      { status: 500 }
    );
  }
}
