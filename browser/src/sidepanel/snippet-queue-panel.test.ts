import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SNIPPET_QUEUE_MAX, type QueuedSnippet } from '../shared/snippet-queue.ts';
import { createSnippetQueuePanel, queueSnippetAndReset } from './snippet-queue-panel.ts';

class ElementStub {
  className = '';
  type = '';
  disabled = false;
  style = { display: 'none' };
  children: ElementStub[] = [];
  private content = '';
  private listeners = new Map<string, Array<() => void>>();
  private attributes = new Map<string, string>();

  set textContent(value: string) { this.content = value; this.children = []; }
  get textContent(): string { return this.content + this.children.map((child) => child.textContent).join(''); }
  append(...children: ElementStub[]) { this.children.push(...children); }
  replaceChildren(...children: ElementStub[]) { this.content = ''; this.children = children; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name); }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  click() { for (const listener of this.listeners.get('click') ?? []) listener(); }
}

const makeItem = (id: string, body: unknown, state: 'queued' | 'failed' = 'queued'): QueuedSnippet => ({
  id, body, state, retryCount: state === 'failed' ? 5 : 0,
  createdAt: '2026-09-27T12:00:00.000Z', path: '/api/extension/snippet',
});

function makePanel(readQueue: () => Promise<QueuedSnippet[]>, change: (action: 'RETRY_SNIPPET' | 'DISCARD_SNIPPET', id: string) => Promise<void>) {
  const section = new ElementStub();
  const depth = new ElementStub();
  const list = new ElementStub();
  const error = new ElementStub();
  const readRetry = new ElementStub();
  const restored: unknown[] = [];
  const panel = createSnippetQueuePanel({
    section, depth, list, error, readRetry,
  } as unknown as Parameters<typeof createSnippetQueuePanel>[0], {
    document: { createElement: () => new ElementStub() } as unknown as Document,
    readQueue, change, restore: (body) => { restored.push(body); },
  });
  return { panel, section, depth, list, error, readRetry, restored };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('newer populated refresh wins over an older empty storage read', async () => {
  const pending: Array<(queue: QueuedSnippet[]) => void> = [];
  const ui = makePanel(() => new Promise((resolve) => { pending.push(resolve); }), async () => {});
  const older = ui.panel.refresh();
  const newer = ui.panel.refresh();
  pending[1]([makeItem('aaaaaaaa-0000-0000-0000-000000000000', { kind: 'text', sourceUrl: 'https://example.test/a' })]);
  await newer;
  pending[0]([]);
  await older;
  assert.equal(ui.section.style.display, '');
  assert.equal(ui.depth.textContent, '1 queued');
  assert.equal(ui.list.children.length, 1);
});

test('read, retry and discard failures remain visible with the editor unavailable', async () => {
  const html = readFileSync(new URL('./sidepanel.html', import.meta.url), 'utf8');
  assert.match(html, /id="sp-snippet-queue-error"[^>]*role="alert"/);
  assert.ok(html.indexOf('id="sp-snippet-queue-section"') < html.indexOf('id="sp-snippet-section"'));

  const item = makeItem('bbbbbbbb-0000-0000-0000-000000000000', { kind: 'link', href: 'https://example.test/a' }, 'failed');
  let failRead = true;
  const actions: string[] = [];
  const ui = makePanel(
    async () => { if (failRead) throw new Error('storage unavailable'); return [item]; },
    async (action) => { actions.push(action); throw new Error('worker unavailable'); },
  );
  await ui.panel.refresh();
  assert.equal(ui.section.style.display, '');
  assert.match(ui.error.textContent, /Could not read local snippets/);
  assert.equal(ui.readRetry.style.display, '');

  failRead = false;
  ui.readRetry.click();
  await settle();
  assert.equal(ui.readRetry.style.display, 'none');
  assert.equal(ui.error.style.display, 'none');
  ui.list.children[0].children[1].click();
  await settle();
  assert.equal(ui.section.style.display, '');
  assert.match(ui.error.textContent, /Local snippet action failed/);
  ui.list.children[0].children[2].click();
  await settle();
  assert.deepEqual(actions, ['RETRY_SNIPPET', 'DISCARD_SNIPPET']);
  assert.match(ui.error.textContent, /Local snippet action failed/);
});

test('rows distinguish safe source, target and timestamp without exposing payloads', async () => {
  const items = [
    makeItem('aaaaaaaa-0000-0000-0000-000000000000', {
      kind: 'text', text: 'alice@example.test secret text',
      sourceUrl: 'https://user:password@example.test/private/alice@example.test?token=secret',
      targetKind: 'contact', targetId: '12345678-aaaa-bbbb-cccc-123456789abc',
    }, 'failed'),
    makeItem('bbbbbbbb-0000-0000-0000-000000000000', {
      kind: 'image', imageBytes: 'very-secret-base64', sourceUrl: 'data:image/png;base64,very-secret-base64',
      targetKind: 'company', targetId: '87654321-aaaa-bbbb-cccc-123456789abc',
    }),
    makeItem('cccccccc-0000-0000-0000-000000000000', {
      kind: 'link', href: 'https://links.example/path?secret=123', targetKind: 'contact', targetId: '3',
    }),
  ];
  items[0].lastError = 'HTTP 422: alice@example.test is invalid';
  const ui = makePanel(async () => items, async () => {});
  await ui.panel.refresh();
  const labels = ui.list.children.map((row) => row.children[0].textContent);
  assert.match(labels[0], /text .*https:\/\/example\.test\/… .*Target: contact 12345678 .*Saved .*Failed .*Ref aaaaaaaa/);
  assert.match(labels[1], /image .*source unavailable .*Target: company 87654321 .*Ref bbbbbbbb/);
  assert.match(labels[2], /link .*https:\/\/links\.example\/… .*Target: contact 3 .*Ref cccccccc/);
  assert.doesNotMatch(labels.join(' '), /alice@|password|token=|very-secret-base64|secret=123|\/private\/|\/path/);
  ui.list.children[0].children[3].click();
  assert.equal(ui.restored.length, 1);
});

test('successful discard refreshes the queue and clears an earlier action error', async () => {
  const item = makeItem('dddddddd-0000-0000-0000-000000000000', { kind: 'text' });
  let queue = [item];
  let fail = true;
  const ui = makePanel(async () => queue, async (_action, id) => {
    if (fail) throw new Error('temporary worker failure');
    queue = queue.filter((entry) => entry.id !== id);
  });
  await ui.panel.refresh();
  ui.list.children[0].children[2].click();
  await settle();
  assert.match(ui.error.textContent, /Local snippet action failed/);
  fail = false;
  ui.list.children[0].children[2].click();
  await settle();
  assert.equal(ui.list.children.length, 0);
  assert.equal(ui.section.style.display, 'none');
  assert.equal(ui.error.style.display, 'none');
});

test('enqueue storage-read failure identifies an unsaved draft and leaves queue action visible', async () => {
  const ui = makePanel(async () => { throw new Error('storage unavailable'); }, async () => {});
  ui.panel.showEnqueueFailure(new Error('Cannot read local snippet queue: storage unavailable'));
  assert.equal(ui.section.style.display, '');
  assert.match(ui.error.textContent, /Snippet was not queued/);
  assert.match(ui.error.textContent, /Draft remains in the editor/);
  assert.doesNotMatch(ui.error.textContent, /stored item remains available/);
  await ui.panel.refresh();
  assert.match(ui.error.textContent, /Snippet was not queued/);
});

test('full queue error clears only after a fresh read shows space or enqueue succeeds', async () => {
  let queue = Array.from({ length: SNIPPET_QUEUE_MAX }, (_, i) => makeItem(`${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, { kind: 'text' }));
  const ui = makePanel(async () => queue, async () => {});
  ui.panel.showEnqueueFailure(new Error('Local snippet queue is full'));
  await ui.panel.refresh();
  assert.match(ui.error.textContent, /queue is full/);
  queue = queue.slice(1); // worker drained one item
  await ui.panel.refresh();
  assert.equal(ui.error.style.display, 'none');
  ui.panel.showEnqueueFailure(new Error('Local snippet queue is full'));
  ui.panel.enqueueSucceeded();
  assert.equal(ui.error.style.display, 'none');
});

test('failed local enqueue keeps the editor draft; confirmed enqueue resets it', async () => {
  let resets = 0;
  let refreshes = 0;
  const reset = () => { resets++; };
  const refresh = async () => { refreshes++; };
  await assert.rejects(
    () => queueSnippetAndReset(async () => { throw new Error('Cannot read local snippet queue'); }, refresh, reset),
    /Cannot read local snippet queue/,
  );
  assert.equal(resets, 0);
  assert.equal(refreshes, 0);
  await queueSnippetAndReset(async () => {}, refresh, reset);
  assert.equal(refreshes, 1);
  assert.equal(resets, 1);
});

test('unverified offline draft stays visible with explicit verify and restore actions', async () => {
  const item = makeItem('eeeeeeee-0000-0000-0000-000000000000', {
    kind: 'text', targetKind: 'contact', targetId: '12345678-aaaa-bbbb-cccc-123456789abc',
    sourceUrl: 'https://example.test/source', text: 'private draft',
  });
  item.state = 'pending_verification';
  item.destination = { appUrl: 'http://localhost:3751', tokenFingerprint: 'synthetic' };
  item.lastError = 'Tenant verification required';
  const actions: string[] = [];
  const ui = makePanel(async () => [item], async (action) => { actions.push(action); });
  await ui.panel.refresh();
  assert.match(ui.depth.textContent, /need verification/);
  assert.match(ui.list.children[0].children[0].textContent, /Needs tenant verification/);
  assert.equal(ui.list.children[0].children[1].textContent, 'Verify tenant and retry');
  ui.list.children[0].children[3].click();
  assert.equal(ui.restored.length, 1);
  assert.deepEqual(actions, []);
});
