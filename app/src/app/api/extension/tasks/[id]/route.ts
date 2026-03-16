// PATCH /api/extension/tasks/:id
// Update task status from extension

import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { query } from '@/lib/db/client';
import { wsServer } from '@/lib/websocket/ws-server';
import {
  createTaskUpdatedEvent,
  createGoalProgressEvent,
} from '@/lib/websocket/ws-events';

interface TaskUpdateBody {
  status: 'completed' | 'skipped' | 'in_progress';
  completionNote?: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withExtensionAuth(req, async (_authReq, extensionId) => {
    try {
      const { id: taskId } = await params;
      const body = (await req.json()) as TaskUpdateBody;

      const validStatuses = ['completed', 'skipped', 'in_progress'];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: 'VALIDATION_ERROR', message: 'Invalid status value' },
          { status: 400 }
        );
      }

      // Check task exists
      const existing = await query<{ id: string; goal_id: string | null }>(
        'SELECT id, goal_id FROM tasks WHERE id = $1',
        [taskId]
      );

      if (existing.rows.length === 0) {
        return NextResponse.json(
          { error: 'NOT_FOUND', message: 'Task not found' },
          { status: 404 }
        );
      }

      const goalId = existing.rows[0].goal_id;

      // Update task
      const completedAt =
        body.status === 'completed' || body.status === 'skipped'
          ? new Date().toISOString()
          : null;

      const metadata = body.completionNote
        ? { completionNote: body.completionNote }
        : {};

      await query(
        `UPDATE tasks
         SET status = $1,
             completed_at = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         WHERE id = $4`,
        [body.status, completedAt, JSON.stringify(metadata), taskId]
      );

      // Push task update via WebSocket
      if (wsServer.isRunning) {
        wsServer.pushToExtension(
          extensionId,
          createTaskUpdatedEvent(taskId, body.status)
        );

        // If task belongs to a goal, recalculate and push progress
        if (goalId) {
          const progressResult = await query<{
            total: string;
            completed: string;
          }>(
            `SELECT
              count(*) as total,
              count(*) FILTER (WHERE status = 'completed') as completed
            FROM tasks WHERE goal_id = $1`,
            [goalId]
          );

          if (progressResult.rows.length > 0) {
            const total = parseInt(progressResult.rows[0].total, 10);
            const completed = parseInt(progressResult.rows[0].completed, 10);
            const progress = total > 0 ? completed / total : 0;

            wsServer.pushToExtension(
              extensionId,
              createGoalProgressEvent(goalId, progress)
            );

            // Update goal's current_value
            await query(
              `UPDATE goals SET current_value = $1, updated_at = now() WHERE id = $2`,
              [progress, goalId]
            );
          }
        }
      }

      return NextResponse.json({
        success: true,
        taskId,
        status: body.status,
        completedAt,
      });
    } catch (error) {
      console.error('[Tasks] Error updating task:', error);
      return NextResponse.json(
        { error: 'INTERNAL_ERROR', message: 'Failed to update task' },
        { status: 500 }
      );
    }
  });
}
