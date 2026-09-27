// WS-4 §3.2 — shift-click secondary-target flow (graph-native shortcut).
//
// Unit-level test of the helpers extracted into
// `app/src/components/network/shift-click.ts`. The sigma component
// delegates to these helpers, so exercising them here proves the
// shift-click flow without needing jsdom/React.

import {
  isShiftClick,
  LatestFocusQueue,
  setSecondaryTargetViaShiftClick,
  writeGraphBack,
  getGraphBackDecision,
  canGraphGoBack,
} from '@/components/network/shift-click';

describe('isShiftClick', () => {
  it('returns true when the original event has shiftKey=true', () => {
    expect(isShiftClick({ original: { shiftKey: true } as unknown as MouseEvent })).toBe(true);
  });

  it('returns false when the event is missing or non-shifted', () => {
    expect(isShiftClick(undefined)).toBe(false);
    expect(isShiftClick({ original: { shiftKey: false } as unknown as MouseEvent })).toBe(false);
  });
});

describe('LatestFocusQueue', () => {
  it('keeps Retry Back actionable after a deferred write and reconciliation read both fail at Self', async () => {
    const queue = new LatestFocusQueue<{ ok: boolean; secondaryTargetId: string | null }>();
    let releaseWrite!: (response: Response) => void;
    let writeStarted!: () => void;
    const heldWrite = new Promise<Response>((resolve) => { releaseWrite = resolve; });
    const started = new Promise<void>((resolve) => { writeStarted = resolve; });
    const writes: Array<string | null> = [];
    let reads = 0;
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        writes.push((JSON.parse(String(init.body)) as { secondaryTargetId: string | null }).secondaryTargetId);
        if (writes.length === 1) { writeStarted(); return heldWrite; }
        return new Response('{}', { status: 200 });
      }
      reads++;
      throw new Error('reconciliation read failed');
    }) as unknown as typeof fetch;

    let retry: { target: string | null; popHistory: boolean } | null = null;
    const firstDecision = getGraphBackDecision(null, [], true);
    const first = queue.enqueue(() => writeGraphBack(firstDecision.target, fetchImpl), async (result) => {
      if (result.ok) return;
      retry = firstDecision;
      try { await fetchImpl('/api/targets/state'); } catch { /* UI keeps Retry Back visible. */ }
    }, () => { throw new Error('unexpected queue failure'); });
    await started;
    expect(writes).toEqual([null]);
    releaseWrite(new Response('{}', { status: 503 }));
    await first;

    expect(reads).toBe(1);
    expect(canGraphGoBack(null, [], false, null)).toBe(false);
    expect(canGraphGoBack(null, [], false, retry)).toBe(true);
    const next = getGraphBackDecision(null, [], false, retry);
    expect(next).toEqual({ target: null, popHistory: false });
    await queue.enqueue(() => writeGraphBack(next.target, fetchImpl), (result) => {
      expect(result.ok).toBe(true);
      retry = null;
    }, () => { throw new Error('unexpected retry failure'); });
    expect(writes).toEqual([null, null]);
    expect(retry).toBeNull();
  });

  it('returns Back to the visible root while Focus is pending, preserving older history', () => {
    expect(getGraphBackDecision('A', [null], true)).toEqual({ target: 'A', popHistory: false });
    expect(getGraphBackDecision('B', [null, 'A'], false)).toEqual({ target: 'A', popHistory: true });
    expect(getGraphBackDecision(null, [], true)).toEqual({ target: null, popHistory: false });
    expect(getGraphBackDecision('B', [null], false, { target: 'A', popHistory: false }))
      .toEqual({ target: 'A', popHistory: false });
  });
  it('writes Back to target state and reports a failed response', async () => {
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ secondaryTargetId: null });
      return new Response('{}', { status: 503 });
    }) as unknown as typeof fetch;
    await expect(writeGraphBack(null, fetchImpl)).resolves.toEqual({ ok: false, secondaryTargetId: null });
    expect(fetchImpl).toHaveBeenCalledWith('/api/targets/state', expect.objectContaining({ method: 'PUT' }));
  });
  it.each(['focus-first', 'back-first'] as const)('serializes deferred Focus and Back with %s completion', async (order) => {
    const queue = new LatestFocusQueue<{ ok: boolean; secondaryTargetId: string | null }>();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const writes: string[] = [];
    const applied: string[] = [];
    const firstName = order === 'focus-first' ? 'focused' : 'previous';
    const secondName = order === 'focus-first' ? 'previous' : 'focused';
    const first = queue.enqueue(async () => { writes.push(firstName); started(); await held; return { ok: true, secondaryTargetId: firstName }; },
      (result) => { applied.push(result.secondaryTargetId!); }, () => { applied.push('first error'); });
    await firstStarted;
    const second = queue.enqueue(async () => { writes.push(secondName); return { ok: true, secondaryTargetId: secondName }; },
      (result) => { applied.push(result.secondaryTargetId!); }, () => { applied.push('second error'); });
    expect(writes).toEqual([firstName]);
    release();
    await Promise.all([first, second]);
    expect(writes).toEqual([firstName, secondName]);
    expect(applied).toEqual([secondName]);
  });

  it.each(['stale-focus', 'stale-back'] as const)('reconciles persisted state after %s completes and the latest write fails', async (stale) => {
    const queue = new LatestFocusQueue<{ ok: boolean; secondaryTargetId: string | null }>();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const firstTarget = stale === 'stale-focus' ? 'focused' : 'previous';
    let persisted: string | null = null;
    let visible: string | null = null;
    const first = queue.enqueue(async () => { started(); await held; persisted = firstTarget; return { ok: true, secondaryTargetId: firstTarget }; },
      (result) => { visible = result.secondaryTargetId; }, () => {});
    await firstStarted;
    const second = queue.enqueue(async () => ({ ok: false, secondaryTargetId: null }),
      (result, isCurrent) => { if (!result.ok && isCurrent()) visible = persisted; }, () => {});
    release();
    await Promise.all([first, second]);
    expect(visible).toBe(firstTarget);
  });
  it('serializes a delayed A write before B and only applies B to the UI', async () => {
    const queue = new LatestFocusQueue<string>();
    let releaseA!: () => void;
    let startA!: () => void;
    const started = new Promise<void>((resolve) => { startA = resolve; });
    const held = new Promise<void>((resolve) => { releaseA = resolve; });
    const writes: string[] = [];
    const applied: string[] = [];
    const first = queue.enqueue(async () => { writes.push('A'); startA(); await held; return 'A'; }, (id) => applied.push(id), () => applied.push('error A'));
    await started;
    const second = queue.enqueue(async () => { writes.push('B'); return 'B'; }, (id) => applied.push(id), () => applied.push('error B'));
    expect(writes).toEqual(['A']);
    releaseA();
    await Promise.all([first, second]);
    expect(writes).toEqual(['A', 'B']);
    expect(applied).toEqual(['B']);
  });

  it('ignores stale errors and reports the latest failure', async () => {
    const queue = new LatestFocusQueue<string>();
    let rejectA!: (error: Error) => void;
    let startA!: () => void;
    const started = new Promise<void>((resolve) => { startA = resolve; });
    const held = new Promise<string>((_resolve, reject) => { rejectA = reject; });
    const errors: string[] = [];
    const first = queue.enqueue(() => { startA(); return held; }, () => {}, () => errors.push('A'));
    await started;
    const second = queue.enqueue(async () => { throw new Error('B failed'); }, () => {}, () => errors.push('B'));
    rejectA(new Error('A failed'));
    await Promise.all([first, second]);
    expect(errors).toEqual(['B']);
  });

  it('lets the latest failed request reconcile the persisted A state', async () => {
    const queue = new LatestFocusQueue<string>();
    let releaseA!: () => void;
    let startA!: () => void;
    const started = new Promise<void>((resolve) => { startA = resolve; });
    const held = new Promise<void>((resolve) => { releaseA = resolve; });
    let persisted: string | null = null;
    let visible: string | null = null;
    const first = queue.enqueue(async () => {
      startA();
      await held;
      persisted = 'A';
      return 'A';
    }, (id) => { visible = id; }, () => {});
    await started;
    const second = queue.enqueue(async () => { throw new Error('B failed'); }, () => {}, (isCurrent) => {
      if (isCurrent()) visible = persisted;
    });
    releaseA();
    await Promise.all([first, second]);
    expect(persisted).toBe('A');
    expect(visible).toBe('A');
  });
});

describe('setSecondaryTargetViaShiftClick', () => {
  it('POSTs /api/targets then PUTs /api/targets/state with the new id', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method as string) ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
      if (url === '/api/targets' && method === 'POST') {
        return new Response(JSON.stringify({ data: { id: 'target-new' } }), {
          status: 200,
        });
      }
      if (url === '/api/targets/state' && method === 'PUT') {
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const result = await setSecondaryTargetViaShiftClick('contact-abc', fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.secondaryTargetId).toBe('target-new');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      url: '/api/targets',
      method: 'POST',
      body: { kind: 'contact', id: 'contact-abc' },
    });
    expect(calls[1]).toEqual({
      url: '/api/targets/state',
      method: 'PUT',
      body: { secondaryTargetId: 'target-new' },
    });
  });

  it('returns ok=false silently when the POST /api/targets call fails', async () => {
    let putCalled = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === '/api/targets' && init?.method === 'POST') {
        return new Response('boom', { status: 500 });
      }
      if (url === '/api/targets/state') {
        putCalled = true;
      }
      return new Response('{}', { status: 200 });
    };

    const result = await setSecondaryTargetViaShiftClick('contact-abc', fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.secondaryTargetId).toBeUndefined();
    expect(putCalled).toBe(false);
  });

  it('swallows thrown errors and returns ok=false', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network down');
    };
    const result = await setSecondaryTargetViaShiftClick('contact-abc', fetchImpl);
    expect(result.ok).toBe(false);
  });
});
