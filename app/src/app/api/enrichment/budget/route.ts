// GET /api/enrichment/budget - Budget status

import { NextRequest, NextResponse } from 'next/server';
import { getBudgetStatus } from '@/lib/enrichment/budget';
import { createCurrentMonthlyBudget } from '@/lib/db/queries/enrichment';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  try {
    const status = await getBudgetStatus();
    return NextResponse.json({ data: status });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get budget status', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const cents = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).budgetCents : undefined;
  if (!Number.isSafeInteger(cents) || (cents as number) < 1 || (cents as number) > 100000000) {
    return NextResponse.json({ error: 'budgetCents must be a whole number from 1 to 100000000' }, { status: 400 });
  }
  try {
    const period = await createCurrentMonthlyBudget(cents as number);
    if (!period) return NextResponse.json({ error: 'A budget period is already configured for today' }, { status: 409 });
    return NextResponse.json({ data: await getBudgetStatus() }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create budget period' }, { status: 500 });
  }
}
