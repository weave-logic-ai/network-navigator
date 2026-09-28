import { query } from '../../../db/client';
import { CONTACT_RECOMMENDATION_ELIGIBLE_SQL, contactDisplayName, hasLinkedIdentity, identityFromRow, isExternalContact, type ContactIdentityRow } from '../../../contacts/identity';
import { requireIdentityTaskIndexes } from '../../../contacts/task-schema';
import type { Impulse } from '../../types';

/**
 * Generate tasks from scoring impulses.
 * Migrated from scoring/task-triggers.ts -- same dedup logic, driven by impulses instead of inline.
 */
export async function executeTaskGenerator(
  impulse: Impulse,
  _config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const contactId = impulse.sourceEntityId;
  const payload = impulse.payload;

  if (!['tier_changed', 'persona_assigned', 'score_computed'].includes(impulse.impulseType)) {
    return { tasksCreated: 0, reason: 'no_matching_rules' };
  }

  // Owner scoring commits tasks with the score. A queued scoring impulse must
  // not recreate a task after that task has already been completed.
  if (payload.scoreTasksCommitted === true) {
    return { tasksCreated: 0, reason: 'committed_with_score' };
  }

  const contactResult = await query<ContactIdentityRow>(
    `SELECT full_name, first_name, last_name, linkedin_url, degree, is_archived
     FROM contacts WHERE id = $1`,
    [contactId]
  );
  const contact = contactResult.rows[0];
  if (!contact || !isExternalContact(contact)) {
    return { tasksCreated: 0, reason: 'ineligible_contact' };
  }
  const identity = identityFromRow(contact);
  const name = contactDisplayName(identity);

  const tasks: Array<{ title: string; description: string; taskType: string; priority: number }> = [];

  if (!hasLinkedIdentity(identity)) {
    tasks.push({
      title: `Verify identity for ${name ?? 'contact'}`,
      description: 'Review this contact’s name and LinkedIn profile before outreach.',
      taskType: 'REPAIR_IDENTITY',
      priority: 1,
    });
  } else {
    switch (impulse.impulseType) {
      case 'tier_changed': {
        const newTier = payload.to as string;
        if (newTier === 'gold') {
          tasks.push({
            title: `Send personalized intro to ${name}`,
            description: `${name} reached Gold tier (from ${payload.from}). Craft a personalized introduction message.`,
            taskType: 'SEND_MESSAGE',
            priority: 1,
          });
        }
        break;
      }

      case 'persona_assigned': {
        const newPersona = payload.to as string;
        if (newPersona === 'buyer') {
          tasks.push({
            title: `Research ${name}'s company for service fit`,
            description: `${name} is classified as a buyer persona. Research their company to identify service fit.`,
            taskType: 'RESEARCH',
            priority: 2,
          });
        }
        break;
      }

      case 'score_computed': {
        const referralPersona = payload.referralPersona as string | undefined;
        const behavioralPersona = payload.behavioralPersona as string | undefined;

        if (referralPersona === 'warm-introducer') {
          tasks.push({
            title: `Ask ${name} for introductions to their network`,
            description: `${name} is a warm-introducer. Leverage this relationship for introductions.`,
            taskType: 'SEND_MESSAGE',
            priority: 3,
          });
        }

        if (behavioralPersona === 'super-connector') {
          tasks.push({
            title: `Engage with ${name}'s content before outreach`,
            description: `${name} is a super-connector. Warm up by engaging their content first.`,
            taskType: 'ENGAGE_CONTENT',
            priority: 4,
          });
        }
        break;
      }
    }
  }

  if (tasks.length > 0) await requireIdentityTaskIndexes();

  // Insert tasks with database-backed deduplication across concurrent runs.
  let created = 0;
  for (const task of tasks) {
    if (task.taskType === 'REPAIR_IDENTITY') {
      const inserted = await query<{ id: string }>(
        `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source, url)
         SELECT $1, $2, $3, 'pending', $4, $5::uuid, 'impulse', $6
         FROM contacts c WHERE c.id = $5::uuid AND c.is_archived = FALSE AND c.degree > 0
           AND COALESCE(c.linkedin_url !~* '^self:', TRUE)
           AND NOT COALESCE((${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}), FALSE)
         FOR SHARE OF c
         ON CONFLICT (contact_id) WHERE task_type = 'REPAIR_IDENTITY' AND status = 'pending'
           AND source IN ('auto-score', 'impulse')
         DO NOTHING RETURNING id`,
        [task.title, task.description, task.taskType, task.priority, contactId, `/contacts/${contactId}`]
      );
      created += inserted.rows.length;
      continue;
    }
    const inserted = await query<{ id: string }>(
      `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source, url)
       SELECT $1, $2, $3, 'pending', $4, $5::uuid, 'impulse', $6
       FROM contacts c WHERE c.id = $5::uuid AND ${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}
       FOR SHARE OF c
       ON CONFLICT (contact_id, source, task_type)
         WHERE status = 'pending' AND source IN ('auto-score', 'impulse')
           AND task_type IN ('SEND_MESSAGE', 'RESEARCH', 'ENGAGE_CONTENT')
       DO NOTHING RETURNING id`,
      [task.title, task.description, task.taskType, task.priority, contactId, `/contacts/${contactId}`]
    );
    created += inserted.rows.length;
  }

  return { tasksCreated: created, tasksSkipped: tasks.length - created };
}
