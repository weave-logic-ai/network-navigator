import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { CapturePayload } from './types/index.ts';

test('worker keeps one replay owner and reports offline, submitted, limit and missing-script outcomes', async () => {
  const storage: Record<string, unknown> = {
    extensionToken: 'synthetic-token',
    appUrl: 'http://localhost:3750',
    captureLimit: 1,
    settings: { maxQueueSize: 1 },
  };
  const today = new Date();
  const dayKey = `captures_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let online = false;
  let postCount = 0;
  let missingScript: false | 'empty' | 'hang' = false;
  let failRemovalOnce = false;
  let snippetPosts = 0;
  let releaseSnippet: (() => void) | undefined;
  let snippetStarted: (() => void) | undefined;
  let messageListener: (message: unknown, sender: unknown, reply: (response: unknown) => void) => boolean;
  let alarmListener!: (alarm: { name: string }) => Promise<void>;
  let payload: CapturePayload = {
    captureId: 'synthetic-capture-1', url: 'https://www.linkedin.com/in/synthetic-fixture',
    pageType: 'PROFILE', html: '<html>synthetic</html>', scrollDepth: 1,
    viewportHeight: 800, documentHeight: 800, capturedAt: new Date().toISOString(),
    extensionVersion: 'test', sessionId: 'synthetic-session', triggerMode: 'manual',
  };
  const event = <T extends (...args: never[]) => unknown>(save: (listener: T) => void) => ({ addListener: save });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: {
      get(key: string, callback?: (value: Record<string, unknown>) => void) {
        const value = { [key]: storage[key] };
        callback?.(value);
        return Promise.resolve(value);
      },
      async set(patch: Record<string, unknown>) {
        if (failRemovalOnce && Array.isArray(patch.captureQueue) && patch.captureQueue.length === 0) {
          failRemovalOnce = false;
          throw new Error('synthetic storage failure');
        }
        Object.assign(storage, patch);
      },
    } },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    notifications: { async create() {} },
    runtime: {
      lastError: undefined,
      onMessage: event((listener) => { messageListener = listener as typeof messageListener; }),
      onInstalled: event(() => {}), onStartup: event(() => {}),
    },
    alarms: { onAlarm: event((listener) => { alarmListener = listener as typeof alarmListener; }), async create() {} },
    permissions: { onAdded: event(() => {}), onRemoved: event(() => {}), async getAll() { return { origins: [] }; } },
    commands: { onCommand: event(() => {}) },
    tabs: {
      query(_query: unknown, callback?: (tabs: Array<{ id: number }>) => void) {
        const tabs = [{ id: 1 }]; callback?.(tabs); return Promise.resolve(tabs);
      },
      sendMessage(_tabId: number, _message: unknown, callback: (result: unknown) => void) {
        if (missingScript !== 'hang') callback(missingScript ? undefined : { payload });
        return Promise.resolve();
      },
      onUpdated: event(() => {}),
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/extension/capture')) {
      postCount++;
      if (!online) throw new Error('offline');
      assert.equal((JSON.parse(String(init?.body)) as CapturePayload).captureId, payload.captureId);
      return new Response(JSON.stringify({ success: true, captureId: payload.captureId, storedBytes: 20 }), { status: 200 });
    }
    if (url.endsWith('/api/extension/snippet')) {
      snippetPosts++;
      snippetStarted?.();
      await new Promise<void>((resolve) => { releaseSnippet = resolve; });
      return new Response('', { status: 200 });
    }
    if (url.includes('/tasks')) return new Response(JSON.stringify({ goals: [] }), { status: 200 });
    return new Response(JSON.stringify({ status: 'healthy' }), { status: 200 });
  }) as typeof fetch;
  try {
    const bundle = await build({ entryPoints: ['src/service-worker.ts'], bundle: true, write: false, platform: 'browser', format: 'iife' });
    runInNewContext(bundle.outputFiles[0].text, {
      chrome: (globalThis as unknown as { chrome: unknown }).chrome,
      fetch: globalThis.fetch, Response, AbortController, URL, crypto, Date,
      setTimeout: (callback: (...args: unknown[]) => void, delay: number) => setTimeout(callback, delay === 10000 ? 0 : delay),
      clearTimeout, console,
    });
    const send = (type: string, payload?: unknown) => new Promise<{ status: string; data?: { queueDepth: number; dailyCaptureCount: number } }>((resolve) => {
      messageListener({ type, payload }, {}, (response) => resolve(response as { status: string; data?: { queueDepth: number; dailyCaptureCount: number } }));
    });
    assert.equal((await send('CAPTURE_REQUEST')).status, 'queued');
    assert.equal((storage.captureQueue as CapturePayload[]).length, 1);
    assert.equal((await send('CAPTURE_REQUEST')).status, 'queued');
    assert.equal((storage.captureQueue as CapturePayload[]).length, 1);
    payload = { ...payload, captureId: 'synthetic-capture-2' };
    assert.equal((await send('CAPTURE_REQUEST')).status, 'failed');
    assert.equal((storage.captureQueue as CapturePayload[])[0].captureId, 'synthetic-capture-1');
    assert.equal((storage.retryQueue as unknown[] | undefined)?.length ?? 0, 0);
    payload = { ...payload, captureId: 'synthetic-capture-1' };
    online = true;
    await alarmListener({ name: 'queue-flush' });
    await alarmListener({ name: 'queue-flush' });
    assert.equal(postCount, 3);
    assert.equal((storage.captureQueue as CapturePayload[]).length, 0);
    assert.equal(storage[dayKey], 1);
    assert.equal(storage.dailyCaptureCount, 1);
    assert.equal((await send('GET_STATUS')).data?.queueDepth, 0);
    assert.equal((await send('GET_STATUS')).data?.dailyCaptureCount, 1);
    assert.equal((await send('CAPTURE_REQUEST')).status, 'limit');
    storage.captureLimit = 2;
    missingScript = 'empty';
    assert.equal((await send('CAPTURE_REQUEST')).status, 'failed');
    missingScript = 'hang';
    assert.equal((await send('CAPTURE_REQUEST')).status, 'failed');
    missingScript = false;
    storage.captureLimit = 5;
    payload = { ...payload, captureId: 'synthetic-legacy-capture' };
    storage.retryQueue = [{ id: 'legacy', method: 'POST', path: '/api/extension/capture', body: payload, retryCount: 0, maxRetries: 3, createdAt: payload.capturedAt }];
    await alarmListener({ name: 'retry-queue' });
    assert.equal((storage.captureQueue as CapturePayload[])[0].captureId, payload.captureId);
    assert.equal((storage.retryQueue as unknown[]).length, 0);
    await alarmListener({ name: 'queue-flush' });
    assert.equal(postCount, 4);
    assert.equal(storage[dayKey], 2);

    payload = { ...payload, captureId: 'synthetic-acknowledged-capture' };
    storage.captureQueue = [payload];
    failRemovalOnce = true;
    await alarmListener({ name: 'queue-flush' });
    assert.equal(postCount, 5);
    assert.equal((storage.captureQueue as CapturePayload[]).length, 1);
    assert.equal((storage.captureReplayAcknowledgements as string[])[0], payload.captureId);
    await alarmListener({ name: 'queue-flush' });
    assert.equal(postCount, 5);
    assert.equal((storage.captureQueue as CapturePayload[]).length, 0);
    assert.equal(storage[dayKey], 3);

    storage.snippetQueue = [{ id: 'synthetic-snippet', createdAt: payload.capturedAt, path: '/api/extension/snippet', body: { kind: 'text', text: 'synthetic' }, retryCount: 0 }];
    const started = new Promise<void>((resolve) => { snippetStarted = resolve; });
    const firstFlush = alarmListener({ name: 'snippet-queue-flush' });
    await Promise.race([started, new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('snippet replay did not start')), 250))]);
    const secondFlush = alarmListener({ name: 'snippet-queue-flush' });
    let discarded = false;
    const discard = send('DISCARD_SNIPPET', { id: 'synthetic-snippet' }).then(() => { discarded = true; });
    await Promise.resolve();
    assert.equal(discarded, false);
    releaseSnippet?.();
    await Promise.all([firstFlush, secondFlush, discard]);
    assert.equal(snippetPosts, 1);
    assert.equal((storage.snippetQueue as unknown[]).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
