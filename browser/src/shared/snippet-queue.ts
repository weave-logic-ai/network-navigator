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
  destination?: SnippetDestination;
  retryCount: number;
  /** Last error message (truncated). Used for surfacing to the user. */
  lastError?: string;
  state?: 'queued' | 'failed' | 'pending_verification';
  nextRetryAt?: string;
}

export interface SnippetDestination {
  appUrl: string;
  tokenFingerprint: string;
  tenantId?: string;
}

export function snippetTargetFromLock(lock: string): { targetKind: 'contact' | 'company'; targetId: string } | null {
  const [, kind, id] = lock.split(':');
  if ((kind !== 'person' && kind !== 'company') || !id) return null;
  return { targetKind: kind === 'person' ? 'contact' : 'company', targetId: id };
}

const SNIPPET_IDENTITY_KEY = 'snippetTenantIdentity';

export async function verifiedSnippetDestination(appUrl: string, token: string | null, fetchImpl: typeof fetch = fetch): Promise<SnippetDestination> {
  const destination = await snippetDestination(appUrl, token);
  try {
    destination.tenantId = await identifySnippetTenant(destination.appUrl, token!, fetchImpl);
    await chrome.storage.local.set({ [SNIPPET_IDENTITY_KEY]: destination });
    return destination;
  } catch {
    const saved = (await chrome.storage.local.get(SNIPPET_IDENTITY_KEY))[SNIPPET_IDENTITY_KEY] as SnippetDestination | undefined;
    if (saved?.appUrl === destination.appUrl && saved.tokenFingerprint === destination.tokenFingerprint &&
        typeof saved.tenantId === 'string' && /^[0-9a-f-]{36}$/i.test(saved.tenantId)) {
      return { ...destination, tenantId: saved.tenantId };
    }
    throw new Error('Cannot verify this app and tenant while offline. The snippet remains in the editor.');
  }
}

/** Capture app and credential even when the first tenant lookup is offline. */
export async function draftSnippetDestination(appUrl: string, token: string | null, fetchImpl: typeof fetch = fetch): Promise<SnippetDestination> {
  try {
    return await verifiedSnippetDestination(appUrl, token, fetchImpl);
  } catch {
    return snippetDestination(appUrl, token);
  }
}

export async function identifySnippetTenant(appUrl: string, token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${appUrl}/api/extension/snippet`, {
    headers: { 'X-Extension-Token': token },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Cannot verify snippet tenant (HTTP ${res.status})`);
  const data = await res.json() as { tenantId?: unknown };
  if (typeof data.tenantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.tenantId)) {
    throw new Error('Invalid snippet tenant identity');
  }
  return data.tenantId;
}

export async function snippetDestination(appUrl: string, token: string | null): Promise<SnippetDestination> {
  const url = new URL(appUrl);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid snippet app URL');
  }
  if (!token) throw new Error('Configure an extension token before saving snippets.');
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    appUrl: url.href.replace(/\/$/, ''),
    tokenFingerprint: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
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
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(SNIPPET_QUEUE_KEY, (v) => {
      const storageError = chrome.runtime?.lastError;
      if (storageError) {
        reject(new Error(`Cannot read local snippet queue: ${storageError.message}`));
        return;
      }
      const list = (v[SNIPPET_QUEUE_KEY] as QueuedSnippet[] | undefined) ?? [];
      if (!Array.isArray(list)) {
        reject(new Error('Local snippet queue has an invalid format'));
        return;
      }
      resolve(list);
    });
  });
}

export async function getSnippetQueueDepth(): Promise<number> {
  const queue = await getSnippetQueue();
  return queue.length;
}

export async function enqueueSnippet(
  body: unknown,
  destination: SnippetDestination,
  error?: string,
  state: 'queued' | 'failed' | 'pending_verification' = 'queued'
): Promise<QueuedSnippet> {
  if (!destination.tenantId && state !== 'pending_verification') throw new Error('Cannot queue a snippet for replay without a verified tenant.');
  return mutateQueue(async () => {
  const queue = await getSnippetQueue();
  const item: QueuedSnippet = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    path: '/api/extension/snippet',
    body,
    destination,
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
  const current = await snippetDestination(options.appUrl, options.extensionToken).catch(() => null);

  // Preserve order-of-insertion — matches the original enqueue ordering.
  let processed = 0;
  for (const item of [...queue]) {
    if (item.state === 'pending_verification') continue;
    if (item.state === 'failed' || item.retryCount >= SNIPPET_QUEUE_MAX_RETRIES) continue;
    if (!item.destination?.tenantId || !current || item.destination.appUrl !== current.appUrl ||
        item.destination.tokenFingerprint !== current.tokenFingerprint) {
      await updateSnippetQueueItem(item.id, {
        state: 'failed',
        lastError: !item.destination?.tenantId ? 'Destination unknown; restore draft only after checking prior save.'
          : item.destination.appUrl !== current?.appUrl ? 'App changed; queued snippet blocked.'
          : 'Token changed; queued snippet blocked until explicit retry.',
      });
      continue;
    }
    if (item.nextRetryAt && Date.parse(item.nextRetryAt) > Date.now()) continue;
    try {
      // Older accepted queue entries predate request IDs. Persist the stable
      // queue ID in their body before the first POST, including timeout cases.
      if (item.body && typeof item.body === 'object' &&
          typeof (item.body as Record<string, unknown>).requestId !== 'string') {
        item.body = { ...(item.body as Record<string, unknown>), requestId: item.id };
        await updateSnippetQueueItem(item.id, { body: item.body });
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (options.extensionToken) {
        headers['X-Extension-Token'] = options.extensionToken;
      }
      if (item.destination.tenantId) headers['X-Snippet-Tenant-ID'] = item.destination.tenantId;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetchImpl(`${item.destination.appUrl}${item.path}`, {
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

export async function retrySnippet(id: string, appUrl: string, token: string | null, fetchImpl: typeof fetch = fetch): Promise<void> {
  const queue = await getSnippetQueue();
  const item = queue.find((entry) => entry.id === id);
  if (!item) throw new Error('Snippet no longer exists.');
  if (!item.destination) throw new Error('Original destination is unknown. Restore the draft only after checking whether it was saved.');
  const current = await snippetDestination(appUrl, token);
  if (item.destination.appUrl !== current.appUrl) throw new Error('App URL changed. Return to the original app to retry or discard this item.');
  if (item.state === 'pending_verification') {
    if (item.destination.tokenFingerprint !== current.tokenFingerprint) {
      throw new Error('Original tenant is unknown. Restore the original token before verifying this draft.');
    }
    const tenantId = await identifySnippetTenant(current.appUrl, token!, fetchImpl);
    await updateSnippetQueueItem(id, {
      destination: { ...current, tenantId }, retryCount: 0, state: 'queued',
      nextRetryAt: undefined, lastError: undefined,
    });
    return;
  }
  if (!item.destination.tenantId) throw new Error('Original destination is unknown. Restore the draft only after checking whether it was saved.');
  if (item.destination.tokenFingerprint !== current.tokenFingerprint) {
    const tenantId = await identifySnippetTenant(current.appUrl, token!, fetchImpl);
    if (tenantId !== item.destination.tenantId) throw new Error('Tenant changed. This snippet cannot be sent with the current token.');
  }
  await updateSnippetQueueItem(id, {
    destination: { ...current, tenantId: item.destination.tenantId },
    retryCount: 0, state: 'queued', nextRetryAt: undefined, lastError: undefined,
  });
}
