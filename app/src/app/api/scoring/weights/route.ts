// GET /api/scoring/weights - Get active weight profile
// PUT /api/scoring/weights - Update weights

import { NextRequest, NextResponse } from 'next/server';
import * as scoringQueries from '@/lib/db/queries/scoring';

export async function GET() {
  try {
    const profiles = await scoringQueries.listWeightProfiles();
    return NextResponse.json({ data: profiles });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get weight profiles', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, weights, description, isDefault } = body as {
      name: string;
      weights: Record<string, number>;
      description?: string;
      isDefault?: boolean;
    };

    if (!name || !weights) {
      return NextResponse.json(
        { error: 'name and weights are required' },
        { status: 400 }
      );
    }

    // Validate weights sum to ~1.0
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      return NextResponse.json(
        { error: `Weights must sum to 1.0 (got ${sum.toFixed(4)})` },
        { status: 400 }
      );
    }

    const profile = await scoringQueries.upsertWeightProfile(name, weights, description, isDefault);
    return NextResponse.json({ data: profile });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update weights', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
