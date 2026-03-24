// GET /api/graph/conversations - MESSAGED edges with contact info and stats

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

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

export async function GET() {
  try {
    // Fetch all MESSAGED edges with contact names and message metadata
    const edgesResult = await query<{
      id: string;
      source_contact_id: string;
      target_contact_id: string;
      weight: number;
      properties: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT e.id, e.source_contact_id, e.target_contact_id,
              e.weight, e.properties, e.created_at, e.updated_at
       FROM edges e
       WHERE e.edge_type = 'MESSAGED'
         AND e.target_contact_id IS NOT NULL
       ORDER BY e.weight DESC`
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
      const msgCount = (row.properties?.message_count as number) ?? 0;
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
    const edges: ConversationEdge[] = edgesResult.rows.map((row) => ({
      id: row.id,
      source: row.source_contact_id,
      target: row.target_contact_id,
      messageCount: (row.properties?.message_count as number) ?? 0,
      weight: row.weight,
      lastActivity: row.updated_at?.toISOString() ?? null,
    }));

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
