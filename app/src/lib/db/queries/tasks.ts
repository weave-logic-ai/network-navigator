// Task query helpers used by API routes

import { query } from '../client';

export interface TaskRow {
  id: string;
  goal_id: string | null;
  contact_id: string | null;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  priority: number;
  url: string | null;
  due_date: string | null;
  completed_at: string | null;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  contact_name?: string | null;
}

export async function getTaskById(id: string): Promise<TaskRow | null> {
  const result = await query<TaskRow>(
    `SELECT t.*, c.full_name AS contact_name
     FROM tasks t
     LEFT JOIN contacts c ON c.id = t.contact_id
     WHERE t.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function updateTask(
  id: string,
  data: Record<string, unknown>
): Promise<TaskRow | null> {
  const allowedFields = [
    'title', 'description', 'task_type', 'status', 'priority',
    'url', 'due_date', 'goal_id', 'contact_id',
  ];

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  // Auto-set completed_at when marking completed
  if (data.status === 'completed') {
    setClauses.push(`completed_at = NOW()`);
  } else if (data.status && data.status !== 'completed') {
    setClauses.push(`completed_at = NULL`);
  }

  if (setClauses.length === 0) return null;

  values.push(id);
  const result = await query<TaskRow>(
    `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function deleteTask(id: string): Promise<boolean> {
  const result = await query('DELETE FROM tasks WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
