let mockParam: string | null = null;
let mockRevision = '1';
let mockActiveLensId: string | null = null;
let mockRef: { current: string | null } = { current: null };
const mockEffects: Array<() => void | (() => void)> = [];
let mockBannerState: { kind: string } = { kind: 'none' };
let mockRetryState = 0;
const mockSetRetry = jest.fn((value: (current: number) => number) => {
  mockRetryState = value(mockRetryState);
});
const mockSetBanner = jest.fn((value: { kind: string } | ((current: { kind: string }) => { kind: string })) => {
  mockBannerState = typeof value === 'function' ? value(mockBannerState) : value;
});
const mockActivateLens = jest.fn();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: (effect: () => void | (() => void)) => { mockEffects.push(effect); },
  useState: (initial: unknown) => typeof initial === 'number'
    ? [mockRetryState, mockSetRetry] : [mockBannerState, mockSetBanner],
  useRef: () => mockRef,
}));
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => mockParam, toString: () => `lens=${mockParam}` }),
  usePathname: () => '/network',
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('@/lib/targets/context-controller', () => ({
  useTargetContext: () => ({ ready: true, snapshot: { secondaryTargetId: null,
    activeLensId: mockActiveLensId, revision: mockRevision } }),
  contextController: { activateLens: (...args: unknown[]) => mockActivateLens(...args),
    getSnapshot: () => ({ snapshot: { revision: mockRevision, activeLensId: mockActiveLensId } }) },
}));

import { LensDeepLink } from '@/components/targets/lens-deep-link';

const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LENS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

async function runLink(detail: Response) {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ data: [] }))
    .mockResolvedValueOnce(detail);
  LensDeepLink({ primaryTargetId: TARGET });
  const cleanup = mockEffects.pop()!();
  await tick();
  if (typeof cleanup === 'function') cleanup();
  return mockSetBanner.mock.calls.map(([value]) => value.kind);
}

describe('lens deep links', () => {
  beforeEach(() => {
    mockParam = LENS;
    mockRevision = '1';
    mockActiveLensId = null;
    mockRef = { current: null };
    mockBannerState = { kind: 'none' };
    mockRetryState = 0;
    mockEffects.length = 0;
    mockSetBanner.mockClear();
    mockSetRetry.mockClear();
    mockActivateLens.mockReset().mockResolvedValue({});
  });
  it.each([
    ['missing', response({ status: 'missing' }, 404)],
    ['deleted', response({ status: 'deleted' })],
    ['wrongTarget', response({ status: 'wrongTarget' })],
  ])('distinguishes %s from other unavailable links', async (expected, detail) => {
    expect(await runLink(detail)).toContain(expected);
    expect(mockActivateLens).not.toHaveBeenCalled();
  });
  it.each(['', 'not-a-lens-id'])('marks malformed lens value %j invalid without a fetch', value => {
    mockParam = value;
    global.fetch = jest.fn();
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    expect(mockSetBanner.mock.calls.map(([state]) => state.kind)).toContain('invalid');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('activates an available lens found by the second fetch', async () => {
    expect(await runLink(response({ status: 'available', name: 'Saved' }))).toContain('activated');
    expect(mockActivateLens).toHaveBeenCalledWith(TARGET, LENS, '1');
  });
  it('retries a failed activation on the same URL and current revision', async () => {
    global.fetch = jest.fn().mockImplementation(async () =>
      response({ data: [{ id: LENS, name: 'Saved' }] }));
    mockActivateLens.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    await tick();
    expect(mockBannerState.kind).toBe('unavailable');
    expect(mockRef.current).toBeNull();
    const view = LensDeepLink({ primaryTargetId: TARGET }) as React.ReactElement<{
      children: Array<React.ReactElement<{ children: string; onClick: () => void }>>;
    }>;
    const retryButton = view.props.children.find(child => child?.props?.children === 'Retry');
    expect(retryButton).toBeDefined();
    retryButton!.props.onClick();
    expect(mockRetryState).toBe(1);
    mockEffects.pop(); // Discard the render used to inspect the button.
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    await tick();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockActivateLens).toHaveBeenCalledTimes(2);
    expect(mockBannerState.kind).toBe('activated');
  });

  it('can retry when activation is cancelled by a newer revision', async () => {
    let finish!: (value: Response) => void;
    global.fetch = jest.fn().mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }))
      .mockImplementation(async () => response({ data: [{ id: LENS, name: 'Saved' }] }));
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    mockRevision = '2';
    finish(response({ data: [{ id: LENS, name: 'Saved' }] }));
    await tick();
    expect(mockActivateLens).not.toHaveBeenCalled();
    expect(mockBannerState.kind).toBe('unavailable');
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    await tick();
    expect(mockActivateLens).toHaveBeenCalledWith(TARGET, LENS, '2');
  });
  it('retries the same URL after a pending lookup is cancelled by revision change', async () => {
    let finishOld!: (value: Response) => void;
    global.fetch = jest.fn().mockReturnValueOnce(new Promise<Response>(resolve => { finishOld = resolve; }))
      .mockImplementation(async () => response({ data: [{ id: LENS, name: 'Saved' }] }));
    LensDeepLink({ primaryTargetId: TARGET });
    const cleanup = mockEffects.pop()!();
    if (typeof cleanup === 'function') cleanup();
    mockRevision = '2';
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    finishOld(response({ data: [{ id: LENS, name: 'Old' }] }));
    await tick();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockActivateLens).toHaveBeenCalledTimes(1);
    expect(mockActivateLens).toHaveBeenCalledWith(TARGET, LENS, '2');
    expect(mockBannerState.kind).toBe('activated');
  });
  it('ignores a second fetch that resolves after the link effect is cancelled', async () => {
    let finishDetail!: (value: Response) => void;
    const detail = new Promise<Response>(resolve => { finishDetail = resolve; });
    global.fetch = jest.fn().mockResolvedValueOnce(response({ data: [] })).mockReturnValueOnce(detail);
    LensDeepLink({ primaryTargetId: TARGET });
    const cleanup = mockEffects.pop()!();
    await tick();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    if (typeof cleanup === 'function') cleanup();
    finishDetail(response({ status: 'deleted' }));
    await tick();
    expect(mockSetBanner.mock.calls.map(([value]) => value.kind)).toEqual(['none']);
    expect(mockActivateLens).not.toHaveBeenCalled();
  });
  it('ignores a second response whose JSON resolves after cancellation', async () => {
    let finishJson!: (value: unknown) => void;
    const lateJson = new Promise(resolve => { finishJson = resolve; });
    global.fetch = jest.fn().mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => lateJson });
    LensDeepLink({ primaryTargetId: TARGET });
    const cleanup = mockEffects.pop()!();
    await tick();
    if (typeof cleanup === 'function') cleanup();
    finishJson({ status: 'available', name: 'Late' });
    await tick();
    expect(mockSetBanner.mock.calls.map(([value]) => value.kind)).toEqual(['none']);
    expect(mockActivateLens).not.toHaveBeenCalled();
  });
  it('does not announce activation after switching away while the CAS command is pending', async () => {
    let finishActivation!: (value: unknown) => void;
    mockActivateLens.mockImplementationOnce(() => new Promise(resolve => { finishActivation = resolve; }));
    global.fetch = jest.fn().mockResolvedValue(response({ data: [{ id: LENS, name: 'A lens' }] }));
    LensDeepLink({ primaryTargetId: TARGET });
    const cleanup = mockEffects.pop()!();
    await tick();
    expect(mockActivateLens).toHaveBeenCalledWith(TARGET, LENS, '1');
    if (typeof cleanup === 'function') cleanup();
    finishActivation({});
    await tick();
    expect(mockSetBanner.mock.calls.map(([state]) => state.kind)).toEqual(['none']);
  });

  it('keeps a manual lens choice after URL activation and handles a later URL change', async () => {
    const nextLens = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    global.fetch = jest.fn().mockImplementation(async () => response({ data: [
      { id: LENS, name: 'Linked' }, { id: nextLens, name: 'Next link' },
    ] }));
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    await tick();
    expect(mockActivateLens).toHaveBeenCalledTimes(1);
    expect(mockBannerState.kind).toBe('activated');
    mockActiveLensId = nextLens; // Manual selector changed the context.
    mockRevision = '3';
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    await tick();
    expect(mockActivateLens).toHaveBeenCalledTimes(1);
    expect(mockBannerState.kind).toBe('none');
    mockParam = nextLens;
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    await tick();
    expect(mockSetBanner.mock.calls.map(([state]) => state.kind)).toContain('activated');
    expect(mockActivateLens).toHaveBeenCalledTimes(1); // Already selected.
  });

  it('ignores an old link result after a manual choice changes revision', async () => {
    let finish!: (value: Response) => void;
    global.fetch = jest.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    mockActiveLensId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mockRevision = '2';
    finish(response({ data: [{ id: LENS, name: 'Old link' }] }));
    await tick();
    expect(mockActivateLens).not.toHaveBeenCalled();
  });

  it('activates a later URL lens and ignores the previous URL response', async () => {
    const nextLens = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    let finishOld!: (value: Response) => void;
    global.fetch = jest.fn()
      .mockReturnValueOnce(new Promise<Response>(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(response({ data: [{ id: nextLens, name: 'New link' }] }));
    LensDeepLink({ primaryTargetId: TARGET });
    const cleanup = mockEffects.pop()!();
    mockParam = nextLens;
    if (typeof cleanup === 'function') cleanup();
    LensDeepLink({ primaryTargetId: TARGET });
    mockEffects.pop()!();
    await tick();
    finishOld(response({ data: [{ id: LENS, name: 'Old link' }] }));
    await tick();
    expect(mockActivateLens).toHaveBeenCalledTimes(1);
    expect(mockActivateLens).toHaveBeenCalledWith(TARGET, nextLens, '1');
  });
});
