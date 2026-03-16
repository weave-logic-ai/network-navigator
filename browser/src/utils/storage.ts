// Type-safe chrome.storage.local wrapper

import type {
  StorageSchema,
  CapturePayload,
  AppConnectionState,
} from '../types';
import { DEFAULT_SETTINGS, DEFAULT_APP_URL } from '../shared/constants';

const STORAGE_DEFAULTS: StorageSchema = {
  extensionToken: null,
  extensionId: null,
  appUrl: DEFAULT_APP_URL,
  captureQueue: [],
  settings: DEFAULT_SETTINGS,
  sessionId: crypto.randomUUID(),
  dailyCaptureCount: 0,
  dailyCaptureDate: new Date().toISOString().split('T')[0],
  pendingTasks: [],
  lastHealthCheck: null,
  connectionState: 'disconnected',
};

export async function getStorage<K extends keyof StorageSchema>(
  key: K
): Promise<StorageSchema[K]> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as StorageSchema[K]) ?? STORAGE_DEFAULTS[key];
}

export async function setStorage<K extends keyof StorageSchema>(
  key: K,
  value: StorageSchema[K]
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getMultipleStorage<K extends keyof StorageSchema>(
  keys: K[]
): Promise<Pick<StorageSchema, K>> {
  const result = await chrome.storage.local.get(keys);
  const filled = {} as Record<string, unknown>;
  for (const key of keys) {
    filled[key] = (result[key] as StorageSchema[K]) ?? STORAGE_DEFAULTS[key];
  }
  return filled as Pick<StorageSchema, K>;
}

// ---- Capture Queue Operations ----

export async function enqueueCapturePayload(
  payload: CapturePayload
): Promise<number> {
  const queue = await getStorage('captureQueue');
  const settings = await getStorage('settings');
  if (queue.length >= settings.maxQueueSize) {
    queue.shift(); // Drop oldest if at max
  }
  queue.push(payload);
  await setStorage('captureQueue', queue);
  return queue.length;
}

export async function dequeueCapturePayload(): Promise<CapturePayload | null> {
  const queue = await getStorage('captureQueue');
  if (queue.length === 0) return null;
  const payload = queue.shift()!;
  await setStorage('captureQueue', queue);
  return payload;
}

export async function getCaptureQueueDepth(): Promise<number> {
  const queue = await getStorage('captureQueue');
  return queue.length;
}

export async function clearCaptureQueue(): Promise<void> {
  await setStorage('captureQueue', []);
}

// ---- Daily Capture Counter ----

export async function incrementDailyCaptureCount(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const storedDate = await getStorage('dailyCaptureDate');
  let count = await getStorage('dailyCaptureCount');

  if (storedDate !== today) {
    count = 0;
    await setStorage('dailyCaptureDate', today);
  }
  count += 1;
  await setStorage('dailyCaptureCount', count);
  return count;
}

// ---- Token Operations ----

export async function getToken(): Promise<string | null> {
  return getStorage('extensionToken');
}

export async function setToken(
  token: string,
  extensionId: string
): Promise<void> {
  await chrome.storage.local.set({ extensionToken: token, extensionId });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.set({
    extensionToken: null,
    extensionId: null,
  });
}

// ---- Connection State ----

export async function setConnectionState(
  state: AppConnectionState
): Promise<void> {
  await setStorage('connectionState', state);
}
