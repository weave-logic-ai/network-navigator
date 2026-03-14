import type { ExtensionConfig, QueuedCapture, ExtensionState } from '../types';

// Type-safe chrome.storage.local wrapper
// Phase 1: Scaffold with type signatures. Full implementation in Phase 4.

const STORAGE_KEYS = {
  CONFIG: 'lni_config',
  STATE: 'lni_state',
  CAPTURE_QUEUE: 'lni_capture_queue',
} as const;

const DEFAULT_CONFIG: ExtensionConfig = {
  appUrl: 'http://localhost:3000',
  authToken: null,
  isRegistered: false,
  autoCaptureEnabled: false,
  overlayPosition: 'top-right',
  dailyCaptureLimit: 100,
  captureWarningThreshold: 80,
};

export async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
  return { ...DEFAULT_CONFIG, ...(result[STORAGE_KEYS.CONFIG] || {}) };
}

export async function setConfig(config: Partial<ExtensionConfig>): Promise<void> {
  const current = await getConfig();
  await chrome.storage.local.set({
    [STORAGE_KEYS.CONFIG]: { ...current, ...config },
  });
}

export async function getState(): Promise<ExtensionState> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.STATE);
  return result[STORAGE_KEYS.STATE] || {
    isConnected: false,
    lastSyncAt: null,
    pendingCaptureCount: 0,
    todayCaptureCount: 0,
    taskCount: 0,
  };
}

export async function getCaptureQueue(): Promise<QueuedCapture[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CAPTURE_QUEUE);
  return result[STORAGE_KEYS.CAPTURE_QUEUE] || [];
}
