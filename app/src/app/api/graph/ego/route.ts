// GET /api/graph/ego?contactId=X&depth=2 — Ego network subgraph

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";

const TIER_COLORS: Record<string, string> = {
  gold: "#eab308",
  silver: "#94a3b8",
  bronze: "#d97706",
  watch: "#6b7280",
  unscored: "#d1d5db",
};

const REAL_EDGE_TYPES = [
  "CONNECTED_TO",
  "MESSAGED",
  "same-company",
  "INVITED_BY",
  "ENDORSED",
  "RECOMMENDED",
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get("contactId");
    const depth = Math.min(parseInt(searchParams.get("depth") || "2", 10), 3);

    if (!contactId) {
      return NextResponse.json(
        { error: "contactId required" },
        { status: 400 }
      );
    }

    // 1st degree neighbors
    const firstDegreeRes = await query<{
      neighbor_id: string;
      edge_type: string;
      weight: number;
    }>(
      `SELECT
         CASE WHEN source_contact_id = $1 THEN target_contact_id
              ELSE source_contact_id END AS neighbor_id,
         edge_type, weight
       FROM edges
       WHERE (source_contact_id = $1 OR target_contact_id = $1)
         AND target_contact_id IS NOT NULL
         AND edge_type = ANY($2)`,
      [contactId, REAL_EDGE_TYPES]
    );

    const neighborIds = new Set(firstDegreeRes.rows.map((r) => r.neighbor_id));
    neighborIds.add(contactId);

    // 2nd degree (if depth >= 2)
    if (depth >= 2 && neighborIds.size > 1) {
      const firstIds = Array.from(neighborIds);
      const secondDegreeRes = await query<{ neighbor_id: string }>(
        `SELECT DISTINCT
           CASE WHEN source_contact_id = ANY($1) THEN target_contact_id
                ELSE source_contact_id END AS neighbor_id
         FROM edges
         WHERE (source_contact_id = ANY($1) OR target_contact_id = ANY($1))
           AND target_contact_id IS NOT NULL
           AND edge_type = ANY($2)
         LIMIT 500`,
        [firstIds, REAL_EDGE_TYPES]
      );
      for (const row of secondDegreeRes.rows) {
        neighborIds.add(row.neighbor_id);
      }
    }

    const allIds = Array.from(neighborIds);

    // Load node data
    const nodesRes = await query<{
      id: string;
      full_name: string | null;
      tier: string | null;
      degree: number;
      composite_score: number | null;
      current_company: string | null;
      title: string | null;
    }>(
      `SELECT id, full_name, tier, degree, composite_score, current_company, title
       FROM contacts WHERE id = ANY($1)`,
      [allIds]
    );

    const nodeSet = new Set(nodesRes.rows.map((r) => r.id));

    const nodes = nodesRes.rows.map((c, idx) => {
      const isCenter = c.id === contactId;
      const angle = (idx / nodesRes.rows.length) * 2 * Math.PI;
      const radius = isCenter ? 0 : 100 + Math.random() * 200;
      return {
        key: c.id,
        attributes: {
          label: c.full_name || "Unknown",
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          size: isCenter ? 15 : 5,
          color: isCenter
            ? "#3b82f6"
            : TIER_COLORS[c.tier || "unscored"] || TIER_COLORS.unscored,
          tier: c.tier || "unscored",
          company: c.current_company,
          title: c.title,
          score: c.composite_score || 0,
          degree: c.degree,
        },
      };
    });

    // Load edges between the ego network nodes
    const edgesRes = await query<{
      id: string;
      source_contact_id: string;
      target_contact_id: string;
      edge_type: string;
      weight: number;
    }>(
      `SELECT id, source_contact_id, target_contact_id, edge_type, weight
       FROM edges
       WHERE source_contact_id = ANY($1) AND target_contact_id = ANY($1)
         AND target_contact_id IS NOT NULL
         AND edge_type = ANY($2)`,
      [allIds, REAL_EDGE_TYPES]
    );

    const edges = edgesRes.rows
      .filter(
        (e) =>
          nodeSet.has(e.source_contact_id) && nodeSet.has(e.target_contact_id)
      )
      .map((e) => ({
        key: e.id,
        source: e.source_contact_id,
        target: e.target_contact_id,
        attributes: {
          type: e.edge_type,
          weight: e.weight,
        },
      }));

    return NextResponse.json({
      data: {
        centerId: contactId,
        nodes,
        edges,
        stats: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          depth,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load ego network",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
