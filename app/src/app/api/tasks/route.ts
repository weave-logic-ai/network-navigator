// GET /api/tasks - list tasks
// POST /api/tasks - create task

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const contactId = searchParams.get('contactId');
    const goalId = searchParams.get('goalId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (status) { conditions.push(`t.status = $${idx++}`); values.push(status); }
    if (contactId) { conditions.push(`t.contact_id = $${idx++}`); values.push(contactId); }
    if (goalId === 'null') {
      conditions.push('t.goal_id IS NULL');
    } else if (goalId) {
      conditions.push(`t.goal_id = $${idx++}`);
      values.push(goalId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit);

    const result = await query(
      `SELECT t.*, c.full_name AS contact_name
       FROM tasks t
       LEFT JOIN contacts c ON c.id = t.contact_id
       ${where} ORDER BY t.priority ASC, t.created_at DESC LIMIT $${idx}`,
      values
    );

    return NextResponse.json({ data: result.rows });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list tasks', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, taskType, contactId, goalId: bodyGoalId, priority, url, metadata } = body as {
      title: string;
      description?: string;
      taskType?: string;
      contactId?: string;
      goalId?: string;
      priority?: number;
      url?: string;
      metadata?: Record<string, unknown>;
    };

    if (!title) {
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    }

    const result = await query(
      `INSERT INTO tasks (title, description, task_type, contact_id, goal_id, priority, url, metadata, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user')
       RETURNING *`,
      [
        title,
        description ?? null,
        taskType ?? 'manual',
        contactId ?? null,
        bodyGoalId ?? null,
        priority ?? 5,
        url ?? null,
        JSON.stringify(metadata ?? {}),
      ]
    );

    return NextResponse.json({ data: result.rows[0] });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create task', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
