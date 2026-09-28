import { NextRequest, NextResponse } from 'next/server';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { listPendingEnrichmentReconciliations, reconcileEnrichmentCharge } from '@/lib/db/queries/enrichment';

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, false);
  if (denied) return denied;
  return NextResponse.json({ data: await listPendingEnrichmentReconciliations() });
}

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid reconciliation' }, { status: 400 });
  }
  const { quoteId, billedCents, invoiceReference } = body as Record<string, unknown>;
  if (typeof quoteId !== 'string' || !/^[0-9a-f-]{36}$/i.test(quoteId)
    || !Number.isSafeInteger(billedCents) || (billedCents as number) < 0
    || typeof invoiceReference !== 'string' || invoiceReference.trim().length < 3
    || invoiceReference.length > 200) {
    return NextResponse.json({ error: 'Quote UUID, verified billed cents and invoice reference required' }, { status: 400 });
  }
  try {
    const settled = await reconcileEnrichmentCharge(quoteId, billedCents as number, invoiceReference.trim());
    return settled ? NextResponse.json({ data: { quoteId, billedCents } })
      : NextResponse.json({ error: 'No pending request, or bill exceeds reserved amount. Use the runbook.' }, { status: 409 });
  } catch {
    return NextResponse.json({ error: 'Reconciliation failed; reservation remains locked' }, { status: 500 });
  }
}
