// GET /api/enrichment/providers - List providers with status

import { NextResponse } from 'next/server';
import * as enrichmentQueries from '@/lib/db/queries/enrichment';
import { publicProvider } from '@/lib/enrichment/providers';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  try {
    const providers = await enrichmentQueries.listProviders();
    return NextResponse.json({ data: providers.map(publicProvider) });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list providers', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
