// GET /api/profile/network-health - Aggregate network health metrics

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

export interface NetworkHealth {
  // Coverage
  totalContacts: number;
  addressedContacts: number;
  addressedPct: number;

  // Scoring distribution
  scoredContacts: number;
  tierDistribution: {
    gold: number;
    silver: number;
    bronze: number;
    watch: number;
    unscored: number;
  };
  avgCompositeScore: number;

  // Relationship health (derived from message_stats.last_message_at)
  relationshipDistribution: {
    strong: number;
    warm: number;
    cooling: number;
    dormant: number;
    unknown: number;
  };

  // Data completeness
  avgCompleteness: number;
  missingEmailCount: number;
  missingTitleCount: number;
  missingCompanyCount: number;

  // Embedding health
  embeddingCount: number;
  embeddingPct: number;

  // Activity
  recentConnections: number;
  activeGoals: number;
  pendingTasks: number;

  computedAt: string;
}

export async function GET() {
  try {
    const [
      totalResult,
      addressedResult,
      tierResult,
      scoredResult,
      avgScoreResult,
      relationshipResult,
      completenessResult,
      embeddingResult,
      recentConnectionsResult,
      activeGoalsResult,
      pendingTasksResult,
    ] = await Promise.all([
      // Total non-archived contacts
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM contacts WHERE NOT is_archived`
      ),

      // Addressed contacts: those with at least one ICP fit
      query<{ count: string }>(
        `SELECT COUNT(DISTINCT cif.contact_id)::text AS count
         FROM contact_icp_fits cif
         JOIN contacts c ON c.id = cif.contact_id
         WHERE NOT c.is_archived`
      ),

      // Tier distribution
      query<{ tier: string; count: string }>(
        `SELECT COALESCE(cs.tier, 'unscored') AS tier, COUNT(*)::text AS count
         FROM contacts c
         LEFT JOIN contact_scores cs ON cs.contact_id = c.id
         WHERE NOT c.is_archived
         GROUP BY COALESCE(cs.tier, 'unscored')`
      ),

      // Scored contacts (have a contact_scores row)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM contact_scores cs
         JOIN contacts c ON c.id = cs.contact_id
         WHERE NOT c.is_archived`
      ),

      // Average composite score
      query<{ avg_score: number }>(
        `SELECT COALESCE(AVG(cs.composite_score), 0)::real AS avg_score
         FROM contact_scores cs
         JOIN contacts c ON c.id = cs.contact_id
         WHERE NOT c.is_archived`
      ),

      // Relationship distribution based on last_message_at
      // strong: < 30 days, warm: 30-90, cooling: 90-180, dormant: > 180, unknown: no stats
      query<{ bucket: string; count: string }>(
        `SELECT bucket, COUNT(*)::text AS count FROM (
           SELECT
             CASE
               WHEN ms.last_message_at IS NULL THEN 'unknown'
               WHEN ms.last_message_at > NOW() - INTERVAL '30 days' THEN 'strong'
               WHEN ms.last_message_at > NOW() - INTERVAL '90 days' THEN 'warm'
               WHEN ms.last_message_at > NOW() - INTERVAL '180 days' THEN 'cooling'
               ELSE 'dormant'
             END AS bucket
           FROM contacts c
           LEFT JOIN message_stats ms ON ms.contact_id = c.id
           WHERE NOT c.is_archived
         ) sub
         GROUP BY bucket`
      ),

      // Data completeness: count nulls for email, title, current_company
      query<{
        total: string;
        missing_email: string;
        missing_title: string;
        missing_company: string;
        completeness_sum: string;
      }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE email IS NULL OR email = '')::text AS missing_email,
           COUNT(*) FILTER (WHERE title IS NULL OR title = '')::text AS missing_title,
           COUNT(*) FILTER (WHERE current_company IS NULL OR current_company = '')::text AS missing_company,
           SUM(
             (CASE WHEN email IS NOT NULL AND email <> '' THEN 1 ELSE 0 END) +
             (CASE WHEN title IS NOT NULL AND title <> '' THEN 1 ELSE 0 END) +
             (CASE WHEN current_company IS NOT NULL AND current_company <> '' THEN 1 ELSE 0 END) +
             (CASE WHEN headline IS NOT NULL AND headline <> '' THEN 1 ELSE 0 END) +
             (CASE WHEN location IS NOT NULL AND location <> '' THEN 1 ELSE 0 END) +
             (CASE WHEN about IS NOT NULL AND about <> '' THEN 1 ELSE 0 END)
           )::text AS completeness_sum
         FROM contacts
         WHERE NOT is_archived`
      ),

      // Embedding count
      query<{ count: string }>(
        `SELECT COUNT(id)::text AS count FROM profile_embeddings`
      ),

      // Recent connections (created in last 30 days)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM contacts
         WHERE NOT is_archived
           AND created_at > NOW() - INTERVAL '30 days'`
      ),

      // Active goals
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM goals WHERE status = 'active'`
      ),

      // Pending tasks
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tasks WHERE status = 'pending'`
      ),
    ]);

    const totalContacts = parseInt(totalResult.rows[0]?.count ?? '0', 10);
    const addressedContacts = parseInt(addressedResult.rows[0]?.count ?? '0', 10);
    const addressedPct = totalContacts > 0 ? addressedContacts / totalContacts : 0;

    const tierDistribution = { gold: 0, silver: 0, bronze: 0, watch: 0, unscored: 0 };
    for (const row of tierResult.rows) {
      const tier = row.tier as keyof typeof tierDistribution;
      if (tier in tierDistribution) {
        tierDistribution[tier] = parseInt(row.count, 10);
      }
    }

    const scoredContacts = parseInt(scoredResult.rows[0]?.count ?? '0', 10);
    const avgCompositeScore = avgScoreResult.rows[0]?.avg_score ?? 0;

    const relationshipDistribution = {
      strong: 0, warm: 0, cooling: 0, dormant: 0, unknown: 0,
    };
    for (const row of relationshipResult.rows) {
      const bucket = row.bucket as keyof typeof relationshipDistribution;
      if (bucket in relationshipDistribution) {
        relationshipDistribution[bucket] = parseInt(row.count, 10);
      }
    }

    const compRow = completenessResult.rows[0];
    const totalForComp = parseInt(compRow?.total ?? '0', 10);
    // 6 fields tracked for completeness
    const maxCompleteness = totalForComp * 6;
    const completenessSum = parseInt(compRow?.completeness_sum ?? '0', 10);
    const avgCompleteness = maxCompleteness > 0 ? completenessSum / maxCompleteness : 0;
    const missingEmailCount = parseInt(compRow?.missing_email ?? '0', 10);
    const missingTitleCount = parseInt(compRow?.missing_title ?? '0', 10);
    const missingCompanyCount = parseInt(compRow?.missing_company ?? '0', 10);

    const embeddingCount = parseInt(embeddingResult.rows[0]?.count ?? '0', 10);
    const embeddingPct = totalContacts > 0 ? embeddingCount / totalContacts : 0;

    const recentConnections = parseInt(recentConnectionsResult.rows[0]?.count ?? '0', 10);
    const activeGoals = parseInt(activeGoalsResult.rows[0]?.count ?? '0', 10);
    const pendingTasks = parseInt(pendingTasksResult.rows[0]?.count ?? '0', 10);

    const data: NetworkHealth = {
      totalContacts,
      addressedContacts,
      addressedPct,
      scoredContacts,
      tierDistribution,
      avgCompositeScore,
      relationshipDistribution,
      avgCompleteness,
      missingEmailCount,
      missingTitleCount,
      missingCompanyCount,
      embeddingCount,
      embeddingPct,
      recentConnections,
      activeGoals,
      pendingTasks,
      computedAt: new Date().toISOString(),
    };

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to compute network health',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
