const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let mockSnapshot = { revision: '1', activeLensId: null as string | null,
  secondaryTargetId: A as string | null };
const mockEffects: Array<() => void | (() => void)> = [];
const mockState: unknown[] = [];
const mockRefs: Array<{ current: number }> = [];
let mockStateIndex = 0;
let mockRefIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockStateIndex++;
    if (!(index in mockState)) mockState[index] = initial;
    return [mockState[index], (value: unknown) => { mockState[index] = value; }];
  },
  useEffect: (effect: () => void | (() => void)) => { mockEffects.push(effect); },
  useCallback: (fn: unknown) => fn,
  useRef: (value: number) => {
    const index = mockRefIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: value });
  },
}));
jest.mock('@/components/targets/lens-manager', () => ({ LensManager: () => null }));
jest.mock('@/lib/targets/context-controller', () => ({
  useTargetContext: () => ({ snapshot: mockSnapshot, ready: true }),
  contextController: { getSnapshot: () => ({ snapshot: mockSnapshot }), activateLens: jest.fn() },
}));

import { LensSelector } from '@/components/targets/lens-selector';

type Node = { type?: string; props?: { value?: string; disabled?: boolean; children?: unknown;
  onClick?: () => void; role?: string } };
function nodes(tree: unknown, type: string): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type));
  if (!tree || typeof tree !== 'object') return [];
  const node = tree as Node;
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
  return [...(node.type === type ? [node] : []), ...children.flatMap(child => nodes(child, type))];
}
function render() {
  mockStateIndex = 0;
  mockRefIndex = 0;
  return LensSelector({ primaryTargetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const lens = (id: string) => ({ id, name: id, createdAt: '2026-09-27', config: {} });

describe('lens selector context list', () => {
  beforeEach(() => {
    mockSnapshot = { revision: '1', activeLensId: null, secondaryTargetId: A };
    mockEffects.length = 0;
    mockState.length = 0;
    mockRefs.length = 0;
  });
  it('shows an explicit No active lens option when the confirmed pointer is null', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [lens('lens-a')] }) });
    render();
    mockEffects.pop()!();
    await tick();
    expect(nodes(render(), 'option').map(node => node.props?.children)).toContain('No active lens');
  });
  it('hides old target options immediately and shows a failed-fetch retry', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true,
      json: async () => ({ data: [lens('old-lens')] }) });
    render();
    const cleanup = mockEffects.pop()!();
    await tick();
    expect(mockState[0]).toMatchObject({ status: 'ready', targetId: A });
    expect(nodes(render(), 'option').map(node => node.props?.value)).toContain('old-lens');

    mockSnapshot = { revision: '2', activeLensId: null, secondaryTargetId: B };
    if (typeof cleanup === 'function') cleanup();
    const switching = render();
    expect(nodes(switching, 'option').map(node => node.props?.value)).not.toContain('old-lens');
    expect(nodes(switching, 'select')[0].props?.disabled).toBe(true);

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    mockEffects.pop()!();
    await tick();
    const failed = render();
    expect(nodes(failed, 'option').map(node => node.props?.value)).not.toContain('old-lens');
    expect(nodes(failed, 'select')[0].props?.disabled).toBe(true);
    expect(JSON.stringify(failed)).toContain('Lens list unavailable');

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true,
      json: async () => ({ data: [lens('new-lens')] }) });
    const retry = nodes(failed, 'button').find(node => node.props?.children === 'Retry');
    retry?.props?.onClick?.();
    await tick();
    const recovered = render();
    expect(nodes(recovered, 'option').map(node => node.props?.value)).toContain('new-lens');
    expect(nodes(recovered, 'option').map(node => node.props?.value)).not.toContain('old-lens');
  });
});
