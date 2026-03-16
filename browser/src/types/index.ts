// Extension type definitions
// All shared types for the LinkedIn Network Intelligence extension

// ============================================================
// Page Types
// ============================================================

export type LinkedInPageType =
  | 'PROFILE'
  | 'PROFILE_ACTIVITY'
  | 'SEARCH_PEOPLE'
  | 'SEARCH_CONTENT'
  | 'FEED'
  | 'COMPANY'
  | 'CONNECTIONS'
  | 'MESSAGES'
  | 'OTHER';

export interface PageUrlPattern {
  pageType: LinkedInPageType;
  pattern: RegExp;
  description: string;
}

// ============================================================
// Capture Types
// ============================================================

export interface CapturePayload {
  captureId: string;
  url: string;
  pageType: LinkedInPageType;
  html: string;
  scrollDepth: number;
  viewportHeight: number;
  documentHeight: number;
  capturedAt: string;
  extensionVersion: string;
  sessionId: string;
  triggerMode: 'manual' | 'auto';
}

export interface CaptureResponse {
  success: boolean;
  captureId: string;
  storedBytes: number;
  compressionRatio: number;
  queuedForParsing: boolean;
  pageType: string;
}

// ============================================================
// Task Types
// ============================================================

export type TaskType =
  | 'VISIT_PROFILE'
  | 'CAPTURE_PAGE'
  | 'SEND_MESSAGE'
  | 'REVIEW_CONTACT'
  | 'SEARCH_QUERY'
  | 'CHECK_COMPANY'
  | 'ENGAGE_POST';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface ExtensionTask {
  id: string;
  goalId: string;
  goalTitle: string;
  type: TaskType;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  targetUrl: string | null;
  searchQuery: string | null;
  contactName: string | null;
  appUrl: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Goal {
  id: string;
  title: string;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  tasks: ExtensionTask[];
}

export interface TasksResponse {
  goals: Goal[];
  totalPending: number;
  totalCompleted: number;
}

// ============================================================
// Template Types
// ============================================================

export interface TemplateResponse {
  success: boolean;
  message: string;
  templateId: string;
  templateName: string;
  variables: Record<string, string>;
  nextTemplateId: string | null;
}

// ============================================================
// Health & Settings Types
// ============================================================

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  dbConnected: boolean;
  wsConnected: boolean;
  pendingParseJobs: number;
  uptime: number;
  timestamp: string;
}

export interface ExtensionSettings {
  autoCaptureEnabled: boolean;
  capturePageTypes: LinkedInPageType[];
  dailyCaptureWarningThreshold: number;
  overlayPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  overlayEnabled: boolean;
  healthCheckIntervalMs: number;
  captureStabilityDelayMs: number;
  maxQueueSize: number;
}

// ============================================================
// WebSocket Types
// ============================================================

export type WsPushEventType =
  | 'CAPTURE_CONFIRMED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'GOAL_PROGRESS'
  | 'TEMPLATE_READY'
  | 'ENRICHMENT_COMPLETE'
  | 'SETTINGS_UPDATED'
  | 'PARSE_COMPLETE';

export interface WsMessage {
  type: WsPushEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

export type WsOutEventType = 'PAGE_NAVIGATED' | 'TASK_VIEWED';

export interface WsOutMessage {
  type: WsOutEventType;
  payload: Record<string, unknown>;
}

// ============================================================
// Connection State
// ============================================================

export type AppConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error';

// ============================================================
// Contact Lookup
// ============================================================

export interface ContactLookupResponse {
  found: boolean;
  contact: {
    id: string;
    name: string;
    headline: string;
    tier: string;
    goldScore: number;
    lastCapturedAt: string | null;
    lastEnrichedAt: string | null;
    tasksPending: number;
  } | null;
}

// ============================================================
// Internal Message Passing (chrome.runtime.sendMessage)
// ============================================================

export type ExtensionMessageType =
  | 'CAPTURE_REQUEST'
  | 'CAPTURE_RESULT'
  | 'PAGE_INFO'
  | 'CONNECTION_STATUS'
  | 'TASKS_UPDATE'
  | 'SETTINGS_UPDATE'
  | 'OVERLAY_STATE'
  | 'GET_STATUS'
  | 'OPEN_SIDE_PANEL';

export interface ExtensionMessage {
  type: ExtensionMessageType;
  payload?: unknown;
}

// ============================================================
// Storage Keys
// ============================================================

export interface StorageSchema {
  extensionToken: string | null;
  extensionId: string | null;
  appUrl: string;
  captureQueue: CapturePayload[];
  settings: ExtensionSettings;
  sessionId: string;
  dailyCaptureCount: number;
  dailyCaptureDate: string;
  pendingTasks: ExtensionTask[];
  lastHealthCheck: string | null;
  connectionState: AppConnectionState;
}
