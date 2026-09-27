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
import { CONTACT_RECOMMENDATION_ELIGIBLE_SQL, contactDisplayName, hasLinkedIdentity, identityFromRow, isExternalContact, type ContactIdentityRow } from '@/lib/contacts/identity';
import { requireIdentityTaskIndexes } from '@/lib/contacts/task-schema';

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

  // Degree zero is the imported owner identity; missing identity is a repair task.
  const contactResult = await query<ContactIdentityRow>(
    `SELECT full_name, first_name, last_name, linkedin_url, degree, is_archived
     FROM contacts WHERE id = $1`,
    [contactId]
  );
  const contact = contactResult.rows[0];
  if (!contact || !isExternalContact(contact)) return;
  const identity = identityFromRow(contact);
  const name = contactDisplayName(identity);

  const tasks: Array<{
    title: string;
    description: string;
    taskType: string;
    priority: number;
  }> = [];

  if (!hasLinkedIdentity(identity)) {
    tasks.push({
      title: `Verify identity for ${name ?? 'contact'}`,
      description: 'Review this contact’s name and LinkedIn profile before outreach.',
      taskType: 'REPAIR_IDENTITY',
      priority: 1,
    });
  } else {
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
  }

  if (tasks.length > 0) await requireIdentityTaskIndexes();

  // Both generator sources use database uniqueness for concurrent deduplication.
  for (const task of tasks) {
    if (task.taskType === 'REPAIR_IDENTITY') {
      await query(
        `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source, url)
         SELECT $1, $2, $3, 'pending', $4, $5::uuid, 'auto-score', $6
         FROM contacts c WHERE c.id = $5::uuid AND c.is_archived = FALSE AND c.degree > 0
           AND COALESCE(c.linkedin_url !~* '^self:', TRUE)
           AND NOT COALESCE((${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}), FALSE)
         FOR SHARE OF c
         ON CONFLICT (contact_id) WHERE task_type = 'REPAIR_IDENTITY' AND status = 'pending'
           AND source IN ('auto-score', 'impulse')
         DO NOTHING`,
        [task.title, task.description, task.taskType, task.priority, contactId, `/contacts/${contactId}`]
      );
      continue;
    }
    await query(
      `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source, url)
       SELECT $1, $2, $3, 'pending', $4, $5::uuid, 'auto-score', $6
       FROM contacts c WHERE c.id = $5::uuid AND ${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}
       FOR SHARE OF c
       ON CONFLICT (contact_id, source, task_type)
         WHERE status = 'pending' AND source IN ('auto-score', 'impulse')
           AND task_type IN ('SEND_MESSAGE', 'RESEARCH', 'ENGAGE_CONTENT')
       DO NOTHING`,
      [task.title, task.description, task.taskType, task.priority, contactId, `/contacts/${contactId}`]
    );
  }
}
