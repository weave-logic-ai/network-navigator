// PUT /api/enrichment/providers/[id] - Update provider config

import { NextRequest, NextResponse } from 'next/server';
import * as enrichmentQueries from '@/lib/db/queries/enrichment';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { apiBaseUrl, isActive, config, rateLimitPerMinute } = body as {
      apiBaseUrl?: string;
      isActive?: boolean;
      config?: Record<string, unknown>;
      rateLimitPerMinute?: number;
    };

    const provider = await enrichmentQueries.updateProvider(id, {
      apiBaseUrl,
      isActive,
      config,
      rateLimitPerMinute,
    });

    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    return NextResponse.json({ data: provider });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update provider', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
