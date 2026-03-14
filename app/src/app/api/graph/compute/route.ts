// POST /api/graph/compute - Trigger graph computation

import { NextResponse } from 'next/server';
import { computeAllMetrics } from '@/lib/graph/metrics';
import { detectCommunities } from '@/lib/graph/communities';

export async function POST() {
  try {
    const [metrics, communities] = await Promise.all([
      computeAllMetrics(),
      detectCommunities(),
    ]);

    return NextResponse.json({
      data: {
        metricsComputed: metrics.length,
        communitiesDetected: communities.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to compute graph', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
