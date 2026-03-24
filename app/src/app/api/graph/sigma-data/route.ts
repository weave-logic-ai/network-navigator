// GET /api/graph/sigma-data — Sigma.js formatted graph data with server-side filtering
// Query params: limit, nicheId, icpId, edgeTypes, minPagerank

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";

const TIER_COLORS: Record<string, string> = {
  gold: "#eab308",
  silver: "#94a3b8",
  bronze: "#d97706",
  watch: "#6b7280",
  unscored: "#d1d5db",
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "500", 10),
      6000
    );
    const nicheId = searchParams.get("nicheId");
    const edgeTypesParam = searchParams.get("edgeTypes");
    const minPagerank = parseFloat(searchParams.get("minPagerank") || "0");

    const edgeTypeFilter = edgeTypesParam
      ? edgeTypesParam.split(",")
      : [
          "CONNECTED_TO",
          "MESSAGED",
          "same-company",
          "INVITED_BY",
          "ENDORSED",
          "RECOMMENDED",
        ];

    // Build nodes query — top contacts by PageRank, optionally filtered by niche
    let nodesQuery: string;
    const nodesParams: unknown[] = [];
    const paramIdx = 1;

    if (nicheId) {
      nodesQuery = `
        SELECT c.id, c.full_name, c.tier, c.degree, c.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality,
               nm.niche_id
        FROM contacts c
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        LEFT JOIN niche_memberships nm ON nm.contact_id = c.id AND nm.niche_id = $${paramIdx}
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $${paramIdx + 1}
        ORDER BY nm.niche_id IS NOT NULL DESC, COALESCE(gm.pagerank, 0) DESC
        LIMIT $${paramIdx + 2}`;
      nodesParams.push(nicheId, minPagerank, limit);
    } else {
      nodesQuery = `
        SELECT c.id, c.full_name, c.tier, c.degree, c.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality
        FROM contacts c
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $1
        ORDER BY COALESCE(gm.pagerank, 0) DESC
        LIMIT $2`;
      nodesParams.push(minPagerank, limit);
    }

    const nodesRes = await query<{
      id: string;
      full_name: string | null;
      tier: string | null;
      degree: number;
      composite_score: number | null;
      current_company: string | null;
      title: string | null;
      pagerank: number | null;
      betweenness_centrality: number | null;
      niche_id?: string | null;
    }>(nodesQuery, nodesParams);

    const nodeIds = new Set(nodesRes.rows.map((r) => r.id));

    // Simple deterministic layout: use pagerank + degree for positioning
    // Real ForceAtlas2 happens in the browser
    const nodes = nodesRes.rows.map((c, idx) => {
      const angle = (idx / nodesRes.rows.length) * 2 * Math.PI;
      const radius = 100 + (1 - (c.pagerank || 0)) * 400;
      return {
        key: c.id,
        attributes: {
          label: c.full_name || "Unknown",
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          size: Math.max(3, Math.min(20, (c.pagerank || 0) * 200 + 3)),
          color: TIER_COLORS[c.tier || "unscored"] || TIER_COLORS.unscored,
          tier: c.tier || "unscored",
          company: c.current_company,
          title: c.title,
          pagerank: c.pagerank || 0,
          score: c.composite_score || 0,
          degree: c.degree,
        },
      };
    });

    // Get edges between loaded nodes
    const edgesRes = await query<{
      id: string;
      source_contact_id: string;
      target_contact_id: string;
      edge_type: string;
      weight: number;
    }>(
      `SELECT id, source_contact_id, target_contact_id, edge_type, weight
       FROM edges
       WHERE target_contact_id IS NOT NULL
         AND edge_type = ANY($1)
       LIMIT 20000`,
      [edgeTypeFilter]
    );

    // Filter edges to only those between loaded nodes
    const edges = edgesRes.rows
      .filter(
        (e) =>
          nodeIds.has(e.source_contact_id) && nodeIds.has(e.target_contact_id)
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

    // Stats
    const totalRes = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text as cnt FROM contacts WHERE is_archived = FALSE`
    );

    const communityRes = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text as cnt FROM clusters`
    );

    return NextResponse.json({
      data: {
        nodes,
        edges,
        stats: {
          totalNodes: parseInt(totalRes.rows[0]?.cnt || "0", 10),
          loadedNodes: nodes.length,
          totalEdges: edges.length,
          communities: parseInt(communityRes.rows[0]?.cnt || "0", 10),
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load graph data",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
