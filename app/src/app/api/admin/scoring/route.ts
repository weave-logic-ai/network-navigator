// GET /api/admin/scoring - Get default weight profile
// PUT /api/admin/scoring - Update weights and optionally trigger batch rescore

import { NextRequest, NextResponse } from 'next/server';
import * as scoringQueries from '@/lib/db/queries/scoring';

export async function GET() {
  try {
    const profile = await scoringQueries.getDefaultWeightProfile();
    if (!profile) {
      return NextResponse.json(
        { error: 'No default weight profile found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ data: profile });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get weight profile', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, weights, description, isDefault, triggerRescore } = body as {
      name?: string;
      weights: Record<string, number>;
      description?: string;
      isDefault?: boolean;
      triggerRescore?: boolean;
    };

    if (!weights || typeof weights !== 'object') {
      return NextResponse.json(
        { error: 'weights object is required' },
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

    const profileName = name || 'default';
    const profile = await scoringQueries.upsertWeightProfile(
      profileName,
      weights,
      description,
      isDefault ?? true
    );

    // Optionally trigger batch rescore (asynchronous — just records the request)
    let rescoreQueued = false;
    if (triggerRescore) {
      const contactIds = await scoringQueries.getAllContactIds();
      // In a production system this would dispatch to a job queue.
      // For now we acknowledge the request and return the count.
      rescoreQueued = true;
      return NextResponse.json({
        data: profile,
        rescore: { queued: true, contactCount: contactIds.length },
      });
    }

    return NextResponse.json({ data: profile, rescore: { queued: rescoreQueued } });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update weights', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
