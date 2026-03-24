// POST /api/goals/[id]/reject - Reject a suggested goal

import { NextRequest, NextResponse } from 'next/server';
import { rejectGoal } from '@/lib/goals/engine';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await rejectGoal(id);
    return NextResponse.json({ data: { rejected: true } });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reject goal', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
