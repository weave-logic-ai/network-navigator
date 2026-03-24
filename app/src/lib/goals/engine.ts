// Goal Engine — runs on every user tick, produces goal candidates
// Fast: all checks are indexed lookups, no heavy computation

import crypto from 'crypto';
import { query } from '../db/client';
import type { TickContext, GoalCandidate, TickResult, GoalCheck } from './types';
import { icpChecks } from './checks/icp-checks';
import { hubChecks } from './checks/hub-checks';
import { relationshipChecks } from './checks/relationship-checks';
import { backgroundChecks } from './checks/background-checks';

const REJECTION_THRESHOLD = 3;   // Need 3 rejections to suppress
const REJECTION_WINDOW_DAYS = 30;
const MAX_CONTEXT_CHECKS = 3;
const MAX_BACKGROUND_CHECKS = 2;

/**
 * Hash a check type + context for dedup/feedback lookup.
 */
export function contextHash(checkType: string, keys: Record<string, string | undefined>): string {
  const normalized = Object.entries(keys)
    .filter(([, v]) => v)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
  return crypto.createHash('md5').update(`${checkType}|${normalized}`).digest('hex').slice(0, 16);
}

/**
 * Check if a check type + context has been rejected >= REJECTION_THRESHOLD times in the window.
 */
async function isSuppressed(checkType: string, ctxHash: string): Promise<boolean> {
  const result = await query<{ rejection_count: string }>(
    `SELECT COUNT(*)::text AS rejection_count
     FROM goal_check_feedback
     WHERE check_type = $1 AND context_hash = $2
       AND accepted = FALSE
       AND created_at > NOW() - INTERVAL '${REJECTION_WINDOW_DAYS} days'`,
    [checkType, ctxHash]
  );
  return parseInt(result.rows[0].rejection_count, 10) >= REJECTION_THRESHOLD;
}

/**
 * Check if there's already an active/suggested goal with the same type and context.
 */
async function isDuplicate(goalType: string, ctxHash: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id FROM goals
     WHERE goal_type = $1 AND status IN ('active', 'suggested')
       AND metadata->>'contextHash' = $2
     LIMIT 1`,
    [goalType, ctxHash]
  );
  return result.rows.length > 0;
}

/**
 * Select context-aware checks based on the current page/selection.
 */
function selectContextChecks(ctx: TickContext): GoalCheck[] {
  const checks: GoalCheck[] = [];

  switch (ctx.page) {
    case 'discover':
      checks.push(...icpChecks);
      if (ctx.selectedNicheId) {
        checks.push(...hubChecks);
      }
      break;
    case 'contacts':
      checks.push(...relationshipChecks);
      if (ctx.viewingContactId) {
        checks.push(...hubChecks);
      }
      break;
    case 'dashboard':
      checks.push(...icpChecks);
      checks.push(...relationshipChecks);
      break;
    case 'network':
      checks.push(...hubChecks);
      break;
    default:
      checks.push(...icpChecks.slice(0, 1));
      break;
  }

  // Limit to MAX_CONTEXT_CHECKS
  return checks.slice(0, MAX_CONTEXT_CHECKS);
}

/**
 * Select random background checks.
 */
function selectBackgroundChecks(): GoalCheck[] {
  const shuffled = [...backgroundChecks].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, MAX_BACKGROUND_CHECKS);
}

/**
 * Main tick function — called on every user interaction.
 */
export async function tick(ctx: TickContext): Promise<TickResult> {
  const newGoals: GoalCandidate[] = [];
  const errors: string[] = [];

  // Gather checks
  const contextCheckFns = selectContextChecks(ctx);
  const bgCheckFns = selectBackgroundChecks();
  const allChecks = [...contextCheckFns, ...bgCheckFns];

  // Run all checks in parallel
  const results = await Promise.allSettled(
    allChecks.map((check) => check(ctx))
  );

  // Collect candidates
  const candidates: GoalCandidate[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      candidates.push(...result.value);
    }
    // Silently skip failed checks — don't block the tick
  }

  // Dedup + suppression filter
  for (const candidate of candidates) {
    const ctxHash = candidate.metadata.contextHash;

    // Check suppression (3 rejections)
    if (await isSuppressed(candidate.metadata.checkType, ctxHash)) {
      continue;
    }

    // Check dedup (already active/suggested)
    if (await isDuplicate(candidate.goalType, ctxHash)) {
      continue;
    }

    // Create the goal in DB with status 'suggested'
    await query(
      `INSERT INTO goals (title, description, goal_type, status, priority, target_metric, target_value, current_value, source, metadata)
       VALUES ($1, $2, $3, 'suggested', $4, $5, $6, $7, 'system', $8)`,
      [
        candidate.title,
        candidate.description,
        candidate.goalType,
        candidate.priority,
        candidate.targetMetric ?? null,
        candidate.targetValue ?? null,
        candidate.currentValue ?? 0,
        JSON.stringify(candidate.metadata),
      ]
    );

    newGoals.push(candidate);

    // Cap at 2 new goals per tick to avoid toast spam
    if (newGoals.length >= 2) break;
  }

  // Check for system errors to surface
  try {
    // Embedding health
    const embCount = await query<{ c: string }>('SELECT count(id)::text AS c FROM profile_embeddings');
    const contactCount = await query<{ c: string }>(
      'SELECT count(*)::text AS c FROM contacts WHERE is_archived = FALSE AND degree > 0'
    );
    const embTotal = parseInt(embCount.rows[0].c, 10);
    const ctTotal = parseInt(contactCount.rows[0].c, 10);
    if (ctTotal > 0 && embTotal < ctTotal * 0.5) {
      errors.push(`Embeddings incomplete: ${embTotal}/${ctTotal} contacts. Go to Admin > Data Management > Reindex.`);
    }
  } catch {
    // Non-critical
  }

  return { newGoals, errors };
}

/**
 * Accept a suggested goal — changes status to 'active' and creates suggested tasks.
 */
export async function acceptGoal(goalId: string): Promise<void> {
  const goalResult = await query<{ metadata: string; goal_type: string }>(
    `UPDATE goals SET status = 'active' WHERE id = $1 AND status = 'suggested'
     RETURNING metadata::text, goal_type`,
    [goalId]
  );

  if (goalResult.rows.length === 0) return;

  const metadata = JSON.parse(goalResult.rows[0].metadata);

  // Record acceptance feedback
  await query(
    `INSERT INTO goal_check_feedback (check_type, goal_type, context_hash, accepted)
     VALUES ($1, $2, $3, TRUE)`,
    [metadata.checkType, goalResult.rows[0].goal_type, metadata.contextHash]
  );

  // Create suggested tasks
  const suggestedTasks = metadata.suggestedTasks ?? [];
  for (const task of suggestedTasks) {
    await query(
      `INSERT INTO tasks (goal_id, title, description, task_type, priority, url, contact_id, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'system')`,
      [goalId, task.title, task.description, task.taskType, task.priority, task.url ?? null, task.contactId ?? null]
    );
  }
}

/**
 * Reject a suggested goal — changes status to 'rejected' and records feedback.
 */
export async function rejectGoal(goalId: string): Promise<void> {
  const goalResult = await query<{ metadata: string; goal_type: string }>(
    `UPDATE goals SET status = 'rejected' WHERE id = $1 AND status = 'suggested'
     RETURNING metadata::text, goal_type`,
    [goalId]
  );

  if (goalResult.rows.length === 0) return;

  const metadata = JSON.parse(goalResult.rows[0].metadata);

  // Record rejection feedback
  await query(
    `INSERT INTO goal_check_feedback (check_type, goal_type, context_hash, accepted)
     VALUES ($1, $2, $3, FALSE)`,
    [metadata.checkType, goalResult.rows[0].goal_type, metadata.contextHash]
  );
}
