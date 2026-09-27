// WS-3 Phase 6 §10 — snippet offline queue.
//
// When the sidebar's POST /api/extension/snippet fails with a network error
// or a 5xx, the payload is serialised into `chrome.storage.local.snippetQueue`
// for later replay. The service worker drains the queue on:
//   (a) incoming WS `CAPTURE_CONFIRMED` / `PARSE_COMPLETE` events (proxies
//       for "server is reachable again"), AND
//   (b) a 30-second interval alarm (`SNIPPET_QUEUE_FLUSH_ALARM`).
//
// This module centralises the storage shape + enqueue/dequeue helpers so both
// the sidebar (producer) and the service worker (consumer) speak the same
// structure.

export interface QueuedSnippet {
  id: string;
  createdAt: string;
  /** Absolute path — always `/api/extension/snippet`. */
  path: string;
  body: unknown;
  retryCount: number;
  /** Last error message (truncated). Used for surfacing to the user. */
  lastError?: string;
  state?: 'queued' | 'failed';
  nextRetryAt?: string;
}

export const SNIPPET_QUEUE_KEY = 'snippetQueue';
export const SNIPPET_QUEUE_MAX = 50;
export const SNIPPET_QUEUE_MAX_RETRIES = 5;
export const SNIPPET_QUEUE_FLUSH_ALARM = 'snippet-queue-flush';
/** 30 seconds per the spec's "30-second timer" trigger. */
export const SNIPPET_QUEUE_FLUSH_INTERVAL_MIN = 0.5;
let queueMutation: Promise<unknown> = Promise.resolve();

function mutateQueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueMutation.then(operation, operation);
  queueMutation = result.then(() => undefined, () => undefined);
  return result;
}

export async function getSnippetQueue(): Promise<QueuedSnippet[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SNIPPET_QUEUE_KEY, (v) => {
      const list = (v[SNIPPET_QUEUE_KEY] as QueuedSnippet[] | undefined) ?? [];
      resolve(Array.isArray(list) ? list : []);
    });
  });
}

export async function getSnippetQueueDepth(): Promise<number> {
  const queue = await getSnippetQueue();
  return queue.length;
}

export async function enqueueSnippet(
  body: unknown,
  error?: string,
  state: 'queued' | 'failed' = 'queued'
): Promise<QueuedSnippet> {
  return mutateQueue(async () => {
  const queue = await getSnippetQueue();
  const item: QueuedSnippet = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    path: '/api/extension/snippet',
    body,
    retryCount: 0,
    lastError: error ? error.slice(0, 400) : undefined,
    state,
  };
  if (queue.length >= SNIPPET_QUEUE_MAX) {
    throw new Error(`Local snippet queue is full (${SNIPPET_QUEUE_MAX}). Retry or discard an item before saving.`);
  }
  queue.push(item);
  await chrome.storage.local.set({ [SNIPPET_QUEUE_KEY]: queue });
  return item;
  });
}

export async function removeSnippetFromQueue(id: string): Promise<void> {
  return mutateQueue(async () => {
  const queue = await getSnippetQueue();
  const next = queue.filter((q) => q.id !== id);
  await chrome.storage.local.set({ [SNIPPET_QUEUE_KEY]: next });
  });
}

export async function updateSnippetQueueItem(
  id: string,
  patch: Partial<QueuedSnippet>
): Promise<void> {
  return mutateQueue(async () => {
  const queue = await getSnippetQueue();
  const idx = queue.findIndex((q) => q.id === id);
  if (idx === -1) return;
  queue[idx] = { ...queue[idx], ...patch };
  await chrome.storage.local.set({ [SNIPPET_QUEUE_KEY]: queue });
  });
}

export async function clearSnippetQueue(): Promise<void> {
  await mutateQueue(() => chrome.storage.local.set({ [SNIPPET_QUEUE_KEY]: [] }));
}

/**
 * Replay queued snippets against the app. Returns the count of successfully
 * flushed items + the updated queue length. Errors are captured and stored
 * against each item so subsequent retries can reason about them. Exhausted
 * and validation failures remain visible until the user retries or discards.
 *
 * This is invoked from the service worker on the flush alarm and on WS
 * `CAPTURE_CONFIRMED`/`PARSE_COMPLETE` (proxies for connectivity returning).
 */
export async function flushSnippetQueue(options: {
  appUrl: string;
  extensionToken: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ processed: number; remaining: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const queue = await getSnippetQueue();
  if (queue.length === 0) return { processed: 0, remaining: 0 };

  // Preserve order-of-insertion — matches the original enqueue ordering.
  let processed = 0;
  for (const item of [...queue]) {
    if (item.state === 'failed' || item.retryCount >= SNIPPET_QUEUE_MAX_RETRIES) continue;
    if (item.nextRetryAt && Date.parse(item.nextRetryAt) > Date.now()) continue;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (options.extensionToken) {
        headers['X-Extension-Token'] = options.extensionToken;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetchImpl(`${options.appUrl}${item.path}`, {
          method: 'POST', headers, body: JSON.stringify(item.body), signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (res.ok) {
        await removeSnippetFromQueue(item.id);
        processed += 1;
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500;
      const retryCount = item.retryCount + 1;
      const retryAfter = res.headers?.get?.('Retry-After');
      const retrySeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0;
      await updateSnippetQueueItem(item.id, {
        retryCount,
        lastError: `HTTP ${res.status}`,
        state: retryable && retryCount < SNIPPET_QUEUE_MAX_RETRIES ? 'queued' : 'failed',
        nextRetryAt: retryable ? new Date(Date.now() + Math.max(retrySeconds * 1000, Math.min(300000, 1000 * 2 ** retryCount))).toISOString() : undefined,
      });
      // Stop iterating on a 5xx — preserves FIFO order and avoids hammering
      // a server that's struggling.
      break;
    } catch (err) {
      const retryCount = item.retryCount + 1;
      await updateSnippetQueueItem(item.id, {
        retryCount,
        lastError: (err as Error).message ?? 'network error',
        state: retryCount < SNIPPET_QUEUE_MAX_RETRIES ? 'queued' : 'failed',
        nextRetryAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** retryCount)).toISOString(),
      });
      break;
    }
  }

  const after = await getSnippetQueue();
  return { processed, remaining: after.length };
}

export async function retrySnippet(id: string): Promise<void> {
  await updateSnippetQueueItem(id, { retryCount: 0, state: 'queued', nextRetryAt: undefined });
}
