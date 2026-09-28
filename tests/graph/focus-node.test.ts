import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from '../../app/node_modules/typescript';

const createAndFocus = jest.fn();
const shiftFocus = jest.fn();
const source = readFileSync(join(process.cwd(), 'src/components/network/sigma-graph.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const clientModule: { exports: Record<string, unknown> } = { exports: {} };
runInNewContext(compiled, {
  module: clientModule, exports: clientModule.exports,
  require: (name: string) => name === './shift-click'
    ? { setSecondaryTargetViaShiftClick: shiftFocus }
    : name === '@/lib/targets/context-controller'
      ? { contextController: { createAndFocus } } : {},
});
const focusGraphNode = clientModule.exports.focusGraphNode as (
  node: { key: string; attributes: { kind: 'contact' | 'company' } }
) => Promise<{ ok: boolean; secondaryTargetId?: string }>;

describe('graph Focus action', () => {
  beforeEach(() => { createAndFocus.mockReset(); shiftFocus.mockReset(); });
  it('queues company creation in the shared controller', async () => {
    createAndFocus.mockResolvedValue({ secondaryTargetId: 'target-1' });
    await expect(focusGraphNode({ key: 'co-1', attributes: { kind: 'company' } }))
      .resolves.toEqual({ ok: true, secondaryTargetId: 'target-1' });
    expect(createAndFocus).toHaveBeenCalledWith('company', 'co-1');
  });
  it('uses the same controller-backed path for contacts', async () => {
    shiftFocus.mockResolvedValue({ ok: true, secondaryTargetId: 'target-2' });
    await expect(focusGraphNode({ key: 'c-1', attributes: { kind: 'contact' } }))
      .resolves.toEqual({ ok: true, secondaryTargetId: 'target-2' });
    expect(shiftFocus).toHaveBeenCalledWith('c-1');
  });
  it('leaves focus unchanged when creation fails', async () => {
    createAndFocus.mockRejectedValue(new Error('offline'));
    await expect(focusGraphNode({ key: 'co-1', attributes: { kind: 'company' } }))
      .resolves.toEqual({ ok: false });
  });
});
