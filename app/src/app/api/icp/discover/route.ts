// GET /api/icp/discover - Discover ICPs from data

import { NextRequest, NextResponse } from 'next/server';
import { discoverIcps } from '@/lib/graph/icp-discovery';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minSize = parseInt(searchParams.get('minSize') || '3', 10);

    const discoveries = await discoverIcps(minSize);
    return NextResponse.json({ data: discoveries });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to discover ICPs', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
