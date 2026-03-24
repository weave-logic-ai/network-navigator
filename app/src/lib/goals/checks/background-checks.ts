// Background checks — system health, data quality, ran randomly each tick

import { query } from '../../db/client';
import { contextHash } from '../engine';
import type { TickContext, GoalCandidate, GoalCheck } from '../types';

const CHECK_STALE_SCORES = 'stale-scores';
const CHECK_NO_ICPS = 'no-icp-profiles';
const CHECK_GOAL_STALE = 'goal-stale';
const CHECK_ORPHAN_CONTACTS = 'orphan-contacts';

async function staleScores(_ctx: TickContext): Promise<GoalCandidate[]> {
  const result = await query<{ total: string; scored: string; stale: string }>(
    `SELECT
       (SELECT count(*)::text FROM contacts WHERE is_archived = FALSE AND degree > 0) AS total,
       (SELECT count(*)::text FROM contact_scores) AS scored,
       (SELECT count(*)::text FROM contact_scores WHERE computed_at < NOW() - INTERVAL '30 days') AS stale`
  );

  const total = parseInt(result.rows[0].total, 10);
  const scored = parseInt(result.rows[0].scored, 10);
  const stale = parseInt(result.rows[0].stale, 10);
  const unscored = total - scored;

  if (total < 10) return [];
  if (unscored < total * 0.3 && stale < scored * 0.3) return [];

  const hash = contextHash(CHECK_STALE_SCORES, {});

  if (unscored > total * 0.3) {
    return [{
      title: `${unscored} contacts need scoring`,
      description: `${unscored} of ${total} contacts haven't been scored. Run a batch scoring job to prioritize your network.`,
      goalType: CHECK_STALE_SCORES,
      priority: 4,
      targetMetric: 'scored_contacts',
      targetValue: total,
      currentValue: scored,
      metadata: {
        engine: 'background',
        checkType: CHECK_STALE_SCORES,
        contextHash: hash,
        suggestedTasks: [{
          title: 'Run batch scoring',
          description: 'Go to Admin > Scoring Weights and run "Rescore All" to score all contacts.',
          taskType: 'manual',
          priority: 3,
        }],
      },
    }];
  }

  return [{
    title: `${stale} contact scores are stale (>30 days)`,
    description: `${stale} contacts were last scored over 30 days ago. Rescoring will pick up changes in their profiles and your ICP criteria.`,
    goalType: CHECK_STALE_SCORES,
    priority: 5,
    metadata: {
      engine: 'background',
      checkType: CHECK_STALE_SCORES,
      contextHash: hash,
      suggestedTasks: [{
        title: 'Rescore stale contacts',
        description: 'Run batch rescoring to update stale scores.',
        taskType: 'manual',
        priority: 4,
      }],
    },
  }];
}

async function noIcpProfiles(_ctx: TickContext): Promise<GoalCandidate[]> {
  const result = await query<{ c: string }>(
    'SELECT count(*)::text AS c FROM icp_profiles WHERE is_active = TRUE'
  );
  if (parseInt(result.rows[0].c, 10) > 0) return [];

  const hash = contextHash(CHECK_NO_ICPS, {});

  return [{
    title: 'Create your first ICP profile',
    description: 'You have no active ICP profiles. Define your ideal customer to start matching contacts and generating leads.',
    goalType: CHECK_NO_ICPS,
    priority: 1,
    metadata: {
      engine: 'background',
      checkType: CHECK_NO_ICPS,
      contextHash: hash,
      suggestedTasks: [{
        title: 'Create an ICP profile',
        description: 'Go to Discover > ICPs tab > "New ICP" and define role patterns, industries, and signals.',
        taskType: 'manual',
        priority: 1,
      }],
    },
  }];
}

async function goalStale(_ctx: TickContext): Promise<GoalCandidate[]> {
  const result = await query<{ id: string; title: string; days: string }>(
    `SELECT g.id, g.title,
            EXTRACT(DAY FROM NOW() - g.updated_at)::text AS days
     FROM goals g
     WHERE g.status = 'active'
       AND g.updated_at < NOW() - INTERVAL '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM tasks t WHERE t.goal_id = g.id AND t.status IN ('in_progress', 'completed')
           AND t.updated_at > NOW() - INTERVAL '7 days'
       )
     ORDER BY g.updated_at ASC
     LIMIT 1`
  );

  if (result.rows.length === 0) return [];

  const goal = result.rows[0];
  const hash = contextHash(CHECK_GOAL_STALE, { goalId: goal.id });

  return [{
    title: `Stalled goal: "${goal.title}"`,
    description: `This goal has had no task activity in ${goal.days} days. Review it — complete, update, or cancel.`,
    goalType: CHECK_GOAL_STALE,
    priority: 5,
    metadata: {
      engine: 'background',
      checkType: CHECK_GOAL_STALE,
      contextHash: hash,
      suggestedTasks: [{
        title: `Review goal: ${goal.title}`,
        description: 'Open the Tasks page and review this goal. Either pick up a task, create new tasks, or cancel the goal.',
        taskType: 'manual',
        priority: 4,
      }],
    },
  }];
}

async function orphanContacts(_ctx: TickContext): Promise<GoalCandidate[]> {
  // Contacts with no tags, no score, and not matching any niche
  const result = await query<{ c: string }>(
    `SELECT count(*)::text AS c FROM contacts c
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     WHERE c.is_archived = FALSE AND c.degree > 0
       AND cs.id IS NULL
       AND (c.tags IS NULL OR array_length(c.tags, 1) IS NULL)`
  );

  const count = parseInt(result.rows[0].c, 10);
  if (count < 20) return [];

  const hash = contextHash(CHECK_ORPHAN_CONTACTS, {});

  return [{
    title: `${count} contacts are unclassified`,
    description: `${count} contacts have no score, no tags, and don't match any niche. Run Rescore All from Admin, or review niche keywords to improve coverage.`,
    goalType: CHECK_ORPHAN_CONTACTS,
    priority: 5,
    targetMetric: 'unclassified_contacts',
    targetValue: 0,
    currentValue: count,
    metadata: {
      engine: 'background',
      checkType: CHECK_ORPHAN_CONTACTS,
      contextHash: hash,
      suggestedTasks: [
        {
          title: 'Run Rescore All',
          description: 'Go to Admin > Scoring Weights and click "Rescore All" to score all unscored contacts.',
          taskType: 'scoring',
          priority: 2,
          url: '/admin',
        },
        {
          title: 'Run full reindex (Admin > Data Management)',
          description: 'Rebuild embeddings and niche counts. Go to Admin > Data Management > Reindex.',
          taskType: 'manual',
          priority: 3,
          url: '/admin',
        },
        {
          title: 'Review niche keywords for better coverage',
          description: 'Go to Discover > Niches tab and check if your niche keywords match how your contacts describe themselves.',
          taskType: 'manual',
          priority: 4,
          url: '/discover',
        },
      ],
    },
  }];
}

export const backgroundChecks: GoalCheck[] = [staleScores, noIcpProfiles, goalStale, orphanContacts];
