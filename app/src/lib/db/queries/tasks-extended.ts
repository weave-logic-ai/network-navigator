// Extended task query functions with joins and aggregations

import { query } from '../client';

interface TaskRow {
  id: string;
  goal_id: string | null;
  contact_id: string | null;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  priority: number;
  url: string | null;
  due_date: Date | null;
  completed_at: Date | null;
  source: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  contact_name?: string | null;
  goal_title?: string | null;
}

interface ListTasksOptions {
  goalId?: string;
  contactId?: string;
  status?: string;
  taskType?: string;
  limit?: number;
}

interface TaskStats {
  pending: number;
  in_progress: number;
  completed: number;
  skipped: number;
  failed: number;
  total: number;
}

export async function listTasks(
  opts: ListTasksOptions = {}
): Promise<TaskRow[]> {
  const { goalId, contactId, status, taskType, limit = 50 } = opts;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (goalId) {
    conditions.push(`t.goal_id = $${idx++}`);
    params.push(goalId);
  }
  if (contactId) {
    conditions.push(`t.contact_id = $${idx++}`);
    params.push(contactId);
  }
  if (status) {
    conditions.push(`t.status = $${idx++}`);
    params.push(status);
  }
  if (taskType) {
    conditions.push(`t.task_type = $${idx++}`);
    params.push(taskType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const result = await query<TaskRow>(
    `SELECT t.*,
            c.full_name AS contact_name,
            g.title AS goal_title
     FROM tasks t
     LEFT JOIN contacts c ON t.contact_id = c.id
     LEFT JOIN goals g ON t.goal_id = g.id
     ${where}
     ORDER BY t.priority ASC, t.created_at DESC
     LIMIT $${idx}`,
    params
  );

  return result.rows;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const result = await query<TaskRow>(
    `SELECT t.*,
            c.full_name AS contact_name,
            g.title AS goal_title
     FROM tasks t
     LEFT JOIN contacts c ON t.contact_id = c.id
     LEFT JOIN goals g ON t.goal_id = g.id
     WHERE t.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createTask(data: {
  title: string;
  description?: string;
  taskType?: string;
  goalId?: string;
  contactId?: string;
  priority?: number;
  url?: string;
  dueDate?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<TaskRow> {
  const result = await query<TaskRow>(
    `INSERT INTO tasks (title, description, task_type, goal_id, contact_id, priority, url, due_date, source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.title,
      data.description ?? null,
      data.taskType ?? 'manual',
      data.goalId ?? null,
      data.contactId ?? null,
      data.priority ?? 5,
      data.url ?? null,
      data.dueDate ?? null,
      data.source ?? 'system',
      JSON.stringify(data.metadata ?? {}),
    ]
  );
  return result.rows[0];
}

export async function updateTask(
  id: string,
  data: Record<string, unknown>
): Promise<TaskRow | null> {
  const allowedFields: Record<string, string> = {
    title: 'title',
    description: 'description',
    taskType: 'task_type',
    status: 'status',
    priority: 'priority',
    url: 'url',
    dueDate: 'due_date',
    completedAt: 'completed_at',
    metadata: 'metadata',
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    const column = allowedFields[key];
    if (column) {
      const val = column === 'metadata' ? JSON.stringify(value) : value;
      setClauses.push(`${column} = $${idx++}`);
      values.push(val);
    }
  }

  // Auto-set completed_at when status changes to completed
  if (data.status === 'completed' && !data.completedAt) {
    setClauses.push(`completed_at = NOW()`);
  }

  if (setClauses.length === 0) return getTask(id);

  values.push(id);
  const result = await query<TaskRow>(
    `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function getTaskStats(): Promise<TaskStats> {
  const result = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count FROM tasks GROUP BY status`
  );

  const stats: TaskStats = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    total: 0,
  };

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    const key = row.status as keyof Omit<TaskStats, 'total'>;
    if (key in stats) {
      stats[key] = count;
    }
    stats.total += count;
  }

  return stats;
}
