const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let mockSnapshot = { revision: '1', activeLensId: null as string | null,
  secondaryTargetId: A, primaryTargetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
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
jest.mock('@/lib/targets/context-controller', () => ({
  useTargetContext: () => ({ snapshot: mockSnapshot }),
  contextController: { getSnapshot: () => ({ snapshot: mockSnapshot }),
    activateLens: jest.fn(), invalidate: jest.fn() },
}));

import { LensManager } from '@/components/targets/lens-manager';
import { contextController } from '@/lib/targets/context-controller';

type Node = { type?: string; props?: { children?: unknown; disabled?: boolean;
  onClick?: () => void; onChange?: (event: { target: { value: string } }) => void;
  'aria-label'?: string } };
function nodes(tree: unknown, type: string): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type));
  if (!tree || typeof tree !== 'object') return [];
  const node = tree as Node;
  return [...(node.type === type ? [node] : []), ...nodes(node.props?.children, type)];
}
function render(targetId: string, currentIcpProfileIds: string[] = []) {
  mockStateIndex = 0;
  mockRefIndex = 0;
  return LensManager({ primaryTargetId: targetId, open: true, onClose: () => undefined,
    currentIcpProfileIds, currentConfig: { color: 'blue' } });
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const lens = (id: string) => ({ id, name: id, createdAt: '2026-09-27', config: {} });

beforeEach(() => {
  mockSnapshot = { revision: '1', activeLensId: null, secondaryTargetId: A,
    primaryTargetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  mockEffects.length = 0;
  mockState.length = 0;
  mockRefs.length = 0;
});

it('duplicates canonical ICP IDs and saves the selected view with its ICPs', async () => {
  const original = { ...lens('source'), icpProfileIds: ['icp-a', 'icp-b'],
    config: { color: 'green', icpProfileIds: ['stale'] } };
  global.fetch = jest.fn().mockImplementation(async (_url, options?: RequestInit) => ({
    ok: true, json: async () => ({ data: options?.method ? original : [original] }),
  }));
  render(A, ['icp-a']);
  mockEffects.pop()!();
  await tick();
  const loaded = render(A, ['icp-a']);
  nodes(loaded, 'button').find(node => node.props?.['aria-label'] === 'Duplicate lens source')
    ?.props?.onClick?.();
  await tick();
  const posts = (global.fetch as jest.Mock).mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body)).toMatchObject({ name: 'source copy',
    icpProfileIds: ['icp-a', 'icp-b'], config: original.config });

  nodes(render(A, ['icp-a']), 'input')[0].props?.onChange?.({ target: { value: 'Saved' } });
  nodes(render(A, ['icp-a']), 'button').find(node => node.props?.children === 'Save as new lens')
    ?.props?.onClick?.();
  await tick();
  const allPosts = (global.fetch as jest.Mock).mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(JSON.parse(allPosts[1][1].body)).toMatchObject({ name: 'Saved',
    icpProfileIds: ['icp-a'], config: { color: 'blue' } });
});

it('clears old target actions immediately, reports failed B fetch and recovers on retry', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true,
    json: async () => ({ data: [lens('old-lens')] }) });
  render(A);
  const cleanup = mockEffects.pop()!();
  await tick();
  const atA = render(A);
  expect(nodes(atA, 'button').map(node => node.props?.['aria-label'])).toContain('Activate lens old-lens');
  const staleActivate = nodes(atA, 'button').find(node =>
    node.props?.['aria-label'] === 'Activate lens old-lens');
  nodes(atA, 'input')[0].props?.onChange?.({ target: { value: 'Saved view' } });

  mockSnapshot = { ...mockSnapshot, revision: '2', secondaryTargetId: B };
  if (typeof cleanup === 'function') cleanup();
  staleActivate?.props?.onClick?.();
  expect(contextController.activateLens).not.toHaveBeenCalled();
  const switching = render(B);
  expect(nodes(switching, 'button').map(node => node.props?.['aria-label']))
    .not.toContain('Activate lens old-lens');
  expect(nodes(switching, 'button').find(node => node.props?.children === 'Save as new lens')?.props?.disabled)
    .toBe(true);

  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  mockEffects.pop()!();
  await tick();
  const failed = render(B);
  expect(JSON.stringify(failed)).toContain('Lens list unavailable');
  expect(JSON.stringify(failed)).not.toContain('old-lens');
  expect(nodes(failed, 'button').find(node => node.props?.children === 'Save as new lens')?.props?.disabled)
    .toBe(true);

  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true,
    json: async () => ({ data: [lens('new-lens')] }) });
  nodes(failed, 'button').find(node => node.props?.children === 'Retry')?.props?.onClick?.();
  await tick();
  const recovered = render(B);
  expect(nodes(recovered, 'button').map(node => node.props?.['aria-label'])).toContain('Activate lens new-lens');
  expect(nodes(recovered, 'button').map(node => node.props?.['aria-label']))
    .not.toContain('Activate lens old-lens');
  expect(nodes(recovered, 'button').find(node => node.props?.children === 'Save as new lens')?.props?.disabled)
    .toBe(false);
  expect((global.fetch as jest.Mock).mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
