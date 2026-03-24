// Goal engine types

export interface TickContext {
  page: 'discover' | 'contacts' | 'dashboard' | 'tasks' | 'network' | 'outreach' | 'import' | 'admin' | 'extension';
  selectedNicheId?: string;
  selectedIcpId?: string;
  selectedOfferingIds?: string[];
  viewingContactId?: string;
}

export interface GoalCandidate {
  title: string;
  description: string;
  goalType: string;
  priority: number;
  targetMetric?: string;
  targetValue?: number;
  currentValue?: number;
  metadata: {
    engine: string;
    checkType: string;
    contextHash: string;
    suggestedTasks: SuggestedTask[];
  };
}

export interface SuggestedTask {
  title: string;
  description: string;
  taskType: string;
  priority: number;
  url?: string;
  contactId?: string;
}

export interface TickResult {
  newGoals: GoalCandidate[];
  errors: string[];
}

export type GoalCheck = (ctx: TickContext) => Promise<GoalCandidate[]>;
