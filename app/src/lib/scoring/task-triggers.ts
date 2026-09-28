// Auto-generate tasks when a contact's score changes significantly.
// The owner pipeline passes forceInline and a pg client so tasks commit with
// the score and ICP fits. ECC task handlers skip scoring impulses carrying
// scoreTasksCommitted, including retries after a pending task is completed.
// Other callers retain the legacy impulse handoff guard below.

import { query } from '@/lib/db/client';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { CompositeScore } from './types';
import { CONTACT_RECOMMENDATION_ELIGIBLE_SQL, contactDisplayName, hasLinkedIdentity, identityFromRow, isExternalContact, type ContactIdentityRow } from '@/lib/contacts/identity';
import { requireIdentityTaskIndexes } from '@/lib/contacts/task-schema';

export interface ScoreTaskWriteOptions {
  client?: PoolClient;
  forceInline?: boolean;
  source?: 'auto-score' | 'impulse';
  identityOnly?: boolean;
}

const ECC_IMPULSES_ENABLED = process.env.ECC_IMPULSES === 'true';

/**
 * Check score transitions and generate tasks when thresholds are crossed.
 * Deduplicates by (task_type, contact_id, source, status='pending').
 *
 * @param impulsesEmitterInvoked - Legacy guard for callers that leave task
 * creation to ECC. The owner pipeline uses forceInline for atomic writes.
 */
export async function checkAndGenerateTasks(
  contactId: string,
  oldScore: CompositeScore | null,
  newScore: CompositeScore,
  impulsesEmitterInvoked: boolean = false,
  options: ScoreTaskWriteOptions = {}
): Promise<void> {
  const runQuery = <T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>> =>
    options.client ? options.client.query<T>(sql, params) : query<T>(sql, params);
  const source = options.source ?? 'auto-score';
  // Legacy callers may still leave task generation to ECC handlers.
  if (ECC_IMPULSES_ENABLED && !options.forceInline) {
    if (!impulsesEmitterInvoked) {
      // Misconfiguration guard: ECC_IMPULSES is on, but whoever called us did
      // not go through the wired path in scoring/pipeline.ts that dispatches
      // emitScoringImpulses first. Nothing is generating tasks for this score
      // change — log loudly instead of failing silently.
      console.error(
        `[scoring] ECC_IMPULSES is enabled but no impulse emitter ran for contact ${contactId}. ` +
          'Automatic task generation is disabled for this score change and nothing replaced it. ' +
          'Use the owner scoring transaction or emit scoring impulses before calling checkAndGenerateTasks.'
      );
    }
    return;
  }

  // Degree zero is the imported owner identity; missing identity is a repair task.
  const contactResult = await runQuery<ContactIdentityRow>(
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
  } else if (!options.identityOnly) {
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

  if (tasks.length > 0) await requireIdentityTaskIndexes(options.client);

  // Both generator sources use database uniqueness for concurrent deduplication.
  for (const task of tasks) {
    if (task.taskType === 'REPAIR_IDENTITY') {
      await runQuery(
        `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source, url)
         SELECT $1, $2, $3, 'pending', $4, $5::uuid, $7, $6
         FROM contacts c WHERE c.id = $5::uuid AND c.is_archived = FALSE AND c.degree > 0
           AND COALESCE(c.linkedin_url !~* '^self:', TRUE)
           AND NOT COALESCE((${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}), FALSE)
         FOR SHARE OF c
         ON CONFLICT (contact_id) WHERE task_type = 'REPAIR_IDENTITY' AND status = 'pending'
           AND source IN ('auto-score', 'impulse')
         DO NOTHING`,
        [task.title, task.description, task.taskType, task.priority, contactId, `/contacts/${contactId}`, source]
      );
      continue;
    }
    await runQuery(
      `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source, url)
       SELECT $1, $2, $3, 'pending', $4, $5::uuid, $7, $6
       FROM contacts c WHERE c.id = $5::uuid AND ${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}
       FOR SHARE OF c
       ON CONFLICT (contact_id, source, task_type)
         WHERE status = 'pending' AND source IN ('auto-score', 'impulse')
           AND task_type IN ('SEND_MESSAGE', 'RESEARCH', 'ENGAGE_CONTENT')
       DO NOTHING`,
      [task.title, task.description, task.taskType, task.priority, contactId, `/contacts/${contactId}`, source]
    );
  }
}
