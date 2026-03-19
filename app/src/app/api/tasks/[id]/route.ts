// GET /api/tasks/:id - get single task
// PUT /api/tasks/:id - update task
// DELETE /api/tasks/:id - delete task

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById, updateTask, deleteTask } from '@/lib/db/queries/tasks';

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
    return NextResponse.json({ error: 'Invalid task ID format' }, { status: 400 });
  }

  try {
    const task = await getTaskById(id);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ data: task });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get task', details: error instanceof Error ? error.message : undefined },
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
    return NextResponse.json({ error: 'Invalid task ID format' }, { status: 400 });
  }

  try {
    const body = await request.json();

    const allowedFields = [
      'title', 'description', 'task_type', 'status', 'priority',
      'url', 'due_date', 'goal_id', 'contact_id',
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

    const task = await updateTask(id, sanitized);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ data: task });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update task', details: error instanceof Error ? error.message : undefined },
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
    return NextResponse.json({ error: 'Invalid task ID format' }, { status: 400 });
  }

  try {
    const deleted = await deleteTask(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete task', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
