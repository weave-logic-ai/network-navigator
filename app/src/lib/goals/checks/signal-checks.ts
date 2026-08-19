// Signal Boost engine checks — role/title changes, content engagement
//
// Data note: docs/plans/goal-engine.md also specifies a `hiring-signal` check
// ("[Company] is hiring engineers"). That is intentionally NOT implemented
// here: there is no job-posting or company hiring-keyword table anywhere in
// the schema (data/db/init/*.sql has no such table, and no importer/scraper
// populates one). Building it would mean inventing a signal the app doesn't
// actually collect.

import { query } from '../../db/client';
import { contextHash } from '../engine';
import type { TickContext, GoalCandidate, GoalCheck } from '../types';

const CHECK_ROLE_CHANGE = 'role-change-detected';
const CHECK_CONTENT_ENGAGEMENT = 'content-engagement';

async function roleChangeDetected(_ctx: TickContext): Promise<GoalCandidate[]> {
  // The import pipeline already diffs title/company per contact on every
  // import and records it in import_change_log (see
  // app/src/lib/import/deduplication.ts: computeFieldDiff/isJobChange).
  // We surface the most recent undismissed one as a goal candidate.
  const result = await query<{
    id: string;
    name: string;
    new_title: string | null;
    old_title: string | null;
    new_company: string | null;
  }>(
    `SELECT icl.contact_id AS id,
            COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
            icl.new_values->>'title' AS new_title,
            icl.old_values->>'title' AS old_title,
            COALESCE(icl.new_values->>'current_company', c.current_company) AS new_company
     FROM import_change_log icl
     JOIN contacts c ON c.id = icl.contact_id
     WHERE icl.change_type = 'updated'
       AND (icl.field_changes @> '["title"]'::jsonb OR icl.field_changes @> '["current_company"]'::jsonb)
       AND icl.created_at > NOW() - INTERVAL '14 days'
       AND c.is_archived = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM tasks t WHERE t.contact_id = icl.contact_id
           AND t.task_type = 'congratulate' AND t.status IN ('pending', 'in_progress', 'completed')
       )
     ORDER BY icl.created_at DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) return [];

  const row = result.rows[0];
  if (!row.new_title) return []; // Only the company changed — not a role/title change

  const atCompany = row.new_company ? ` at ${row.new_company}` : '';
  const hash = contextHash(CHECK_ROLE_CHANGE, { contactId: row.id });

  return [{
    title: `${row.name} is now ${row.new_title}${atCompany} — outreach window`,
    description: `${row.name}'s title changed${row.old_title ? ` from "${row.old_title}"` : ''} to "${row.new_title}"${atCompany}. Recent role changes are a strong window for re-engagement.`,
    goalType: CHECK_ROLE_CHANGE,
    priority: 2,
    metadata: {
      engine: 'signal_boost',
      checkType: CHECK_ROLE_CHANGE,
      contextHash: hash,
      suggestedTasks: [{
        title: `Congratulate ${row.name} on the new role`,
        description: `Send a short congratulations message referencing their new role${atCompany}.`,
        taskType: 'congratulate',
        priority: 2,
        contactId: row.id,
      }],
    },
  }];
}

async function contentEngagement(_ctx: TickContext): Promise<GoalCandidate[]> {
  // content_profiles.topics is populated by the legacy-graph import path
  // (app/src/app/api/import/legacy-graph/route.ts) — sparse but real.
  const result = await query<{
    id: string;
    name: string;
    topics: string[];
    offering_id: string;
    offering_name: string;
  }>(
    `SELECT c.id,
            COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
            cp.topics,
            o.id AS offering_id,
            o.name AS offering_name
     FROM content_profiles cp
     JOIN contacts c ON c.id = cp.contact_id
     JOIN offerings o ON o.is_active = TRUE
     WHERE c.is_archived = FALSE
       AND cp.topics IS NOT NULL AND array_length(cp.topics, 1) > 0
       AND EXISTS (
         SELECT 1 FROM unnest(cp.topics) topic
         WHERE o.name ILIKE '%' || topic || '%' OR o.description ILIKE '%' || topic || '%'
       )
       AND NOT EXISTS (
         SELECT 1 FROM tasks t WHERE t.contact_id = c.id
           AND t.task_type = 'engage_content' AND t.status IN ('pending', 'in_progress', 'completed')
       )
     ORDER BY cp.avg_engagement DESC NULLS LAST
     LIMIT 1`
  );

  if (result.rows.length === 0) return [];

  const row = result.rows[0];
  const hash = contextHash(CHECK_CONTENT_ENGAGEMENT, { contactId: row.id, offeringId: row.offering_id });

  return [{
    title: `${row.name} is posting about topics that fit "${row.offering_name}"`,
    description: `${row.name}'s recent content covers ${row.topics.join(', ')}, which aligns with your "${row.offering_name}" offering. Engage now while it's top of mind for them.`,
    goalType: CHECK_CONTENT_ENGAGEMENT,
    priority: 3,
    metadata: {
      engine: 'signal_boost',
      checkType: CHECK_CONTENT_ENGAGEMENT,
      contextHash: hash,
      suggestedTasks: [{
        title: `Comment on ${row.name}'s recent post`,
        description: `Engage with ${row.name}'s content and position "${row.offering_name}" naturally in the conversation.`,
        taskType: 'engage_content',
        priority: 3,
        contactId: row.id,
      }],
    },
  }];
}

export const signalChecks: GoalCheck[] = [roleChangeDetected, contentEngagement];
