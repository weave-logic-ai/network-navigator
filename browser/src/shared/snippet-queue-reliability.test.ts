import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  enqueueSnippet, flushSnippetQueue, getSnippetQueue, retrySnippet,
  removeSnippetFromQueue, updateSnippetQueueItem, verifiedSnippetDestination, SNIPPET_QUEUE_MAX,
  draftSnippetDestination, snippetTargetFromLock,
} from './snippet-queue.ts';

const store: Record<string, unknown> = {};
let readError: string | undefined;
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  readError = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { get lastError() { return readError ? { message: readError } : undefined; } },
    storage: { local: {
      get(key: string, callback?: (value: Record<string, unknown>) => void) {
        const value = { [key]: store[key] };
        callback?.(value);
        return Promise.resolve(value);
      },
      async set(patch: Record<string, unknown>) { Object.assign(store, patch); },
    } },
  };
});

const destination = { appUrl: 'http://localhost:3751', tokenFingerprint: createHash('sha256').update('synthetic').digest('hex'), tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const options = (fetchImpl: typeof fetch) => ({ appUrl: 'http://localhost:3751', extensionToken: 'synthetic', fetchImpl });

test('full queue rejects a new item and retains all accepted text/image/link work', async () => {
  await Promise.all(Array.from({ length: SNIPPET_QUEUE_MAX }, (_, i) =>
    enqueueSnippet({ kind: ['text', 'image', 'link'][i % 3], idx: i }, destination)));
  await assert.rejects(() => enqueueSnippet({ kind: 'text', idx: 99 }, destination), /full/);
  const queue = await getSnippetQueue();
  assert.equal(queue.length, SNIPPET_QUEUE_MAX);
  assert.equal((queue[0].body as { idx: number }).idx, 0);
  assert.equal(new Set(queue.map((item) => (item.body as { idx: number }).idx)).size, SNIPPET_QUEUE_MAX);
});

test('storage read failure does not overwrite accepted work', async () => {
  await enqueueSnippet({ kind: 'text', text: 'accepted' }, destination);
  readError = 'storage unavailable';
  await assert.rejects(() => enqueueSnippet({ kind: 'link' }, destination), /storage unavailable/);
  assert.equal((store.snippetQueue as unknown[]).length, 1);
  readError = undefined;
  const queue = await getSnippetQueue();
  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0].body, { kind: 'text', text: 'accepted' });
});

test('direct validation failure is retained with error until retry or discard', async () => {
  const item = await enqueueSnippet({ kind: 'text', text: 'synthetic' }, destination, 'HTTP 422: invalid target', 'failed');
  assert.equal((await getSnippetQueue())[0].state, 'failed');
  assert.match((await getSnippetQueue())[0].lastError ?? '', /invalid target/);
  await retrySnippet(item.id, destination.appUrl, 'synthetic');
  assert.equal((await getSnippetQueue())[0].state, 'queued');
  assert.equal((await getSnippetQueue())[0].lastError, undefined);
});

test('429 backs off and retains item; validation failure remains recoverable', async () => {
  const item = await enqueueSnippet({ kind: 'link' }, destination);
  let rateLimitCalls = 0;
  const rateLimit = async () => {
    rateLimitCalls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
  };
  await flushSnippetQueue(options(rateLimit as typeof fetch));
  let queue = await getSnippetQueue();
  assert.equal(queue[0].lastError, 'HTTP 429');
  assert.ok(Date.parse(queue[0].nextRetryAt ?? '') > Date.now());
  await flushSnippetQueue(options(rateLimit as typeof fetch));
  assert.equal(rateLimitCalls, 1, 'an alarm during backoff must not resend');
  await retrySnippet(item.id, destination.appUrl, 'synthetic');
  const validation = async () => new Response('', { status: 422 });
  await flushSnippetQueue(options(validation as typeof fetch));
  queue = await getSnippetQueue();
  assert.equal(queue[0].state, 'failed');
  assert.equal(queue[0].lastError, 'HTTP 422');
  await retrySnippet(item.id, destination.appUrl, 'synthetic');
  await flushSnippetQueue(options((async () => new Response('', { status: 200 })) as typeof fetch));
  assert.equal((await getSnippetQueue()).length, 0);
});

test('exhausted retries retain the body until explicit discard', async () => {
  const item = await enqueueSnippet({ kind: 'image', imageBytes: 'synthetic' }, destination);
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
  await enqueueSnippet({ kind: 'text', text: 'synthetic' }, destination);
  await enqueueSnippet({ kind: 'image', imageBytes: 'synthetic' }, destination);
  await enqueueSnippet({ kind: 'link', href: 'https://example.invalid/synthetic' }, destination);
  await flushSnippetQueue(options((async () => { throw new Error('offline'); }) as typeof fetch));
  const [first] = await getSnippetQueue();
  await retrySnippet(first.id, destination.appUrl, 'synthetic');
  const sent: string[] = [];
  await flushSnippetQueue(options((async (_url, init) => {
    sent.push((JSON.parse(String(init?.body)) as { kind: string }).kind);
    return new Response('', { status: 200 });
  }) as typeof fetch));
  assert.deepEqual(sent, ['text', 'image', 'link']);
  assert.equal((await getSnippetQueue()).length, 0);
});

test('legacy accepted item gains a persisted request ID before POST and reuses it after lost response', async () => {
  const item = await enqueueSnippet({ kind: 'text', text: 'synthetic' }, destination);
  const ids: string[] = [];
  await flushSnippetQueue(options((async (_url, init) => {
    ids.push((JSON.parse(String(init?.body)) as { requestId: string }).requestId);
    throw new Error('response lost after server saved');
  }) as typeof fetch));
  assert.equal(ids[0], item.id);
  assert.equal((await getSnippetQueue())[0].body && ((await getSnippetQueue())[0].body as { requestId: string }).requestId, item.id);
  await retrySnippet(item.id, destination.appUrl, 'synthetic');
  await flushSnippetQueue(options((async (_url, init) => {
    ids.push((JSON.parse(String(init?.body)) as { requestId: string }).requestId);
    return new Response('', { status: 200 });
  }) as typeof fetch));
  assert.deepEqual(ids, [item.id, item.id]);
  assert.equal((await getSnippetQueue()).length, 0);
});

test('app A item never posts to app B, even after an explicit retry', async () => {
  const item = await enqueueSnippet({ kind: 'text', text: 'app A evidence' }, destination);
  const sent = async () => { throw new Error('cross-app POST'); };
  await flushSnippetQueue({ appUrl: 'http://localhost:3752', extensionToken: 'synthetic', fetchImpl: sent as typeof fetch });
  assert.equal((await getSnippetQueue())[0].state, 'failed');
  await assert.rejects(() => retrySnippet(item.id, 'http://localhost:3752', 'synthetic'), /App URL changed/);
  assert.equal((await getSnippetQueue())[0].destination?.appUrl, destination.appUrl);
});

test('rotated token blocks automatic replay and needs explicit same-app retry', async () => {
  const item = await enqueueSnippet({ kind: 'text', text: 'same tenant' }, {
    ...destination, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  let posts = 0;
  const fetchImpl = (async () => { posts++; return new Response('', { status: 200 }); }) as typeof fetch;
  await flushSnippetQueue({ appUrl: destination.appUrl, extensionToken: 'replacement', fetchImpl });
  assert.equal(posts, 0);
  assert.match((await getSnippetQueue())[0].lastError ?? '', /Token changed/);
  await assert.rejects(() => retrySnippet(item.id, destination.appUrl, 'replacement',
    (async () => Response.json({ tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })) as typeof fetch), /Tenant changed/);
  assert.equal(posts, 0);
  await retrySnippet(item.id, destination.appUrl, 'replacement',
    (async () => Response.json({ tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })) as typeof fetch);
  await flushSnippetQueue({ appUrl: destination.appUrl, extensionToken: 'replacement', fetchImpl });
  assert.equal(posts, 1);
  assert.equal((await getSnippetQueue()).length, 0);
});

test('first offline save stays durable, never auto-posts, and requires explicit same-token verification', async () => {
  const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
  const pendingDestination = await draftSnippetDestination(destination.appUrl, 'synthetic', offline);
  assert.equal(pendingDestination.tenantId, undefined);
  const body = { kind: 'text', targetKind: 'contact', targetId: 'A', text: 'offline first save' };
  const pending = await enqueueSnippet(body, pendingDestination, 'Tenant verification required', 'pending_verification');
  let calls = 0;
  await flushSnippetQueue(options((async () => { calls++; throw new Error('unexpected request'); }) as typeof fetch));
  assert.equal(calls, 0);
  assert.deepEqual((await getSnippetQueue())[0].body, body);
  await assert.rejects(() => retrySnippet(pending.id, destination.appUrl, 'replacement'), /Original tenant is unknown/);
  await assert.rejects(() => retrySnippet(pending.id, 'http://localhost:3752', 'synthetic'), /App URL changed/);
  assert.equal((await getSnippetQueue())[0].state, 'pending_verification');
  await retrySnippet(pending.id, destination.appUrl, 'synthetic',
    (async () => Response.json({ tenantId: destination.tenantId })) as typeof fetch);
  assert.equal((await getSnippetQueue())[0].destination?.tenantId, destination.tenantId);
  await flushSnippetQueue(options((async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>)['X-Snippet-Tenant-ID'], destination.tenantId);
    calls++;
    return new Response('', { status: 200 });
  }) as typeof fetch));
  assert.equal(calls, 1);
  assert.equal((await getSnippetQueue()).length, 0);
});

test('unknown original tenant is not accepted for automatic replay or legacy retry', async () => {
  await assert.rejects(() => enqueueSnippet({ kind: 'text', text: 'offline first save' },
    { appUrl: destination.appUrl, tokenFingerprint: destination.tokenFingerprint }), /verified tenant/);
  store.snippetQueue = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), path: '/api/extension/snippet',
    body: { kind: 'text' }, retryCount: 0,
    destination: { appUrl: destination.appUrl, tokenFingerprint: destination.tokenFingerprint } }];
  await flushSnippetQueue(options((async () => { throw new Error('legacy POST'); }) as typeof fetch));
  const item = (await getSnippetQueue())[0];
  assert.equal(item.state, 'failed');
  await assert.rejects(() => retrySnippet(item.id, destination.appUrl, 'replacement'), /unknown/);
});

test('capture target remains A after external navigation and B selection', () => {
  const captured = snippetTargetFromLock('page:person:A');
  assert.deepEqual(captured, { targetKind: 'contact', targetId: 'A' });
  assert.equal(snippetTargetFromLock('none'), null);
  assert.deepEqual(snippetTargetFromLock('page:person:B'), { targetKind: 'contact', targetId: 'B' });
  assert.deepEqual(captured, { targetKind: 'contact', targetId: 'A' });
});

test('replay sends to the recorded app with the recorded tenant guard', async () => {
  await enqueueSnippet({ kind: 'link', href: 'https://example.test/' }, {
    ...destination, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  await flushSnippetQueue(options((async (url, init) => {
    assert.equal(url, `${destination.appUrl}/api/extension/snippet`);
    assert.equal((init?.headers as Record<string, string>)['X-Snippet-Tenant-ID'],
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    return new Response('', { status: 200 });
  }) as typeof fetch));
  assert.equal((await getSnippetQueue()).length, 0);
});

test('unbound legacy entry stays local and cannot be rebound by retry', async () => {
  store.snippetQueue = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), path: '/api/extension/snippet', body: { kind: 'text' }, retryCount: 0 }];
  await flushSnippetQueue(options((async () => { throw new Error('legacy POST'); }) as typeof fetch));
  const item = (await getSnippetQueue())[0];
  assert.equal(item.state, 'failed');
  await assert.rejects(() => retrySnippet(item.id, destination.appUrl, 'synthetic'), /unknown/);
});

test('verified tenant cache permits offline save only for the same app and credential', async () => {
  const online = (async () => Response.json({ tenantId: destination.tenantId })) as typeof fetch;
  const verified = await verifiedSnippetDestination(destination.appUrl, 'synthetic', online);
  assert.deepEqual(verified, destination);
  const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.deepEqual(await verifiedSnippetDestination(destination.appUrl, 'synthetic', offline), destination);
  await assert.rejects(() => verifiedSnippetDestination(destination.appUrl, 'replacement', offline), /Cannot verify/);
  await assert.rejects(() => verifiedSnippetDestination('http://localhost:3752', 'synthetic', offline), /Cannot verify/);
});
