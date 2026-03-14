// GET /api/icp/profiles - List ICP profiles
// POST /api/icp/profiles - Create ICP profile

import { NextRequest, NextResponse } from 'next/server';
import * as scoringQueries from '@/lib/db/queries/scoring';

export async function GET() {
  try {
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
    const { name, description, criteria, weightOverrides } = body as {
      name: string;
      description?: string;
      criteria: Record<string, unknown>;
      weightOverrides?: Record<string, number>;
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
    });

    return NextResponse.json({ data: profile }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create ICP profile', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
