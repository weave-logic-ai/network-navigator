// CausalGraph module-specific types
export type { CausalNode, CausalEdge, CausalGraphTrace, CausalRelation, CausalEntityType } from '../types';

export interface CounterfactualResult {
  original: { compositeScore: number; tier: string; persona: string };
  counterfactual: { compositeScore: number; tier: string; persona: string };
  diff: {
    compositeScoreDelta: number;
    tierChanged: boolean;
    personaChanged: boolean;
    dimensionDeltas: Record<string, number>;
  };
}
