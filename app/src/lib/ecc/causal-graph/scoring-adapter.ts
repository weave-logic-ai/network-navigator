import { scoreContact as originalScoreContact } from '../../scoring/pipeline';
import { createCausalNode, createCausalEdge, updateCausalNodeOutput } from './service';
import { ECC_FLAGS } from '../types';
import type { ScoringRunResult } from '../../scoring/types';
import type { CausalGraphTrace } from '../types';

const DEFAULT_TENANT_ID = 'default'; // TODO: resolve from request context

/**
 * Score a contact with CausalGraph provenance tracking.
 * When ECC_CAUSAL_GRAPH is disabled, falls through to the original pipeline.
 */
export async function scoreContactWithProvenance(
  contactId: string,
  profileName?: string,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<ScoringRunResult & { _causal?: CausalGraphTrace }> {
  if (!ECC_FLAGS.causalGraph) {
    return originalScoreContact(contactId, profileName);
  }

  // Create root causal node
  const rootNode = await createCausalNode(
    tenantId, 'score', contactId, 'score_contact',
    { contactId, profileName: profileName ?? 'default' }
  );

  // Run the original scoring pipeline
  const result = await originalScoreContact(contactId, profileName);

  // Create causal nodes for each dimension
  const nodes = [rootNode];
  const edges = [];

  for (const dim of result.score.dimensions) {
    // Input node
    const inputNode = await createCausalNode(
      tenantId, 'input', dim.dimension, 'gather_inputs',
      { dimension: dim.dimension, metadata: dim.metadata ?? {} }
    );
    nodes.push(inputNode);

    // Dimension score node
    const dimNode = await createCausalNode(
      tenantId, 'dimension', dim.dimension, `compute_${dim.dimension}`,
      { dimension: dim.dimension },
      { raw: dim.rawValue }
    );
    nodes.push(dimNode);

    // Input -> Dimension edge
    const inputEdge = await createCausalEdge(inputNode.id, dimNode.id, 'caused', 1.0);
    edges.push(inputEdge);

    // Weight application node
    const weightNode = await createCausalNode(
      tenantId, 'weight', dim.dimension, 'apply_weight',
      { raw: dim.rawValue, weight: dim.weight },
      { weighted: dim.weightedValue }
    );
    nodes.push(weightNode);

    // Dimension -> Weight edge
    const dimWeightEdge = await createCausalEdge(dimNode.id, weightNode.id, 'weighted_by', dim.weight);
    edges.push(dimWeightEdge);

    // Weight -> Root edge
    const weightRootEdge = await createCausalEdge(weightNode.id, rootNode.id, 'merged_into', dim.weight);
    edges.push(weightRootEdge);
  }

  // Update root node with final output
  await updateCausalNodeOutput(rootNode.id, {
    compositeScore: result.score.compositeScore,
    tier: result.score.tier,
    persona: result.score.persona,
    behavioralPersona: result.score.behavioralPersona,
  });

  const causalGraph: CausalGraphTrace = { rootNode, nodes, edges };

  return { ...result, _causal: causalGraph };
}
