// POST /api/extension/capture
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { captureRequestSchema, type CaptureRequestBody, type CaptureResponse } from '@/lib/capture/capture-schema';
import { storePageCache } from '@/lib/capture/capture-store';
import { wsServer } from '@/lib/websocket/ws-server';
import { createCaptureConfirmedEvent } from '@/lib/websocket/ws-events';
import { transaction } from '@/lib/db/client';
import { triggerAutoScore } from '@/lib/scoring/auto-score';

type Receipt = { request_hash: string; response: CaptureResponse };
type CaptureOutcome =
  | { kind: 'replay'; response: CaptureResponse }
  | { kind: 'conflict' }
  | { kind: 'created'; response: CaptureResponse; contactId: string | null };

// A failed optional effect must not leave the surrounding transaction aborted.
async function bestEffort<T>(client: PoolClient, action: () => Promise<T>): Promise<T | undefined> {
  await client.query('SAVEPOINT capture_optional');
  try {
    const result = await action();
    await client.query('RELEASE SAVEPOINT capture_optional');
    return result;
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT capture_optional');
    await client.query('RELEASE SAVEPOINT capture_optional');
    return undefined;
  }
}

async function completeTask(client: PoolClient, url: string): Promise<{ goal_id: string | null } | undefined> {
  const result = await client.query<{ goal_id: string | null }>(
    `UPDATE tasks SET status = 'completed', completed_at = now()
     WHERE id = (
       SELECT id FROM tasks
       WHERE status = 'pending' AND url IS NOT NULL
         AND ($1 LIKE '%' || replace(replace(url, 'https://www.linkedin.com', ''), 'https://linkedin.com', '') || '%'
              OR url = $1)
       ORDER BY priority ASC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     AND status = 'pending'
     RETURNING goal_id`,
    [url]
  );
  const task = result.rows[0];
  if (task?.goal_id) {
    await client.query('SELECT id FROM goals WHERE id = $1 FOR UPDATE', [task.goal_id]);
    await client.query(
      `UPDATE goals SET current_value = (
         SELECT COUNT(*) FROM tasks WHERE goal_id = $1 AND status = 'completed'
       ) WHERE id = $1`,
      [task.goal_id]
    );
  }
  return task;
}

async function createNextPageTask(client: PoolClient, data: CaptureRequestBody, goalId: string | null): Promise<void> {
  if (data.pageType !== 'SEARCH_PEOPLE' && data.pageType !== 'SEARCH_CONTENT') return;
  const url = new URL(data.url);
  const currentPage = parseInt(url.searchParams.get('page') || '1', 10);
  if (!Number.isFinite(currentPage) || currentPage >= 10) return;
  url.searchParams.set('page', String(currentPage + 1));
  const nextPageUrl = url.toString();
  const existing = await client.query(
    `SELECT id FROM tasks WHERE url = $1 AND status IN ('pending', 'in_progress') LIMIT 1`,
    [nextPageUrl]
  );
  if (existing.rows.length > 0) return;
  await client.query(
    `INSERT INTO tasks (title, description, task_type, priority, url, goal_id, source, metadata)
     VALUES ($1, $2, 'expand_network', 3, $3, $4, 'system', $5)`,
    [
      `Capture search page ${currentPage + 1}`,
      `Continue capturing LinkedIn search results — page ${currentPage + 1} of up to 10`,
      nextPageUrl,
      goalId,
      JSON.stringify({ autoCreated: true, pageNumber: currentPage + 1, sourceCapture: data.captureId }),
    ]
  );
}

async function captureOnce(extensionId: string, data: CaptureRequestBody): Promise<CaptureOutcome> {
  const requestHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return transaction(async (client) => {
    // A conflicting insert waits for the first transaction to commit or roll back.
    // Only its winner may store HTML and run effects.
    const claim = await client.query(
      `INSERT INTO extension_capture_receipts (extension_id, capture_id, request_hash, response)
       VALUES ($1, $2, $3, '{}'::jsonb)
       ON CONFLICT (extension_id, capture_id) DO NOTHING
       RETURNING capture_id`,
      [extensionId, data.captureId, requestHash]
    );
    if (claim.rowCount === 0) {
      const existing = await client.query<Receipt>(
        `SELECT request_hash, response FROM extension_capture_receipts
         WHERE extension_id = $1 AND capture_id = $2`,
        [extensionId, data.captureId]
      );
      if (existing.rows[0]?.request_hash !== requestHash) return { kind: 'conflict' };
      return { kind: 'replay', response: existing.rows[0].response };
    }

    const stored = await storePageCache({
      ...data,
      client,
    });
    const task = await bestEffort(client, () => completeTask(client, data.url));
    await bestEffort(client, () => createNextPageTask(client, data, task?.goal_id ?? null));
    const contact = data.pageType === 'PROFILE'
      ? await bestEffort(client, () => client.query<{ id: string }>(
          `SELECT id FROM contacts WHERE linkedin_url LIKE $1 LIMIT 1`,
          [`%${data.url.replace(/https?:\/\/(www\.)?linkedin\.com/, '')}%`]
        ))
      : undefined;
    const originalSize = Buffer.byteLength(data.html, 'utf-8');
    const response: CaptureResponse = {
      success: true,
      captureId: data.captureId,
      storedBytes: stored.storedBytes,
      compressionRatio: stored.storedBytes > 0
        ? Math.round((1 - stored.storedBytes / originalSize) * 100) / 100
        : 0,
      queuedForParsing: true,
      pageType: data.pageType,
    };
    await client.query(
      `UPDATE extension_capture_receipts SET response = $3::jsonb
       WHERE extension_id = $1 AND capture_id = $2`,
      [extensionId, data.captureId, JSON.stringify(response)]
    );
    return { kind: 'created', response, contactId: contact?.rows[0]?.id ?? null };
  });
}

export async function POST(req: NextRequest) {
  return withExtensionAuth(req, async (_authReq, extensionId) => {
    try {
      const parsed = captureRequestSchema.safeParse(await req.json());
      if (!parsed.success) {
        return NextResponse.json({
          success: false,
          error: 'VALIDATION_ERROR',
          details: parsed.error.issues.map((e) => ({
            field: e.path.map(String).join('.'),
            message: e.message,
          })),
        }, { status: 400 });
      }
      const outcome = await captureOnce(extensionId, parsed.data);
      if (outcome.kind === 'conflict') {
        return NextResponse.json(
          { success: false, error: 'CAPTURE_ID_CONFLICT' },
          { status: 409 }
        );
      }
      if (outcome.kind === 'created') {
        // Post-commit effects are deliberately never repeated by a replay.
        try {
          if (wsServer.isRunning) {
            wsServer.pushToExtension(
              extensionId,
              createCaptureConfirmedEvent(parsed.data.captureId, parsed.data.url, parsed.data.pageType)
            );
          }
        } catch (error) {
          console.error('[Capture] Confirmation delivery failed:', error);
        }
        try {
          if (outcome.contactId) triggerAutoScore(outcome.contactId);
        } catch (error) {
          console.error('[Capture] Auto-score dispatch failed:', error);
        }
      }
      return NextResponse.json(outcome.response);
    } catch (error) {
      console.error('[Capture] Error storing capture:', error);
      return NextResponse.json(
        { success: false, error: 'INTERNAL_ERROR', message: 'Failed to store capture' },
        { status: 500 }
      );
    }
  });
}
