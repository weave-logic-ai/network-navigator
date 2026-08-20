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
import {
  flushSnippetQueue,
  getSnippetQueueDepth,
  SNIPPET_QUEUE_FLUSH_ALARM,
  SNIPPET_QUEUE_FLUSH_INTERVAL_MIN,
} from './shared/snippet-queue';
import { syncApprovedOriginsFromChrome } from './shared/approved-origins';

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

async function processCapture(
  payload: CapturePayload,
  sourceTabId?: number,
): Promise<void> {
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

    // Refresh tasks -- server auto-completes matching tasks on capture and
    // creates a follow-up task for the next search page (up to MAX_SEARCH_PAGES).
    try {
      const tasksData = await client.fetchTasks('pending', 50);
      const allTasks = tasksData.goals.flatMap((g) => g.tasks);
      await setStorage('pendingTasks', allTasks);
    } catch {
      // Non-critical
    }

    await updateBadge();

    // Task #11: browser-side auto-pagination click-through
    if (sourceTabId !== undefined) {
      await maybeAutoPaginate(payload, sourceTabId);
    }
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

/**
 * Task #11 — browser-side auto-pagination click-through.
 *
 * After a successful capture of a SEARCH_PEOPLE / SEARCH_CONTENT page, the
 * server has already inserted a pending task for `?page=N+1` (capped at
 * MAX_SEARCH_PAGES in app/src/app/api/extension/capture/route.ts). If the
 * user enabled `autoPaginate`, navigate the tab to that next-page URL and
 * re-fire CAPTURE_REQUEST once the page finishes loading. The chain
 * self-terminates at MAX_SEARCH_PAGES because the server stops creating
 * follow-up tasks at that point.
 */
async function maybeAutoPaginate(
  payload: CapturePayload,
  tabId: number,
): Promise<void> {
  if (payload.pageType !== 'SEARCH_PEOPLE' && payload.pageType !== 'SEARCH_CONTENT') {
    return;
  }

  const { autoPaginate } = await new Promise<{ autoPaginate?: boolean }>((r) =>
    chrome.storage.local.get('autoPaginate', (v) => r(v)),
  );
  if (!autoPaginate) return;

  let currentPage: number;
  let nextPageUrl: string;
  try {
    const u = new URL(payload.url);
    currentPage = parseInt(u.searchParams.get('page') || '1', 10);
    u.searchParams.set('page', String(currentPage + 1));
    nextPageUrl = u.toString();
  } catch {
    return;
  }

  // The server only creates a task when next < MAX_SEARCH_PAGES. Look for it
  // in the refreshed tasks list; if it isn't there, we've hit the cap — stop.
  const pendingTasks = await new Promise<Array<{ targetUrl?: string | null }>>(
    (r) =>
      chrome.storage.local.get('pendingTasks', (v) =>
        r(((v.pendingTasks as Array<{ targetUrl?: string | null }>) || [])),
      ),
  );
  const hasFollowup = pendingTasks.some((t) => {
    if (!t.targetUrl) return false;
    try {
      const a = new URL(t.targetUrl);
      const b = new URL(nextPageUrl);
      return a.pathname === b.pathname &&
        a.searchParams.get('page') === b.searchParams.get('page');
    } catch {
      return false;
    }
  });
  if (!hasFollowup) {
    logger.info(`Auto-paginate: no follow-up task for page ${currentPage + 1}; chain complete.`);
    return;
  }

  // Small delay so LinkedIn's rate limiter doesn't see back-to-back requests
  await new Promise((r) => setTimeout(r, 2000));

  logger.info(`Auto-paginate: navigating tab ${tabId} to page ${currentPage + 1}`);

  // Wait for the tab to finish loading the new URL before re-firing capture.
  const navigationComplete = new Promise<void>((resolve) => {
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Safety timeout: if load never completes in 20s, resolve anyway and let capture fail
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
  });

  try {
    await chrome.tabs.update(tabId, { url: nextPageUrl });
  } catch (err) {
    logger.warn(`Auto-paginate: tab.update failed: ${(err as Error).message}`);
    return;
  }

  await navigationComplete;
  // Give the content script a moment to re-initialize on the new page
  await new Promise((r) => setTimeout(r, 1500));

  try {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'CAPTURE_REQUEST' } satisfies ExtensionMessage,
      (response) => {
        if (response?.payload) {
          void processCapture(response.payload as CapturePayload, tabId);
        }
      },
    );
  } catch (err) {
    logger.warn(`Auto-paginate: re-fire CAPTURE_REQUEST failed: ${(err as Error).message}`);
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
        const allTasks = tasksData.goals.flatMap((g) => g.tasks);
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
            const sourceTabId = sender.tab.id;
            chrome.tabs.sendMessage(
              sourceTabId,
              { type: 'CAPTURE_REQUEST' } satisfies ExtensionMessage,
              (response) => {
                if (response?.payload) {
                  processCapture(response.payload as CapturePayload, sourceTabId).then(() => {
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
                  const sourceTabId = tabs[0].id;
                  chrome.tabs.sendMessage(
                    sourceTabId,
                    { type: 'CAPTURE_REQUEST' } satisfies ExtensionMessage,
                    (response) => {
                      if (response?.payload) {
                        processCapture(response.payload as CapturePayload, sourceTabId).then(
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
        const taskPayload = message.payload as
          | { taskId: string; status: 'in_progress' | 'completed' | 'skipped' }
          | undefined;
        if (taskPayload?.taskId) {
          (async () => {
            try {
              const client = await getAppClient();
              await client.updateTask(taskPayload.taskId, taskPayload.status);
              // Refresh tasks from server
              const tasksData = await client.fetchTasks('pending', 50);
              const allTasks = tasksData.goals.flatMap((g) => g.tasks);
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
// Snippet Offline Queue (WS-3 Phase 6 §10)
// ============================================================

async function processSnippetQueue(): Promise<void> {
  const depth = await getSnippetQueueDepth();
  if (depth === 0) return;
  const [appUrl, token] = await Promise.all([
    getStorage('appUrl'),
    getStorage('extensionToken'),
  ]);
  try {
    const result = await flushSnippetQueue({
      appUrl: appUrl || DEFAULT_APP_URL,
      extensionToken: token,
    });
    if (result.processed > 0) {
      logger.info(
        `Snippet queue: flushed ${result.processed} items, ${result.remaining} remaining`
      );
    }
  } catch (err) {
    logger.warn(
      `Snippet queue flush failed: ${(err as Error).message ?? err}`
    );
  }
}

// ============================================================
// Permission Change Listeners (WS-3 Phase 6 §7)
// ============================================================

// Listen for origin revokes from chrome://extensions so the sidebar's
// `approvedOrigins` storage key stays aligned. The sidebar subscribes to
// `storage.onChanged` and re-renders automatically when we rewrite the key.
chrome.permissions.onRemoved.addListener(async (perms) => {
  const origins = perms?.origins ?? [];
  if (origins.length === 0) return;
  const next = await import('./shared/approved-origins').then((m) =>
    m.removeApprovedOrigins(origins)
  );
  logger.info(
    `Permissions revoked: ${origins.join(', ')}; approved list now ${next.length}`
  );
});

chrome.permissions.onAdded.addListener(async (perms) => {
  const origins = perms?.origins ?? [];
  if (origins.length === 0) return;
  const next = await import('./shared/approved-origins').then((m) =>
    m.addApprovedOrigins(origins)
  );
  logger.info(
    `Permissions granted: ${origins.join(', ')}; approved list now ${next.length}`
  );
});

// ============================================================
// Commands (ADR-028 clause 4 — Snip mode opt-in hotkey)
// ============================================================
//
// `chrome.commands` only fires in the extension's background context, so the
// side panel can't register the hotkey itself. Relay it as a runtime message;
// the side panel (if open) flips its own session-scoped snip-mode state. If
// no side panel is open there is nothing to toggle, so the "receiving end
// does not exist" rejection is expected and swallowed.
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-snip-mode') return;
  chrome.runtime
    .sendMessage({ type: 'TOGGLE_SNIP_MODE' } satisfies ExtensionMessage)
    .catch(() => {
      // No side panel listening — ignore.
    });
});

// ============================================================
// WebSocket Event Handlers
// ============================================================

async function setupWebSocketHandlers(): Promise<void> {
  const client = await getAppClient();

  client.onWsEvent('CAPTURE_CONFIRMED', (msg: WsMessage) => {
    logger.info('Capture confirmed:', msg.payload);
    // WS-3 Phase 6 §10 — connectivity returned; try to flush offline snippets.
    void processSnippetQueue();
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

  // WS-2 Phase 2 Track D: relay parse-complete to the sidebar via
  // chrome.storage.local (the sidebar listens on storage.onChanged).
  client.onWsEvent('PARSE_COMPLETE', async (msg: WsMessage) => {
    try {
      const p = msg.payload as {
        captureId?: string;
        pageType?: string;
        fields?: Array<{ field: string; confidence: number }>;
      };
      if (!p?.captureId) return;
      await chrome.storage.local.set({
        lastParseResult: {
          captureId: p.captureId,
          pageType: p.pageType ?? 'OTHER',
          receivedAt: msg.timestamp,
          fields: Array.isArray(p.fields) ? p.fields : [],
        },
      });
    } catch {
      // Non-critical
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
  if (alarm.name === SNIPPET_QUEUE_FLUSH_ALARM) {
    await processSnippetQueue();
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
    await chrome.alarms.create(SNIPPET_QUEUE_FLUSH_ALARM, {
      periodInMinutes: SNIPPET_QUEUE_FLUSH_INTERVAL_MIN, // 30 seconds
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
  await chrome.alarms.create(SNIPPET_QUEUE_FLUSH_ALARM, {
    periodInMinutes: SNIPPET_QUEUE_FLUSH_INTERVAL_MIN,
  });

  // Run health check immediately
  await performHealthCheck();

  // Process retry queue on startup (Phase 6)
  await processRetryQueue();

  // Reconcile approved-origins with Chrome's native permission state in case
  // the user revoked an origin while the SW was asleep (WS-3 Phase 6 §7).
  await syncApprovedOriginsFromChrome();

  // Drain any pending snippets from the previous session (WS-3 Phase 6 §10).
  await processSnippetQueue();
});

// Run initial health check to set connection state (HTTP-based, always works)
performHealthCheck().catch(() => {});

// Process retry queue on initial load (Phase 6)
processRetryQueue().catch(() => {});

// WS-3 Phase 6 §7 — reconcile approved origins on SW load.
syncApprovedOriginsFromChrome().catch(() => {});

// WS-3 Phase 6 §10 — drain offline snippet queue on SW load.
processSnippetQueue().catch(() => {});

// WebSocket is optional -- only attempt if explicitly enabled
// Next.js standalone doesn't support WS upgrade, so skip by default
getStorage('settings').then((settings) => {
  const wsEnabled = (settings as unknown as Record<string, unknown>)?.wsEnabled;
  if (wsEnabled) {
    setupWebSocketHandlers().catch((err) => {
      logger.warn('WebSocket unavailable (HTTP polling active):', (err as Error).message);
    });
  } else {
    logger.info('Service worker loaded (HTTP polling mode)');
  }
});

logger.info('Service worker loaded');
