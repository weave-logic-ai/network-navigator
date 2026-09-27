import { ContextController, type ContextSnapshot } from '@/lib/targets/context-controller';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const L = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SELF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeSnapshot(revision: number, secondaryTargetId: string | null = null,
  history: ContextSnapshot['history'] = [], activeLensId: string | null = null): ContextSnapshot {
  return { revision: String(revision), primaryTargetId: SELF, primaryLabel: 'Self',
    secondaryTargetId, focusLabel: secondaryTargetId === A ? 'A' : secondaryTargetId === B ? 'B' : null,
    activeLensId, activeLensLabel: activeLensId ? 'Lens' : null,
    canGoBack: history.length > 0, history, warning: null };
}

function server() {
  let state = makeSnapshot(0);
  const writes: Array<{ expectedRevision: string; action: { type: string; targetId?: string | null; lensId?: string } }> = [];
  let rejectGet = false;
  let force428 = false;
  const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/targets' && init?.method === 'POST') {
      return new Response(JSON.stringify({ data: { id: JSON.parse(String(init.body)).id } }));
    }
    if (url !== '/api/targets/state') return new Response('{}', { status: 404 });
    if (!init?.method) {
      if (rejectGet) throw new Error('offline');
      return new Response(JSON.stringify({ data: state }));
    }
    const command = JSON.parse(String(init.body));
    writes.push(command);
    if (force428) { force428 = false; return new Response('{}', { status: 428 }); }
    if (command.expectedRevision !== state.revision) {
      return new Response(JSON.stringify({ data: state, error: 'changed' }), { status: 409 });
    }
    const action = command.action;
    const prior = state.secondaryTargetId ?? SELF;
    if (action.type === 'focus') {
      state = makeSnapshot(Number(state.revision) + 1, action.targetId,
        [{ targetId: prior, targetLabel: prior === SELF ? 'Self' : prior === A ? 'A' : 'B',
          lensId: state.activeLensId, lensLabel: state.activeLensId ? 'Lens' : null,
          lensUnavailable: false, openedAt: new Date().toISOString() }, ...state.history], null);
    } else if (action.type === 'back') {
      const [entry, ...rest] = state.history;
      if (!entry) return new Response('{}', { status: 400 });
      state = makeSnapshot(Number(state.revision) + 1, entry.targetId === SELF ? null : entry.targetId,
        rest, entry.lensId);
    } else {
      if (action.targetId !== (state.secondaryTargetId ?? SELF)) return new Response('{}', { status: 400 });
      state = makeSnapshot(Number(state.revision) + 1, state.secondaryTargetId, state.history, action.lensId);
    }
    return new Response(JSON.stringify({ data: state }));
  }) as typeof fetch;
  return { fetcher, writes, get state() { return state; }, set rejectGet(v: boolean) { rejectGet = v; },
    set force428(v: boolean) { force428 = v; }, set state(v: ContextSnapshot) { state = v; } };
}

describe('context controller', () => {
  it('serializes A → B → Clear → Back from invocation time, including creation', async () => {
    const api = server();
    const client = new ContextController(api.fetcher);
    const operations = [client.createAndFocus('contact', A), client.createAndFocus('contact', B),
      client.focus(null), client.back()];
    await Promise.all(operations);
    expect(api.state.secondaryTargetId).toBe(B);
    expect(api.writes.map(w => w.expectedRevision)).toEqual(['0', '1', '2', '3']);
    expect(api.writes.map(w => w.action.type)).toEqual(['focus', 'focus', 'focus', 'back']);
  });

  it('keeps the confirmed crumb and history after a failed Back write, then retries explicitly', async () => {
    const api = server();
    let failBack = true;
    const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (failBack && init?.method === 'PUT' &&
          JSON.parse(String(init.body)).action.type === 'back') {
        failBack = false;
        return new Response('{}', { status: 500 });
      }
      return api.fetcher(input, init);
    }) as typeof fetch;
    const client = new ContextController(fetcher);
    await client.focus(A);
    await client.focus(B);
    const confirmed = client.getSnapshot().snapshot;
    await expect(client.back()).rejects.toThrow('Context write failed');
    expect(client.getSnapshot()).toMatchObject({ snapshot: confirmed, stale: true });
    expect(client.getSnapshot().snapshot?.canGoBack).toBe(true);
    await client.back();
    expect(api.state.secondaryTargetId).toBe(A);
  });

  it('does not let an older state/history GET replace a later confirmed focus', async () => {
    const api = server();
    let release!: (response: Response) => void;
    let hold = false;
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      hold && !init?.method ? delayed : api.fetcher(input, init)) as typeof fetch;
    const client = new ContextController(fetcher);
    await client.focus(A);
    const older = api.state;
    hold = true;
    const pendingRefresh = client.refresh();
    await client.focus(B);
    release(new Response(JSON.stringify({ data: older })));
    await pendingRefresh;
    expect(client.getSnapshot().snapshot).toMatchObject({
      revision: '2', secondaryTargetId: B, canGoBack: true,
    });
    expect(client.getSnapshot().snapshot?.history[0]).toMatchObject({ targetId: A });
  });

  it('queues Clear behind a pending Back write without overlapping PUTs', async () => {
    const api = server();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const backStarted = new Promise<void>(resolve => { started = resolve; });
    const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT' && JSON.parse(String(init.body)).action.type === 'back') {
        started();
        await gate;
      }
      return api.fetcher(input, init);
    }) as typeof fetch;
    const client = new ContextController(fetcher);
    await client.focus(A);
    await client.focus(B);
    const back = client.back();
    await backStarted;
    const clear = client.focus(null);
    expect(api.writes).toHaveLength(2);
    release();
    await Promise.all([back, clear]);
    expect(api.writes.map(w => w.action.type)).toEqual(['focus', 'focus', 'back', 'focus']);
    expect(api.writes.map(w => w.expectedRevision)).toEqual(['0', '1', '2', '3']);
    expect(api.state.secondaryTargetId).toBeNull();
  });

  it('rejects a late A deep-link activation after focus switches to B', async () => {
    const api = server();
    const client = new ContextController(api.fetcher);
    await client.focus(A);
    const switchToB = client.focus(B);
    const lateActivation = client.activateLens(A, L);
    await switchToB;
    await expect(lateActivation).rejects.toThrow('Target changed; lens was not activated');
    expect(api.state).toMatchObject({ secondaryTargetId: B, activeLensId: null });
    expect(api.writes.map(w => w.action.type)).toEqual(['focus', 'focus']);
  });

  it('does not apply queued URL lens X after manual lens Y commits on the same target', async () => {
    const api = server();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const manualStarted = new Promise<void>(resolve => { started = resolve; });
    const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT' && JSON.parse(String(init.body)).action.lensId === L) {
        started();
        await gate;
      }
      return api.fetcher(input, init);
    }) as typeof fetch;
    const client = new ContextController(fetcher);
    await client.focus(A);
    const linkedRevision = client.getSnapshot().snapshot!.revision;
    const manual = client.activateLens(A, L);
    await manualStarted;
    const linkedX = client.activateLens(A, B, linkedRevision);
    release();
    await manual;
    await expect(linkedX).rejects.toThrow('linked lens was not activated');
    expect(api.state).toMatchObject({ secondaryTargetId: A, activeLensId: L });
    expect(api.writes.map(w => w.action.lensId).filter(Boolean)).toEqual([L]);
  });

  it('shows a two-tab focus conflict without overwriting the other tab', async () => {
    const api = server();
    const first = new ContextController(api.fetcher);
    const second = new ContextController(api.fetcher);
    await Promise.all([first.refresh(), second.refresh()]);
    await first.focus(A);
    await expect(second.focus(B)).rejects.toThrow('action was not applied');
    expect(api.state.secondaryTargetId).toBe(A);
    expect(api.writes.map(w => w.expectedRevision)).toEqual(['0', '0']);
    expect(second.getSnapshot()).toMatchObject({ snapshot: { revision: '1', secondaryTargetId: A },
      error: expect.stringContaining('action was not applied') });
    await second.focus(B); // A new, explicit action uses the current revision.
    expect(api.state.secondaryTargetId).toBe(B);
    expect(api.writes.map(w => w.expectedRevision)).toEqual(['0', '0', '1']);
  });

  it('does not silently clear another tab’s focus on a 409', async () => {
    const api = server();
    const first = new ContextController(api.fetcher);
    const second = new ContextController(api.fetcher);
    await Promise.all([first.refresh(), second.refresh()]);
    await first.focus(A);
    await expect(second.focus(null)).rejects.toThrow('action was not applied');
    expect(api.state.secondaryTargetId).toBe(A);
    expect(second.getSnapshot().snapshot).toMatchObject({ revision: '1', secondaryTargetId: A });
    expect(api.writes).toHaveLength(2);
  });

  it('does not reinterpret Back after another tab changes focus', async () => {
    const api = server();
    const first = new ContextController(api.fetcher);
    const second = new ContextController(api.fetcher);
    await first.focus(A);
    await second.refresh(); // Both tabs see A and its return-to-Self history.
    await second.focus(B);
    await expect(first.back()).rejects.toThrow('Back was not applied');
    expect(api.state.secondaryTargetId).toBe(B);
    expect(first.getSnapshot()).toMatchObject({ snapshot: { revision: '2', secondaryTargetId: B },
      error: expect.stringContaining('Back was not applied') });
    expect(api.writes.map(w => w.action.type)).toEqual(['focus', 'focus', 'back']);
    expect(api.writes[2].expectedRevision).toBe('1');
  });

  it('does not reinterpret Back when refresh advances before its PUT', async () => {
    const api = server();
    const first = new ContextController(api.fetcher);
    const second = new ContextController(api.fetcher);
    await first.focus(A);
    await second.refresh();
    api.rejectGet = true;
    await first.refresh(); // Keep the visible A snapshot, marked stale.
    api.rejectGet = false;
    await second.focus(B);
    await expect(first.back()).rejects.toThrow('Back was not applied');
    expect(first.getSnapshot().snapshot).toMatchObject({ revision: '2', secondaryTargetId: B });
    expect(api.writes.map(w => w.action.type)).toEqual(['focus', 'focus']);
  });

  it('treats 428 as a protocol error without retrying and preserves state on failed GET', async () => {
    const api = server();
    const client = new ContextController(api.fetcher);
    await client.refresh();
    api.force428 = true;
    await expect(client.focus(A)).rejects.toThrow('Context protocol error');
    expect(api.writes.map(w => w.expectedRevision)).toEqual(['0']);
    expect(client.getSnapshot().snapshot?.secondaryTargetId).toBeNull();
    await client.focus(A);
    api.rejectGet = true;
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ stale: true, snapshot: { revision: '1', secondaryTargetId: A } });
    await expect(client.focus(B)).rejects.toThrow('Context is unavailable');
    expect(api.state.secondaryTargetId).toBe(A);
  });

  it('uses the confirmed lens revision and notices a soft delete on refresh', async () => {
    const api = server();
    const client = new ContextController(api.fetcher);
    await client.focus(A);
    await client.activateLens(A, L);
    expect(client.getSnapshot().snapshot).toMatchObject({ activeLensId: L, revision: '2' });
    api.state = makeSnapshot(3, A, api.state.history, null);
    await client.refresh();
    expect(client.getSnapshot().snapshot).toMatchObject({ activeLensId: null, revision: '3' });
    api.state = makeSnapshot(2, B);
    await client.refresh();
    expect(client.getSnapshot().snapshot).toMatchObject({ secondaryTargetId: A, revision: '3' });
  });

  it('stops on the first conflict and shows an explicit retry error', async () => {
    let revision = 0;
    const fetcher = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ data: makeSnapshot(revision) }));
      revision++;
      return new Response(JSON.stringify({ data: makeSnapshot(revision) }), { status: 409 });
    }) as typeof fetch;
    const client = new ContextController(fetcher);
    await expect(client.focus(A)).rejects.toThrow('try again');
    expect(client.getSnapshot()).toMatchObject({ stale: false, pending: 0,
      snapshot: { revision: '1', secondaryTargetId: null },
      error: expect.stringContaining('action was not applied') });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('clears the prior identity on an unauthorized refresh', async () => {
    let unauthorized = false;
    const fetcher = jest.fn(async () => unauthorized
      ? new Response('{}', { status: 401 })
      : new Response(JSON.stringify({ data: makeSnapshot(4, A) }))) as typeof fetch;
    const client = new ContextController(fetcher);
    await client.refresh();
    unauthorized = true;
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ snapshot: null, stale: true });
  });

  it('cancels a late PUT and every queued intent after reset', async () => {
    let finishPut!: (response: Response) => void;
    let markPutStarted!: () => void;
    const putStarted = new Promise<void>(resolve => { markPutStarted = resolve; });
    const latePut = new Promise<Response>(resolve => { finishPut = resolve; });
    const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/targets/state' && init?.method === 'PUT') {
        markPutStarted();
        return latePut;
      }
      return new Response(JSON.stringify({ data: makeSnapshot(0) }));
    }) as typeof fetch;
    const client = new ContextController(fetcher);
    await client.refresh();
    const first = client.focus(A);
    const second = client.createAndFocus('contact', B);
    await putStarted;
    client.reset();
    finishPut(new Response(JSON.stringify({ data: makeSnapshot(1, A) })));
    await expect(first).rejects.toThrow('session changed');
    await expect(second).rejects.toThrow('session changed');
    expect(client.getSnapshot()).toMatchObject({ snapshot: null, ready: true });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([input]) => String(input) === '/api/targets')).toHaveLength(0);
  });

  it('ignores a late unauthorized GET from before reset', async () => {
    let finishGet!: (response: Response) => void;
    const lateGet = new Promise<Response>(resolve => { finishGet = resolve; });
    const fetcher = jest.fn()
      .mockImplementationOnce(() => lateGet)
      .mockResolvedValue(new Response(JSON.stringify({ data: makeSnapshot(7, B) }))) as typeof fetch;
    const client = new ContextController(fetcher);
    const oldRefresh = client.refresh();
    client.reset();
    await client.refresh();
    finishGet(new Response('{}', { status: 401 }));
    await oldRefresh;
    expect(client.getSnapshot()).toMatchObject({ snapshot: { revision: '7', secondaryTargetId: B } });
  });
});
