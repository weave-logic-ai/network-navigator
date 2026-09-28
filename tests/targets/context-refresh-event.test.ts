const effects: Array<() => void | (() => void)> = [];
let mockView: { snapshot: import('@/lib/targets/context-controller').ContextSnapshot | null;
  ready: boolean; stale: boolean; error: string | null } = {
  snapshot: null, ready: false, stale: false, error: null,
};
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => [initial, jest.fn()],
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
}));
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('lucide-react', () => ({ X: () => null, ArrowLeft: () => null }));
jest.mock('@/lib/targets/context-controller', () => ({
  useTargetContext: () => mockView,
  contextController: { focus: jest.fn(), back: jest.fn() },
}));

import { useRouter } from 'next/navigation';
import { TargetBreadcrumbs } from '@/components/targets/target-breadcrumbs';
import { contextController } from '@/lib/targets/context-controller';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mockRouter = useRouter as jest.Mock;
function findButton(tree: unknown, label: string): { props: { onClick: () => Promise<void> } } | null {
  if (!tree || typeof tree !== 'object') return null;
  const node = tree as { props?: { 'aria-label'?: string; children?: unknown; onClick?: () => Promise<void> } };
  if (node.props?.['aria-label'] === label) return node as { props: { onClick: () => Promise<void> } };
  for (const child of Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]) {
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
    mockView = { snapshot: null, ready: false, stale: false, error: null };
    refresh.mockClear();
    mockRouter.mockReturnValue({ refresh });
    global.window = new EventTarget() as unknown as Window & typeof globalThis;
  });
  afterEach(() => { global.window = nativeWindow; });
  it('refreshes server consumers for a confirmed target event', () => {
    TargetBreadcrumbs({ initialSecondaryLabel: 'A', initialSecondaryTargetId: A });
    const cleanup = effects[0]();
    window.dispatchEvent(new CustomEvent('research-target-changed', { detail: { revision: '1' } }));
    expect(refresh).toHaveBeenCalledTimes(1);
    if (typeof cleanup === 'function') cleanup();
  });
  it('keeps an id-only focused target visible', () => {
    const tree = TargetBreadcrumbs({ initialSecondaryTargetId: A });
    expect(findButton(tree, 'Clear secondary target Target aaaaaaaa')).not.toBeNull();
  });
  it('sends clear to the shared controller', async () => {
    (contextController.focus as jest.Mock).mockResolvedValueOnce({ secondaryTargetId: null });
    const tree = TargetBreadcrumbs({ initialSecondaryLabel: 'A', initialSecondaryTargetId: A });
    await findButton(tree, 'Clear secondary target A')!.props.onClick();
    expect(contextController.focus).toHaveBeenCalledWith(null);
  });
  it('shows usable Back at Self when Clear left server history', async () => {
    mockView = { ready: true, stale: false, error: null, snapshot: {
      revision: '4', primaryTargetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      primaryLabel: 'Self', secondaryTargetId: null,
      focusLabel: null, activeLensId: null, activeLensLabel: null, warning: null,
      canGoBack: true, history: [{ targetId: A, targetLabel: 'A', lensId: null,
        lensLabel: null, lensUnavailable: false, openedAt: new Date().toISOString() }],
    } };
    (contextController.back as jest.Mock).mockResolvedValueOnce({ secondaryTargetId: A });
    const tree = TargetBreadcrumbs({});
    expect(findButton(tree, 'Clear secondary target A')).toBeNull();
    await findButton(tree, 'Back to prior target')!.props.onClick();
    expect(contextController.back).toHaveBeenCalledTimes(1);
  });
  it('keeps the confirmed focused target usable when its label is unavailable', () => {
    mockView = { ready: true, stale: false, error: null, snapshot: {
      revision: '5', primaryTargetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      primaryLabel: 'Self', secondaryTargetId: A, focusLabel: null,
      activeLensId: null, activeLensLabel: null, warning: null,
      canGoBack: true, history: [{ targetId: A, targetLabel: null, lensId: null,
        lensLabel: null, lensUnavailable: false, openedAt: new Date().toISOString() }],
    } };
    const tree = TargetBreadcrumbs({});
    expect(findButton(tree, 'Clear secondary target Target aaaaaaaa')).not.toBeNull();
    expect(findButton(tree, 'Back to prior target')).not.toBeNull();
  });
  it('does not resurrect old server props after an auth reset', () => {
    mockView = { snapshot: null, ready: true, stale: true, error: null };
    const tree = TargetBreadcrumbs({ initialPrimaryLabel: 'Old account',
      initialSecondaryLabel: 'Old target', initialSecondaryTargetId: A });
    expect(findButton(tree, 'Clear secondary target Old target')).toBeNull();
    expect(JSON.stringify(tree)).not.toContain('Old target');
    expect(JSON.stringify(tree)).not.toContain('Old account');
  });
});
