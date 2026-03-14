// Tests for weight manager

import { WeightManager } from '@/lib/scoring/weight-manager';

// Mock the scoring queries
jest.mock('@/lib/db/queries/scoring', () => ({
  getDefaultWeightProfile: jest.fn().mockResolvedValue(null),
  getWeightProfileByName: jest.fn().mockResolvedValue(null),
}));

describe('WeightManager', () => {
  describe('redistributeWeights', () => {
    it('should return original weights when all dimensions available', async () => {
      const manager = new WeightManager();
      await manager.loadProfile(); // Will use fallback defaults

      const allDimensions = [
        'icp_fit', 'network_hub', 'relationship_strength', 'signal_boost',
        'skills_relevance', 'network_proximity', 'behavioral',
        'content_relevance', 'graph_centrality',
      ];

      const weights = manager.redistributeWeights(allDimensions);
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.01);
    });

    it('should redistribute weights from unavailable dimensions', async () => {
      const manager = new WeightManager();
      await manager.loadProfile();

      // Only 3 dimensions available
      const available = ['icp_fit', 'relationship_strength', 'network_proximity'];
      const weights = manager.redistributeWeights(available);

      // Unavailable dimensions should have weight 0
      expect(weights['network_hub']).toBe(0);
      expect(weights['behavioral']).toBe(0);
      expect(weights['graph_centrality']).toBe(0);

      // Available dimensions should have increased weights
      expect(weights['icp_fit']).toBeGreaterThan(0.20);

      // Total should still sum to ~1.0
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.01);
    });

    it('should handle case where no dimensions available', async () => {
      const manager = new WeightManager();
      await manager.loadProfile();

      const weights = manager.redistributeWeights([]);
      // All weights should be 0
      for (const w of Object.values(weights)) {
        expect(w).toBe(0);
      }
    });
  });
});
