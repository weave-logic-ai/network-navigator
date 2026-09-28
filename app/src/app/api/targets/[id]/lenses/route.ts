// GET  /api/targets/:id/lenses   — list lenses attached to a target
// POST /api/targets/:id/lenses   — create a new lens for a target
//
// Phase 1.5 — WS-4 per-target ICP plumbing (`08-phased-delivery.md` §3.4).
// Lenses bundle a target with the ICP profiles used for scoring; see
// `app/src/lib/targets/lens-service.ts` for the schema mapping
// (research_target_icps.lens_id is canonical after migration 053).
// Gated behind `RESEARCH_FLAGS.targets` at the UI
// layer; the backend routes remain callable so scoring can thread targetId
// through without flipping the flag on.

import { NextRequest, NextResponse } from 'next/server';
import {
  listLensesForTarget,
  getActiveLensForTarget,
  createLensForTarget,
} from '@/lib/targets/lens-service';
import { getTargetById, getCurrentOwnerProfileId, getResearchTargetState } from '@/lib/targets/service';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorizedTarget(id: string) {
  if (!uuid.test(id)) return null;
  const ownerId = await getCurrentOwnerProfileId();
  if (!ownerId) return null;
  const [state, target] = await Promise.all([getResearchTargetState(ownerId), getTargetById(id)]);
  if (!state || !target || state.tenantId !== target.tenantId ||
      (target.kind === 'self' && target.ownerId !== ownerId)) return null;
  return { target, scope: { tenantId: state.tenantId, ownerId } };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const access = await authorizedTarget(id);
    if (!access) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }
    const lenses = await listLensesForTarget(id, access.scope);
    const activeLens = await getActiveLensForTarget(id, access.scope);
    return NextResponse.json({ data: lenses, activeLensId: activeLens?.id ?? null });
  } catch {
    return NextResponse.json(
      { error: 'Failed to list lenses' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  try {
    const { id } = await params;
    const access = await authorizedTarget(id);
    if (!access) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    const parsed: unknown = await request.json().catch(() => null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid lens body' }, { status: 400 });
    }
    const body = parsed as {
      name?: string;
      icpProfileIds?: string[];
      secondaryTargetId?: string | null;
      config?: Record<string, unknown>;
    };

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Missing `name`' }, { status: 400 });
    }
    if (body.icpProfileIds !== undefined &&
        (!Array.isArray(body.icpProfileIds) || !body.icpProfileIds.every(value =>
          typeof value === 'string' && uuid.test(value)))) {
      return NextResponse.json({ error: 'Invalid ICP profile IDs' }, { status: 400 });
    }
    if (body.config !== undefined &&
        (!body.config || typeof body.config !== 'object' || Array.isArray(body.config))) {
      return NextResponse.json({ error: 'Invalid lens config' }, { status: 400 });
    }

    if (body.secondaryTargetId != null) {
      if (typeof body.secondaryTargetId !== 'string' || !uuid.test(body.secondaryTargetId)) {
        return NextResponse.json({ error: 'Invalid secondary target' }, { status: 400 });
      }
      const secondary = await getTargetById(body.secondaryTargetId);
      if (!secondary || secondary.tenantId !== access.scope.tenantId ||
          (secondary.kind === 'self' && secondary.ownerId !== access.scope.ownerId)) {
        return NextResponse.json({ error: 'Invalid secondary target' }, { status: 400 });
      }
    }

    const lens = await createLensForTarget({
      targetId: id,
      tenantId: access.scope.tenantId,
      name: body.name.trim(),
      userId: access.scope.ownerId,
      icpProfileIds: body.icpProfileIds ?? [],
      secondaryTargetId: body.secondaryTargetId ?? null,
      configExtras: body.config ?? {},
    });
    return NextResponse.json({ data: lens });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create lens' },
      { status: 500 }
    );
  }
}
