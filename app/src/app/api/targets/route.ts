// GET  /api/targets?id=... — resolve a target for breadcrumb navigation
// POST /api/targets — create (or fetch existing) target for a contact or company
//
// Body: { kind: 'contact' | 'company', id: string }
//
// Used by the target picker (Phase 1 Track B): selecting a search result
// upserts a research_targets row and returns its id so the client can PUT it
// into /api/targets/state.

import { NextRequest, NextResponse } from 'next/server';
import {
  getOrCreateContactTarget,
  getOrCreateCompanyTarget,
  getDefaultTenantId,
  getTargetById,
} from '@/lib/targets/service';

// The breadcrumb uses this lookup when a focus-change event carries an id
// but no label (for example, Back to a previous secondary target).
export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Valid target id is required' }, { status: 400 });
    }
    const target = await getTargetById(id);
    if (!target || target.tenantId !== await getDefaultTenantId()) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }
    return NextResponse.json({ data: target });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load target', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      kind?: string;
      id?: string;
    };

    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json({ error: 'Missing `id`' }, { status: 400 });
    }

    const tenantId = await getDefaultTenantId();

    if (body.kind === 'contact') {
      const target = await getOrCreateContactTarget(body.id, tenantId);
      return NextResponse.json({ data: target });
    }
    if (body.kind === 'company') {
      const target = await getOrCreateCompanyTarget(body.id, tenantId);
      return NextResponse.json({ data: target });
    }

    return NextResponse.json(
      { error: 'Invalid `kind` — must be `contact` or `company`' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create target', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
