// Impulse module-specific types -- re-exports from shared + adds local types

export type {
  Impulse, ImpulseHandler, ImpulseAck, ImpulseType, HandlerType
} from '../types';

export interface EmitImpulseParams {
  tenantId: string;
  impulseType: import('../types').ImpulseType;
  sourceEntityType: string;
  sourceEntityId: string;
  payload: Record<string, unknown>;
}

export interface HandlerExecutionResult {
  handlerId: string;
  status: 'success' | 'failed' | 'skipped';
  result: Record<string, unknown>;
  durationMs: number;
}

export interface DispatchResult {
  impulseId: string;
  handlersExecuted: number;
  results: HandlerExecutionResult[];
}
