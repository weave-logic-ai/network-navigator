// POST /api/extension/capture
// Receives raw HTML from the Chrome extension, stores in page_cache,
// queues for parsing, and pushes confirmation via WebSocket

import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { captureRequestSchema } from '@/lib/capture/capture-schema';
import { storePageCache } from '@/lib/capture/capture-store';
import { wsServer } from '@/lib/websocket/ws-server';
import { createCaptureConfirmedEvent } from '@/lib/websocket/ws-events';
import { query } from '@/lib/db/client';
import { triggerAutoScore } from '@/lib/scoring/auto-score';

export async function POST(req: NextRequest) {
  return withExtensionAuth(req, async (_authReq, extensionId) => {
    try {
      const body = await req.json();

      // Validate request body
      const parsed = captureRequestSchema.safeParse(body);
      if (!parsed.success) {
        const issues = parsed.error.issues ?? [];
        return NextResponse.json(
          {
            success: false,
            error: 'VALIDATION_ERROR',
            details: issues.map((e) => ({
              field: (e.path ?? []).map(String).join('.'),
              message: e.message,
            })),
          },
          { status: 400 }
        );
      }

      const data = parsed.data;

      // Store in page_cache
      const stored = await storePageCache({
        url: data.url,
        pageType: data.pageType,
        html: data.html,
        captureId: data.captureId,
        extensionVersion: data.extensionVersion,
        sessionId: data.sessionId,
        scrollDepth: data.scrollDepth,
        viewportHeight: data.viewportHeight,
        documentHeight: data.documentHeight,
        triggerMode: data.triggerMode,
      });

      // Push confirmation via WebSocket
      if (wsServer.isRunning) {
        wsServer.pushToExtension(
          extensionId,
          createCaptureConfirmedEvent(data.captureId, data.url, data.pageType)
        );
      }

      // Auto-complete ONE matching task by URL (not all — avoid over-completing)
      let tasksCompleted = 0;
      try {
        const taskResult = await query<{ id: string; goal_id: string | null; task_type: string }>(
          `UPDATE tasks SET status = 'completed', completed_at = now()
           WHERE id = (
             SELECT id FROM tasks
             WHERE status = 'pending' AND url IS NOT NULL
               AND ($1 LIKE '%' || replace(replace(url, 'https://www.linkedin.com', ''), 'https://linkedin.com', '') || '%'
                    OR url = $1)
             ORDER BY priority ASC, created_at ASC
             LIMIT 1
           )
           RETURNING id, goal_id, task_type`,
          [data.url]
        );
        tasksCompleted = taskResult.rowCount ?? 0;

        // Update goal progress
        if (tasksCompleted > 0) {
          const completedTask = taskResult.rows[0];
          if (completedTask.goal_id) {
            await query(
              `UPDATE goals SET current_value = (
                 SELECT COUNT(*) FROM tasks WHERE goal_id = $1 AND status = 'completed'
               ) WHERE id = $1`,
              [completedTask.goal_id]
            );
          }
        }
      } catch {
        // Non-critical — task completion is best-effort
      }

      // For SEARCH_PEOPLE captures: create follow-up task for next page
      const MAX_SEARCH_PAGES = 10;
      if (data.pageType === 'SEARCH_PEOPLE' || data.pageType === 'SEARCH_CONTENT') {
        try {
          // Parse current page number from URL
          const urlObj = new URL(data.url);
          const currentPage = parseInt(urlObj.searchParams.get('page') || '1', 10);

          if (currentPage < MAX_SEARCH_PAGES) {
            // Build next page URL
            urlObj.searchParams.set('page', String(currentPage + 1));
            const nextPageUrl = urlObj.toString();

            // Check if a task for the next page already exists
            const existingTask = await query<{ id: string }>(
              `SELECT id FROM tasks WHERE url = $1 AND status IN ('pending', 'in_progress') LIMIT 1`,
              [nextPageUrl]
            );

            if (existingTask.rows.length === 0) {
              // Find the goal_id from the completed task (if any)
              const goalId = tasksCompleted > 0
                ? (await query<{ goal_id: string | null }>(
                    `SELECT goal_id FROM tasks WHERE status = 'completed' AND url LIKE $1 AND goal_id IS NOT NULL ORDER BY completed_at DESC LIMIT 1`,
                    [`%${urlObj.pathname}%`]
                  )).rows[0]?.goal_id ?? null
                : null;

              await query(
                `INSERT INTO tasks (title, description, task_type, priority, url, goal_id, source, metadata)
                 VALUES ($1, $2, 'expand_network', 3, $3, $4, 'system', $5)`,
                [
                  `Capture search page ${currentPage + 1}`,
                  `Continue capturing LinkedIn search results — page ${currentPage + 1} of up to ${MAX_SEARCH_PAGES}`,
                  nextPageUrl,
                  goalId,
                  JSON.stringify({ autoCreated: true, pageNumber: currentPage + 1, sourceCapture: data.captureId }),
                ]
              );
            }
          }
        } catch {
          // Non-critical — pagination task creation is best-effort
        }
      }

      // Auto-score contact if this is a profile capture and we can resolve the contact
      if (data.pageType === 'PROFILE' && data.url) {
        try {
          const contactResult = await query(
            `SELECT id FROM contacts WHERE linkedin_url LIKE $1 LIMIT 1`,
            [`%${data.url.replace(/https?:\/\/(www\.)?linkedin\.com/, '')}%`]
          );
          if (contactResult.rows.length > 0) {
            triggerAutoScore(contactResult.rows[0].id);
          }
        } catch {
          // Non-critical — scoring is best-effort on capture
        }
      }

      const originalSize = Buffer.byteLength(data.html, 'utf-8');
      const compressionRatio =
        stored.storedBytes > 0
          ? 1 - stored.storedBytes / originalSize
          : 0;

      return NextResponse.json({
        success: true,
        captureId: data.captureId,
        storedBytes: stored.storedBytes,
        compressionRatio: Math.round(compressionRatio * 100) / 100,
        queuedForParsing: true,
        pageType: data.pageType,
      });
    } catch (error) {
      console.error('[Capture] Error storing capture:', error);
      return NextResponse.json(
        { success: false, error: 'INTERNAL_ERROR', message: 'Failed to store capture' },
        { status: 500 }
      );
    }
  });
}
