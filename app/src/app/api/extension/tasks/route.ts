// GET /api/extension/tasks
// Returns tasks grouped by goal for the extension sidebar/popup

import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { query } from '@/lib/db/client';

interface TaskRow {
  id: string;
  goal_id: string | null;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  priority: number;
  url: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  contact_id: string | null;
  metadata: Record<string, unknown>;
  // Goal fields (from JOIN)
  goal_title: string | null;
  goal_status: string | null;
}

export async function GET(req: NextRequest) {
  return withExtensionAuth(req, async (authReq, _extensionId) => {
    try {
      const url = new URL(authReq.url);
      const statusFilter = url.searchParams.get('status');
      const goalIdFilter = url.searchParams.get('goalId');
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

      let sql = `
        SELECT
          t.id, t.goal_id, t.title, t.description, t.task_type,
          t.status, t.priority, t.url, t.due_date, t.completed_at,
          t.created_at, t.contact_id, t.metadata,
          g.title as goal_title, g.status as goal_status
        FROM tasks t
        LEFT JOIN goals g ON t.goal_id = g.id
        WHERE 1=1
      `;
      const params: unknown[] = [];
      let paramIdx = 1;

      if (statusFilter) {
        sql += ` AND t.status = $${paramIdx++}`;
        params.push(statusFilter);
      }
      if (goalIdFilter) {
        sql += ` AND t.goal_id = $${paramIdx++}`;
        params.push(goalIdFilter);
      }

      sql += ` ORDER BY t.priority ASC, t.due_date ASC NULLS LAST, t.created_at DESC`;
      sql += ` LIMIT $${paramIdx++}`;
      params.push(limit);

      const result = await query<TaskRow>(sql, params);

      // Get accurate goal-level counts (not limited by task pagination)
      const goalCountsResult = await query<{
        goal_id: string;
        goal_title: string;
        total: string;
        completed: string;
        pending: string;
      }>(
        `SELECT
          COALESCE(t.goal_id, '00000000-0000-0000-0000-000000000000') as goal_id,
          COALESCE(g.title, 'Ungrouped Tasks') as goal_title,
          COUNT(*)::text as total,
          COUNT(*) FILTER (WHERE t.status = 'completed')::text as completed,
          COUNT(*) FILTER (WHERE t.status IN ('pending', 'in_progress'))::text as pending
        FROM tasks t
        LEFT JOIN goals g ON t.goal_id = g.id
        GROUP BY t.goal_id, g.title`
      );

      const goalCounts = new Map<string, { total: number; completed: number; pending: number; title: string }>();
      for (const row of goalCountsResult.rows) {
        goalCounts.set(row.goal_id, {
          total: parseInt(row.total, 10),
          completed: parseInt(row.completed, 10),
          pending: parseInt(row.pending, 10),
          title: row.goal_title,
        });
      }

      // Group tasks by goal
      const goalsMap = new Map<
        string,
        {
          id: string;
          title: string;
          progress: number;
          totalTasks: number;
          completedTasks: number;
          tasks: Array<{
            id: string;
            goalId: string;
            goalTitle: string;
            type: string;
            title: string;
            description: string;
            priority: string;
            status: string;
            targetUrl: string | null;
            searchQuery: string | null;
            contactName: string | null;
            appUrl: string | null;
            dueDate: string | null;
            completedAt: string | null;
            createdAt: string;
          }>;
        }
      >();

      const ungroupedGoalId = '00000000-0000-0000-0000-000000000000';
      let totalPending = 0;
      let totalCompleted = 0;

      for (const row of result.rows) {
        const goalId = row.goal_id ?? ungroupedGoalId;
        const goalTitle = row.goal_title ?? 'Ungrouped Tasks';
        const counts = goalCounts.get(goalId);

        if (!goalsMap.has(goalId)) {
          goalsMap.set(goalId, {
            id: goalId,
            title: goalTitle,
            progress: 0,
            totalTasks: counts?.total ?? 0,
            completedTasks: counts?.completed ?? 0,
            tasks: [],
          });
        }

        const goal = goalsMap.get(goalId)!;
        const priorityLabel =
          row.priority <= 3 ? 'high' : row.priority <= 6 ? 'medium' : 'low';
        const metadata = row.metadata ?? {};

        goal.tasks.push({
          id: row.id,
          goalId,
          goalTitle,
          type: row.task_type,
          title: row.title,
          description: row.description ?? '',
          priority: priorityLabel,
          status: row.status,
          targetUrl: row.url,
          searchQuery: (metadata as Record<string, string>).searchQuery ?? null,
          contactName: (metadata as Record<string, string>).contactName ?? null,
          appUrl: row.contact_id
            ? `/contacts/${row.contact_id}`
            : null,
          dueDate: row.due_date,
          completedAt: row.completed_at,
          createdAt: row.created_at,
        });

        // Don't increment counts here — they come from goalCounts query
      }

      // Calculate totals and progress from accurate counts
      for (const goal of goalsMap.values()) {
        totalPending += goal.totalTasks - goal.completedTasks;
        totalCompleted += goal.completedTasks;
        goal.progress =
          goal.totalTasks > 0
            ? Math.round((goal.completedTasks / goal.totalTasks) * 100) / 100
            : 0;
      }

      return NextResponse.json({
        goals: Array.from(goalsMap.values()),
        totalPending,
        totalCompleted,
      });
    } catch (error) {
      console.error('[Tasks] Error fetching tasks:', error);
      return NextResponse.json(
        { error: 'INTERNAL_ERROR', message: 'Failed to fetch tasks' },
        { status: 500 }
      );
    }
  });
}
