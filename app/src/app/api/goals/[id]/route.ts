// GET /api/goals/:id - get single goal with tasks
// PUT /api/goals/:id - update goal
// DELETE /api/goals/:id - delete goal

import { NextRequest, NextResponse } from 'next/server';
import { getGoalById, updateGoal, deleteGoal } from '@/lib/db/queries/goals';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateUuid(id)) {
    return NextResponse.json({ error: 'Invalid goal ID format' }, { status: 400 });
  }

  try {
    const goal = await getGoalById(id);

    if (!goal) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    }

    return NextResponse.json({ data: goal });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get goal', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateUuid(id)) {
    return NextResponse.json({ error: 'Invalid goal ID format' }, { status: 400 });
  }

  try {
    const body = await request.json();

    const allowedFields = [
      'title', 'description', 'goal_type', 'status', 'priority',
      'target_metric', 'target_value', 'current_value', 'deadline',
    ];

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields.includes(key)) {
        sanitized[key] = value;
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const goal = await updateGoal(id, sanitized);

    if (!goal) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    }

    return NextResponse.json({ data: goal });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update goal', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateUuid(id)) {
    return NextResponse.json({ error: 'Invalid goal ID format' }, { status: 400 });
  }

  try {
    const deleted = await deleteGoal(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete goal', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
