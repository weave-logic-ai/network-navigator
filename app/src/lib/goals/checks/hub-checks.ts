// Network Hub engine checks — connector leverage, unexplored hubs

import { query } from '../../db/client';
import { contextHash } from '../engine';
import type { TickContext, GoalCandidate, GoalCheck } from '../types';

const CHECK_HUB_UNEXPLORED = 'hub-unexplored';
const CHECK_HUB_DORMANT = 'hub-dormant';

async function hubUnexplored(ctx: TickContext): Promise<GoalCandidate[]> {
  // Find high-connection contacts who haven't been explored for 2nd-degree
  const result = await query<{
    id: string; name: string; connections_count: number; title: string | null;
  }>(
    `SELECT c.id,
            COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
            COALESCE(c.connections_count, 0) AS connections_count,
            c.title
     FROM contacts c
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     WHERE c.is_archived = FALSE AND c.degree = 1
       AND COALESCE(c.connections_count, 0) > 200
       AND NOT EXISTS (
         SELECT 1 FROM tasks t
         WHERE t.contact_id = c.id AND t.task_type = 'expand_network'
           AND t.status IN ('pending', 'in_progress', 'completed')
       )
     ORDER BY c.connections_count DESC NULLS LAST
     LIMIT 1`
  );

  if (result.rows.length === 0) return [];

  const hub = result.rows[0];
  const hash = contextHash(CHECK_HUB_UNEXPLORED, { contactId: hub.id });

  return [{
    title: `Explore ${hub.name}'s network (${hub.connections_count}+ connections)`,
    description: `${hub.name} (${hub.title || 'Contact'}) has ${hub.connections_count}+ connections and you haven't explored their 2nd-degree network yet. They could be a gateway to new contacts in your target niches.`,
    goalType: CHECK_HUB_UNEXPLORED,
    priority: 3,
    metadata: {
      engine: 'network_hub',
      checkType: CHECK_HUB_UNEXPLORED,
      contextHash: hash,
      suggestedTasks: [
        {
          title: `Browse ${hub.name}'s LinkedIn connections`,
          description: `Visit ${hub.name}'s LinkedIn profile and browse their connections for contacts matching your ICP criteria.`,
          taskType: 'expand_network',
          priority: 2,
          contactId: hub.id,
          url: 'https://www.linkedin.com/search/results/people/?network=%5B%22S%22%5D',
        },
        {
          title: `Send ${hub.name} a catch-up message`,
          description: `Re-engage with ${hub.name} before exploring their network. A warm relationship increases intro success.`,
          taskType: 'SEND_MESSAGE',
          priority: 3,
          contactId: hub.id,
        },
      ],
    },
  }];
}

async function hubDormant(ctx: TickContext): Promise<GoalCandidate[]> {
  if (ctx.page !== 'contacts' && ctx.page !== 'network' && ctx.page !== 'discover') return [];

  // Find high-score contacts with no recent messages
  const result = await query<{
    id: string; name: string; tier: string | null; last_msg: string | null; days_dormant: string;
  }>(
    `SELECT c.id,
            COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
            cs.tier,
            ms.last_message_at::text AS last_msg,
            EXTRACT(DAY FROM NOW() - COALESCE(ms.last_message_at, c.created_at))::text AS days_dormant
     FROM contacts c
     JOIN contact_scores cs ON cs.contact_id = c.id
     LEFT JOIN message_stats ms ON ms.contact_id = c.id
     WHERE c.is_archived = FALSE AND c.degree = 1
       AND cs.tier IN ('gold', 'silver')
       AND (ms.last_message_at IS NULL OR ms.last_message_at < NOW() - INTERVAL '60 days')
       AND NOT EXISTS (
         SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.task_type = 'SEND_MESSAGE' AND t.status = 'pending'
       )
     ORDER BY cs.composite_score DESC NULLS LAST
     LIMIT 1`
  );

  if (result.rows.length === 0) return [];

  const contact = result.rows[0];
  const days = parseInt(contact.days_dormant, 10);
  const hash = contextHash(CHECK_HUB_DORMANT, { contactId: contact.id });

  return [{
    title: `Re-engage ${contact.name} — ${contact.tier} tier, ${days}d dormant`,
    description: `${contact.name} is a ${contact.tier}-tier contact but hasn't had interaction in ${days} days. Re-engaging could unlock warm introductions.`,
    goalType: CHECK_HUB_DORMANT,
    priority: contact.tier === 'gold' ? 2 : 4,
    metadata: {
      engine: 'network_hub',
      checkType: CHECK_HUB_DORMANT,
      contextHash: hash,
      suggestedTasks: [{
        title: `Send catch-up message to ${contact.name}`,
        description: `Reach out to ${contact.name} with a personalized message. Reference shared context or recent activity.`,
        taskType: 'SEND_MESSAGE',
        priority: 2,
        contactId: contact.id,
      }],
    },
  }];
}

export const hubChecks: GoalCheck[] = [hubUnexplored, hubDormant];
