// Auto-generate tasks when a contact's score changes significantly.
// Called from the scoring pipeline after upsertContactScore.
// NOTE: When ECC_IMPULSES=true, task generation is handled by the impulse system
// (see lib/ecc/impulses/handlers/task-generator.ts). This file remains as the
// fallback path when the impulse system is disabled.
//
// The handoff to the impulse system is wired in `scoring/pipeline.ts`'s
// `scoreContact()`: it calls `emitScoringImpulses` (ecc/impulses/scoring-adapter.ts)
// immediately before calling this function, so the impulse scoring-adapter emits
// tier_changed/persona_assigned/score_computed impulses and the task-generator
// handler creates the same tasks from those impulses. That call site is the ONLY
// thing standing between "ECC_IMPULSES=true" and "task generation is silently
// disabled" — see the `impulsesEmitterInvoked` guard below, which existed to
// close exactly that gap once already (`emitScoringImpulses` had zero production
// callers despite this early-return assuming it did).

import { query } from '@/lib/db/client';
import type { CompositeScore } from './types';

const ECC_IMPULSES_ENABLED = process.env.ECC_IMPULSES === 'true';

/**
 * Check score transitions and generate tasks when thresholds are crossed.
 * Deduplicates by (task_type, contact_id, source='auto-score', status='pending').
 *
 * @param impulsesEmitterInvoked - Set by the caller to confirm the ECC impulse
 * emitter (`emitScoringImpulses`) was actually invoked for this score change
 * before calling this function. `scoring/pipeline.ts`'s `scoreContact()` always
 * passes `true` here, since it always calls the emitter immediately before this
 * function (the emitter itself no-ops when ECC_IMPULSES is off). Defaults to
 * `false` so any other/future call site that skips the emitter — the exact
 * misconfiguration that shipped once already — is caught below instead of
 * silently doing nothing.
 */
export async function checkAndGenerateTasks(
  contactId: string,
  oldScore: CompositeScore | null,
  newScore: CompositeScore,
  impulsesEmitterInvoked: boolean = false
): Promise<void> {
  // When ECC impulse system is active, task generation is handled by impulse handlers.
  // The impulse scoring-adapter emits tier_changed/persona_assigned impulses,
  // and the task-generator handler creates the same tasks.
  if (ECC_IMPULSES_ENABLED) {
    if (!impulsesEmitterInvoked) {
      // Misconfiguration guard: ECC_IMPULSES is on, but whoever called us did
      // not go through the wired path in scoring/pipeline.ts that dispatches
      // emitScoringImpulses first. Nothing is generating tasks for this score
      // change — log loudly instead of failing silently.
      console.error(
        `[scoring] ECC_IMPULSES is enabled but no impulse emitter ran for contact ${contactId}. ` +
          'Automatic task generation is disabled for this score change and nothing replaced it. ' +
          "Ensure this path goes through scoring/pipeline.ts's scoreContact(), which dispatches " +
          'emitScoringImpulses before calling checkAndGenerateTasks.'
      );
    }
    return;
  }

  // Fetch contact name for task titles
  const contactResult = await query<{ full_name: string }>(
    'SELECT full_name FROM contacts WHERE id = $1',
    [contactId]
  );
  const name = contactResult.rows[0]?.full_name ?? 'Unknown Contact';

  const tasks: Array<{
    title: string;
    description: string;
    taskType: string;
    priority: number;
  }> = [];

  // 1. Contact reaches Gold tier (was not gold before)
  const wasGold = oldScore?.tier === 'gold';
  if (newScore.tier === 'gold' && !wasGold) {
    tasks.push({
      title: `Send personalized intro to ${name}`,
      description: `${name} reached Gold tier. Craft a personalized introduction message.`,
      taskType: 'SEND_MESSAGE',
      priority: 1,
    });
  }

  // 2. Contact identified as buyer persona
  const wasBuyer = oldScore?.persona === 'buyer';
  if (newScore.persona === 'buyer' && !wasBuyer) {
    tasks.push({
      title: `Research ${name}'s company for service fit`,
      description: `${name} is classified as a buyer persona. Research their company to identify service fit.`,
      taskType: 'RESEARCH',
      priority: 2,
    });
  }

  // 3. Contact identified as warm-introducer referral persona
  const wasWarmIntroducer = oldScore?.referralPersona === 'warm-introducer';
  if (newScore.referralPersona === 'warm-introducer' && !wasWarmIntroducer) {
    tasks.push({
      title: `Ask ${name} for introductions to their network`,
      description: `${name} is a warm-introducer. Leverage this relationship for introductions.`,
      taskType: 'SEND_MESSAGE',
      priority: 3,
    });
  }

  // 4. Contact reaches 500+ connections (super-connector)
  const wasSuperConnector =
    oldScore?.behavioralPersona === 'super-connector';
  if (
    newScore.behavioralPersona === 'super-connector' &&
    !wasSuperConnector
  ) {
    tasks.push({
      title: `Engage with ${name}'s content before outreach`,
      description: `${name} is a super-connector with 500+ connections. Warm up by engaging their content first.`,
      taskType: 'ENGAGE_CONTENT',
      priority: 4,
    });
  }

  // Insert tasks, skipping duplicates
  for (const task of tasks) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM tasks
       WHERE task_type = $1 AND contact_id = $2 AND source = 'auto-score' AND status = 'pending'
       LIMIT 1`,
      [task.taskType, contactId]
    );

    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source)
         VALUES ($1, $2, $3, 'pending', $4, $5, 'auto-score')`,
        [task.title, task.description, task.taskType, task.priority, contactId]
      );
    }
  }
}
