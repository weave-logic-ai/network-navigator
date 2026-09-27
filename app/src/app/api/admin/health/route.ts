// GET /api/admin/health - System health check

import { NextResponse } from 'next/server';
import { query, healthCheck } from '@/lib/db/client';
import * as enrichmentQueries from '@/lib/db/queries/enrichment';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';

interface HealthCheck {
  status: 'healthy' | 'degraded';
  checks: {
    db: { connected: boolean; latencyMs?: number };
    providers: Array<{ name: string; active: boolean }>;
    counts: Record<string, number>;
    diskUsage?: { dbSizeBytes: number; dbSizeHuman: string };
    parser: { enabled: boolean; checked: boolean; lastRollupDay: string | null; error?: string };
  };
  error?: string;
}

export async function GET() {
  const health: HealthCheck = {
    status: 'healthy',
    checks: {
      db: { connected: false },
      providers: [],
      counts: {},
      parser: { enabled: RESEARCH_FLAGS.parserTelemetry, checked: false, lastRollupDay: null },
    },
  };
  try {
    // DB connection check with latency measurement
    const dbStart = Date.now();
    const dbOk = await healthCheck();
    const dbLatency = Date.now() - dbStart;
    health.checks.db = { connected: dbOk, latencyMs: dbLatency };

    if (!dbOk) {
      health.status = 'degraded';
      return NextResponse.json(health, { status: 503 });
    }

    // Table row counts
    const tableCounts = await getTableCounts();
    health.checks.counts = tableCounts;

    // Provider status
    const providers = await enrichmentQueries.listProviders();
    health.checks.providers = providers.map(p => ({
      name: p.name,
      active: p.isActive,
    }));

    if (RESEARCH_FLAGS.parserTelemetry) {
      try {
        const rollup = await query<{ last_rollup_day: string | null }>(
          `SELECT MAX(day)::text AS last_rollup_day FROM parse_field_outcomes_daily`
        );
        health.checks.parser.lastRollupDay = rollup.rows[0]?.last_rollup_day ?? null;
        health.checks.parser.checked = true;
      } catch {
        health.status = 'degraded';
        health.checks.parser.checked = true;
        health.checks.parser.error = 'Unable to read parser rollup status';
      }
    }

    // DB size estimate
    try {
      const sizeResult = await query<{ size_bytes: string; size_human: string }>(
        `SELECT pg_database_size(current_database())::text AS size_bytes,
                pg_size_pretty(pg_database_size(current_database())) AS size_human`
      );
      if (sizeResult.rows.length > 0) {
        health.checks.diskUsage = {
          dbSizeBytes: parseInt(sizeResult.rows[0].size_bytes, 10),
          dbSizeHuman: sizeResult.rows[0].size_human,
        };
      }
    } catch {
      // Non-critical — some DB configs may restrict pg_database_size
    }

    return NextResponse.json(health, { status: health.status === 'degraded' ? 503 : 200 });
  } catch (error) {
    health.status = 'degraded';
    health.error = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      health,
      { status: 503 }
    );
  }
}

async function getTableCounts(): Promise<Record<string, number>> {
  const tables = ['contacts', 'goals', 'tasks', 'enrichment_transactions', 'action_log'];
  const counts: Record<string, number> = {};

  for (const table of tables) {
    try {
      const result = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${table}`
      );
      counts[table] = parseInt(result.rows[0].count, 10);
    } catch {
      counts[table] = -1; // table may not exist
    }
  }

  return counts;
}
