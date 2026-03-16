// GET /api/extension/health-internal - Health check without token auth (for app UI)

import { NextResponse } from 'next/server';
import { healthCheck, query } from '@/lib/db/client';

const startTime = Date.now();

export async function GET() {
  try {
    const dbConnected = await Promise.race([
      healthCheck(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);

    let pendingParseJobs = 0;
    if (dbConnected) {
      try {
        const result = await query<{ count: string }>(
          'SELECT count(*) FROM page_cache WHERE parsed = false'
        );
        pendingParseJobs = parseInt(result.rows[0].count, 10);
      } catch {
        // Non-critical
      }
    }

    return NextResponse.json({
      status: dbConnected ? 'healthy' : 'unhealthy',
      dbConnected,
      wsConnected: false,
      pendingParseJobs,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  } catch {
    return NextResponse.json(
      { status: 'unhealthy', dbConnected: false, wsConnected: false, pendingParseJobs: 0, uptime: 0 },
      { status: 503 }
    );
  }
}
