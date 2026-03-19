// GET /api/contacts/[id]/enrichment-history - Enrichment history for a contact

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EnrichmentHistoryEntry {
  id: string;
  provider: string;
  providerDisplayName: string;
  date: string;
  fieldsReturned: string[];
  costCents: number;
  status: string;
  confidence: number | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid contact ID format' }, { status: 400 });
  }

  try {
    // Query enrichment_transactions joined with enrichment_providers
    const txResult = await query<{
      id: string;
      provider_name: string;
      provider_display_name: string;
      created_at: Date;
      fields_returned: string[];
      cost_cents: number;
      status: string;
    }>(
      `SELECT et.id, ep.name AS provider_name, ep.display_name AS provider_display_name,
              et.created_at, et.fields_returned, et.cost_cents, et.status
       FROM enrichment_transactions et
       JOIN enrichment_providers ep ON ep.id = et.provider_id
       WHERE et.contact_id = $1
       ORDER BY et.created_at DESC
       LIMIT 50`,
      [id]
    );

    // Also query person_enrichments for additional history
    const peResult = await query<{
      id: string;
      provider: string;
      enriched_fields: string[];
      confidence: number | null;
      cost_cents: number;
      enriched_at: Date;
    }>(
      `SELECT id, provider, enriched_fields, confidence, cost_cents, enriched_at
       FROM person_enrichments
       WHERE contact_id = $1
       ORDER BY enriched_at DESC
       LIMIT 50`,
      [id]
    );

    // Merge: transactions are the primary source; person_enrichments adds confidence
    const confidenceMap = new Map<string, number | null>();
    for (const pe of peResult.rows) {
      confidenceMap.set(pe.provider, pe.confidence);
    }

    const history: EnrichmentHistoryEntry[] = txResult.rows.map((tx) => ({
      id: tx.id,
      provider: tx.provider_name,
      providerDisplayName: tx.provider_display_name,
      date: tx.created_at.toISOString(),
      fieldsReturned: tx.fields_returned || [],
      costCents: tx.cost_cents,
      status: tx.status,
      confidence: confidenceMap.get(tx.provider_name) ?? null,
    }));

    // If person_enrichments has providers not in transactions, include them
    const seenProviders = new Set(history.map((h) => h.provider));
    for (const pe of peResult.rows) {
      if (!seenProviders.has(pe.provider)) {
        history.push({
          id: pe.id,
          provider: pe.provider,
          providerDisplayName: pe.provider,
          date: pe.enriched_at.toISOString(),
          fieldsReturned: pe.enriched_fields || [],
          costCents: pe.cost_cents ?? 0,
          status: 'success',
          confidence: pe.confidence,
        });
      }
    }

    // Sort by date descending
    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ data: { history } });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get enrichment history', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
