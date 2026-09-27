import type { PoolClient } from "pg";

export class GraphSchemaUpgradeRequiredError extends Error {
  constructor() {
    super("Graph schema upgrade required: back up the existing database, apply migrations 059 then 060 using docs/content/docs/architecture/deployment.mdx#graph-grouping-upgrade, and restart the app.");
  }
}

export async function assertGraphSchemaReady(client: PoolClient): Promise<void> {
  const result = await client.query<{ membership_index: string | null; publication_table: string | null }>(
    `SELECT to_regclass('public.idx_cluster_memberships_cluster_id')::text AS membership_index,
            to_regclass('public.graph_compute_state')::text AS publication_table`
  );
  if (!result.rows[0]?.membership_index || !result.rows[0]?.publication_table) {
    throw new GraphSchemaUpgradeRequiredError();
  }
  const pointer = await client.query<{ present: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM graph_compute_state WHERE id = TRUE) AS present"
  );
  if (!pointer.rows[0]?.present) throw new GraphSchemaUpgradeRequiredError();
}
