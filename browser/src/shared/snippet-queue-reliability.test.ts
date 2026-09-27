import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueSnippet, flushSnippetQueue, getSnippetQueue, retrySnippet,
  removeSnippetFromQueue, updateSnippetQueueItem, SNIPPET_QUEUE_MAX,
} from './snippet-queue.ts';

const store: Record<string, unknown> = {};
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: {
      get(key: string, callback: (value: Record<string, unknown>) => void) { callback({ [key]: store[key] }); },
      async set(patch: Record<string, unknown>) { Object.assign(store, patch); },
    } },
  };
});

const options = (fetchImpl: typeof fetch) => ({ appUrl: 'http://localhost:3751', extensionToken: 'synthetic', fetchImpl });

test('full queue rejects a new item and retains all accepted text/image/link work', async () => {
  await Promise.all(Array.from({ length: SNIPPET_QUEUE_MAX }, (_, i) =>
    enqueueSnippet({ kind: ['text', 'image', 'link'][i % 3], idx: i })));
  await assert.rejects(() => enqueueSnippet({ kind: 'text', idx: 99 }), /full/);
  const queue = await getSnippetQueue();
  assert.equal(queue.length, SNIPPET_QUEUE_MAX);
  assert.equal((queue[0].body as { idx: number }).idx, 0);
  assert.equal(new Set(queue.map((item) => (item.body as { idx: number }).idx)).size, SNIPPET_QUEUE_MAX);
});

test('direct validation failure is retained with error until retry or discard', async () => {
  const item = await enqueueSnippet({ kind: 'text', text: 'synthetic' }, 'HTTP 422: invalid target', 'failed');
  assert.equal((await getSnippetQueue())[0].state, 'failed');
  assert.match((await getSnippetQueue())[0].lastError ?? '', /invalid target/);
  await retrySnippet(item.id);
  assert.equal((await getSnippetQueue())[0].state, 'queued');
});

test('429 backs off and retains item; validation failure remains recoverable', async () => {
  const item = await enqueueSnippet({ kind: 'link' });
  const rateLimit = async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } });
  await flushSnippetQueue(options(rateLimit as typeof fetch));
  let queue = await getSnippetQueue();
  assert.equal(queue[0].lastError, 'HTTP 429');
  assert.ok(Date.parse(queue[0].nextRetryAt ?? '') > Date.now());
  await retrySnippet(item.id);
  const validation = async () => new Response('', { status: 422 });
  await flushSnippetQueue(options(validation as typeof fetch));
  queue = await getSnippetQueue();
  assert.equal(queue[0].state, 'failed');
  assert.equal(queue[0].lastError, 'HTTP 422');
  await retrySnippet(item.id);
  await flushSnippetQueue(options((async () => new Response('', { status: 200 })) as typeof fetch));
  assert.equal((await getSnippetQueue()).length, 0);
});

test('exhausted retries retain the body until explicit discard', async () => {
  const item = await enqueueSnippet({ kind: 'image', imageBytes: 'synthetic' });
  for (let i = 0; i < 5; i++) {
    await updateSnippetQueueItem(item.id, { nextRetryAt: undefined });
    await flushSnippetQueue(options((async () => { throw new Error('offline'); }) as typeof fetch));
  }
  assert.equal((await getSnippetQueue())[0].state, 'failed');
  assert.equal((await getSnippetQueue())[0].retryCount, 5);
  await removeSnippetFromQueue(item.id);
  assert.equal((await getSnippetQueue()).length, 0);
});

test('text, image and link bodies recover after offline retry', async () => {
  await enqueueSnippet({ kind: 'text', text: 'synthetic' });
  await enqueueSnippet({ kind: 'image', imageBytes: 'synthetic' });
  await enqueueSnippet({ kind: 'link', href: 'https://example.invalid/synthetic' });
  await flushSnippetQueue(options((async () => { throw new Error('offline'); }) as typeof fetch));
  const [first] = await getSnippetQueue();
  await retrySnippet(first.id);
  const sent: string[] = [];
  await flushSnippetQueue(options((async (_url, init) => {
    sent.push((JSON.parse(String(init?.body)) as { kind: string }).kind);
    return new Response('', { status: 200 });
  }) as typeof fetch));
  assert.deepEqual(sent, ['text', 'image', 'link']);
  assert.equal((await getSnippetQueue()).length, 0);
});
