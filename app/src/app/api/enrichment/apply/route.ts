// POST /api/enrichment/apply - Apply user-reviewed enrichment fields to a contact

import { NextRequest, NextResponse } from 'next/server';
import { triggerAutoScore } from '@/lib/scoring/auto-score';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { readSignedEnrichmentQuote } from '@/lib/enrichment/quote';
import { applyReviewedEnrichment } from '@/lib/db/queries/enrichment-apply';

interface ApplyField {
  field: string;
  value: string;
}

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { contactId, fields, quote } = body as {
      contactId: string;
      fields: ApplyField[];
      quote: string;
    };

    if (typeof contactId !== 'string' || !Array.isArray(fields) || fields.length === 0
      || fields.length > 100 || typeof quote !== 'string'
      || fields.some(item => !item || typeof item.field !== 'string' || typeof item.value !== 'string')
      || new Set(fields.map(item => item.field)).size !== fields.length) {
      return NextResponse.json(
        { error: 'A quote, contactId and reviewed fields[] are required' },
        { status: 400 }
      );
    }

    const signed = readSignedEnrichmentQuote(quote);
    if (!signed || !signed.contactIds.includes(contactId)) {
      return NextResponse.json({ error: 'Quote does not authorize this contact' }, { status: 409 });
    }
    const applied = await applyReviewedEnrichment(signed.id, contactId, fields);
    if (applied.state === 'conflict' || applied.state === 'missing') {
      return NextResponse.json({ error: applied.error }, { status: applied.state === 'missing' ? 404 : 409 });
    }
    if (applied.state === 'applied') triggerAutoScore(contactId);

    return NextResponse.json({
      data: {
        contactId,
        fieldsApplied: applied.appliedFields.length,
        appliedFields: applied.appliedFields,
        replayed: applied.state === 'replayed',
        scoringTriggered: applied.state === 'applied',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to apply enrichment', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
