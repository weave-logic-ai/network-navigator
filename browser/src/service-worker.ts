// LinkedIn Network Intelligence - Service Worker
// Message routing, capture queue, WebSocket client, health checks

import type {
  ExtensionMessage,
  CapturePayload,
  WsMessage,
} from './types';
import { AppClient } from './shared/app-client';
import {
  getStorage,
  setStorage,
  enqueueCapturePayload,
  dequeueCapturePayload,
  getCaptureQueueDepth,
  incrementDailyCaptureCount,
  getDailyCaptureCount,
  getCaptureLimit,
  incrementDailyCaptureTracking,
  getRetryQueue,
  removeRetryItem,
  updateRetryItem,
  enqueueRetry,
} from './utils/storage';
import {
  DEFAULT_APP_URL,
  HEALTH_CHECK_ALARM,
  QUEUE_FLUSH_ALARM,
} from './shared/constants';
import { logger } from './utils/logger';

// ============================================================
// Constants
// ============================================================

const RETRY_QUEUE_ALARM = 'retry-queue';
const MAX_RETRIES = 3;

// ============================================================
// App Client (singleton)
// ============================================================

let appClient: AppClient | null = null;

async function getAppClient(): Promise<AppClient> {
  if (!appClient) {
    const appUrl = await getStorage('appUrl');
    appClient = new AppClient(appUrl || DEFAULT_APP_URL);
  }
  return appClient;
}

// ============================================================
// Badge Management
// ============================================================

async function updateBadge(): Promise<void> {
  const queueDepth = await getCaptureQueueDepth();
  const connectionState = await getStorage('connectionState');

  // Check capture rate for badge warning (Phase 6)
  const dailyCount = await getDailyCaptureCount();
  const limit = await getCaptureLimit();
  const ratio = limit > 0 ? dailyCount / limit : 0;

  if (dailyCount >= limit) {
    // At limit -- red badge
    await chrome.action.setBadgeText({ text: 'MAX' });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
  } else if (ratio >= 0.8) {
    // Approaching limit (80%) -- yellow/warning badge
    const remaining = limit - dailyCount;
    await chrome.action.setBadgeText({ text: String(remaining) });
    await chrome.action.setBadgeBackgroundColor({ color: '#ffc107' });
  } else if (queueDepth > 0) {
    await chrome.action.setBadgeText({ text: String(queueDepth) });
    await chrome.action.setBadgeBackgroundColor({ color: '#ffc107' });
  } else if (connectionState === 'connected') {
    await chrome.action.setBadgeText({ text: '' });
  } else if (connectionState === 'error') {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// ============================================================
// Rate Limit Check (Phase 6)
// ============================================================

async function checkCaptureRateLimit(): Promise<{ allowed: boolean; remaining: number }> {
  const dailyCount = await getDailyCaptureCount();
  const limit = await getCaptureLimit();
  const remaining = Math.max(0, limit - dailyCount);
  return { allowed: dailyCount < limit, remaining };
}

// ============================================================
// Capture Processing
// ============================================================

async function processCapture(payload: CapturePayload): Promise<void> {
  // Phase 6: Check rate limit before processing
  const rateCheck = await checkCaptureRateLimit();
  if (!rateCheck.allowed) {
    logger.warn(`Daily capture limit reached. Skipping capture.`);
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon-48.png',
        title: 'Capture Limit Reached',
        message: `You have reached your daily capture limit. Adjust the limit in settings to continue.`,
      });
    } catch {
      // Notifications API may not be available
    }
    await updateBadge();
    return;
  }

  const client = await getAppClient();

  try {
    const result = await client.submitCapture(payload);
    logger.info(`Capture submitted: ${result.captureId}, ${result.storedBytes} bytes`);
    await incrementDailyCaptureCount();
    await incrementDailyCaptureTracking();

    // Refresh tasks -- server auto-completes matching tasks on capture
    try {
      const tasksData = await client.fetchTasks('pending', 50);
      const allTasks = tasksData.goals.flatMap((g: { tasks: unknown[] }) => g.tasks);
      await setStorage('pendingTasks', allTasks);
    } catch {
      // Non-critical
    }

    await updateBadge();
  } catch (error) {
    logger.warn(`Capture failed, queuing: ${(error as Error).message}`);
    await enqueueCapturePayload(payload);
    // Queue for retry (Phase 6)
    try {
      await enqueueRetry({
        method: 'POST',
        path: '/api/extension/capture',
        body: payload,
        maxRetries: MAX_RETRIES,
      });
    } catch {
      // Non-critical -- already queued via enqueueCapturePayload
    }
    await updateBadge();
  }
}

async function flushCaptureQueue(): Promise<void> {
  const queueDepth = await getCaptureQueueDepth();
  if (queueDepth === 0) return;

  logger.info(`Flushing capture queue: ${queueDepth} items`);
  const client = await getAppClient();

  let processed = 0;
  let payload = await dequeueCapturePayload();

  while (payload) {
    try {
      await client.submitCapture(payload);
      processed++;
    } catch (error) {
      // Re-queue on failure and stop
      logger.warn(`Queue flush failed at item ${processed}: ${(error as Error).message}`);
      await enqueueCapturePayload(payload);
      break;
    }
    payload = await dequeueCapturePayload();
  }

  logger.info(`Queue flush complete: ${processed} items processed`);
  await updateBadge();
}

// ============================================================
// Retry Queue Processing (Phase 6)
// ============================================================

async function processRetryQueue(): Promise<void> {
  const queue = await getRetryQueue();
  if (queue.length === 0) return;

  logger.info(`Processing retry queue: ${queue.length} items`);

  for (const item of queue) {
    if (item.retryCount >= item.maxRetries) {
      logger.error(`Retry exhausted for ${item.method} ${item.path} after ${item.maxRetries} attempts. Discarding.`);
      await removeRetryItem(item.id);
      continue;
    }

    try {
      const appUrl = await getStorage('appUrl');
      const token = await getStorage('extensionToken');
      if (!token) {
        await removeRetryItem(item.id);
        continue;
      }

      const response = await fetch(`${appUrl || DEFAULT_APP_URL}${item.path}`, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Token': token,
        },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (response.ok) {
        logger.info(`Retry succeeded for ${item.method} ${item.path}`);
        await removeRetryItem(item.id);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      logger.warn(`Retry failed for ${item.method} ${item.path}: ${(error as Error).message}`);
      await updateRetryItem(item.id, { retryCount: item.retryCount + 1 });
    }
  }
}

// ============================================================
// Health Check
// ============================================================

async function performHealthCheck(): Promise<void> {
  const client = await getAppClient();

  try {
    const health = await client.checkHealth();
    const state = health.status === 'unhealthy' ? 'disconnected' : 'connected';
    await setStorage('connectionState', state);
    await setStorage('lastHealthCheck', new Date().toISOString());

    // Refresh tasks from the app
    if (state === 'connected') {
      try {
        const tasksData = await client.fetchTasks('pending', 50);
        const allTasks = tasksData.goals.flatMap((g: { tasks: unknown[] }) => g.tasks);
        await setStorage('pendingTasks', allTasks);
      } catch {
        // Non-critical -- tasks will load on next check
      }
    }

    await updateBadge();

    // Broadcast connection status to content scripts
    const tabs = await chrome.tabs.query({
      url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'],
    });

    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CONNECTION_STATUS' as const,
          payload: { state },
        }).catch(() => {
          // Tab might not have content script loaded
        });
      }
    }
  } catch {
    await setStorage('connectionState', 'disconnected');
    await updateBadge();
  }
}

// ============================================================
// Message Routing
// ============================================================

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'CAPTURE_REQUEST': {
        // Phase 6: Check rate limit before capture
        checkCaptureRateLimit().then((rateCheck) => {
          if (!rateCheck.allowed) {
            sendResponse({
              status: 'error',
              message: 'Daily capture limit reached',
            });
            return;
          }

          if (sender.tab?.id) {
            // Content script initiated capture - process the result
            chrome.tabs.sendMessage(
              sender.tab.id,
              { type: 'CAPTURE_REQUEST' } satisfies ExtensionMessage,
              (response) => {
                if (response?.payload) {
                  processCapture(response.payload as CapturePayload).then(() => {
                    sendResponse({ status: 'ok' });
                  });
                }
              }
            );
          } else {
            // Popup or side panel initiated - get active tab
            chrome.tabs.query(
              { active: true, currentWindow: true },
              (tabs) => {
                if (tabs[0]?.id) {
                  chrome.tabs.sendMessage(
                    tabs[0].id,
                    { type: 'CAPTURE_REQUEST' } satisfies ExtensionMessage,
                    (response) => {
                      if (response?.payload) {
                        processCapture(response.payload as CapturePayload).then(
                          () => {
                            sendResponse({ status: 'ok' });
                          }
                        );
                      }
                    }
                  );
                }
              }
            );
          }
        });
        return true; // async response
      }

      case 'GET_STATUS': {
        Promise.all([
          getStorage('connectionState'),
          getCaptureQueueDepth(),
          getStorage('dailyCaptureCount'),
          getStorage('lastHealthCheck'),
          getStorage('pendingTasks'),
        ]).then(
          ([
            connectionState,
            queueDepth,
            dailyCaptureCount,
            lastHealthCheck,
            pendingTasks,
          ]) => {
            sendResponse({
              status: 'ok',
              data: {
                connectionState,
                queueDepth,
                dailyCaptureCount,
                lastHealthCheck,
                taskCount: pendingTasks.length,
              },
            });
          }
        );
        return true; // async response
      }

      case 'OPEN_SIDE_PANEL': {
        if (sender.tab?.id) {
          chrome.sidePanel
            .open({ tabId: sender.tab.id })
            .catch((err: Error) => {
              logger.error('Failed to open side panel:', err.message);
            });
        }
        sendResponse({ status: 'ok' });
        return false;
      }

      case 'TASKS_UPDATE': {
        // Sidebar/popup requested task status update
        const taskPayload = message.payload as { taskId: string; status: string } | undefined;
        if (taskPayload?.taskId) {
          (async () => {
            try {
              const client = await getAppClient();
              await client.updateTask(taskPayload.taskId, taskPayload.status);
              // Refresh tasks from server
              const tasksData = await client.fetchTasks('pending', 50);
              const allTasks = tasksData.goals.flatMap((g: { tasks: unknown[] }) => g.tasks);
              await setStorage('pendingTasks', allTasks);
              await updateBadge();
              sendResponse({ status: 'ok' });
            } catch (err) {
              logger.error('Task update failed:', (err as Error).message);
              // Phase 6: Queue failed task update for retry
              try {
                await enqueueRetry({
                  method: 'PATCH',
                  path: `/api/extension/tasks/${taskPayload.taskId}`,
                  body: { status: taskPayload.status },
                  maxRetries: MAX_RETRIES,
                });
              } catch {
                // Non-critical
              }
              sendResponse({ status: 'error', message: (err as Error).message });
            }
          })();
        } else {
          sendResponse({ status: 'ok' });
        }
        return true; // async response
      }

      case 'PAGE_INFO': {
        // Navigation detected - notify via WebSocket
        const client = appClient;
        if (client) {
          client.sendWsMessage({
            type: 'PAGE_NAVIGATED',
            payload: (message.payload as Record<string, unknown>) ?? {},
          });
        }
        sendResponse({ status: 'ok' });
        return false;
      }

      default:
        sendResponse({ status: 'ok' });
        return false;
    }
  }
);

// ============================================================
// WebSocket Event Handlers
// ============================================================

async function setupWebSocketHandlers(): Promise<void> {
  const client = await getAppClient();

  client.onWsEvent('CAPTURE_CONFIRMED', (msg: WsMessage) => {
    logger.info('Capture confirmed:', msg.payload);
  });

  client.onWsEvent('TASK_CREATED', async (msg: WsMessage) => {
    logger.info('New task:', msg.payload);
    // Refresh tasks
    try {
      const tasks = await client.fetchTasks('pending');
      await setStorage('pendingTasks', tasks.goals.flatMap((g) => g.tasks));
      await updateBadge();
    } catch {
      // Non-critical
    }
  });

  client.onWsEvent('SETTINGS_UPDATED', async (msg: WsMessage) => {
    const settings = (msg.payload as { settings?: unknown })?.settings;
    if (settings) {
      await setStorage(
        'settings',
        settings as Awaited<ReturnType<typeof getStorage<'settings'>>>
      );
    }
  });

  await client.connectWebSocket();
}

// ============================================================
// Alarms
// ============================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEALTH_CHECK_ALARM) {
    await performHealthCheck();
  }
  if (alarm.name === QUEUE_FLUSH_ALARM) {
    await flushCaptureQueue();
  }
  if (alarm.name === RETRY_QUEUE_ALARM) {
    await processRetryQueue();
  }
});

// ============================================================
// Install Handler
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info(`Extension installed: ${details.reason}`);

  if (details.reason === 'install') {
    // Set up periodic alarms
    await chrome.alarms.create(HEALTH_CHECK_ALARM, {
      periodInMinutes: 0.5, // Every 30 seconds
    });
    await chrome.alarms.create(QUEUE_FLUSH_ALARM, {
      periodInMinutes: 1, // Every minute
    });
    await chrome.alarms.create(RETRY_QUEUE_ALARM, {
      periodInMinutes: 2, // Every 2 minutes
    });
  }
});

// ============================================================
// Startup
// ============================================================

chrome.runtime.onStartup.addListener(async () => {
  logger.info('Service worker started');

  // Set up alarms
  await chrome.alarms.create(HEALTH_CHECK_ALARM, {
    periodInMinutes: 0.5,
  });
  await chrome.alarms.create(QUEUE_FLUSH_ALARM, {
    periodInMinutes: 1,
  });
  await chrome.alarms.create(RETRY_QUEUE_ALARM, {
    periodInMinutes: 2,
  });

  // Run health check immediately
  await performHealthCheck();

  // Process retry queue on startup (Phase 6)
  await processRetryQueue();
});

// Run initial health check to set connection state (HTTP-based, always works)
performHealthCheck().catch(() => {});

// Process retry queue on initial load (Phase 6)
processRetryQueue().catch(() => {});

// WebSocket is optional -- only attempt if explicitly enabled
// Next.js standalone doesn't support WS upgrade, so skip by default
getStorage('settings').then((settings) => {
  const wsEnabled = (settings as Record<string, unknown>)?.wsEnabled;
  if (wsEnabled) {
    setupWebSocketHandlers().catch((err) => {
      logger.warn('WebSocket unavailable (HTTP polling active):', (err as Error).message);
    });
  } else {
    logger.info('Service worker loaded (HTTP polling mode)');
  }
});

logger.info('Service worker loaded');
