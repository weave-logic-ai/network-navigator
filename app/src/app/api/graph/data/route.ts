// GET /api/graph/data - Graph nodes and edges for reagraph visualization

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

interface GraphNode {
  id: string;
  label: string;
  data: {
    tier: string | null;
    company: string | null;
    title: string | null;
    score: number | null;
  };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  data: {
    type: string;
    weight: number;
  };
}

interface GraphDataResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get('limit') || '500', 10)));

    // Fetch top contacts by composite score
    const nodesResult = await query<{
      id: string;
      full_name: string | null;
      current_company: string | null;
      title: string | null;
      tier: string | null;
      composite_score: number | null;
    }>(
      `SELECT c.id, c.full_name, c.current_company, c.title,
              cs.tier, cs.composite_score
       FROM contacts c
       LEFT JOIN contact_scores cs ON c.id = cs.contact_id
       WHERE NOT c.is_archived
       ORDER BY cs.composite_score DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );

    if (nodesResult.rows.length === 0) {
      return NextResponse.json({ data: { nodes: [], edges: [] } });
    }

    // Collect node IDs for edge filtering
    const nodeIds = nodesResult.rows.map((r) => r.id);

    // Fetch REAL edges only (exclude synthetic mutual-proximity and same-cluster)
    const REAL_EDGE_TYPES = ['CONNECTED_TO', 'MESSAGED', 'same-company', 'INVITED_BY', 'ENDORSED', 'RECOMMENDED', 'FOLLOWS_COMPANY', 'WORKED_AT', 'EDUCATED_AT', 'WORKS_AT'];

    const edgesResult = await query<{
      id: string;
      source_contact_id: string;
      target_contact_id: string;
      edge_type: string;
      weight: number;
    }>(
      `SELECT e.id, e.source_contact_id, e.target_contact_id, e.edge_type, e.weight
       FROM edges e
       WHERE e.target_contact_id = ANY($1)
         AND e.target_contact_id IS NOT NULL
         AND e.edge_type = ANY($2)`,
      [nodeIds, REAL_EDGE_TYPES]
    );

    // Add any source nodes that aren't already in the set (e.g., self-contact)
    const existingIds = new Set(nodeIds);
    const missingSources = new Set<string>();
    for (const edge of edgesResult.rows) {
      if (!existingIds.has(edge.source_contact_id)) {
        missingSources.add(edge.source_contact_id);
      }
    }

    if (missingSources.size > 0) {
      const missingResult = await query<{
        id: string;
        full_name: string | null;
        current_company: string | null;
        title: string | null;
        tier: string | null;
        composite_score: number | null;
      }>(
        `SELECT c.id, c.full_name, c.current_company, c.title,
                cs.tier, cs.composite_score
         FROM contacts c
         LEFT JOIN contact_scores cs ON c.id = cs.contact_id
         WHERE c.id = ANY($1)`,
        [Array.from(missingSources)]
      );
      nodesResult.rows.push(...missingResult.rows);
    }

    // Build response
    const nodes: GraphNode[] = nodesResult.rows.map((row) => ({
      id: row.id,
      label: row.full_name || 'Unknown',
      data: {
        tier: row.tier,
        company: row.current_company,
        title: row.title,
        score: row.composite_score,
      },
    }));

    const edges: GraphEdge[] = edgesResult.rows.map((row) => ({
      id: row.id,
      source: row.source_contact_id,
      target: row.target_contact_id,
      data: {
        type: row.edge_type,
        weight: row.weight,
      },
    }));

    const response: GraphDataResponse = { nodes, edges };

    return NextResponse.json({ data: response });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load graph data', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
