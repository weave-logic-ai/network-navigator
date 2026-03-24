import { query } from '../../db/client';
import type { CausalNode, CausalEdge, CausalGraphTrace, CausalEntityType, CausalRelation } from '../types';

// --- Create ---

export async function createCausalNode(
  tenantId: string,
  entityType: CausalEntityType,
  entityId: string,
  operation: string,
  inputs: Record<string, unknown> = {},
  output: Record<string, unknown> = {},
  sessionId?: string
): Promise<CausalNode> {
  const result = await query<Record<string, unknown>>(
    `INSERT INTO causal_nodes (tenant_id, entity_type, entity_id, operation, inputs, output, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [tenantId, entityType, entityId, operation, JSON.stringify(inputs), JSON.stringify(output), sessionId ?? null]
  );
  return mapNode(result.rows[0]);
}

export async function updateCausalNodeOutput(
  nodeId: string,
  output: Record<string, unknown>
): Promise<void> {
  await query(
    `UPDATE causal_nodes SET output = $1 WHERE id = $2`,
    [JSON.stringify(output), nodeId]
  );
}

export async function createCausalEdge(
  sourceNodeId: string,
  targetNodeId: string,
  relation: CausalRelation,
  weight: number = 1.0,
  metadata: Record<string, unknown> = {}
): Promise<CausalEdge> {
  const result = await query<Record<string, unknown>>(
    `INSERT INTO causal_edges (source_node_id, target_node_id, relation, weight, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [sourceNodeId, targetNodeId, relation, weight, JSON.stringify(metadata)]
  );
  return mapEdge(result.rows[0]);
}

// Batch insert for performance (single round-trip)
export async function batchCreateNodes(
  tenantId: string,
  nodes: Array<{
    entityType: CausalEntityType;
    entityId: string;
    operation: string;
    inputs?: Record<string, unknown>;
    output?: Record<string, unknown>;
  }>
): Promise<CausalNode[]> {
  if (nodes.length === 0) return [];

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const node of nodes) {
    placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    values.push(
      tenantId,
      node.entityType,
      node.entityId,
      node.operation,
      JSON.stringify(node.inputs ?? {}),
      JSON.stringify(node.output ?? {})
    );
  }

  const result = await query<Record<string, unknown>>(
    `INSERT INTO causal_nodes (tenant_id, entity_type, entity_id, operation, inputs, output)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values
  );
  return result.rows.map(mapNode);
}

export async function batchCreateEdges(
  edges: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    relation: CausalRelation;
    weight?: number;
  }>
): Promise<CausalEdge[]> {
  if (edges.length === 0) return [];

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const edge of edges) {
    placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    values.push(edge.sourceNodeId, edge.targetNodeId, edge.relation, edge.weight ?? 1.0);
  }

  const result = await query<Record<string, unknown>>(
    `INSERT INTO causal_edges (source_node_id, target_node_id, relation, weight)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values
  );
  return result.rows.map(mapEdge);
}

// --- Read ---

export async function getCausalGraph(
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<CausalGraphTrace | null> {
  // Find root node
  const rootResult = await query<Record<string, unknown>>(
    `SELECT * FROM causal_nodes
     WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, entityType, entityId]
  );

  if (rootResult.rows.length === 0) return null;
  const rootNode = mapNode(rootResult.rows[0]);

  // Get all nodes connected to this root via edges (2 levels deep)
  const nodesResult = await query<Record<string, unknown>>(
    `WITH RECURSIVE graph AS (
       SELECT id FROM causal_nodes WHERE id = $1
       UNION
       SELECT CASE WHEN ce.source_node_id = g.id THEN ce.target_node_id ELSE ce.source_node_id END
       FROM causal_edges ce JOIN graph g ON ce.source_node_id = g.id OR ce.target_node_id = g.id
     )
     SELECT cn.* FROM causal_nodes cn JOIN graph g ON cn.id = g.id`,
    [rootNode.id]
  );

  const nodeIds = new Set(nodesResult.rows.map(r => String(r.id)));
  const edgesResult = await query<Record<string, unknown>>(
    `SELECT * FROM causal_edges
     WHERE source_node_id = ANY($1) OR target_node_id = ANY($1)`,
    [Array.from(nodeIds)]
  );

  return {
    rootNode,
    nodes: nodesResult.rows.map(mapNode),
    edges: edgesResult.rows.map(mapEdge),
  };
}

export async function getLatestTraceForContact(
  tenantId: string,
  contactId: string
): Promise<CausalGraphTrace | null> {
  return getCausalGraph(tenantId, 'score', contactId);
}

// --- Mappers ---

function mapNode(row: Record<string, unknown>): CausalNode {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    entityType: String(row.entity_type) as CausalNode['entityType'],
    entityId: String(row.entity_id),
    operation: String(row.operation),
    inputs: (row.inputs ?? {}) as Record<string, unknown>,
    output: (row.output ?? {}) as Record<string, unknown>,
    sessionId: row.session_id as string | null,
    createdAt: String(row.created_at),
  };
}

function mapEdge(row: Record<string, unknown>): CausalEdge {
  return {
    id: String(row.id),
    sourceNodeId: String(row.source_node_id),
    targetNodeId: String(row.target_node_id),
    relation: String(row.relation) as CausalEdge['relation'],
    weight: Number(row.weight ?? 1.0),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}
