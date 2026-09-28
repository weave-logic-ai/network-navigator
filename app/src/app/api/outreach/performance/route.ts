import { NextRequest, NextResponse } from 'next/server';
import { getTemplatePerformanceStats } from '@/lib/db/queries/outreach';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ data: await getTemplatePerformanceStats() });
  } catch {
    return NextResponse.json({ error: 'Failed to load event performance' }, { status: 500 });
  }
}
