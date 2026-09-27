// POST /api/goals/[id]/accept - Accept a suggested goal

import { NextRequest, NextResponse } from 'next/server';
import { acceptGoal, StaleGoalIdentityError } from '@/lib/goals/engine';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const accepted = await acceptGoal(id);
    if (!accepted) return NextResponse.json({ error: 'Goal is no longer suggested' }, { status: 409 });
    return NextResponse.json({ data: { accepted: true } });
  } catch (error) {
    if (error instanceof StaleGoalIdentityError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Failed to accept goal', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
