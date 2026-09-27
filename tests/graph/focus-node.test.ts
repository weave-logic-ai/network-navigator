import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from '../../app/node_modules/typescript';

// Jest's shared tsconfig preserves JSX. Compile this client component with
// React JSX for this focused node action test without changing app config.
const source = readFileSync(join(process.cwd(), 'src/components/network/sigma-graph.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const clientModule: { exports: Record<string, unknown> } = { exports: {} };
runInNewContext(compiled, {
  module: clientModule,
  exports: clientModule.exports,
  require: (name: string) => name === './shift-click'
    ? jest.requireActual('@/components/network/shift-click')
    : {},
});
const focusGraphNode = clientModule.exports.focusGraphNode as (
  node: ReturnType<typeof node>,
  fetchImpl: typeof fetch
) => Promise<{ ok: boolean; secondaryTargetId?: string }>;

function node(key: string, kind: 'contact' | 'company') {
  return {
    key,
    attributes: {
      label: kind === 'company' ? 'Acme' : 'Alice',
      x: 0,
      y: 0,
      size: 10,
      color: '#000',
      tier: 'unscored',
      company: null,
      title: null,
      pagerank: 0,
      score: 0,
      degree: 0,
      clusterId: null,
      kind,
    },
  };
}

describe('graph Focus action', () => {
  it.each([
    ['contact', 'c1'],
    ['company', 'co-1'],
  ] as const)('sets %s as secondary without sending a primary update', async (kind, id) => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fakeFetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url === '/api/targets') {
        return { ok: true, json: async () => ({ data: { id: 'target-1' } }) } as Response;
      }
      return { ok: true } as Response;
    }) as unknown as typeof fetch;

    const result = await focusGraphNode(node(id, kind), fakeFetch);

    expect(result).toEqual({ ok: true, secondaryTargetId: 'target-1' });
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('/api/targets');
    expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ kind, id });
    expect(calls[1][0]).toBe('/api/targets/state');
    expect(JSON.parse(calls[1][1]!.body as string)).toEqual({ secondaryTargetId: 'target-1' });
  });

  it('does not report focus success when the state write fails', async () => {
    const fakeFetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'target-1' } }) })
      .mockResolvedValueOnce({ ok: false }) as unknown as typeof fetch;
    await expect(focusGraphNode(node('co-1', 'company'), fakeFetch)).resolves.toEqual({
      ok: false,
      secondaryTargetId: 'target-1',
    });
  });
});
