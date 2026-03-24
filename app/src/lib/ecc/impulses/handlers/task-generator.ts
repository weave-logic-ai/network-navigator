import { query } from '../../../db/client';
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

  // Get contact name for task titles
  const contactResult = await query<{ full_name: string }>(
    'SELECT full_name FROM contacts WHERE id = $1',
    [contactId]
  );
  const name = contactResult.rows[0]?.full_name ?? 'Unknown Contact';

  const tasks: Array<{ title: string; description: string; taskType: string; priority: number }> = [];

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

    default:
      return { tasksCreated: 0, reason: 'no_matching_rules' };
  }

  // Insert tasks with dedup (same pattern as original task-triggers.ts)
  let created = 0;
  for (const task of tasks) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM tasks
       WHERE task_type = $1 AND contact_id = $2 AND source = 'impulse' AND status = 'pending'
       LIMIT 1`,
      [task.taskType, contactId]
    );

    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source)
         VALUES ($1, $2, $3, 'pending', $4, $5, 'impulse')`,
        [task.title, task.description, task.taskType, task.priority, contactId]
      );
      created++;
    }
  }

  return { tasksCreated: created, tasksSkipped: tasks.length - created };
}
