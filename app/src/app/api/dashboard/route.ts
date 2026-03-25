// GET /api/dashboard - Aggregate dashboard data

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

export async function GET() {
  try {
    // Run all independent queries in parallel
    const [
      contactCountResult,
      tierResult,
      enrichedResult,
      budgetResult,
      recentImportsResult,
      edgesResult,
      embeddingsResult,
      graphComputedResult,
      activeGoalResult,
      pendingTasksResult,
      pendingTaskCountResult,
      avgScoreResult,
      recentNichesResult,
      recentIcpsResult,
    ] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM contacts WHERE NOT is_archived`
      ),
      query<{ tier: string; count: string }>(
        `SELECT COALESCE(cs.tier, 'unscored') AS tier, COUNT(*)::text AS count
         FROM contacts c
         LEFT JOIN contact_scores cs ON cs.contact_id = c.id
         WHERE NOT c.is_archived
         GROUP BY COALESCE(cs.tier, 'unscored')`
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM person_enrichments`
      ),
      query<{
        budget_cents: number;
        spent_cents: number;
        lookup_count: number;
      }>(
        `SELECT budget_cents, spent_cents, lookup_count
         FROM budget_periods
         ORDER BY period_start DESC
         LIMIT 1`
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM import_sessions
         WHERE started_at > NOW() - INTERVAL '7 days'`
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM edges`
      ),
      query<{ count: string }>(
        `SELECT COUNT(id)::text AS count FROM profile_embeddings`
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM graph_metrics WHERE pagerank > 0`
      ),
      // Active goal with highest priority
      query<{
        id: string;
        title: string;
        current_value: number;
        target_value: number;
        deadline: string | null;
        priority: number;
      }>(
        `SELECT g.id, g.title, g.current_value, g.target_value,
                g.deadline::text, g.priority
         FROM goals g
         WHERE g.status = 'active'
         ORDER BY g.priority ASC, g.created_at DESC
         LIMIT 1`
      ),
      // Next 5 pending tasks by priority
      query<{
        id: string;
        title: string;
        priority: number;
        due_date: string | null;
        url: string | null;
        task_type: string;
      }>(
        `SELECT id, title, priority, due_date::text, url, task_type
         FROM tasks
         WHERE status = 'pending'
         ORDER BY priority ASC, due_date ASC NULLS LAST
         LIMIT 5`
      ),
      // Pending task count
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tasks WHERE status = 'pending'`
      ),
      // Average composite score
      query<{ avg_score: number }>(
        `SELECT COALESCE(AVG(composite_score), 0)::real AS avg_score
         FROM contact_scores`
      ),
      // Recent niches
      query<{ id: string; name: string; member_count: number; niche_score: number | null; created_at: string }>(
        `SELECT id, name, member_count, niche_score, created_at::text
         FROM niche_profiles
         ORDER BY created_at DESC
         LIMIT 5`
      ),
      // Recent ICPs
      query<{ id: string; name: string; created_at: string }>(
        `SELECT id, name, created_at::text
         FROM icp_profiles
         ORDER BY created_at DESC
         LIMIT 5`
      ),
    ]);

    // Parse contact count
    const totalContacts = parseInt(contactCountResult.rows[0]?.count ?? '0', 10);

    // Parse tier distribution with unscored
    const tierDistribution: Record<string, number> = {
      gold: 0, silver: 0, bronze: 0, watch: 0, unscored: 0,
    };
    for (const row of tierResult.rows) {
      const tier = row.tier;
      if (tier in tierDistribution) {
        tierDistribution[tier] = parseInt(row.count, 10);
      }
    }

    // Parse enrichment count and rate
    const enrichedCount = parseInt(enrichedResult.rows[0]?.count ?? '0', 10);
    const enrichmentRate = totalContacts > 0 ? enrichedCount / totalContacts : 0;

    // Parse budget
    const budgetRow = budgetResult.rows[0];
    const budgetCents = budgetRow?.budget_cents ?? 0;
    const spentCents = budgetRow?.spent_cents ?? 0;
    const lookupCount = budgetRow?.lookup_count ?? 0;
    const utilization = budgetCents > 0 ? spentCents / budgetCents : 0;

    // Parse recent imports
    const recentImports = parseInt(recentImportsResult.rows[0]?.count ?? '0', 10);

    // Parse network health
    const totalEdges = parseInt(edgesResult.rows[0]?.count ?? '0', 10);
    const embeddingsGenerated = parseInt(embeddingsResult.rows[0]?.count ?? '0', 10);
    const graphMetricsCount = parseInt(graphComputedResult.rows[0]?.count ?? '0', 10);
    const graphMetricsComputed = graphMetricsCount > 0;

    // Data maturity score (0-100)
    const hasContacts = totalContacts > 0 ? 20 : 0;
    const enrichmentCoverage = Math.min(30, Math.round(enrichmentRate * 30));
    const hasGraph = graphMetricsComputed ? 25 : 0;
    const embeddingCoverage = totalContacts > 0
      ? Math.min(25, Math.round((embeddingsGenerated / totalContacts) * 25))
      : 0;
    const dataMaturity = hasContacts + enrichmentCoverage + hasGraph + embeddingCoverage;

    // Active goal
    const activeGoal = activeGoalResult.rows[0] ?? null;

    // Pending tasks with priority label
    const pendingTaskCount = parseInt(pendingTaskCountResult.rows[0]?.count ?? '0', 10);
    const pendingTasks = pendingTasksResult.rows.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority <= 3 ? 'high' : t.priority <= 6 ? 'medium' : 'low',
      due_date: t.due_date,
      url: t.url,
      task_type: t.task_type,
    }));

    // Average score
    const avgScore = avgScoreResult.rows[0]?.avg_score ?? 0;

    // Recent discoveries
    const recentDiscoveries = [
      ...recentNichesResult.rows.map((n) => ({
        type: 'niche' as const,
        id: n.id,
        name: n.name,
        score: n.niche_score,
        memberCount: n.member_count,
        createdAt: n.created_at,
      })),
      ...recentIcpsResult.rows.map((p) => ({
        type: 'icp' as const,
        id: p.id,
        name: p.name,
        score: null,
        memberCount: null,
        createdAt: p.created_at,
      })),
    ].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 5);

    // Build recent activity from import sessions
    const activityResult = await query<{
      status: string;
      new_records: number;
      updated_records: number;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      `SELECT status, new_records, updated_records, started_at, completed_at
       FROM import_sessions
       ORDER BY created_at DESC
       LIMIT 10`
    );

    const recentActivity = activityResult.rows.map((row) => {
      const timestamp = (row.completed_at ?? row.started_at)?.toISOString() ?? new Date().toISOString();
      if (row.status === 'completed') {
        return {
          type: 'import',
          message: `Imported ${row.new_records} new, ${row.updated_records} updated contacts`,
          timestamp,
        };
      }
      return {
        type: 'import',
        message: `Import ${row.status}`,
        timestamp,
      };
    });

    return NextResponse.json({
      data: {
        stats: {
          totalContacts,
          tierDistribution,
          enrichedCount,
          enrichmentRate,
          recentImports,
        },
        budget: {
          budgetCents,
          spentCents,
          utilization,
          lookupCount,
        },
        recentActivity,
        networkHealth: {
          dataMaturity,
          graphMetricsComputed,
          embeddingsGenerated,
          totalEdges,
          avgScore,
        },
        // Phase 3 additions
        activeGoal,
        pendingTasks,
        pendingTaskCount,
        recentDiscoveries,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load dashboard data', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
