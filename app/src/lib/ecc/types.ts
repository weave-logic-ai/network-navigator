// ECC (Embodied Cognitive Computing) shared types

// --- Feature Flags ---
export const ECC_FLAGS = {
  causalGraph: process.env.ECC_CAUSAL_GRAPH === 'true',
  exoChain: process.env.ECC_EXO_CHAIN === 'true',
  impulses: process.env.ECC_IMPULSES === 'true',
  cognitiveTick: process.env.ECC_COGNITIVE_TICK === 'true',
  crossRefs: process.env.ECC_CROSS_REFS === 'true',
};

// --- CausalGraph Types ---
export type CausalRelation = 'caused' | 'enabled' | 'weighted_by' | 'derived_from' | 'merged_into' | 'counterfactual';
export type CausalEntityType = 'score' | 'dimension' | 'input' | 'weight' | 'enrichment' | 'graph_metric';

export interface CausalNode {
  id: string;
  tenantId: string;
  entityType: CausalEntityType;
  entityId: string;
  operation: string;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  sessionId: string | null;
  createdAt: string;
}

export interface CausalEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: CausalRelation;
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CausalGraphTrace {
  rootNode: CausalNode;
  nodes: CausalNode[];
  edges: CausalEdge[];
}

// --- ExoChain Types ---
export type ChainOperation =
  | 'budget_check'
  | 'field_check'
  | 'provider_select'
  | 'provider_skip'
  | 'enrich_call'
  | 'enrich_result'
  | 'budget_debit'
  | 'waterfall_complete';

export interface ExoChainEntry {
  id: string;
  tenantId: string;
  chainId: string;
  sequence: number;
  prevHash: string | null; // hex-encoded
  entryHash: string; // hex-encoded
  operation: ChainOperation;
  data: Record<string, unknown>;
  actor: string;
  createdAt: string;
}

// --- Impulse Types ---
export type ImpulseType =
  | 'score_computed'
  | 'tier_changed'
  | 'persona_assigned'
  | 'enrichment_complete'
  | 'contact_created'
  | 'edge_created';

export type HandlerType = 'task_generator' | 'campaign_enroller' | 'notification' | 'webhook';

export interface Impulse {
  id: string;
  tenantId: string;
  impulseType: ImpulseType;
  sourceEntityType: string;
  sourceEntityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ImpulseHandler {
  id: string;
  tenantId: string;
  impulseType: ImpulseType;
  handlerType: HandlerType;
  config: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImpulseAck {
  id: string;
  impulseId: string;
  handlerId: string;
  status: 'success' | 'failed' | 'skipped';
  result: Record<string, unknown>;
  processedAt: string;
}

// --- CognitiveTick Types ---
export type SessionStatus = 'active' | 'paused' | 'completed';

export interface ResearchSession {
  id: string;
  tenantId: string;
  userId: string;
  intent: Record<string, unknown>;
  context: Record<string, unknown>;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  contextSnapshot: Record<string, unknown>;
  tokensUsed: number;
  createdAt: string;
}

// --- CrossRef Types ---
export type CrossRefType =
  | 'co_worker'
  | 'referrer'
  | 'shared_company'
  | 'mutual_connection'
  | 'reported_to'
  | 'invested_in'
  | 'co_author'
  | 'advisor'
  | 'custom';

export interface CrossRef {
  id: string;
  tenantId: string;
  edgeId: string;
  relationType: CrossRefType;
  context: Record<string, unknown>;
  confidence: number;
  source: string;
  sourceEntityId: string | null;
  bidirectional: boolean;
  createdAt: string;
  updatedAt: string;
}
