// POST /api/admin/purge - Data purge with scope and filters
// Requires confirmToken === 'CONFIRM_PURGE' for safety

import { NextRequest, NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db/client';
import { PoolClient } from 'pg';

interface PurgeFilters {
  tier?: string;
  olderThan?: string; // ISO date string
  archived?: boolean;
}

interface PurgeBody {
  scope: 'contacts' | 'enrichment' | 'scoring' | 'all';
  filters?: PurgeFilters;
  confirmToken: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PurgeBody;

    if (body.confirmToken !== 'CONFIRM_PURGE') {
      return NextResponse.json(
        { error: 'Confirmation token required. Send confirmToken: "CONFIRM_PURGE"' },
        { status: 400 }
      );
    }

    if (!body.scope || !['contacts', 'enrichment', 'scoring', 'all'].includes(body.scope)) {
      return NextResponse.json(
        { error: 'scope must be one of: contacts, enrichment, scoring, all' },
        { status: 400 }
      );
    }

    const purged: Record<string, number> = {};

    await transaction(async (client: PoolClient) => {
      if (body.scope === 'contacts' || body.scope === 'all') {
        const count = await purgeContacts(client, body.filters);
        purged.contacts = count;
      }

      if (body.scope === 'enrichment' || body.scope === 'all') {
        const txCount = await purgeEnrichment(client, body.filters);
        purged.enrichment_transactions = txCount.transactions;
        purged.person_enrichments = txCount.personEnrichments;
      }

      if (body.scope === 'scoring' || body.scope === 'all') {
        const sCount = await purgeScoring(client, body.filters);
        purged.contact_scores = sCount.scores;
        purged.score_dimensions = sCount.dimensions;
      }
    });

    return NextResponse.json({ purged });
  } catch (error) {
    return NextResponse.json(
      { error: 'Purge failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

async function purgeContacts(
  client: PoolClient,
  filters?: PurgeFilters
): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  // Always exclude owner (degree 0)
  conditions.push('c.degree > 0');

  if (filters?.tier) {
    conditions.push(`cs.tier = $${idx++}`);
    params.push(filters.tier);
  }
  if (filters?.olderThan) {
    conditions.push(`c.created_at < $${idx++}`);
    params.push(filters.olderThan);
  }
  if (filters?.archived !== undefined) {
    conditions.push(`c.is_archived = $${idx++}`);
    params.push(filters.archived);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Cascading deletes handled by ON DELETE CASCADE on most tables.
  // For tables with SET NULL, we need to handle them explicitly.
  const selectIds = `SELECT c.id FROM contacts c LEFT JOIN contact_scores cs ON cs.contact_id = c.id ${where}`;

  const result = await client.query(
    `DELETE FROM contacts WHERE id IN (${selectIds})`,
    params
  );

  return result.rowCount ?? 0;
}

async function purgeEnrichment(
  _client: PoolClient,
  _filters?: PurgeFilters
): Promise<{ transactions: number; personEnrichments: number }> {
  // Delete enrichment transactions
  const txResult = await query(
    'DELETE FROM enrichment_transactions'
  );

  // Delete person enrichments and reset enriched fields on contacts
  const peResult = await query(
    'DELETE FROM person_enrichments'
  );

  return {
    transactions: txResult.rowCount ?? 0,
    personEnrichments: peResult.rowCount ?? 0,
  };
}

async function purgeScoring(
  _client: PoolClient,
  _filters?: PurgeFilters
): Promise<{ scores: number; dimensions: number }> {
  // Delete dimensions first (FK constraint)
  const dimResult = await query(
    'DELETE FROM score_dimensions'
  );

  const scoreResult = await query(
    'DELETE FROM contact_scores'
  );

  return {
    scores: scoreResult.rowCount ?? 0,
    dimensions: dimResult.rowCount ?? 0,
  };
}
