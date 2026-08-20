// GET  /api/targets/[id]/banner-state
// POST /api/targets/[id]/banner-state
//
// Persists ADR-032 conflict-banner dismissals server-side (gap 2 fix — see
// the ADR's 2026-08-19 update note and
// `data/db/init/051-banner-dismiss-state.sql`). `SourceConflictBanner`
// fetches this alongside `/field-conflicts` on mount and only suppresses a
// field whose dismissal fingerprint still matches the current conflict.

import { NextRequest, NextResponse } from 'next/server';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { getDefaultTenantId, getCurrentOwnerProfileId } from '@/lib/targets/service';
import { query } from '@/lib/db/client';
import { listDismissals, dismissBanner } from '@/lib/targets/banner-state-service';

export const dynamic = 'force-dynamic';

async function targetExists(tenantId: string, id: string): Promise<boolean> {
  const res = await query<{ id: string }>(
    `SELECT id FROM research_targets WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return !!res.rows[0];
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!RESEARCH_FLAGS.sources) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const { id } = await context.params;
  const tenantId = await getDefaultTenantId();
  if (!(await targetExists(tenantId, id))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const dismissals = await listDismissals(tenantId, id);
  return NextResponse.json({ dismissals });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!RESEARCH_FLAGS.sources) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    fieldName?: unknown;
    fingerprint?: unknown;
  };
  if (typeof body.fieldName !== 'string' || body.fieldName.length === 0) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: '`fieldName` required' },
      { status: 400 }
    );
  }
  if (typeof body.fingerprint !== 'string') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: '`fingerprint` must be a string' },
      { status: 400 }
    );
  }
  const tenantId = await getDefaultTenantId();
  if (!(await targetExists(tenantId, id))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const userId = await getCurrentOwnerProfileId();
  const dismissal = await dismissBanner(
    tenantId,
    id,
    body.fieldName,
    body.fingerprint,
    userId
  );
  return NextResponse.json({ dismissal });
}
