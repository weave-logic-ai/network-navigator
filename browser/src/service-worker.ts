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
} from './utils/storage';
import {
  DEFAULT_APP_URL,
  HEALTH_CHECK_ALARM,
  QUEUE_FLUSH_ALARM,
} from './shared/constants';
import { logger } from './utils/logger';

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

  if (queueDepth > 0) {
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
// Capture Processing
// ============================================================

async function processCapture(payload: CapturePayload): Promise<void> {
  const client = await getAppClient();

  try {
    const result = await client.submitCapture(payload);
    logger.info(`Capture submitted: ${result.captureId}, ${result.storedBytes} bytes`);
    await incrementDailyCaptureCount();

    // Refresh tasks — server auto-completes matching tasks on capture
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
        // Non-critical — tasks will load on next check
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
        // Request capture from active tab's content script
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

  // Run health check immediately
  await performHealthCheck();
});

// Run initial health check to set connection state (HTTP-based, always works)
performHealthCheck().catch(() => {});

// WebSocket is optional — only attempt if explicitly enabled
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
