import { NextRequest, NextResponse } from 'next/server';
import { getCurrentOwnerProfileId, getTargetStateSnapshot, commandTargetState,
  TargetStateCommandError, type TargetStateAction } from '@/lib/targets/service';
import { invalidateForOwner } from '@/lib/graph/data-cache';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const headers = { 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const own = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

function parseStateCommand(value: unknown):
  { expectedRevision?: string; action: TargetStateAction } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (!own(body, 'action') || !body.action || typeof body.action !== 'object' ||
      Array.isArray(body.action)) return null;
  const action = body.action as Record<string, unknown>;
  let parsed: TargetStateAction;
  if (action.type === 'focus' && Object.keys(action).length === 2 &&
      (action.targetId === null || (typeof action.targetId === 'string' && uuid.test(action.targetId)))) {
    parsed = { type: 'focus', targetId: action.targetId as string | null };
  } else if (action.type === 'back' && Object.keys(action).length === 1) {
    parsed = { type: 'back' };
  } else if (action.type === 'activateLens' && Object.keys(action).length === 3 &&
      typeof action.targetId === 'string' && uuid.test(action.targetId) &&
      typeof action.lensId === 'string' && uuid.test(action.lensId)) {
    parsed = { type: 'activateLens', targetId: action.targetId, lensId: action.lensId };
  } else return null;
  if (keys.some(key => key !== 'action' && key !== 'expectedRevision')) return null;
  if (own(body, 'expectedRevision') &&
      (typeof body.expectedRevision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(body.expectedRevision))) return null;
  return { expectedRevision: body.expectedRevision as string | undefined, action: parsed };
}

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  try {
    const ownerId = await getCurrentOwnerProfileId();
    return NextResponse.json({ data: ownerId ? await getTargetStateSnapshot(ownerId) : null }, { headers });
  } catch {
    return NextResponse.json({ error: 'Failed to read target state' }, { status: 500, headers });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) { denied.headers.set('Cache-Control', 'no-store'); return denied; }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers });
  }
  const command = parseStateCommand(body);
  if (!command) return NextResponse.json({ error: 'Invalid target state command' }, { status: 400, headers });
  if (command.expectedRevision === undefined) {
    return NextResponse.json({ error: 'expectedRevision is required' }, { status: 428, headers });
  }
  try {
    const ownerId = await getCurrentOwnerProfileId();
    if (!ownerId) return NextResponse.json({ error: 'No owner profile configured' }, { status: 400, headers });
    const state = await commandTargetState(ownerId, command.expectedRevision, command.action);
    invalidateForOwner(ownerId);
    return NextResponse.json({ data: state }, { headers });
  } catch (error) {
    if (error instanceof TargetStateCommandError) {
      return NextResponse.json({ error: error.message, ...(error.current ? { data: error.current } : {}) },
        { status: error.status, headers });
    }
    return NextResponse.json({ error: 'Failed to update target state' }, { status: 500, headers });
  }
}
