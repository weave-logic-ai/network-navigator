// Auto-generate tasks when a contact's score changes significantly.
// Called from the scoring pipeline after upsertContactScore.
// NOTE: When ECC_IMPULSES=true, task generation is handled by the impulse system
// (see lib/ecc/impulses/handlers/task-generator.ts). This file remains as the
// fallback path when the impulse system is disabled.

import { query } from '@/lib/db/client';
import type { CompositeScore } from './types';

const ECC_IMPULSES_ENABLED = process.env.ECC_IMPULSES === 'true';

/**
 * Check score transitions and generate tasks when thresholds are crossed.
 * Deduplicates by (task_type, contact_id, source='auto-score', status='pending').
 */
export async function checkAndGenerateTasks(
  contactId: string,
  oldScore: CompositeScore | null,
  newScore: CompositeScore
): Promise<void> {
  // When ECC impulse system is active, task generation is handled by impulse handlers.
  // The impulse scoring-adapter emits tier_changed/persona_assigned impulses,
  // and the task-generator handler creates the same tasks.
  if (ECC_IMPULSES_ENABLED) {
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
