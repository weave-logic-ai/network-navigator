// GET /api/icp/profiles - List ICP profiles (optionally filtered by nicheId)
// POST /api/icp/profiles - Create ICP profile

import { NextRequest, NextResponse } from 'next/server';
import * as scoringQueries from '@/lib/db/queries/scoring';
import { listIcpsByNiche } from '@/lib/db/queries/icps';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nicheId = searchParams.get('nicheId');

    if (nicheId) {
      const icps = await listIcpsByNiche(nicheId);
      return NextResponse.json({ data: icps });
    }

    const profiles = await scoringQueries.listIcpProfiles();
    return NextResponse.json({ data: profiles });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list ICP profiles', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, criteria, weightOverrides, nicheId } = body as {
      name: string;
      description?: string;
      criteria: Record<string, unknown>;
      weightOverrides?: Record<string, number>;
      nicheId?: string;
    };

    if (!name || !criteria) {
      return NextResponse.json(
        { error: 'name and criteria are required' },
        { status: 400 }
      );
    }

    const profile = await scoringQueries.createIcpProfile({
      name,
      description,
      criteria: criteria as import('@/lib/scoring/types').IcpCriteria,
      weightOverrides,
      nicheId,
    });

    return NextResponse.json({ data: profile }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create ICP profile', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
