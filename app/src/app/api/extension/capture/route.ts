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

      // Auto-complete matching tasks by URL
      let tasksCompleted = 0;
      try {
        const taskResult = await query(
          `UPDATE tasks SET status = 'completed', completed_at = now()
           WHERE status = 'pending' AND url IS NOT NULL
             AND ($1 LIKE '%' || replace(replace(url, 'https://www.linkedin.com', ''), 'https://linkedin.com', '') || '%'
                  OR url = $1)
           RETURNING id`,
          [data.url]
        );
        tasksCompleted = taskResult.rowCount ?? 0;

        // Update goal progress
        if (tasksCompleted > 0) {
          await query(
            `UPDATE goals SET current_value = (
               SELECT COUNT(*) FROM tasks WHERE goal_id = goals.id AND status = 'completed'
             ) WHERE id IN (
               SELECT DISTINCT goal_id FROM tasks WHERE goal_id IS NOT NULL AND status = 'completed'
                 AND completed_at >= now() - interval '5 seconds'
             )`
          );
        }
      } catch {
        // Non-critical — task completion is best-effort
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
