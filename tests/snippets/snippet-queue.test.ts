// WS-3 Phase 6 §10 — offline snippet queue tests.
//
// Exercises enqueue → flush ordering and preservation of failed work.
// Uses a local in-memory stand-in for chrome.storage.local.

/* eslint-disable @typescript-eslint/no-explicit-any */

interface StoredMap {
  [key: string]: unknown;
}

function installChromeShim(): void {
  const db: StoredMap = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get(
          key: string | string[],
          cb: (items: StoredMap) => void
        ): void {
          if (typeof key === 'string') {
            cb({ [key]: db[key] });
          } else if (Array.isArray(key)) {
            const out: StoredMap = {};
            for (const k of key) out[k] = db[k];
            cb(out);
          } else {
            cb({ ...db });
          }
        },
        set(patch: StoredMap, cb?: () => void): void {
          for (const k of Object.keys(patch)) db[k] = patch[k];
          cb?.();
        },
      },
    },
  };
  (globalThis as any).crypto ??= { randomUUID: () => String(Math.random()) };
}

describe('snippet-queue', () => {
  beforeEach(() => {
    installChromeShim();
    jest.resetModules();
  });

  it('enqueueSnippet + getSnippetQueueDepth round-trip', async () => {
    const mod = await import('../../browser/src/shared/snippet-queue');
    expect(await mod.getSnippetQueueDepth()).toBe(0);
    await mod.enqueueSnippet({ targetId: 'a' }, 'network down');
    await mod.enqueueSnippet({ targetId: 'b' });
    expect(await mod.getSnippetQueueDepth()).toBe(2);
    const list = await mod.getSnippetQueue();
    expect(list.map((q) => (q.body as any).targetId)).toEqual(['a', 'b']);
  });

  it('flushSnippetQueue preserves FIFO order on success', async () => {
    const mod = await import('../../browser/src/shared/snippet-queue');
    await mod.enqueueSnippet({ idx: 1 });
    await mod.enqueueSnippet({ idx: 2 });
    await mod.enqueueSnippet({ idx: 3 });

    const bodies: unknown[] = [];
    const fetchImpl = jest.fn(async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;

    const r = await mod.flushSnippetQueue({
      appUrl: 'https://app.test',
      extensionToken: 'tok',
      fetchImpl,
    });
    expect(r.processed).toBe(3);
    expect(r.remaining).toBe(0);
    expect(bodies).toEqual([{ idx: 1 }, { idx: 2 }, { idx: 3 }]);
  });

  it('retains items that hit a 4xx for explicit retry or discard', async () => {
    const mod = await import('../../browser/src/shared/snippet-queue');
    await mod.enqueueSnippet({ idx: 1 });

    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 422,
    })) as unknown as typeof fetch;

    const r = await mod.flushSnippetQueue({
      appUrl: 'https://app.test',
      extensionToken: null,
      fetchImpl,
    });
    expect(r.processed).toBe(0);
    expect(r.remaining).toBe(1);
    expect((await mod.getSnippetQueue())[0]).toMatchObject({
      state: 'failed', lastError: 'HTTP 422',
    });
  });

  it('stops after a 5xx + bumps retry count', async () => {
    const mod = await import('../../browser/src/shared/snippet-queue');
    await mod.enqueueSnippet({ idx: 1 });
    await mod.enqueueSnippet({ idx: 2 });

    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 503,
    })) as unknown as typeof fetch;

    const r = await mod.flushSnippetQueue({
      appUrl: 'https://app.test',
      extensionToken: null,
      fetchImpl,
    });
    expect(r.processed).toBe(0);
    expect(r.remaining).toBe(2);

    const list = await mod.getSnippetQueue();
    // Only the first item's retryCount should bump — we break the loop after
    // a 5xx rather than hammer every item.
    expect(list[0].retryCount).toBe(1);
    expect(list[1].retryCount).toBe(0);
  });

  it('retains exhausted items without automatic replay', async () => {
    const mod = await import('../../browser/src/shared/snippet-queue');
    // Manually seed a queue item at max retries by dropping it in storage.
    await (globalThis as any).chrome.storage.local.set({
      snippetQueue: [
        {
          id: 'old',
          createdAt: '2026-04-17T00:00:00Z',
          path: '/api/extension/snippet',
          body: {},
          retryCount: mod.SNIPPET_QUEUE_MAX_RETRIES,
        },
      ],
    });
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const r = await mod.flushSnippetQueue({
      appUrl: 'https://app.test',
      extensionToken: null,
      fetchImpl,
    });
    expect(r.processed).toBe(0);
    expect(r.remaining).toBe(1);
    expect((await mod.getSnippetQueue())[0].id).toBe('old');
    expect((fetchImpl as unknown as jest.Mock).mock.calls.length).toBe(0);
  });

  it('treats network errors as retryable and stops the pass', async () => {
    const mod = await import('../../browser/src/shared/snippet-queue');
    await mod.enqueueSnippet({ idx: 1 });
    await mod.enqueueSnippet({ idx: 2 });

    const fetchImpl = jest.fn(async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof fetch;

    const r = await mod.flushSnippetQueue({
      appUrl: 'https://app.test',
      extensionToken: null,
      fetchImpl,
    });
    expect(r.processed).toBe(0);
    expect(r.remaining).toBe(2);
    const list = await mod.getSnippetQueue();
    expect(list[0].retryCount).toBe(1);
    expect(list[0].lastError).toMatch(/Failed to fetch/);
  });
});
