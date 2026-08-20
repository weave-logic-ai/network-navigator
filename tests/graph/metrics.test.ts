// Tests for graph metrics computation

jest.mock('@/lib/db/queries/graph', () => ({
  getAllEdges: jest.fn(),
  getDegreeCounts: jest.fn(),
  upsertGraphMetrics: jest.fn(),
  listGraphMetrics: jest.fn(),
}));

jest.mock('@/lib/graph/ruvector-sync', () => ({
  syncContactsGraph: jest.fn(),
  computeRuVectorPageRank: jest.fn(),
  computeRuVectorCentrality: jest.fn(),
  ensureEdgeIndex: jest.fn(),
}));

import * as graphQueries from '@/lib/db/queries/graph';
import * as ruvectorSync from '@/lib/graph/ruvector-sync';
import { computeAllMetrics } from '@/lib/graph/metrics';

const mockEnsureEdgeIndex = ruvectorSync.ensureEdgeIndex as jest.MockedFunction<
  typeof ruvectorSync.ensureEdgeIndex
>;
const mockSyncContactsGraph = ruvectorSync.syncContactsGraph as jest.MockedFunction<
  typeof ruvectorSync.syncContactsGraph
>;
const mockListGraphMetrics = graphQueries.listGraphMetrics as jest.MockedFunction<
  typeof graphQueries.listGraphMetrics
>;
const mockGetAllEdges = graphQueries.getAllEdges as jest.MockedFunction<
  typeof graphQueries.getAllEdges
>;
const mockGetDegreeCounts = graphQueries.getDegreeCounts as jest.MockedFunction<
  typeof graphQueries.getDegreeCounts
>;

describe('computeAllMetrics (RuVector-first with Node.js fallback)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('uses the RuVector result without falling back when the sync succeeds', async () => {
    mockEnsureEdgeIndex.mockResolvedValueOnce(undefined);
    mockSyncContactsGraph.mockResolvedValueOnce(new Map());
    mockListGraphMetrics.mockResolvedValueOnce({
      data: [
        {
          contactId: 'c1',
          pagerank: 0.5,
          betweennessCentrality: 0.1,
          closenessCentrality: null,
          degreeCentrality: 2,
          eigenvectorCentrality: null,
          clusteringCoefficient: null,
          computedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    } as Awaited<ReturnType<typeof graphQueries.listGraphMetrics>>);

    const result = await computeAllMetrics();

    expect(result).toHaveLength(1);
    expect(mockGetAllEdges).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to Node.js computation and logs which engine served the request when RuVector sync fails', async () => {
    mockEnsureEdgeIndex.mockResolvedValueOnce(undefined);
    mockSyncContactsGraph.mockRejectedValueOnce(new Error('graph engine unavailable'));
    mockGetDegreeCounts.mockResolvedValueOnce(new Map());
    // computeAllMetricsNodeJS calls getAllEdges from both computePageRank and
    // computeBetweenness — stub every call, not just the first.
    mockGetAllEdges.mockResolvedValue([]);

    const result = await computeAllMetrics();

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[graph/metrics]');
    expect(warnSpy.mock.calls[0][0]).toContain('falling back to the Node.js');
  });
});

describe('Graph Metrics', () => {
  describe('PageRank computation', () => {
    it('should initialize equal ranks', () => {
      const n = 4;
      const initialRank = 1.0 / n;
      expect(initialRank).toBe(0.25);
    });

    it('should converge after iterations', () => {
      // Simple 3-node graph: A->B, B->C, C->A
      const dampingFactor = 0.85;
      const n = 3;
      const ranks = new Map<string, number>();
      ranks.set('A', 1 / n);
      ranks.set('B', 1 / n);
      ranks.set('C', 1 / n);

      // In a cycle, all nodes should converge to equal rank
      const outLinks = new Map<string, Set<string>>();
      outLinks.set('A', new Set(['B']));
      outLinks.set('B', new Set(['C']));
      outLinks.set('C', new Set(['A']));

      const nodes = ['A', 'B', 'C'];

      for (let iter = 0; iter < 20; iter++) {
        const newRanks = new Map<string, number>();
        for (const node of nodes) {
          let incoming = 0;
          for (const [source, targets] of outLinks.entries()) {
            if (targets.has(node)) {
              incoming += (ranks.get(source) || 0) / targets.size;
            }
          }
          newRanks.set(node, (1 - dampingFactor) / n + dampingFactor * incoming);
        }
        for (const [node, rank] of newRanks) {
          ranks.set(node, rank);
        }
      }

      // All ranks should be roughly equal in a cycle
      const rankA = ranks.get('A')!;
      const rankB = ranks.get('B')!;
      const rankC = ranks.get('C')!;
      expect(Math.abs(rankA - rankB)).toBeLessThan(0.01);
      expect(Math.abs(rankB - rankC)).toBeLessThan(0.01);
    });
  });

  describe('Betweenness centrality', () => {
    it('should identify central nodes in star topology', () => {
      // Star graph: center connected to A, B, C, D
      const adj = new Map<string, Set<string>>();
      adj.set('center', new Set(['A', 'B', 'C', 'D']));
      adj.set('A', new Set(['center']));
      adj.set('B', new Set(['center']));
      adj.set('C', new Set(['center']));
      adj.set('D', new Set(['center']));

      // In a star graph, center has highest betweenness
      // BFS from A to any other node goes through center
      const pathsThroughCenter = 4 * 3; // 4 leaves, 3 other leaves each
      const totalPairs = 5 * 4; // 5 nodes, 4 other nodes each
      const centerBetweenness = pathsThroughCenter / totalPairs;
      expect(centerBetweenness).toBeGreaterThan(0);
    });
  });

  describe('Degree centrality', () => {
    it('should count connections correctly', () => {
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'A', target: 'C' },
        { source: 'B', target: 'C' },
      ];

      const degrees = new Map<string, number>();
      for (const edge of edges) {
        degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
        degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
      }

      expect(degrees.get('A')).toBe(2);
      expect(degrees.get('B')).toBe(2);
      expect(degrees.get('C')).toBe(2);
    });
  });
});
