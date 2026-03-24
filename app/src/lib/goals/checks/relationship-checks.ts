// Relationship Strength engine checks — new connections, cooling leads

import { query } from '../../db/client';
import { contextHash } from '../engine';
import type { TickContext, GoalCandidate, GoalCheck } from '../types';

const CHECK_NEW_CONNECTION = 'new-connection-window';
const CHECK_WARM_COOLING = 'warm-lead-cooling';

async function newConnectionWindow(ctx: TickContext): Promise<GoalCandidate[]> {
  // Find contacts connected in the last 7 days with no outreach
  const result = await query<{
    id: string; name: string; title: string | null; connected_days: string;
  }>(
    `SELECT c.id,
            COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
            c.title,
            EXTRACT(DAY FROM NOW() - c.created_at)::text AS connected_days
     FROM contacts c
     WHERE c.is_archived = FALSE AND c.degree = 1
       AND c.created_at > NOW() - INTERVAL '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM tasks t WHERE t.contact_id = c.id
           AND t.task_type IN ('SEND_MESSAGE', 'outreach')
           AND t.status IN ('pending', 'in_progress', 'completed')
       )
     ORDER BY c.created_at DESC
     LIMIT 3`
  );

  if (result.rows.length === 0) return [];

  const count = result.rows.length;
  const first = result.rows[0];
  const hash = contextHash(CHECK_NEW_CONNECTION, {});

  return [{
    title: `Welcome ${count} new connection${count > 1 ? 's' : ''} — optimal outreach window`,
    description: `${result.rows.map(r => r.name).join(', ')} connected recently. The first 7 days after connecting have the highest response rate.`,
    goalType: CHECK_NEW_CONNECTION,
    priority: 2,
    targetMetric: 'outreach_sent',
    targetValue: count,
    currentValue: 0,
    metadata: {
      engine: 'relationship_strength',
      checkType: CHECK_NEW_CONNECTION,
      contextHash: hash,
      suggestedTasks: result.rows.map((r) => ({
        title: `Welcome message to ${r.name}`,
        description: `Send a personalized welcome message to ${r.name} (${r.title || 'new connection'}). Reference how you connected or shared interests.`,
        taskType: 'SEND_MESSAGE',
        priority: 2,
        contactId: r.id,
      })),
    },
  }];
}

async function warmLeadCooling(ctx: TickContext): Promise<GoalCandidate[]> {
  if (ctx.page !== 'contacts' && ctx.page !== 'discover' && ctx.page !== 'dashboard') return [];

  // Find gold/silver contacts whose last message is 30-90 days ago
  const result = await query<{
    id: string; name: string; tier: string; days_since: string;
  }>(
    `SELECT c.id,
            COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
            cs.tier,
            EXTRACT(DAY FROM NOW() - ms.last_message_at)::text AS days_since
     FROM contacts c
     JOIN contact_scores cs ON cs.contact_id = c.id
     JOIN message_stats ms ON ms.contact_id = c.id
     WHERE c.is_archived = FALSE
       AND cs.tier IN ('gold', 'silver')
       AND ms.last_message_at BETWEEN NOW() - INTERVAL '90 days' AND NOW() - INTERVAL '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.task_type = 'SEND_MESSAGE' AND t.status = 'pending'
       )
     ORDER BY cs.composite_score DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) return [];

  const contact = result.rows[0];
  const days = parseInt(contact.days_since, 10);
  const hash = contextHash(CHECK_WARM_COOLING, { contactId: contact.id });

  return [{
    title: `${contact.name} is cooling off — ${days}d since last contact`,
    description: `${contact.name} (${contact.tier} tier) hasn't had interaction in ${days} days. Re-engage before the relationship goes cold.`,
    goalType: CHECK_WARM_COOLING,
    priority: 3,
    metadata: {
      engine: 'relationship_strength',
      checkType: CHECK_WARM_COOLING,
      contextHash: hash,
      suggestedTasks: [{
        title: `Re-engage ${contact.name}`,
        description: `Send a value-add message: share an article, congratulate on something, or ask for their take on a topic.`,
        taskType: 'SEND_MESSAGE',
        priority: 2,
        contactId: contact.id,
      }],
    },
  }];
}

export const relationshipChecks: GoalCheck[] = [newConnectionWindow, warmLeadCooling];
