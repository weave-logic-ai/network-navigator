import { scoreContact as originalScoreContact } from '../../scoring/pipeline';
import { createCausalNode, createCausalEdge, updateCausalNodeOutput } from './service';
import { ECC_FLAGS } from '../types';
import { getDefaultTenantId, getTargetById } from '../../targets/service';
import type { ScoringRunResult } from '../../scoring/types';
import type { CausalGraphTrace } from '../types';

/**
 * Resolve the tenant id for an ECC causal-graph scoring run.
 *
 * Resolution order (per WS-4 Phase 1 Track B — replaces the old
 * `DEFAULT_TENANT_ID = 'default'` hardcoded stub listed as P0 in
 * `docs/development_notes/stub-inventory.md`):
 *
 *   1. Caller-supplied override (`tenantIdOverride`) — used by tests and
 *      internal multi-tenant dispatchers that already resolved the tenant.
 *   2. The `tenant_id` on the target row referenced by `targetId`.
 *   3. Fallback to the default tenant (single-tenant local mode).
 */
async function resolveTenantId(
  targetId?: string,
  tenantIdOverride?: string
): Promise<string> {
  if (tenantIdOverride) return tenantIdOverride;
  if (targetId) {
    const target = await getTargetById(targetId);
    if (target) return target.tenantId;
  }
  return getDefaultTenantId();
}

/**
 * Score a contact with CausalGraph provenance tracking.
 * When ECC_CAUSAL_GRAPH is disabled, falls through to the original pipeline.
 *
 * Signature compatibility: existing callers pass only `(contactId, profileName?)`.
 * `targetId` is rejected before causal nodes are created because persisted
 * scores and transition impulses represent only the owner baseline.
 * `tenantIdOverride` is reserved for test setups and internal callers.
 */
export async function scoreContactWithProvenance(
  contactId: string,
  profileName?: string,
  targetId?: string,
  tenantIdOverride?: string
): Promise<ScoringRunResult & { _causal?: CausalGraphTrace }> {
  if (targetId !== undefined) {
    throw new Error('targetId is only supported by the read-only scoring context preview');
  }
  if (!ECC_FLAGS.causalGraph) {
    return originalScoreContact(contactId, profileName, targetId);
  }

  const tenantId = await resolveTenantId(targetId, tenantIdOverride);

  // Create root causal node
  const rootNode = await createCausalNode(
    tenantId, 'score', contactId, 'score_contact',
    { contactId, profileName: profileName ?? 'default', targetId: targetId ?? null }
  );

  // Run the original scoring pipeline
  const result = await originalScoreContact(contactId, profileName, targetId);

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
