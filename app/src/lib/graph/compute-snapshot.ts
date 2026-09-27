// One graph snapshot, one bounded transaction, one atomic publication.
import type { PoolClient } from "pg";
import { transaction } from "../db/client";
import { detectCommunitiesInTransaction, type CommunityComputeResult } from "./communities";
import { syncContactsGraph } from "./ruvector-sync";
import { randomUUID } from "node:crypto";
import { assertGraphSchemaReady } from "./schema-gate";

import { PUBLISHED_GRAPH_EDGE_TYPES } from "./edge-policy";
const MAX_EDGES = 10_000; // Matches the spectral input bound; never publish a truncated graph.
const COMPUTE_BUDGET_MS = 90_000;
const MAX_ORPHANS_PER_RUN = 8;

type Edge = { source_contact_id: string; target_contact_id: string };
type Metric = { id: string; pagerank: number; betweenness: number; degree: number };

export class GraphComputeBusyError extends Error {
  constructor() { super("Graph computation is already running. Retry when it finishes."); }
}

export class GraphComputePublicationUncertainError extends Error {
  constructor() { super("Graph computation ended, but its publication could not be verified. Refresh the graph before retrying."); }
}

export type GraphComputeResult = {
  metricsComputed: number;
  communitiesDetected: number;
  communityMethod: CommunityComputeResult["method"];
  metricsMethod: "node-atomic";
};

function calculateMetrics(ids: string[], edges: Edge[], deadline: number): Metric[] {
  const neighbors = new Map(ids.map((id) => [id, new Set<string>()]));
  const out = new Map(ids.map((id) => [id, new Set<string>()]));
  const degree = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    if (!neighbors.has(edge.source_contact_id) || !neighbors.has(edge.target_contact_id)) continue;
    out.get(edge.source_contact_id)!.add(edge.target_contact_id);
    neighbors.get(edge.source_contact_id)!.add(edge.target_contact_id);
    neighbors.get(edge.target_contact_id)!.add(edge.source_contact_id);
    degree.set(edge.source_contact_id, degree.get(edge.source_contact_id)! + 1);
    degree.set(edge.target_contact_id, degree.get(edge.target_contact_id)! + 1);
  }
  if (!ids.length) return [];

  let ranks = new Map(ids.map((id) => [id, 1 / ids.length]));
  for (let iteration = 0; iteration < 20; iteration++) {
    if (Date.now() > deadline) throw new Error("Graph computation exceeded its time budget");
    const dangling = ids.reduce((sum, id) => sum + (out.get(id)!.size ? 0 : ranks.get(id)!), 0);
    const next = new Map(ids.map((id) => [id, (1 - 0.85 + 0.85 * dangling) / ids.length]));
    for (const id of ids) {
      const targets = out.get(id)!;
      if (!targets.size) continue;
      const share = 0.85 * ranks.get(id)! / targets.size;
      for (const target of targets) next.set(target, next.get(target)! + share);
    }
    ranks = next;
  }

  // Bounded Brandes sample, preserving the prior 50-source approximation.
  const betweenness = new Map(ids.map((id) => [id, 0]));
  for (const source of ids.filter((id) => neighbors.get(id)!.size > 0).slice(0, 50)) {
    if (Date.now() > deadline) throw new Error("Graph computation exceeded its time budget");
    const stack: string[] = [];
    const predecessors = new Map(ids.map((id) => [id, [] as string[]]));
    const paths = new Map(ids.map((id) => [id, 0]));
    const distance = new Map(ids.map((id) => [id, -1]));
    const dependency = new Map(ids.map((id) => [id, 0]));
    paths.set(source, 1);
    distance.set(source, 0);
    const queue = [source];
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      stack.push(node);
      for (const neighbor of neighbors.get(node)!) {
        if (distance.get(neighbor) === -1) {
          distance.set(neighbor, distance.get(node)! + 1);
          queue.push(neighbor);
        }
        if (distance.get(neighbor) === distance.get(node)! + 1) {
          paths.set(neighbor, paths.get(neighbor)! + paths.get(node)!);
          predecessors.get(neighbor)!.push(node);
        }
      }
    }
    while (stack.length) {
      const node = stack.pop()!;
      for (const previous of predecessors.get(node)!) {
        dependency.set(previous, dependency.get(previous)! + paths.get(previous)! / paths.get(node)! * (1 + dependency.get(node)!));
      }
      if (node !== source) betweenness.set(node, betweenness.get(node)! + dependency.get(node)!);
    }
  }
  const scale = ids.length > 2 ? 2 / ((ids.length - 1) * (ids.length - 2)) : 0;
  return ids.map((id) => ({ id, pagerank: ranks.get(id)!, betweenness: betweenness.get(id)! * scale, degree: degree.get(id)! }));
}

// Called only while holding the compute advisory lock. A crashed process
// releases that lock, so every private graph except the published pointer is
// an abandoned stage or an old publication. The cap keeps retries bounded.
export async function reclaimInactiveGraphs(client: PoolClient, activeGraph: string | null): Promise<number> {
  const candidates = await client.query<{ graph_name: string }>(
    `SELECT graph_name FROM unnest(ruvector_list_graphs()) AS native_graphs(graph_name)
     WHERE (graph_name = 'contacts' OR graph_name ~ '^contacts_[0-9a-f]{32}$')
       AND graph_name IS DISTINCT FROM $1
     ORDER BY graph_name`,
    [activeGraph]
  );
  let deleted = 0;
  for (const { graph_name } of candidates.rows) {
    if (deleted >= MAX_ORPHANS_PER_RUN) break;
    const pin = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock(832782, hashtext($1)) AS acquired', [graph_name]
    );
    if (!pin.rows[0]?.acquired) continue;
    await client.query("SELECT ruvector_delete_graph($1)", [graph_name]);
    deleted++;
  }
  return deleted;
}

async function cleanupInactiveGraphs(): Promise<void> {
  try {
    await transaction(async (client) => {
      await client.query("SET LOCAL transaction_timeout = '10s'");
      await client.query("SET LOCAL statement_timeout = '2s'");
      const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(832781, 2) AS acquired");
      if (!lock.rows[0]?.acquired) return;
      const state = await client.query<{ active_graph_name: string | null }>(
        "SELECT active_graph_name FROM graph_compute_state WHERE id = TRUE"
      );
      if (state.rows[0]) await reclaimInactiveGraphs(client, state.rows[0].active_graph_name);
    });
  } catch (error) {
    console.warn("[graph/compute] Deferred inactive graph cleanup", error);
  }
}

// A rejected transaction may have committed before its acknowledgment was
// lost. Only a fresh transaction holding the publication lock can decide
// whether this stage is safe to retire. Readers may still pin an older stage.
async function reconcileFailedStage(stagingGraph: string): Promise<"published" | "not-published"> {
  return transaction(async (client) => {
    await client.query("SET LOCAL transaction_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock(832781, 2)");
    const state = await client.query<{ active_graph_name: string | null }>(
      "SELECT active_graph_name FROM graph_compute_state WHERE id = TRUE"
    );
    if (state.rows.length !== 1) throw new GraphComputePublicationUncertainError();
    if (state.rows[0].active_graph_name === stagingGraph) return "published";
    const pin = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(832782, hashtext($1)) AS acquired", [stagingGraph]
    );
    if (pin.rows[0]?.acquired) await client.query("SELECT ruvector_delete_graph($1)", [stagingGraph]);
    return "not-published";
  });
}

async function publishMetrics(client: PoolClient, metrics: Metric[]): Promise<void> {
  const ids = metrics.map((row) => row.id);
  if (ids.length) {
    await client.query(
      `INSERT INTO graph_metrics (contact_id, pagerank, betweenness_centrality, degree_centrality, computed_at)
       SELECT id, rank, centrality, degree, NOW()
       FROM unnest($1::uuid[], $2::real[], $3::real[], $4::integer[]) AS m(id, rank, centrality, degree)
       ON CONFLICT (contact_id) DO UPDATE SET pagerank = EXCLUDED.pagerank,
         betweenness_centrality = EXCLUDED.betweenness_centrality,
         degree_centrality = EXCLUDED.degree_centrality, computed_at = EXCLUDED.computed_at`,
      [ids, metrics.map((row) => row.pagerank), metrics.map((row) => row.betweenness), metrics.map((row) => row.degree)]
    );
  }
  await client.query("DELETE FROM graph_metrics WHERE NOT (contact_id = ANY($1::uuid[]))", [ids]);
}

export async function computeGraphSnapshot(): Promise<GraphComputeResult> {
  let stagingGraph: string | null = null;
  let completedResult: GraphComputeResult | null = null;
  try {
    const result = await transaction(async (client) => {
      // PostgreSQL 17 ends the whole transaction (and releases the lock) after
      // the budget, including time spent in application computation.
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await client.query("SET LOCAL transaction_timeout = '90s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await assertGraphSchemaReady(client);
      const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(832781, 2) AS acquired");
      if (!lock.rows[0]?.acquired) throw new GraphComputeBusyError();
      const deadline = Date.now() + COMPUTE_BUDGET_MS;
      const state = await client.query<{ active_graph_name: string | null }>(
        "SELECT active_graph_name FROM graph_compute_state WHERE id = TRUE FOR UPDATE"
      );
      if (state.rows.length !== 1) throw new Error("Graph publication state is missing; apply migration 060.");

      const contacts = await client.query<{ id: string }>("SELECT id FROM contacts WHERE is_archived = FALSE ORDER BY id");
      const edges = await client.query<Edge>(
        `SELECT e.id, e.source_contact_id, e.target_contact_id, e.target_company_id,
                e.edge_type, e.weight, e.properties FROM edges e
         JOIN contacts source ON source.id = e.source_contact_id AND source.is_archived = FALSE
         JOIN contacts target ON target.id = e.target_contact_id AND target.is_archived = FALSE
         WHERE e.edge_type = ANY($1) ORDER BY e.id LIMIT $2`,
        [PUBLISHED_GRAPH_EDGE_TYPES, MAX_EDGES + 1]
      );
      if (edges.rows.length > MAX_EDGES) throw new Error("Graph exceeds the 10,000-edge compute limit; prior results were retained.");
      const metrics = calculateMetrics(contacts.rows.map((row) => row.id), edges.rows, deadline);
      if (Date.now() > deadline) throw new Error("Graph computation exceeded its time budget");
      // RuVector graph writes are not transactional in the installed extension.
      // Build under a private name; only the pointer below is published with
      // SQL results. A failed compute never exposes its staging graph.
      stagingGraph = `contacts_${randomUUID().replaceAll("-", "")}`;
      await syncContactsGraph(client, stagingGraph, PUBLISHED_GRAPH_EDGE_TYPES);
      await publishMetrics(client, metrics);
      const community = await detectCommunitiesInTransaction(client);
      const publication = await client.query(
        "UPDATE graph_compute_state SET active_graph_name = $1, published_edges = $2::jsonb, published_at = NOW() WHERE id = TRUE",
        [stagingGraph, JSON.stringify(edges.rows)]
      );
      if (publication.rowCount !== 1) throw new Error("Graph publication state changed during compute");
      completedResult = {
        metricsComputed: metrics.length,
        communitiesDetected: community.communities.length,
        communityMethod: community.method,
        metricsMethod: "node-atomic" as const,
      };
      return completedResult;
    });
    return result;
  } catch (error) {
    if (stagingGraph) {
      try {
        const outcome = await reconcileFailedStage(stagingGraph);
        if (outcome === "published") {
          if (completedResult) return completedResult;
          throw new GraphComputePublicationUncertainError();
        }
      } catch (reconcileError) {
        console.warn("[graph/compute] Could not verify failed stage publication", reconcileError);
        throw new GraphComputePublicationUncertainError();
      }
    }
    throw error;
  } finally {
    // Separate transaction: a late compute rollback must not restore stale
    // native graphs. Re-read the active pointer under the same advisory lock.
    await cleanupInactiveGraphs();
  }
}
