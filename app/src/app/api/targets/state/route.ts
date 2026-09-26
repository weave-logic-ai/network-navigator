// GET  /api/targets/state      — current primary + secondary for the session user
// PUT  /api/targets/state      — set secondary target (or clear it)
//
// WS-4 Phase 1 Track B. Gated behind RESEARCH_FLAGS.targets at the UI layer;
// backend plumbing remains callable so scoring and graph routes can pass the
// target_id without flipping the flag on.
//
// v1 scope: primary is immutable and always equals the owner's self-target
// (`10-decisions.md` Q4 / ADR-027). The PUT endpoint only accepts a secondary
// target id or `null` to clear.

import { NextRequest, NextResponse } from 'next/server';
import {
  getResearchTargetState,
  setSecondaryTarget,
  getCurrentOwnerProfileId,
  getTargetById,
} from '@/lib/targets/service';
import { invalidateForOwner } from '@/lib/graph/data-cache';
import { pushTargetHistory } from '@/lib/targets/history-service';

export async function GET() {
  try {
    const ownerId = await getCurrentOwnerProfileId();
    if (!ownerId) {
      return NextResponse.json({ data: null });
    }
    const state = await getResearchTargetState(ownerId);
    return NextResponse.json({ data: state });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read target state', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ownerId = await getCurrentOwnerProfileId();
    if (!ownerId) {
      return NextResponse.json({ error: 'No owner profile configured' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      secondaryTargetId?: string | null;
    };

    // Validate the target id exists (when non-null). Keeps a stale client
    // from wedging the state with a dangling FK — the FK itself has
    // ON DELETE SET NULL so we'd self-heal on deletion, but we'd rather
    // 400 now than surface a silent clear.
    if (body.secondaryTargetId != null) {
      const target = await getTargetById(body.secondaryTargetId);
      if (!target) {
        return NextResponse.json({ error: 'Target not found' }, { status: 404 });
      }
    }

    const previous = await getResearchTargetState(ownerId);
    const state = await setSecondaryTarget(ownerId, body.secondaryTargetId ?? null);
    if (state?.secondaryTargetId && previous?.secondaryTargetId !== state.secondaryTargetId) {
      await pushTargetHistory(ownerId, {
        targetId: state.secondaryTargetId,
        lensId: null,
        openedAt: new Date().toISOString(),
      }).catch((error) => {
        // History is a navigation cache; its failure must not make a
        // successful target-state write look like a failed request.
        console.warn('[targets/state] Could not record target history:', error);
      });
    }
    // Phase 4 Track I: invalidate the /api/graph/data cache for this owner
    // so the re-rooted graph reflects the new secondary immediately.
    invalidateForOwner(ownerId);
    return NextResponse.json({ data: state });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update target state', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
