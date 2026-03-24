export type { CrossRef, CrossRefType } from '../types';

export interface CreateCrossRefParams {
  tenantId: string;
  edgeId: string;
  relationType: import('../types').CrossRefType;
  context?: Record<string, unknown>;
  confidence?: number;
  source: string;
  sourceEntityId?: string;
  bidirectional?: boolean;
}
