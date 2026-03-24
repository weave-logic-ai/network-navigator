import { query } from '../../db/client';
import type { CounterfactualResult } from './types';

/**
 * Re-score a contact with modified weights by replaying the causal graph.
 * Reuses cached input nodes; only recomputes weight application and aggregation.
 */
export async function counterfactualScore(
  tenantId: string,
  contactId: string,
  modifiedWeights: Record<string, number>
): Promise<CounterfactualResult | null> {
  // Get the latest causal graph for this contact
  const rootResult = await query<Record<string, unknown>>(
    `SELECT * FROM causal_nodes
     WHERE tenant_id = $1 AND entity_type = 'score' AND entity_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, contactId]
  );

  if (rootResult.rows.length === 0) return null;
  const rootNode = rootResult.rows[0];
  const originalOutput = rootNode.output as Record<string, unknown>;

  // Get weight nodes connected to this scoring run
  const weightNodes = await query<Record<string, unknown>>(
    `SELECT cn.* FROM causal_nodes cn
     JOIN causal_edges ce ON ce.source_node_id = cn.id
     WHERE ce.target_node_id = $1 AND cn.entity_type = 'weight'
     ORDER BY cn.entity_id`,
    [rootNode.id]
  );

  // Recompute with modified weights
  let newComposite = 0;
  let totalWeight = 0;
  const dimensionDeltas: Record<string, number> = {};

  for (const wn of weightNodes.rows) {
    const dimName = String(wn.entity_id);
    const inputs = wn.inputs as Record<string, unknown>;
    const rawScore = Number(inputs.raw ?? 0);
    const oldWeight = Number(inputs.weight ?? 0);
    const newWeight = modifiedWeights[dimName] ?? oldWeight;

    const oldWeighted = rawScore * oldWeight;
    const newWeighted = rawScore * newWeight;

    newComposite += newWeighted;
    totalWeight += newWeight;
    dimensionDeltas[dimName] = newWeighted - oldWeighted;
  }

  // Normalize if weights don't sum to 1
  if (totalWeight > 0 && totalWeight !== 1) {
    newComposite = newComposite / totalWeight;
  }

  const originalComposite = Number(originalOutput.compositeScore ?? 0);
  const originalTier = String(originalOutput.tier ?? 'unscored');
  const originalPersona = String(originalOutput.persona ?? 'unknown');

  // Determine new tier based on composite score
  const newTier = computeTier(newComposite);
  const newPersona = originalPersona; // Persona depends on dimension pattern, not just composite

  return {
    original: {
      compositeScore: originalComposite,
      tier: originalTier,
      persona: originalPersona,
    },
    counterfactual: {
      compositeScore: Math.round(newComposite * 1000) / 1000,
      tier: newTier,
      persona: newPersona,
    },
    diff: {
      compositeScoreDelta: Math.round((newComposite - originalComposite) * 1000) / 1000,
      tierChanged: newTier !== originalTier,
      personaChanged: false,
      dimensionDeltas,
    },
  };
}

function computeTier(score: number): string {
  if (score >= 0.75) return 'gold';
  if (score >= 0.5) return 'silver';
  if (score >= 0.25) return 'bronze';
  if (score > 0) return 'watch';
  return 'unscored';
}
