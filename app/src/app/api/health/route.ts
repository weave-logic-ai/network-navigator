// GET /api/health - system health check

import { NextResponse } from 'next/server';
import { healthCheck, query } from '@/lib/db/client';

const startTime = Date.now();

export async function GET() {
  const dbHealthy = await healthCheck();
  let version = 'unknown';

  if (dbHealthy) {
    try {
      const result = await query<{ version: string }>(
        "SELECT version FROM schema_versions ORDER BY applied_at DESC LIMIT 1"
      );
      if (result.rows.length > 0) {
        version = result.rows[0].version;
      }
    } catch {
      // Schema versions table may not exist yet
    }
  }

  const uptimeMs = Date.now() - startTime;
  const status = dbHealthy ? 'ok' : 'error';

  return NextResponse.json(
    {
      status,
      db: dbHealthy,
      uptime: uptimeMs,
      version,
    },
    { status: dbHealthy ? 200 : 503 }
  );
}
