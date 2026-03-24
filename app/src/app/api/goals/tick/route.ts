// POST /api/goals/tick - Run the goal engine for current context

import { NextRequest, NextResponse } from 'next/server';
import { tick } from '@/lib/goals/engine';
import type { TickContext } from '@/lib/goals/types';

const VALID_PAGES = ['discover', 'contacts', 'dashboard', 'tasks', 'network', 'outreach', 'import', 'admin', 'extension'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ctx: TickContext = {
      page: VALID_PAGES.includes(body.page) ? body.page : 'dashboard',
      selectedNicheId: body.selectedNicheId || undefined,
      selectedIcpId: body.selectedIcpId || undefined,
      selectedOfferingIds: Array.isArray(body.selectedOfferingIds) ? body.selectedOfferingIds : undefined,
      viewingContactId: body.viewingContactId || undefined,
    };

    const result = await tick(ctx);
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      { error: 'Goal tick failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
