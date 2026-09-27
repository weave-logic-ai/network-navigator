const effects: Array<() => void | (() => void)> = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => [initial, jest.fn()],
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => ({ current: initial }),
}));
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('lucide-react', () => ({ X: () => null, ArrowLeft: () => null }));

import { useRouter } from 'next/navigation';
import { TargetBreadcrumbs } from '@/components/targets/target-breadcrumbs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mockRouter = useRouter as jest.Mock;

function findButton(tree: unknown, label: string): { props: { onClick: () => Promise<void> } } | null {
  if (!tree || typeof tree !== 'object') return null;
  const node = tree as { props?: { 'aria-label'?: string; children?: unknown; onClick?: () => Promise<void> } };
  if (node.props?.['aria-label'] === label) return node as { props: { onClick: () => Promise<void> } };
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

describe('context refresh event', () => {
  const refresh = jest.fn();
  const nativeWindow = global.window;

  beforeEach(() => {
    effects.length = 0;
    refresh.mockClear();
    mockRouter.mockReturnValue({ refresh });
    global.window = new EventTarget() as unknown as Window & typeof globalThis;
  });

  afterEach(() => { global.window = nativeWindow; });

  it('refreshes server consumers for a confirmed target event', () => {
    TargetBreadcrumbs({ initialSecondaryLabel: 'A', initialSecondaryTargetId: A });
    const cleanup = effects[0]();
    window.dispatchEvent(new CustomEvent('research-target-changed', {
      detail: { secondaryTargetId: A, secondaryTargetLabel: 'A' },
    }));
    expect(refresh).toHaveBeenCalledTimes(1);
    if (typeof cleanup === 'function') cleanup();
  });

  it('keeps an id-only focused target visible when the label is unavailable', () => {
    const tree = TargetBreadcrumbs({ initialSecondaryTargetId: A });
    expect(findButton(tree, 'Clear secondary target Target aaaaaaaa')).not.toBeNull();
  });

  it('keeps the last good context when clear fails or returns a mismatched state', async () => {
    const tree = TargetBreadcrumbs({ initialSecondaryLabel: 'A', initialSecondaryTargetId: A });
    const cleanup = effects[0]();
    const clear = findButton(tree, 'Clear secondary target A');
    expect(clear).not.toBeNull();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { secondaryTargetId: A } }) });
    global.fetch = fetchMock;
    await clear!.props.onClick();
    await clear!.props.onClick();
    expect(refresh).not.toHaveBeenCalled();
    if (typeof cleanup === 'function') cleanup();
  });
});
