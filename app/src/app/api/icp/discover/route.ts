// GET /api/icp/discover - Discover ICPs from data (read-only, no auto-save)
// POST /api/icp/discover - Save a discovered ICP with de-duplication

import { NextRequest, NextResponse } from 'next/server';
import { discoverIcps } from '@/lib/graph/icp-discovery';
import { saveDiscoveredIcp } from '@/lib/taxonomy/discovery';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minSize = parseInt(searchParams.get('minSize') || '3', 10);

    const discoveries = await discoverIcps(minSize);

    return NextResponse.json({
      data: {
        discoveries,
        totalDiscovered: discoveries.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to discover ICPs', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { nicheId, discovery } = body as {
      nicheId: string;
      discovery: Parameters<typeof saveDiscoveredIcp>[0];
    };

    if (!nicheId || !discovery) {
      return NextResponse.json(
        { error: 'nicheId and discovery are required' },
        { status: 400 }
      );
    }

    if (!discovery.suggestedName || !discovery.criteria) {
      return NextResponse.json(
        { error: 'discovery must include suggestedName and criteria' },
        { status: 400 }
      );
    }

    const result = await saveDiscoveredIcp(discovery, nicheId);
    return NextResponse.json({ data: result }, { status: result.action === 'created' ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save discovered ICP', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
