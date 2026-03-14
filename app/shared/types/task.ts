// ExtensionTask: task pushed from app to extension
export interface ExtensionTask {
  id: string;
  goalId?: string;
  contactId?: string;
  title: string;
  description?: string;
  taskType: 'visit_profile' | 'send_message' | 'capture_page' | 'review_contact' | 'manual';
  url?: string;
  priority: number;     // 1-10
  dueDate?: string;     // ISO 8601
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  metadata: Record<string, unknown>;
}

// TaskCompletion: sent from extension to app when a task is done
export interface TaskCompletion {
  taskId: string;
  completedAt: string;
  autoCompleted: boolean;  // true if auto-detected by URL match
  captureId?: string;      // If task completion triggered a capture
}
