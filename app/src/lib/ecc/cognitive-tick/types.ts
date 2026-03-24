export type { ResearchSession, SessionMessage, SessionStatus } from '../types';

export interface SessionIntent {
  goal: string;
  icpFocus?: string[];
  verticals?: string[];
  contactIds?: string[];
}

export interface IntentShift {
  type: 'vertical_shift' | 'icp_shift' | 'goal_shift';
  from: string | string[];
  to: string | string[];
}

export interface CreateSessionParams {
  tenantId: string;
  userId: string;
  intent: SessionIntent;
}

export interface AnalyzeWithSessionParams {
  tenantId: string;
  userId: string;
  contactId: string;
  prompt: string;
  sessionId?: string;
}
