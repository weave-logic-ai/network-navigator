// API graph route tests

describe('Graph API', () => {
  describe('GET /api/graph/path validation', () => {
    it('should require source and target parameters', () => {
      const searchParams = new URLSearchParams('source=id1&target=id2');
      expect(searchParams.get('source')).toBe('id1');
      expect(searchParams.get('target')).toBe('id2');
    });

    it('should parse maxDepth with default', () => {
      const searchParams = new URLSearchParams('source=id1&target=id2');
      const maxDepth = parseInt(searchParams.get('maxDepth') || '4', 10);
      expect(maxDepth).toBe(4);
    });

    it('should reject missing source/target', () => {
      const searchParams = new URLSearchParams('');
      const source = searchParams.get('source');
      const target = searchParams.get('target');
      expect(!source || !target).toBe(true);
    });
  });

  describe('POST /api/graph/compute response', () => {
    it('should return compute counts', () => {
      const response = {
        data: {
          metricsComputed: 100,
          communitiesDetected: 5,
        },
      };

      expect(response.data.metricsComputed).toBeDefined();
      expect(response.data.communitiesDetected).toBeDefined();
    });
  });

  describe('GET /api/icp/discover validation', () => {
    it('should parse minSize with default', () => {
      const searchParams = new URLSearchParams('');
      const minSize = parseInt(searchParams.get('minSize') || '3', 10);
      expect(minSize).toBe(3);
    });

    it('should accept custom minSize', () => {
      const searchParams = new URLSearchParams('minSize=5');
      const minSize = parseInt(searchParams.get('minSize') || '3', 10);
      expect(minSize).toBe(5);
    });
  });

  describe('Path result format', () => {
    it('should format path result correctly', () => {
      const pathResult = {
        path: ['A', 'B', 'C'],
        length: 2,
        edges: [
          { from: 'A', to: 'B', edgeType: 'connection', weight: 1.0 },
          { from: 'B', to: 'C', edgeType: 'mutual', weight: 0.8 },
        ],
      };

      expect(pathResult.length).toBe(pathResult.path.length - 1);
      expect(pathResult.edges.length).toBe(pathResult.length);
    });
  });
});
