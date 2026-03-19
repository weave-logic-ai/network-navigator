// GET /api/contacts/[id]/activity - Activity / behavioral data for a contact

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Observation {
  id: string;
  type: string;
  content: string | null;
  url: string | null;
  observedAt: string | null;
  source: string;
}

interface ActionEntry {
  id: string;
  type: string;
  actor: string;
  date: string;
  summary: string;
  metadata: Record<string, unknown>;
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
    // Query behavioral_observations
    const obsResult = await query<{
      id: string;
      observation_type: string;
      content: string | null;
      url: string | null;
      observed_at: Date | null;
      source: string;
    }>(
      `SELECT id, observation_type, content, url, observed_at, source
       FROM behavioral_observations
       WHERE contact_id = $1
       ORDER BY COALESCE(observed_at, created_at) DESC
       LIMIT 50`,
      [id]
    );

    // Query action_log for this contact
    const actionResult = await query<{
      id: string;
      action_type: string;
      actor: string;
      created_at: Date;
      target_name: string | null;
      metadata: Record<string, unknown>;
      after_snapshot: Record<string, unknown>;
    }>(
      `SELECT id, action_type, actor, created_at, target_name, metadata, after_snapshot
       FROM action_log
       WHERE target_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [id]
    );

    const observations: Observation[] = obsResult.rows.map((row) => ({
      id: row.id,
      type: row.observation_type,
      content: row.content,
      url: row.url,
      observedAt: row.observed_at?.toISOString() ?? null,
      source: row.source,
    }));

    const actions: ActionEntry[] = actionResult.rows.map((row) => ({
      id: row.id,
      type: row.action_type,
      actor: row.actor,
      date: row.created_at.toISOString(),
      summary: buildActionSummary(row.action_type, row.target_name, row.after_snapshot),
      metadata: row.metadata,
    }));

    return NextResponse.json({ data: { observations, actions } });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get activity data', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

function buildActionSummary(
  actionType: string,
  targetName: string | null,
  afterSnapshot: Record<string, unknown>
): string {
  const name = targetName || 'contact';
  switch (actionType) {
    case 'enrich':
    case 'enrichment':
      return `Enriched ${name}`;
    case 'score':
    case 'scoring':
      return `Scored ${name}`;
    case 'import':
      return `Imported ${name}`;
    case 'update':
      return `Updated ${name}`;
    case 'tag':
      return `Tagged ${name}`;
    case 'revert':
      return `Reverted action on ${name}`;
    case 'enrichment_apply':
      return `Applied enrichment data to ${name}`;
    default: {
      const fields = Object.keys(afterSnapshot);
      if (fields.length > 0) {
        return `${actionType} on ${name} (${fields.slice(0, 3).join(', ')})`;
      }
      return `${actionType} on ${name}`;
    }
  }
}
