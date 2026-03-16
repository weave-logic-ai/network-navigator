// GET /api/icp/discover - Discover ICPs from data and auto-save as profiles

import { NextRequest, NextResponse } from 'next/server';
import { discoverIcps, createIcpFromDiscovery } from '@/lib/graph/icp-discovery';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minSize = parseInt(searchParams.get('minSize') || '3', 10);

    const discoveries = await discoverIcps(minSize);

    // Auto-save discovered ICPs as profiles (skip low-confidence ones)
    const saved: Array<{ id: string; name: string }> = [];
    for (const discovery of discoveries) {
      if (discovery.confidence < 0.1) continue;
      try {
        const profile = await createIcpFromDiscovery(discovery);
        saved.push(profile);
      } catch {
        // Skip duplicates or errors
      }
    }

    return NextResponse.json({
      data: {
        discoveries,
        savedProfiles: saved,
        totalDiscovered: discoveries.length,
        totalSaved: saved.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to discover ICPs', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
