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
// re-centers the view, primary/self stays the default fallback). Contact
// targets show their 1-hop neighborhood. Company targets show their linked
// contacts around an explicit company node. Self uses the default listing.
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

    // Only a secondary contact or company can re-root the graph. Primary/self
    // continues to use the default listing.
    let rootContactId: string | null = null;
    let rootCompanyId: string | null = null;
    if (primaryTargetIdParam) {
      const target = await getTargetById(primaryTargetIdParam);
      if (target && target.kind === "contact") {
        rootContactId = getTargetEntityId(target);
      } else if (target && target.kind === "company") {
        rootCompanyId = getTargetEntityId(target);
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
        SELECT c.id, c.full_name, cs.tier, c.degree, cs.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality, top_cluster.cluster_id
        FROM contacts c
        INNER JOIN neighborhood n ON n.id = c.id
        LEFT JOIN contact_scores cs ON cs.contact_id = c.id
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        ${clusterJoin}
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $2
        ORDER BY COALESCE(gm.pagerank, 0) DESC
        LIMIT $3`;
      nodesParams.push(rootContactId, minPagerank, limit);
    } else if (rootCompanyId) {
      // Company context comes from structured links, not a name comparison:
      // current employees, work history, and explicit company edges.
      // Keep the focal company visible even when it has no linked contacts.
      nodesQuery = `
        WITH neighborhood AS (
          SELECT id FROM contacts WHERE current_company_id = $1
          UNION
          SELECT contact_id AS id FROM work_history WHERE company_id = $1
          UNION
          SELECT source_contact_id AS id FROM edges WHERE target_company_id = $1
        )
        SELECT c.id, c.full_name, cs.tier, c.degree, cs.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality, top_cluster.cluster_id
        FROM contacts c
        INNER JOIN neighborhood n ON n.id = c.id
        LEFT JOIN contact_scores cs ON cs.contact_id = c.id
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        ${clusterJoin}
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $2
        ORDER BY COALESCE(gm.pagerank, 0) DESC
        LIMIT $3`;
      nodesParams.push(rootCompanyId, minPagerank, limit);
    } else if (nicheId) {
      nodesQuery = `
        SELECT c.id, c.full_name, cs.tier, c.degree, cs.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality,
               nm.niche_id, top_cluster.cluster_id
        FROM contacts c
        LEFT JOIN contact_scores cs ON cs.contact_id = c.id
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        LEFT JOIN LATERAL (
          SELECT ip.niche_id
          FROM contact_icp_fits cif
          JOIN icp_profiles ip ON ip.id = cif.icp_profile_id
          WHERE cif.contact_id = c.id AND ip.niche_id = $${paramIdx}
          LIMIT 1
        ) nm ON true
        ${clusterJoin}
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $${paramIdx + 1}
        ORDER BY nm.niche_id IS NOT NULL DESC, COALESCE(gm.pagerank, 0) DESC
        LIMIT $${paramIdx + 2}`;
      nodesParams.push(nicheId, minPagerank, limit);
    } else {
      nodesQuery = `
        SELECT c.id, c.full_name, cs.tier, c.degree, cs.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality, top_cluster.cluster_id
        FROM contacts c
        LEFT JOIN contact_scores cs ON cs.contact_id = c.id
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
          kind: "contact",
        },
      };
    });

    if (rootCompanyId) {
      const companyRes = await query<{ id: string; name: string }>(
        `SELECT id, name FROM companies WHERE id = $1`,
        [rootCompanyId]
      );
      const company = companyRes.rows[0];
      if (company) {
        nodes.push({
          key: company.id,
          attributes: {
            label: company.name,
            x: 0,
            y: 0,
            size: 24,
            color: "#2563eb",
            tier: "company",
            company: null,
            title: null,
            pagerank: 0,
            score: 0,
            degree: nodesRes.rows.length,
            clusterId: null,
            kind: "company",
          },
        });
      }
    }

    // Get edges between loaded nodes
    // A focused neighborhood can be arbitrarily far down the global edges
    // table. Filter in SQL before the cap so its real edges are not lost to
    // the first 20,000 unrelated rows.
    const focused = Boolean(rootContactId || rootCompanyId);
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
         ${focused ? "AND source_contact_id = ANY($2::uuid[]) AND target_contact_id = ANY($2::uuid[])" : ""}
       LIMIT 20000`,
      focused ? [edgeTypeFilter, [...nodeIds]] : [edgeTypeFilter]
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

    if (rootCompanyId && nodeIds.size > 0 && nodes.some((n) => n.key === rootCompanyId)) {
      for (const contactId of nodeIds) {
        edges.push({
          key: `company-context:${rootCompanyId}:${contactId}`,
          source: rootCompanyId,
          target: contactId,
          attributes: { type: "company-context", weight: 1 },
        });
      }
    }

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
        focusNodeId: rootContactId || rootCompanyId,
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
