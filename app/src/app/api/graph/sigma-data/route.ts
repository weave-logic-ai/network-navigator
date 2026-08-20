// GET /api/graph/sigma-data — Sigma.js formatted graph data with server-side filtering
// Query params: limit, nicheId, icpId, edgeTypes, minPagerank, primaryTargetId
//
// ADR-027 follow-up (2026-08-20): this is the live Graph tab's data source
// (`sigma-graph.tsx`), and until now it had no re-rooting capability at all —
// `/api/graph/data` grew a `?primaryTargetId=` re-root path under WS-4 Phase 1
// Track B, but that route is dead code (its only caller never passes the
// param); this route, which IS actually rendered, never got one. See the ADR
// update note for the full history.
//
// We port the re-root SQL from `app/src/app/api/graph/data/route.ts` (the
// neighborhood CTE keyed on `source_contact_id`/`target_contact_id`, both
// indexed) rather than reinventing it, and keep the `primaryTargetId` name
// for consistency with that route even though, per the ADR, it's semantically
// "whatever target the view should center on" — in practice the caller
// passes the current *secondary* target id (ADR-027 decision 3: secondary
// re-centers the view, primary/self stays the default fallback). Only
// `kind='contact'` targets actually re-root, matching `/api/graph/data`'s
// v1 scope note — `kind='company'` and `kind='self'` fall through to the
// existing top-by-PageRank listing (self has no `source_contact_id` /
// `target_contact_id` identity to re-root a *contact* graph on; company
// re-rooting is deferred the same way it was there).
//
// Deliberate adaptation vs. a literal port: `/api/graph/data` orders the
// re-rooted neighborhood by `composite_score`; this route orders everything
// else by PageRank (it's what drives node sizing/layout here), so the
// re-rooted branch orders by PageRank too, and the existing `minPagerank`
// filter still applies. Unlike `/api/graph/data`, this route does not
// backfill "missing source" nodes referenced by edges outside the loaded
// set — unnecessary here because the neighborhood query already returns the
// full 1-hop set before the LIMIT truncates it to the top-PageRank subset.
// No caching: sigma-data has never had the LRU layer `/api/graph/data` uses
// (`@/lib/graph/data-cache`, out of scope for this route/owner boundary), so
// none is added here either.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";
import { getTargetById, getTargetEntityId } from "@/lib/targets/service";

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
    // Phase 4 Track I — provenance edges are opt-in. When the caller passes
    // `includeProvenanceEdges=true`, we pull `evidence_for` / `derived_from`
    // alongside the real edges. Default behaviour is unchanged.
    const includeProvenanceEdges =
      searchParams.get("includeProvenanceEdges") === "true";
    const primaryTargetIdParam = searchParams.get("primaryTargetId");

    // Resolve the re-root target (see file header). Only `kind='contact'`
    // targets re-root; everything else (missing target, `self`, `company`)
    // falls through to the default top-by-PageRank listing below.
    let rootContactId: string | null = null;
    if (primaryTargetIdParam) {
      const target = await getTargetById(primaryTargetIdParam);
      if (target && target.kind === "contact") {
        rootContactId = getTargetEntityId(target);
      }
    }

    const baseEdgeTypes = edgeTypesParam
      ? edgeTypesParam.split(",")
      : [
          "CONNECTED_TO",
          "MESSAGED",
          "same-company",
          "INVITED_BY",
          "ENDORSED",
          "RECOMMENDED",
        ];
    const edgeTypeFilter = includeProvenanceEdges
      ? [...baseEdgeTypes, "evidence_for", "derived_from"]
      : baseEdgeTypes;

    // Build nodes query — top contacts by PageRank, optionally filtered by niche
    let nodesQuery: string;
    const nodesParams: unknown[] = [];
    const paramIdx = 1;

    // Per-contact cluster id, for the ClusterSidebar "highlight" feature.
    // `cluster_memberships` is many-to-many (a contact can score into
    // several clusters), so we take the highest-`membership_score` row as
    // "the" cluster for that contact — the same pattern already used for
    // pagerank-driven node sizing elsewhere in this route. LEFT JOIN LATERAL
    // so unclustered contacts still return with cluster_id = NULL.
    const clusterJoin = `
        LEFT JOIN LATERAL (
          SELECT cm.cluster_id
          FROM cluster_memberships cm
          WHERE cm.contact_id = c.id
          ORDER BY cm.membership_score DESC
          LIMIT 1
        ) top_cluster ON true`;

    if (rootContactId) {
      // Re-rooted path — center the graph on `rootContactId`'s 1-hop
      // neighborhood instead of the global top-PageRank listing. Mutually
      // exclusive with the niche filter (matches `/api/graph/data`, which
      // has no niche concept at all — re-rooting takes precedence here).
      //
      // The `source_contact_id = $1 OR target_contact_id = $1` predicate
      // uses the indexed columns from `002-core-schema.sql`, same as
      // `/api/graph/data` — an indexed BitmapOr, not a Seq Scan.
      nodesQuery = `
        WITH neighborhood AS (
          SELECT DISTINCT c.id
          FROM contacts c
          WHERE c.id = $1
             OR c.id IN (
               SELECT CASE WHEN source_contact_id = $1 THEN target_contact_id
                           ELSE source_contact_id END
               FROM edges
               WHERE source_contact_id = $1 OR target_contact_id = $1
             )
        )
        SELECT c.id, c.full_name, c.tier, c.degree, c.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality, top_cluster.cluster_id
        FROM contacts c
        INNER JOIN neighborhood n ON n.id = c.id
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        ${clusterJoin}
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $2
        ORDER BY COALESCE(gm.pagerank, 0) DESC
        LIMIT $3`;
      nodesParams.push(rootContactId, minPagerank, limit);
    } else if (nicheId) {
      nodesQuery = `
        SELECT c.id, c.full_name, c.tier, c.degree, c.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality,
               nm.niche_id, top_cluster.cluster_id
        FROM contacts c
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        LEFT JOIN niche_memberships nm ON nm.contact_id = c.id AND nm.niche_id = $${paramIdx}
        ${clusterJoin}
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $${paramIdx + 1}
        ORDER BY nm.niche_id IS NOT NULL DESC, COALESCE(gm.pagerank, 0) DESC
        LIMIT $${paramIdx + 2}`;
      nodesParams.push(nicheId, minPagerank, limit);
    } else {
      nodesQuery = `
        SELECT c.id, c.full_name, c.tier, c.degree, c.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality, top_cluster.cluster_id
        FROM contacts c
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        ${clusterJoin}
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
      cluster_id: string | null;
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
          clusterId: c.cluster_id || null,
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
