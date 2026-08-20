// Content/Skills Relevance engine checks — skill cluster gaps, offering alignment
//
// Data note: contacts have no dedicated skills column/table. The scoring
// pipeline already treats contacts.tags as a skills proxy (see
// app/src/lib/db/queries/scoring.ts: "skills: row.tags || [] // tags as
// proxy for skills", consumed by app/src/lib/scoring/scorers/skills-relevance.ts).
// These checks follow that same established convention rather than
// inventing a new per-contact skills signal.

import { query } from '../../db/client';
import { contextHash } from '../engine';
import type { TickContext, GoalCandidate, GoalCheck } from '../types';

const CHECK_SKILL_CLUSTER_GAP = 'skill-cluster-gap';
const CHECK_OFFERING_ALIGNMENT = 'offering-alignment';

async function skillClusterGap(ctx: TickContext): Promise<GoalCandidate[]> {
  if (!ctx.selectedNicheId) return [];

  const nicheResult = await query<{ name: string }>(
    'SELECT name FROM niche_profiles WHERE id = $1',
    [ctx.selectedNicheId]
  );
  if (nicheResult.rows.length === 0) return [];
  const nicheName = nicheResult.rows[0].name;

  // Niche membership is determined the same way icp-checks.ts's
  // unaddressedNetwork does: keyword match against title/headline (there is
  // no explicit niche-membership table). Within that membership, group by
  // tag (skills proxy) and find a cluster of 3+ contacts where none are
  // 1st-degree — i.e. a skill you know is present in the niche but haven't
  // connected into.
  const result = await query<{ tag: string; member_count: string }>(
    `WITH niche_members AS (
       SELECT c.id, c.tags, c.degree
       FROM contacts c, niche_profiles np
       WHERE np.id = $1
         AND c.is_archived = FALSE
         AND np.keywords IS NOT NULL AND array_length(np.keywords, 1) > 0
         AND EXISTS (
           SELECT 1 FROM unnest(np.keywords) kw
           WHERE c.title ILIKE '%' || kw || '%' OR c.headline ILIKE '%' || kw || '%'
         )
     )
     SELECT tag, count(*)::text AS member_count
     FROM niche_members, unnest(tags) AS tag
     GROUP BY tag
     HAVING count(*) >= 3 AND count(*) FILTER (WHERE degree = 1) = 0
     ORDER BY count(*) DESC
     LIMIT 1`,
    [ctx.selectedNicheId]
  );

  if (result.rows.length === 0) return [];

  const cluster = result.rows[0];
  const count = parseInt(cluster.member_count, 10);
  const hash = contextHash(CHECK_SKILL_CLUSTER_GAP, { nicheId: ctx.selectedNicheId, tag: cluster.tag });

  return [{
    title: `Skill gap in "${nicheName}": "${cluster.tag}" cluster has ${count} contacts, none connected`,
    description: `${count} contacts matching "${nicheName}" are tagged "${cluster.tag}", but you're not connected to any of them (2nd-degree only). Consider requesting introductions or searching directly.`,
    goalType: CHECK_SKILL_CLUSTER_GAP,
    priority: 4,
    targetMetric: 'connected_in_cluster',
    targetValue: 1,
    currentValue: 0,
    metadata: {
      engine: 'skills_relevance',
      checkType: CHECK_SKILL_CLUSTER_GAP,
      contextHash: hash,
      suggestedTasks: [{
        title: `Search LinkedIn for "${cluster.tag}" in "${nicheName}"`,
        description: `Search LinkedIn People for contacts tagged "${cluster.tag}" within your "${nicheName}" niche.`,
        taskType: 'expand_network',
        priority: 3,
        url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cluster.tag)}`,
      }],
    },
  }];
}

async function offeringAlignment(ctx: TickContext): Promise<GoalCandidate[]> {
  if (!ctx.selectedIcpId) return [];

  const result = await query<{
    id: string;
    name: string;
    offering_id: string;
    offering_name: string;
    fit_score: number;
  }>(
    `SELECT c.id,
            COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
            o.id AS offering_id,
            o.name AS offering_name,
            cif.fit_score
     FROM contact_icp_fits cif
     JOIN contacts c ON c.id = cif.contact_id
     JOIN icp_offerings io ON io.icp_id = cif.icp_profile_id
     JOIN offerings o ON o.id = io.offering_id AND o.is_active = TRUE
     WHERE cif.icp_profile_id = $1
       AND c.is_archived = FALSE
       AND cif.fit_score >= 0.7
       AND c.tags IS NOT NULL AND array_length(c.tags, 1) > 0
       AND EXISTS (
         SELECT 1 FROM unnest(c.tags) tag
         WHERE o.name ILIKE '%' || tag || '%' OR o.description ILIKE '%' || tag || '%'
       )
       AND NOT EXISTS (
         SELECT 1 FROM tasks t WHERE t.contact_id = c.id
           AND t.task_type = 'pitch_offering' AND t.status IN ('pending', 'in_progress', 'completed')
       )
     ORDER BY cif.fit_score DESC
     LIMIT 1`,
    [ctx.selectedIcpId]
  );

  if (result.rows.length === 0) return [];

  const row = result.rows[0];
  const pct = Math.round(row.fit_score * 100);
  const hash = contextHash(CHECK_OFFERING_ALIGNMENT, { contactId: row.id, offeringId: row.offering_id });

  return [{
    title: `${row.name} is ideal for "${row.offering_name}" — ${pct}% fit`,
    description: `${row.name}'s skills align with your "${row.offering_name}" offering (${pct}% ICP fit). Prepare a targeted pitch.`,
    goalType: CHECK_OFFERING_ALIGNMENT,
    priority: 2,
    metadata: {
      engine: 'skills_relevance',
      checkType: CHECK_OFFERING_ALIGNMENT,
      contextHash: hash,
      suggestedTasks: [{
        title: `Prepare "${row.offering_name}" pitch for ${row.name}`,
        description: `Draft a personalized pitch for "${row.offering_name}" tailored to ${row.name}'s background.`,
        taskType: 'pitch_offering',
        priority: 2,
        contactId: row.id,
      }],
    },
  }];
}

export const relevanceChecks: GoalCheck[] = [skillClusterGap, offeringAlignment];
