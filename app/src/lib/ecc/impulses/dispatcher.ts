import { query } from '../../db/client';
import type { Impulse, ImpulseHandler } from '../types';
import type { HandlerExecutionResult, DispatchResult } from './types';
import { executeTaskGenerator } from './handlers/task-generator';
import { executeCampaignEnroller } from './handlers/campaign-enroller';
import { executeNotification } from './handlers/notification';
import { executeWebhook } from './handlers/webhook';

const HANDLER_TIMEOUT_MS = 5000;
const MAX_FAILURES_BEFORE_DISABLE = 3;

/**
 * Race a promise against a timeout, without leaking the timer.
 *
 * A bare `Promise.race([promise, new Promise((_, reject) => setTimeout(...))])`
 * never clears the timeout's handle once `promise` wins the race — the timer
 * stays scheduled for the full `ms` regardless of outcome. In a long-lived
 * server that's an easy-to-miss resource leak (one live timer per dispatched
 * handler); in tests it surfaces as Jest's "did not exit one second after
 * the test run has completed" / "worker process has failed to exit
 * gracefully" warnings, since every mocked handler resolves instantly and
 * leaves its timeout pending for up to HANDLER_TIMEOUT_MS afterward.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Dispatch an impulse to all matching handlers.
 * Each handler is executed independently with error isolation.
 */
export async function dispatchImpulse(impulseId: string): Promise<DispatchResult> {
  // Load the impulse
  const impulseResult = await query<Record<string, unknown>>(
    `SELECT * FROM impulses WHERE id = $1`,
    [impulseId]
  );
  if (impulseResult.rows.length === 0) {
    throw new Error(`Impulse not found: ${impulseId}`);
  }
  const impulse = mapImpulse(impulseResult.rows[0]);

  // Find matching handlers
  const handlersResult = await query<Record<string, unknown>>(
    `SELECT * FROM impulse_handlers
     WHERE tenant_id = $1 AND impulse_type = $2 AND enabled = true
     ORDER BY priority ASC`,
    [impulse.tenantId, impulse.impulseType]
  );

  const handlers = handlersResult.rows.map(mapHandler);

  // An impulse with no registered handler is dispatched to nobody. That is
  // indistinguishable from success in the return value (handlersExecuted: 0),
  // which is exactly how ECC_IMPULSES=true silently produced zero tasks for
  // as long as impulse_handlers went unseeded. Say so out loud instead.
  if (handlers.length === 0) {
    console.warn(
      `[ecc/impulses] No enabled handler registered for impulse_type ` +
        `"${impulse.impulseType}" (tenant ${impulse.tenantId}, impulse ${impulseId}). ` +
        `The impulse was recorded but nothing acted on it. Register a row in ` +
        `impulse_handlers for this tenant and impulse type — see ` +
        `data/db/init/048-seed-impulse-handlers.sql.`
    );
  }

  const results: HandlerExecutionResult[] = [];

  for (const handler of handlers) {
    const start = Date.now();
    try {
      const result = await withTimeout(
        executeHandler(handler, impulse),
        HANDLER_TIMEOUT_MS,
        'Handler timeout'
      );

      const durationMs = Date.now() - start;
      results.push({ handlerId: handler.id, status: 'success', result, durationMs });

      // Record acknowledgment
      await query(
        `INSERT INTO impulse_acks (impulse_id, handler_id, status, result)
         VALUES ($1, $2, 'success', $3)`,
        [impulseId, handler.id, JSON.stringify(result)]
      );
    } catch (error) {
      const durationMs = Date.now() - start;
      const errorResult = { error: error instanceof Error ? error.message : 'Unknown error' };
      results.push({ handlerId: handler.id, status: 'failed', result: errorResult, durationMs });

      // Record failed acknowledgment
      await query(
        `INSERT INTO impulse_acks (impulse_id, handler_id, status, result)
         VALUES ($1, $2, 'failed', $3)`,
        [impulseId, handler.id, JSON.stringify(errorResult)]
      );

      // Check if handler should be auto-disabled (dead letter)
      await checkDeadLetter(handler.id);
    }
  }

  return { impulseId, handlersExecuted: results.length, results };
}

async function executeHandler(
  handler: ImpulseHandler,
  impulse: Impulse
): Promise<Record<string, unknown>> {
  switch (handler.handlerType) {
    case 'task_generator':
      return executeTaskGenerator(impulse, handler.config);
    case 'campaign_enroller':
      return executeCampaignEnroller(impulse, handler.config);
    case 'notification':
      return executeNotification(impulse, handler.config);
    case 'webhook':
      return executeWebhook(impulse, handler.config);
    default:
      return { skipped: true, reason: `Unknown handler type: ${handler.handlerType}` };
  }
}

async function checkDeadLetter(handlerId: string): Promise<void> {
  const failCount = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM impulse_acks
     WHERE handler_id = $1 AND status = 'failed'
     AND processed_at > NOW() - INTERVAL '1 hour'`,
    [handlerId]
  );

  if (Number(failCount.rows[0]?.count ?? 0) >= MAX_FAILURES_BEFORE_DISABLE) {
    await query(
      `UPDATE impulse_handlers SET enabled = false, updated_at = NOW() WHERE id = $1`,
      [handlerId]
    );
    console.warn(`[impulse] Handler ${handlerId} auto-disabled after ${MAX_FAILURES_BEFORE_DISABLE} failures`);
  }
}

function mapImpulse(row: Record<string, unknown>): Impulse {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    impulseType: String(row.impulse_type) as Impulse['impulseType'],
    sourceEntityType: String(row.source_entity_type),
    sourceEntityId: String(row.source_entity_id),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

function mapHandler(row: Record<string, unknown>): ImpulseHandler {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    impulseType: String(row.impulse_type) as ImpulseHandler['impulseType'],
    handlerType: String(row.handler_type) as ImpulseHandler['handlerType'],
    config: (row.config ?? {}) as Record<string, unknown>,
    enabled: Boolean(row.enabled),
    priority: Number(row.priority ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
