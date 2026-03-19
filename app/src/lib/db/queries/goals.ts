// Goal CRUD query functions

import { query } from '../client';

export interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  goal_type: string;
  status: string;
  priority: number;
  target_metric: string | null;
  target_value: number | null;
  current_value: number;
  deadline: string | null;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  task_count?: number;
  completed_task_count?: number;
}

export interface GoalWithTasks extends GoalRow {
  tasks: TaskRow[];
}

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

export async function listGoals(
  opts: { status?: string; limit?: number } = {}
): Promise<GoalRow[]> {
  const { status, limit = 50 } = opts;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (status) {
    conditions.push(`g.status = $${idx++}`);
    values.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(limit);

  const result = await query<GoalRow>(
    `SELECT g.*,
       COALESCE(tc.task_count, 0)::int AS task_count,
       COALESCE(tc.completed_task_count, 0)::int AS completed_task_count
     FROM goals g
     LEFT JOIN (
       SELECT goal_id,
              COUNT(*)::int AS task_count,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_task_count
       FROM tasks
       WHERE goal_id IS NOT NULL
       GROUP BY goal_id
     ) tc ON tc.goal_id = g.id
     ${where}
     ORDER BY g.priority ASC, g.created_at DESC
     LIMIT $${idx}`,
    values
  );

  return result.rows;
}

export async function getGoalById(id: string): Promise<GoalWithTasks | null> {
  const goalResult = await query<GoalRow>(
    `SELECT g.*,
       COALESCE(tc.task_count, 0)::int AS task_count,
       COALESCE(tc.completed_task_count, 0)::int AS completed_task_count
     FROM goals g
     LEFT JOIN (
       SELECT goal_id,
              COUNT(*)::int AS task_count,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_task_count
       FROM tasks
       WHERE goal_id IS NOT NULL
       GROUP BY goal_id
     ) tc ON tc.goal_id = g.id
     WHERE g.id = $1`,
    [id]
  );

  if (goalResult.rows.length === 0) return null;

  const tasksResult = await query<TaskRow>(
    `SELECT t.*, c.full_name AS contact_name
     FROM tasks t
     LEFT JOIN contacts c ON c.id = t.contact_id
     WHERE t.goal_id = $1
     ORDER BY t.priority ASC, t.created_at DESC`,
    [id]
  );

  return {
    ...goalResult.rows[0],
    tasks: tasksResult.rows,
  };
}

export async function createGoal(data: {
  title: string;
  description?: string;
  goal_type?: string;
  priority?: number;
  deadline?: string;
}): Promise<GoalRow> {
  const result = await query<GoalRow>(
    `INSERT INTO goals (title, description, goal_type, priority, deadline, source)
     VALUES ($1, $2, $3, $4, $5, 'user')
     RETURNING *`,
    [
      data.title,
      data.description ?? null,
      data.goal_type ?? 'custom',
      data.priority ?? 5,
      data.deadline ?? null,
    ]
  );
  return result.rows[0];
}

export async function updateGoal(
  id: string,
  data: Record<string, unknown>
): Promise<GoalRow | null> {
  const allowedFields = [
    'title', 'description', 'goal_type', 'status', 'priority',
    'target_metric', 'target_value', 'current_value', 'deadline',
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

  if (setClauses.length === 0) return null;

  values.push(id);
  const result = await query<GoalRow>(
    `UPDATE goals SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function deleteGoal(id: string): Promise<boolean> {
  const result = await query('DELETE FROM goals WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
