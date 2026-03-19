// GET /api/goals - list goals with optional status filter
// POST /api/goals - create a new goal

import { NextRequest, NextResponse } from 'next/server';
import { listGoals, createGoal } from '@/lib/db/queries/goals';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;

    const goals = await listGoals({ status });

    return NextResponse.json({ data: goals });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list goals', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, priority, deadline, goalType } = body as {
      title: string;
      description?: string;
      priority?: number;
      deadline?: string;
      goalType?: string;
    };

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const goal = await createGoal({
      title: title.trim(),
      description: description ?? undefined,
      goal_type: goalType ?? 'custom',
      priority: priority ?? 5,
      deadline: deadline ?? undefined,
    });

    return NextResponse.json({ data: goal }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create goal', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
