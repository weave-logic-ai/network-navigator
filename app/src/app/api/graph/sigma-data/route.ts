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
import { transaction } from "@/lib/db/client";
import { assertGraphSchemaReady, GraphSchemaUpgradeRequiredError } from "@/lib/graph/schema-gate";
import { getTargetById, getTargetEntityId } from "@/lib/targets/service";
import { createHash } from "node:crypto";

const TIER_COLORS: Record<string, string> = {
  gold: "#eab308",
  silver: "#94a3b8",
  bronze: "#d97706",
  watch: "#6b7280",
  unscored: "#d1d5db",
};

const DEFAULT_EDGE_TYPES = [
  "CONNECTED_TO", "MESSAGED", "same-company", "INVITED_BY",
  "ENDORSED", "RECOMMENDED", "company-context",
];
const PROVENANCE_EDGE_TYPES = ["evidence_for", "derived_from"];
const SUPPORTED_EDGE_TYPES = new Set([...DEFAULT_EDGE_TYPES, ...PROVENANCE_EDGE_TYPES]);
const GROUP_CATALOG_LIMIT = 500;
const GROUP_CATALOG_PAGE_SIZE = 100;
const GROUP_MEMBER_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit") ?? "500";
    const rawMinPagerank = searchParams.get("minPagerank") ?? "0";
    const parsedLimit = Number(rawLimit);
    const minPagerank = Number(rawMinPagerank);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 ||
        !Number.isFinite(minPagerank) || minPagerank < 0) {
      return NextResponse.json({ error: "Invalid graph query parameters" }, { status: 400 });
    }
    const limit = Math.min(parsedLimit, 6000);
    const nicheId = searchParams.get("nicheId");
    const edgeTypesParam = searchParams.get("edgeTypes");
    // Phase 4 Track I — provenance edges are opt-in. When the caller passes
    // `includeProvenanceEdges=true`, we pull `evidence_for` / `derived_from`
    // alongside the real edges. Default behaviour is unchanged.
    const includeProvenanceEdges =
      searchParams.get("includeProvenanceEdges") === "true";
    const primaryTargetIdParam = searchParams.get("primaryTargetId");
    const memberGroupId = searchParams.get("memberGroupId");
    const memberKey = searchParams.get("memberKey");
    const memberCursor = searchParams.get("memberCursor");
    const selectedGroupId = searchParams.get("selectedGroupId");
    const selectedGroupKey = searchParams.get("selectedGroupKey");
    const catalogCursor = searchParams.get("catalogCursor");
    if (catalogCursor !== null) {
      const separator = catalogCursor.indexOf(":");
      const method = catalogCursor.slice(0, separator);
      const after = catalogCursor.slice(separator + 1);
      if (separator < 0 || !["community", "company", "industry"].includes(method) ||
          ((method === "community" || method === "company") && after && !UUID_PATTERN.test(after)) || after.length > 200) {
        return NextResponse.json({ error: "Invalid group catalog cursor" }, { status: 400 });
      }
      return await transaction(async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await assertGraphSchemaReady(client);
        type CatalogRow = { identity: string; label: string; algorithm?: string; total_count: number };
        let rows: CatalogRow[];
        if (method === "community") {
          rows = (await client.query<CatalogRow>(
            `SELECT cl.id::text AS identity, cl.label, cl.algorithm, COUNT(c.id)::int AS total_count
             FROM clusters cl LEFT JOIN cluster_memberships cm ON cm.cluster_id = cl.id
             LEFT JOIN contacts c ON c.id = cm.contact_id AND c.is_archived = FALSE
             WHERE ($1::uuid IS NULL OR cl.id > $1::uuid)
             GROUP BY cl.id, cl.label, cl.algorithm ORDER BY cl.id LIMIT $2`,
            [after || null, GROUP_CATALOG_PAGE_SIZE + 1])).rows;
        } else if (method === "company") {
          rows = (await client.query<CatalogRow>(
            `SELECT co.id::text AS identity, co.name AS label, COUNT(c.id)::int AS total_count
             FROM companies co LEFT JOIN contacts c ON c.current_company_id = co.id AND c.is_archived = FALSE
             WHERE ($1::uuid IS NULL OR co.id > $1::uuid)
             GROUP BY co.id, co.name HAVING COUNT(c.id) > 0 ORDER BY co.id LIMIT $2`,
            [after || null, GROUP_CATALOG_PAGE_SIZE + 1])).rows;
        } else {
          rows = (await client.query<CatalogRow>(
            `SELECT lower(trim(co.industry)) AS identity, MIN(trim(co.industry)) AS label, COUNT(*)::int AS total_count
             FROM contacts c JOIN companies co ON co.id = c.current_company_id
             WHERE c.is_archived = FALSE AND nullif(trim(co.industry), '') IS NOT NULL
               AND lower(trim(co.industry)) > $1
             GROUP BY lower(trim(co.industry)) ORDER BY identity LIMIT $2`,
            [after, GROUP_CATALOG_PAGE_SIZE + 1])).rows;
        }
        const hasMore = rows.length > GROUP_CATALOG_PAGE_SIZE;
        const pageRows = rows.slice(0, GROUP_CATALOG_PAGE_SIZE);
        const groups = pageRows.map((row) => {
          const id = method === "community" ? `community:${row.identity}` : method === "company"
            ? `company:${row.identity}` : `industry:${createHash("sha256").update(row.identity).digest("hex").slice(0, 16)}`;
          const groupMethod = method === "community"
            ? row.algorithm === "legacy-import" ? "imported-group" : row.algorithm?.startsWith("spectral") ? "inferred-community" : "stored-group"
            : method;
          return { id, label: method === "industry" ? `Industry: ${row.label}` : row.label,
            method: groupMethod, totalCount: row.total_count,
            ...(method === "industry" ? { memberKey: row.identity } : {}) };
        });
        const nextCursor = hasMore ? `${method}:${pageRows[pageRows.length - 1].identity}`
          : method === "community" ? "company:" : method === "company" ? "industry:" : null;
        return NextResponse.json({ data: { groups, nextCursor } });
      });
    }
    if (memberGroupId) {
      const [method, identity] = memberGroupId.split(":", 2);
      if (!identity || !["community", "company", "industry"].includes(method) ||
          (method !== "industry" && !UUID_PATTERN.test(identity)) ||
          (memberCursor !== null && !UUID_PATTERN.test(memberCursor)) ||
          (method === "industry" && (!memberKey || createHash("sha256").update(memberKey).digest("hex").slice(0, 16) !== identity))) {
        return NextResponse.json({ error: "Invalid group member query" }, { status: 400 });
      }
      return await transaction(async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await assertGraphSchemaReady(client);
        const predicate = method === "community"
          ? "EXISTS (SELECT 1 FROM cluster_memberships cm WHERE cm.cluster_id = $1::uuid AND cm.contact_id = c.id)"
          : method === "company" ? "c.current_company_id = $1::uuid"
          : "lower(trim(co.industry)) = $1";
        const result = await client.query<{ id: string; full_name: string; title: string | null; company: string | null }>(
          `SELECT c.id, c.full_name, c.title, co.name AS company
           FROM contacts c LEFT JOIN companies co ON co.id = c.current_company_id
           WHERE c.is_archived = FALSE AND ${predicate} AND ($2::uuid IS NULL OR c.id > $2::uuid)
           ORDER BY c.id LIMIT $3`,
          [method === "industry" ? memberKey : identity, memberCursor, GROUP_MEMBER_PAGE_SIZE + 1]
        );
        const hasMore = result.rows.length > GROUP_MEMBER_PAGE_SIZE;
        const members = result.rows.slice(0, GROUP_MEMBER_PAGE_SIZE);
        return NextResponse.json({ data: { members, nextCursor: hasMore ? members[members.length - 1].id : null } });
      });
    }

    // An explicitly present empty value is an all-off selection. Provenance
    // augments a nonempty selection, but cannot override all-off.
    const baseEdgeTypes = edgeTypesParam === null
      ? DEFAULT_EDGE_TYPES
      : edgeTypesParam === "" ? [] : edgeTypesParam.split(",");
    if (baseEdgeTypes.some((type) => !SUPPORTED_EDGE_TYPES.has(type))) {
      return NextResponse.json({ error: "Unsupported edge type" }, { status: 400 });
    }
    const edgeTypeFilter = [...new Set(
      baseEdgeTypes.length && includeProvenanceEdges
        ? [...baseEdgeTypes, ...PROVENANCE_EDGE_TYPES]
        : baseEdgeTypes
    )];
    const storedEdgeTypes = edgeTypeFilter.filter((type) => type !== "company-context");

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

    return await transaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await assertGraphSchemaReady(client);
    // Build nodes query — top contacts by PageRank, optionally filtered by niche
    let nodesQuery: string;
    const nodesParams: unknown[] = [];
    const paramIdx = 1;

    // Attribute groups use structured company identity. An unlinked company
    // string is deliberately not equated to a company row by spelling.
    const clusterJoin = `LEFT JOIN companies co ON co.id = c.current_company_id`;
    const groupColumns = `c.current_company_id, co.name AS canonical_company_name, lower(trim(co.industry)) AS industry_key`;

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
               gm.pagerank, gm.betweenness_centrality, ${groupColumns},
               COUNT(*) OVER()::int AS available_nodes
        FROM contacts c
        INNER JOIN neighborhood n ON n.id = c.id
        LEFT JOIN contact_scores cs ON cs.contact_id = c.id
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        ${clusterJoin}
        WHERE c.is_archived = FALSE
          AND (COALESCE(gm.pagerank, 0) >= $2 OR c.id = $1)
        ORDER BY (c.id = $1) DESC, COALESCE(gm.pagerank, 0) DESC, c.id ASC
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
               gm.pagerank, gm.betweenness_centrality, ${groupColumns},
               COUNT(*) OVER()::int AS available_nodes
        FROM contacts c
        INNER JOIN neighborhood n ON n.id = c.id
        LEFT JOIN contact_scores cs ON cs.contact_id = c.id
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        ${clusterJoin}
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $2
        ORDER BY COALESCE(gm.pagerank, 0) DESC, c.id ASC
        LIMIT $3`;
      nodesParams.push(rootCompanyId, minPagerank, limit);
    } else if (nicheId) {
      nodesQuery = `
        SELECT c.id, c.full_name, cs.tier, c.degree, cs.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality,
               nm.niche_id, ${groupColumns},
               COUNT(*) OVER()::int AS available_nodes
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
        ORDER BY nm.niche_id IS NOT NULL DESC, COALESCE(gm.pagerank, 0) DESC, c.id ASC
        LIMIT $${paramIdx + 2}`;
      nodesParams.push(nicheId, minPagerank, limit);
    } else {
      nodesQuery = `
        SELECT c.id, c.full_name, cs.tier, c.degree, cs.composite_score,
               c.current_company, c.title,
               gm.pagerank, gm.betweenness_centrality, ${groupColumns},
               COUNT(*) OVER()::int AS available_nodes
        FROM contacts c
        LEFT JOIN contact_scores cs ON cs.contact_id = c.id
        LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
        ${clusterJoin}
        WHERE c.is_archived = FALSE
          AND COALESCE(gm.pagerank, 0) >= $1
        ORDER BY COALESCE(gm.pagerank, 0) DESC, c.id ASC
        LIMIT $2`;
      nodesParams.push(minPagerank, limit);
    }

    const nodesRes = await client.query<{
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
      current_company_id: string | null;
      canonical_company_name: string | null;
      industry_key: string | null;
      available_nodes?: number;
    }>(nodesQuery, nodesParams);

    const nodeIds = new Set(nodesRes.rows.map((r) => r.id));

    type Group = { id: string; label: string; method: "inferred-community" | "imported-group" | "stored-group" | "company" | "industry"; totalCount: number; loadedCount: number; visibleCount: number; canonicalCompanyId?: string; memberKey?: string };
    const groups = new Map<string, Group>();
    const memberships = new Map<string, string[]>();
    // The catalog is independent of this view's node limit, PageRank, niche,
    // or focus. A selected group with no loaded members still exists.
    const storedGroups = await client.query<{ cluster_id: string; label: string; algorithm: string; total_count: number }>(
      `SELECT cl.id AS cluster_id, cl.label, cl.algorithm, COUNT(c.id)::int AS total_count
       FROM clusters cl
       LEFT JOIN cluster_memberships cm ON cm.cluster_id = cl.id
       LEFT JOIN contacts c ON c.id = cm.contact_id AND c.is_archived = FALSE
       GROUP BY cl.id, cl.label, cl.algorithm
       ORDER BY COUNT(c.id) DESC, cl.id
       LIMIT ${GROUP_CATALOG_LIMIT}`
    );
    for (const row of storedGroups.rows) {
      const id = `community:${row.cluster_id}`;
      groups.set(id, { id, label: row.label,
        method: row.algorithm === "legacy-import" ? "imported-group" : row.algorithm.startsWith("spectral") ? "inferred-community" : "stored-group",
        totalCount: row.total_count, loadedCount: 0, visibleCount: 0 });
    }
    const addMembership = (contactId: string, id: string, label: string, method: Group["method"], totalCount = 0, canonicalCompanyId?: string, memberKey?: string) => {
      const memberGroups = memberships.get(contactId) ?? [];
      if (!memberGroups.includes(id)) memberGroups.push(id);
      memberships.set(contactId, memberGroups);
      if (!groups.has(id)) groups.set(id, { id, label, method, totalCount, loadedCount: 0, visibleCount: 0, ...(canonicalCompanyId ? { canonicalCompanyId } : {}), ...(memberKey ? { memberKey } : {}) });
    };
    // Include every persisted membership, including historical company and
    // industry groups with name-only contacts. Their stored IDs are separate
    // from current canonical company/industry identities.
    if (nodeIds.size) {
      const inferredRes = await client.query<{ contact_id: string; cluster_id: string; label: string; algorithm: string; total_count: number }>(
        `SELECT cm.contact_id, cm.cluster_id, cl.label, cl.algorithm
         FROM cluster_memberships cm JOIN clusters cl ON cl.id = cm.cluster_id
         WHERE cm.contact_id = ANY($1::uuid[])`,
        [[...nodeIds]]
      );
      for (const row of inferredRes.rows) addMembership(row.contact_id, `community:${row.cluster_id}`, row.label,
        row.algorithm === "legacy-import" ? "imported-group" : row.algorithm.startsWith("spectral") ? "inferred-community" : "stored-group", row.total_count);
    }
    for (const row of nodesRes.rows) {
      if (row.current_company_id) addMembership(row.id, `company:${row.current_company_id}`, row.canonical_company_name || "Company", "company", 0, row.current_company_id);
      const industry = row.industry_key;
      if (industry) addMembership(row.id, `industry:${createHash("sha256").update(industry).digest("hex").slice(0, 16)}`, `Industry: ${industry}`, "industry", 0, undefined, industry);
    }
    // Counts are over all unarchived contacts, before the graph's PageRank,
    // niche, root and node-limit filters. The same canonical IDs drive nodes.
    const attributeCounts = await client.query<{ method: "company" | "industry"; identity: string; label: string; total_count: number }>(
      `SELECT 'company' AS method, co.id::text AS identity, co.name AS label, COUNT(*)::int AS total_count
       FROM contacts c JOIN companies co ON co.id = c.current_company_id WHERE c.is_archived = FALSE
       GROUP BY co.id, co.name
       UNION ALL
       SELECT 'industry' AS method, lower(trim(co.industry)) AS identity, MIN(trim(co.industry)) AS label, COUNT(*)::int AS total_count
       FROM contacts c JOIN companies co ON co.id = c.current_company_id
       WHERE c.is_archived = FALSE AND nullif(trim(co.industry), '') IS NOT NULL
       GROUP BY lower(trim(co.industry))
       ORDER BY total_count DESC, identity
       LIMIT ${GROUP_CATALOG_LIMIT}`
    );
    for (const row of attributeCounts.rows) {
      const id = row.method === "company" ? `company:${row.identity}` : `industry:${createHash("sha256").update(row.identity).digest("hex").slice(0, 16)}`;
      const group = groups.get(id);
      if (group) {
        group.totalCount = row.total_count;
        group.label = row.method === "company" ? row.label : `Industry: ${row.label}`;
        if (row.method === "industry") Object.assign(group, { memberKey: row.identity });
      } else {
        groups.set(id, { id, label: row.method === "company" ? row.label : `Industry: ${row.label}`,
          method: row.method, totalCount: row.total_count, loadedCount: 0, visibleCount: 0,
          ...(row.method === "company" ? { canonicalCompanyId: row.identity } : { memberKey: row.identity }) });
      }
    }
    // Loaded memberships omitted by the catalog cap still need exact totals.
    // Resolve only those identities in batches; the normal top catalog path
    // adds no extra count queries.
    const missingTotals = [...new Set([...memberships.values()].flat())]
      .map((id) => groups.get(id))
      .filter((group): group is Group => Boolean(group && group.totalCount === 0));
    const missingCommunities = missingTotals.filter((group) => group.id.startsWith("community:")).map((group) => group.id.slice(10));
    const missingCompanies = missingTotals.filter((group) => group.id.startsWith("company:")).map((group) => group.id.slice(8));
    const missingIndustries = missingTotals.filter((group) => group.method === "industry" && group.memberKey).map((group) => group.memberKey!);
    if (missingCommunities.length) {
      const counts = await client.query<{ identity: string; total_count: number }>(
        `SELECT cl.id::text AS identity, COUNT(c.id)::int AS total_count
         FROM clusters cl LEFT JOIN cluster_memberships cm ON cm.cluster_id = cl.id
         LEFT JOIN contacts c ON c.id = cm.contact_id AND c.is_archived = FALSE
         WHERE cl.id = ANY($1::uuid[]) GROUP BY cl.id`, [missingCommunities]);
      for (const row of counts.rows) groups.get(`community:${row.identity}`)!.totalCount = row.total_count;
    }
    if (missingCompanies.length) {
      const counts = await client.query<{ identity: string; total_count: number }>(
        `SELECT c.current_company_id::text AS identity, COUNT(*)::int AS total_count
         FROM contacts c WHERE c.is_archived = FALSE AND c.current_company_id = ANY($1::uuid[])
         GROUP BY c.current_company_id`, [missingCompanies]);
      for (const row of counts.rows) groups.get(`company:${row.identity}`)!.totalCount = row.total_count;
    }
    if (missingIndustries.length) {
      const counts = await client.query<{ identity: string; total_count: number }>(
        `SELECT lower(trim(co.industry)) AS identity, COUNT(*)::int AS total_count
         FROM contacts c JOIN companies co ON co.id = c.current_company_id
         WHERE c.is_archived = FALSE AND lower(trim(co.industry)) = ANY($1::text[])
         GROUP BY lower(trim(co.industry))`, [missingIndustries]);
      for (const row of counts.rows) {
        const id = `industry:${createHash("sha256").update(row.identity).digest("hex").slice(0, 16)}`;
        groups.get(id)!.totalCount = row.total_count;
      }
    }
    // A selection can outlive a catalog page. Resolve its exact identity so
    // a capped catalog never mistakes a valid zero-loaded group for deletion.
    if (selectedGroupId && !groups.has(selectedGroupId)) {
      const [method, identity] = selectedGroupId.split(":", 2);
      if (identity && UUID_PATTERN.test(identity) && method === "community") {
        const pinned = await client.query<{ label: string; algorithm: string; total_count: number }>(
          `SELECT cl.label, cl.algorithm, COUNT(c.id)::int AS total_count
           FROM clusters cl LEFT JOIN cluster_memberships cm ON cm.cluster_id = cl.id
           LEFT JOIN contacts c ON c.id = cm.contact_id AND c.is_archived = FALSE
           WHERE cl.id = $1::uuid GROUP BY cl.id, cl.label, cl.algorithm`, [identity]);
        const row = pinned.rows[0];
        if (row) groups.set(selectedGroupId, { id: selectedGroupId, label: row.label,
          method: row.algorithm === "legacy-import" ? "imported-group" : row.algorithm.startsWith("spectral") ? "inferred-community" : "stored-group",
          totalCount: row.total_count, loadedCount: 0, visibleCount: 0 });
      } else if (identity && UUID_PATTERN.test(identity) && method === "company") {
        const pinned = await client.query<{ label: string; total_count: number }>(
          `SELECT co.name AS label, COUNT(c.id)::int AS total_count FROM companies co
           LEFT JOIN contacts c ON c.current_company_id = co.id AND c.is_archived = FALSE
           WHERE co.id = $1::uuid GROUP BY co.id, co.name`, [identity]);
        const row = pinned.rows[0];
        if (row) groups.set(selectedGroupId, { id: selectedGroupId, label: row.label,
          method: "company", totalCount: row.total_count, loadedCount: 0, visibleCount: 0, canonicalCompanyId: identity });
      } else if (method === "industry" && selectedGroupKey &&
        createHash("sha256").update(selectedGroupKey).digest("hex").slice(0, 16) === identity) {
        const pinned = await client.query<{ total_count: number }>(
          `SELECT COUNT(*)::int AS total_count FROM contacts c JOIN companies co ON co.id = c.current_company_id
           WHERE c.is_archived = FALSE AND lower(trim(co.industry)) = $1`, [selectedGroupKey]);
        if (pinned.rows[0]?.total_count) groups.set(selectedGroupId, { id: selectedGroupId,
          label: `Industry: ${selectedGroupKey}`, method: "industry", totalCount: pinned.rows[0].total_count,
          loadedCount: 0, visibleCount: 0, memberKey: selectedGroupKey });
      }
    }
    for (const ids of memberships.values()) for (const id of ids) {
      const group = groups.get(id)!;
      group.loadedCount++;
      group.visibleCount++; // Initial payload has no client search/selection.
    }

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
          groupIds: memberships.get(c.id) || [],
          kind: "contact",
        },
      };
    });

    if (rootCompanyId) {
      const companyRes = await client.query<{ id: string; name: string }>(
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
            groupIds: [],
            kind: "company",
          },
        });
      }
    }

    // Get edges between loaded nodes
    // A focused neighborhood can be arbitrarily far down the global edges
    // table. Filter in SQL before the cap so its real edges are not lost to
    // the first 20,000 unrelated rows.
    type EdgeRow = {
      id: string;
      source_contact_id: string;
      target_contact_id: string;
      edge_type: string;
      weight: number;
      available_edges: number;
    };
    const edgesRes = storedEdgeTypes.length === 0 || nodeIds.size === 0
      ? { rows: [] as EdgeRow[] }
      : await client.query<EdgeRow>(
      `SELECT id, source_contact_id, target_contact_id, edge_type, weight,
              COUNT(*) OVER()::int AS available_edges
       FROM edges
       WHERE target_contact_id IS NOT NULL
         AND edge_type = ANY($1)
         AND source_contact_id = ANY($2::uuid[])
         AND target_contact_id = ANY($2::uuid[])
       ORDER BY id ASC
       LIMIT 20000`,
      [storedEdgeTypes, [...nodeIds]]
    );

    // The SQL has already restricted both endpoints to loaded contacts.
    const edges = edgesRes.rows.map((e) => ({
      key: e.id,
      source: e.source_contact_id,
      target: e.target_contact_id,
      attributes: {
        type: e.edge_type,
        weight: e.weight,
      },
    }));

    if (edgeTypeFilter.includes("company-context") && rootCompanyId && nodeIds.size > 0 && nodes.some((n) => n.key === rootCompanyId)) {
      for (const contactId of nodeIds) {
        edges.push({
          key: `company-context:${rootCompanyId}:${contactId}`,
          source: rootCompanyId,
          target: contactId,
          attributes: { type: "company-context", weight: 1 },
        });
      }
    }

    const companyLoaded = Boolean(rootCompanyId && nodes.some((n) => n.key === rootCompanyId));
    const availableNodes = (nodesRes.rows[0]?.available_nodes ?? 0) + (companyLoaded ? 1 : 0);
    const availableEdges = (edgesRes.rows[0]?.available_edges ?? 0) + (edges.length - edgesRes.rows.length);

    // Stats
    const totalRes = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text as cnt FROM contacts WHERE is_archived = FALSE`
    );

    const communityRes = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text as cnt FROM clusters`
    );

    const sortedGroups = [...groups.values()].sort((a, b) => b.totalCount - a.totalCount || a.id.localeCompare(b.id));
    const catalogGroups = sortedGroups.slice(0, GROUP_CATALOG_LIMIT * 2);
    // Paged catalog rows need counts for loaded groups beyond the cap.
    const payloadIds = new Set(catalogGroups.map((group) => group.id));
    for (const ids of memberships.values()) for (const id of ids) {
      if (!payloadIds.has(id)) {
        catalogGroups.push(groups.get(id)!);
        payloadIds.add(id);
      }
    }
    if (selectedGroupId && groups.has(selectedGroupId) && !payloadIds.has(selectedGroupId)) {
      catalogGroups.push(groups.get(selectedGroupId)!);
    }
    return NextResponse.json({
      data: {
        nodes,
        edges,
        groups: catalogGroups,
        focusNodeId: rootContactId || rootCompanyId,
        stats: {
          totalNodes: parseInt(totalRes.rows[0]?.cnt || "0", 10) + (companyLoaded ? 1 : 0),
          loadedNodes: nodes.length,
          availableNodes,
          truncatedNodes: Math.max(0, availableNodes - nodes.length),
          totalEdges: edges.length,
          availableEdges,
          truncatedEdges: Math.max(0, availableEdges - edges.length),
          communities: parseInt(communityRes.rows[0]?.cnt || "0", 10),
        },
      },
    });
    });
  } catch (error) {
    if (error instanceof GraphSchemaUpgradeRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      {
        error: "Failed to load graph data",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
