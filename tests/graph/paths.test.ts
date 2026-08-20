// Tests for path finding

jest.mock('@/lib/db/queries/graph', () => ({
  getAllEdges: jest.fn(),
}));

jest.mock('@/lib/graph/ruvector-sync', () => ({
  GRAPH_NAME: 'contacts',
  ensureNodeContactIdIndex: jest.fn().mockResolvedValue(undefined),
  getNodeIdForContact: jest.fn(),
  getContactIdsForNodes: jest.fn(),
  getEdgesByIds: jest.fn(),
  computeRuVectorShortestPath: jest.fn(),
  computeRuVectorPersonalizedPageRank: jest.fn(),
}));

import * as graphQueries from '@/lib/db/queries/graph';
import * as ruvectorSync from '@/lib/graph/ruvector-sync';
import { findPath, rankByRelevance } from '@/lib/graph/paths';

const mockGetAllEdges = graphQueries.getAllEdges as jest.MockedFunction<
  typeof graphQueries.getAllEdges
>;
const mockGetNodeIdForContact = ruvectorSync.getNodeIdForContact as jest.MockedFunction<
  typeof ruvectorSync.getNodeIdForContact
>;
const mockGetContactIdsForNodes = ruvectorSync.getContactIdsForNodes as jest.MockedFunction<
  typeof ruvectorSync.getContactIdsForNodes
>;
const mockGetEdgesByIds = ruvectorSync.getEdgesByIds as jest.MockedFunction<
  typeof ruvectorSync.getEdgesByIds
>;
const mockShortestPath = ruvectorSync.computeRuVectorShortestPath as jest.MockedFunction<
  typeof ruvectorSync.computeRuVectorShortestPath
>;
const mockPersonalizedPageRank =
  ruvectorSync.computeRuVectorPersonalizedPageRank as jest.MockedFunction<
    typeof ruvectorSync.computeRuVectorPersonalizedPageRank
  >;

function fakeEdge(overrides: Partial<import('@/lib/graph/types').GraphEdge>) {
  return {
    id: 'edge-id',
    sourceContactId: 'A',
    targetContactId: 'B',
    targetCompanyId: null,
    edgeType: 'CONNECTED_TO',
    weight: 1,
    properties: {},
    ...overrides,
  };
}

describe('findPath (RuVector-first with Node.js BFS fallback)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('uses RuVector and resolves node/edge ids back to contact ids without touching BFS', async () => {
    mockGetNodeIdForContact.mockResolvedValueOnce(1).mockResolvedValueOnce(3);
    mockShortestPath.mockResolvedValueOnce({
      nodes: [1, 2, 3],
      edges: [10, 20],
      length: 3,
      cost: 0,
    });
    mockGetContactIdsForNodes.mockResolvedValueOnce(
      new Map([
        [1, 'contact-a'],
        [2, 'contact-b'],
        [3, 'contact-c'],
      ])
    );
    mockGetEdgesByIds.mockResolvedValueOnce([
      { id: 10, source: 1, target: 2, edgeType: 'CONNECTED_TO', properties: { weight: 2 } },
      { id: 20, source: 2, target: 3, edgeType: 'MESSAGED', properties: { weight: 1 } },
    ]);

    const result = await findPath('contact-a', 'contact-c', 4);

    expect(result).toEqual({
      path: ['contact-a', 'contact-b', 'contact-c'],
      length: 2,
      edges: [
        { from: 'contact-a', to: 'contact-b', edgeType: 'CONNECTED_TO', weight: 2 },
        { from: 'contact-b', to: 'contact-c', edgeType: 'MESSAGED', weight: 1 },
      ],
    });
    expect(mockGetAllEdges).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats a RuVector "no path" result as authoritative and does not fall back to BFS', async () => {
    mockGetNodeIdForContact.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    mockShortestPath.mockResolvedValueOnce(null);

    const result = await findPath('contact-a', 'contact-z', 4);

    expect(result).toBeNull();
    expect(mockGetAllEdges).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to Node.js BFS and logs which engine served the request when RuVector cannot resolve a node', async () => {
    mockGetNodeIdForContact.mockResolvedValueOnce(null).mockResolvedValueOnce(2);
    mockGetAllEdges.mockResolvedValueOnce([
      fakeEdge({ sourceContactId: 'contact-a', targetContactId: 'contact-b', edgeType: 'CONNECTED_TO' }),
    ]);

    const result = await findPath('contact-a', 'contact-b', 4);

    expect(result).toEqual({
      path: ['contact-a', 'contact-b'],
      length: 1,
      edges: [{ from: 'contact-a', to: 'contact-b', edgeType: 'CONNECTED_TO', weight: 1 }],
    });
    expect(mockGetAllEdges).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[graph/paths]');
    expect(warnSpy.mock.calls[0][0]).toContain('falling back to Node.js BFS');
  });
});

describe('rankByRelevance (personalized PageRank)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('ranks by RuVector personalized PageRank score, excluding the source contact', async () => {
    mockGetAllEdges.mockResolvedValueOnce([
      fakeEdge({ sourceContactId: 'A', targetContactId: 'B' }),
      fakeEdge({ sourceContactId: 'A', targetContactId: 'C' }),
    ]);
    mockPersonalizedPageRank.mockResolvedValueOnce([
      { node: 0, rank: 0.6 }, // A (source) — must be excluded
      { node: 1, rank: 0.25 }, // B
      { node: 2, rank: 0.15 }, // C
    ]);

    const result = await rankByRelevance('A', { limit: 10 });

    expect(result).toEqual([
      { id: 'B', score: 0.25 },
      { id: 'C', score: 0.15 },
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to Node.js power-iteration PPR and logs it when RuVector fails', async () => {
    mockGetAllEdges.mockResolvedValueOnce([
      fakeEdge({ sourceContactId: 'A', targetContactId: 'B' }),
      fakeEdge({ sourceContactId: 'B', targetContactId: 'C' }),
    ]);
    mockPersonalizedPageRank.mockRejectedValueOnce(new Error('connection refused'));

    const result = await rankByRelevance('A', { limit: 10 });

    // A -> B -> C: B is a direct neighbor of the source and should outrank
    // C, which is two hops away.
    expect(result.map((r) => r.id)).toEqual(['B', 'C']);
    expect(result.find((r) => r.id === 'A')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[graph/paths]');
    expect(warnSpy.mock.calls[0][0]).toContain('falling back to Node.js power-iteration');
  });

  it('returns an empty array when the source contact has no edges', async () => {
    mockGetAllEdges.mockResolvedValueOnce([
      fakeEdge({ sourceContactId: 'B', targetContactId: 'C' }),
    ]);

    const result = await rankByRelevance('A', { limit: 10 });

    expect(result).toEqual([]);
    expect(mockPersonalizedPageRank).not.toHaveBeenCalled();
  });
});

describe('Path Finding', () => {
  describe('BFS path finding', () => {
    it('should find direct path', () => {
      const adj = new Map<string, string[]>();
      adj.set('A', ['B']);
      adj.set('B', ['A', 'C']);
      adj.set('C', ['B']);

      // BFS from A to C
      const visited = new Set<string>(['A']);
      const parent = new Map<string, string>();
      const queue: string[] = ['A'];
      let found = false;

      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node === 'C') {
          found = true;
          break;
        }
        for (const neighbor of adj.get(node) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            parent.set(neighbor, node);
            queue.push(neighbor);
          }
        }
      }

      expect(found).toBe(true);

      // Reconstruct path
      const path: string[] = [];
      let current = 'C';
      while (current !== 'A') {
        path.unshift(current);
        current = parent.get(current)!;
      }
      path.unshift('A');

      expect(path).toEqual(['A', 'B', 'C']);
    });

    it('should return null when no path exists', () => {
      const adj = new Map<string, string[]>();
      adj.set('A', ['B']);
      adj.set('B', ['A']);
      adj.set('C', ['D']);
      adj.set('D', ['C']);

      // BFS from A, C is in disconnected component
      const visited = new Set<string>(['A']);
      const queue: string[] = ['A'];
      let found = false;

      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node === 'C') {
          found = true;
          break;
        }
        for (const neighbor of adj.get(node) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      expect(found).toBe(false);
    });

    it('should respect max depth', () => {
      const adj = new Map<string, string[]>();
      adj.set('A', ['B']);
      adj.set('B', ['A', 'C']);
      adj.set('C', ['B', 'D']);
      adj.set('D', ['C', 'E']);
      adj.set('E', ['D']);

      // BFS from A to E with max depth 2 should not find it
      const maxDepth = 2;
      const visited = new Set<string>(['A']);
      const queue: Array<{ node: string; depth: number }> = [{ node: 'A', depth: 0 }];
      let found = false;

      while (queue.length > 0) {
        const { node, depth } = queue.shift()!;
        if (node === 'E') {
          found = true;
          break;
        }
        if (depth >= maxDepth) continue;
        for (const neighbor of adj.get(node) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ node: neighbor, depth: depth + 1 });
          }
        }
      }

      expect(found).toBe(false);
    });
  });

  describe('reachability', () => {
    it('should find all reachable nodes within hops', () => {
      const adj = new Map<string, Set<string>>();
      adj.set('A', new Set(['B', 'C']));
      adj.set('B', new Set(['A', 'D']));
      adj.set('C', new Set(['A']));
      adj.set('D', new Set(['B']));

      const visited = new Map<string, number>();
      visited.set('A', 0);
      const queue: Array<{ node: string; dist: number }> = [{ node: 'A', dist: 0 }];
      const maxHops = 1;

      while (queue.length > 0) {
        const { node, dist } = queue.shift()!;
        if (dist >= maxHops) continue;
        for (const neighbor of adj.get(node) || new Set()) {
          if (!visited.has(neighbor)) {
            visited.set(neighbor, dist + 1);
            queue.push({ node: neighbor, dist: dist + 1 });
          }
        }
      }

      visited.delete('A');
      expect(visited.size).toBe(2); // B and C at distance 1
      expect(visited.get('B')).toBe(1);
      expect(visited.get('C')).toBe(1);
    });
  });
});
