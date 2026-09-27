// GET /api/graph/conversations - MESSAGED edges with contact info and stats

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

interface ConversationNode {
  id: string;
  label: string;
  messageCount: number;
}

interface ConversationEdge {
  id: string;
  source: string;
  target: string;
  messageCount: number;
  weight: number;
  lastActivity: string | null;
}

function messageCount(row: { message_count: number; properties: Record<string, unknown> }): number {
  if (row.message_count > 0) return row.message_count;
  // A legacy graph may have an edge without the underlying message rows.
  const legacy = row.properties?.message_count;
  return typeof legacy === 'number' && Number.isFinite(legacy)
    ? Math.max(0, Math.floor(legacy))
    : 0;
}

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  try {
    // Messages are stored per contact, without a source-contact key. Keep one
    // graph edge per recipient so repeated imports cannot count the same raw
    // messages more than once. Prefer the imported self contact as the source.
    const edgesResult = await query<{
      id: string;
      source_contact_id: string;
      target_contact_id: string;
      weight: number;
      properties: Record<string, unknown>;
      message_count: number;
      last_message_at: Date | null;
    }>(
      `WITH recipient_edges AS (
         SELECT DISTINCT ON (e.target_contact_id)
                e.id, e.source_contact_id, e.target_contact_id,
                e.weight, e.properties
         FROM edges e
         LEFT JOIN contacts src ON src.id = e.source_contact_id
         WHERE e.edge_type = 'MESSAGED'
           AND e.target_contact_id IS NOT NULL
         ORDER BY e.target_contact_id,
                  CASE WHEN src.linkedin_url LIKE 'self:%' THEN 0 ELSE 1 END,
                  e.id
       )
       SELECT e.id, e.source_contact_id, e.target_contact_id,
              e.weight, e.properties, m.message_count, m.last_message_at
       FROM recipient_edges e
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS message_count, MAX(unique_messages.sent_at) AS last_message_at
         FROM (
           SELECT DISTINCT direction, subject, content, conversation_id, sent_at, source
           FROM messages
           WHERE contact_id = e.target_contact_id
         ) unique_messages
       ) m ON TRUE
       ORDER BY m.message_count DESC, e.id`
    );

    if (edgesResult.rows.length === 0) {
      return NextResponse.json({
        data: { nodes: [], edges: [] },
      });
    }

    // Collect unique contact IDs
    const contactIds = new Set<string>();
    for (const row of edgesResult.rows) {
      contactIds.add(row.source_contact_id);
      contactIds.add(row.target_contact_id);
    }

    // Fetch contact names
    const contactsResult = await query<{
      id: string;
      full_name: string | null;
    }>(
      `SELECT id, full_name FROM contacts WHERE id = ANY($1)`,
      [Array.from(contactIds)]
    );

    const nameMap = new Map<string, string>();
    for (const row of contactsResult.rows) {
      nameMap.set(row.id, row.full_name ?? 'Unknown');
    }

    // Compute per-node message totals
    const messageTotals = new Map<string, number>();
    for (const row of edgesResult.rows) {
      // Imported edge properties can outlive an import batch. The messages
      // table is the source of truth; retain legacy-only edge counts when no
      // message rows were imported alongside an older graph.
      const msgCount = messageCount(row);
      messageTotals.set(
        row.source_contact_id,
        (messageTotals.get(row.source_contact_id) ?? 0) + msgCount
      );
      messageTotals.set(
        row.target_contact_id,
        (messageTotals.get(row.target_contact_id) ?? 0) + msgCount
      );
    }

    // Build nodes
    const nodes: ConversationNode[] = Array.from(contactIds).map((id) => ({
      id,
      label: nameMap.get(id) ?? 'Unknown',
      messageCount: messageTotals.get(id) ?? 0,
    }));

    // Build edges
    const edges: ConversationEdge[] = edgesResult.rows.map((row) => {
      const count = messageCount(row);
      return {
        id: row.id,
        source: row.source_contact_id,
        target: row.target_contact_id,
        messageCount: count,
        weight: count > 0 ? Math.log1p(count) : row.weight,
        lastActivity: row.last_message_at?.toISOString() ?? null,
      };
    });

    return NextResponse.json({
      data: { nodes, edges },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load conversation data',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
