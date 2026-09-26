// GET  /api/targets/:id/lenses   — list lenses attached to a target
// POST /api/targets/:id/lenses   — create a new lens for a target
//
// Phase 1.5 — WS-4 per-target ICP plumbing (`08-phased-delivery.md` §3.4).
// Lenses bundle a target with the ICP profiles used for scoring; see
// `app/src/lib/targets/lens-service.ts` for the schema mapping (config JSONB
// stores `icpProfileIds`). Gated behind `RESEARCH_FLAGS.targets` at the UI
// layer; the backend routes remain callable so scoring can thread targetId
// through without flipping the flag on.

import { NextRequest, NextResponse } from 'next/server';
import {
  listLensesForTarget,
  getActiveLensForTarget,
  createLensForTarget,
} from '@/lib/targets/lens-service';
import { getTargetById, getCurrentOwnerProfileId } from '@/lib/targets/service';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const target = await getTargetById(id);
    if (!target) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }
    const lenses = await listLensesForTarget(id);
    const activeLens = await getActiveLensForTarget(id);
    return NextResponse.json({ data: lenses, activeLensId: activeLens?.id ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list lenses', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const target = await getTargetById(id);
    if (!target) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      icpProfileIds?: string[];
      secondaryTargetId?: string | null;
      config?: Record<string, unknown>;
    };

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Missing `name`' }, { status: 400 });
    }

    const ownerId = await getCurrentOwnerProfileId();
    const lens = await createLensForTarget({
      targetId: id,
      tenantId: target.tenantId,
      name: body.name.trim(),
      userId: ownerId,
      icpProfileIds: Array.isArray(body.icpProfileIds) ? body.icpProfileIds : [],
      secondaryTargetId: body.secondaryTargetId ?? null,
      configExtras: body.config ?? {},
    });
    return NextResponse.json({ data: lens });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create lens', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
