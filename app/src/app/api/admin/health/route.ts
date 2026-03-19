// GET /api/admin/health - System health check

import { NextResponse } from 'next/server';
import { query, healthCheck } from '@/lib/db/client';
import * as enrichmentQueries from '@/lib/db/queries/enrichment';

interface HealthCheck {
  status: 'healthy' | 'degraded';
  checks: {
    db: { connected: boolean; latencyMs?: number };
    providers: Array<{ name: string; active: boolean }>;
    counts: Record<string, number>;
    diskUsage?: { dbSizeBytes: number; dbSizeHuman: string };
  };
}

export async function GET() {
  try {
    const health: HealthCheck = {
      status: 'healthy',
      checks: {
        db: { connected: false },
        providers: [],
        counts: {},
      },
    };

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

    return NextResponse.json(health);
  } catch (error) {
    return NextResponse.json(
      {
        status: 'degraded',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
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
