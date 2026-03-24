// POST /api/goals/[id]/accept - Accept a suggested goal

import { NextRequest, NextResponse } from 'next/server';
import { acceptGoal } from '@/lib/goals/engine';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await acceptGoal(id);
    return NextResponse.json({ data: { accepted: true } });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to accept goal', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
