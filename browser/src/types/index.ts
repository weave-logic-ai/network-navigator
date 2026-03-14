// Extension configuration stored in chrome.storage.local
export interface ExtensionConfig {
  appUrl: string;
  authToken: string | null;
  isRegistered: boolean;
  autoCaptureEnabled: boolean;
  overlayPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  dailyCaptureLimit: number;
  captureWarningThreshold: number;
}

// Capture queue item for offline buffering
export interface QueuedCapture {
  id: string;
  url: string;
  pageType: string;
  html: string;
  capturedAt: string;
  retryCount: number;
}

// Extension state managed by service worker
export interface ExtensionState {
  isConnected: boolean;
  lastSyncAt: string | null;
  pendingCaptureCount: number;
  todayCaptureCount: number;
  taskCount: number;
}

// Message types for chrome.runtime.sendMessage
export type ExtensionMessage =
  | { type: 'CAPTURE_PAGE'; payload: { url: string; pageType: string } }
  | { type: 'GET_STATUS'; payload?: never }
  | { type: 'SYNC_TASKS'; payload?: never }
  | { type: 'UPDATE_CONFIG'; payload: Partial<ExtensionConfig> }
  | { type: 'QUEUE_FLUSH'; payload?: never };

export type ExtensionResponse =
  | { status: 'ok'; data?: unknown }
  | { status: 'error'; error: string };

// LinkedIn page type classification
export type LinkedInPageType =
  | 'profile'
  | 'search_results'
  | 'feed'
  | 'company'
  | 'group'
  | 'event'
  | 'messaging'
  | 'unknown';
