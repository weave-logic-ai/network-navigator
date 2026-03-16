// GET /api/extension/health
// Lightweight health check for the extension (called every 30s)

import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { healthCheck, query } from '@/lib/db/client';
import { wsServer } from '@/lib/websocket/ws-server';

const startTime = Date.now();

export async function GET(req: NextRequest) {
  return withExtensionAuth(req, async () => {
    try {
      // DB check with timeout
      const dbConnected = await Promise.race([
        healthCheck(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);

      // Pending parse jobs
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

      const wsConnected = wsServer.isRunning;
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (!dbConnected) {
        status = 'unhealthy';
      } else if (!wsConnected) {
        status = 'degraded';
      }

      return NextResponse.json({
        status,
        version: '2.0.0',
        dbConnected,
        wsConnected,
        pendingParseJobs,
        uptime: uptimeSeconds,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Health] Error:', error);
      return NextResponse.json(
        {
          status: 'unhealthy',
          version: '2.0.0',
          dbConnected: false,
          wsConnected: false,
          pendingParseJobs: 0,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
  });
}
