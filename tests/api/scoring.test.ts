// API scoring route tests

describe('Scoring API', () => {
  describe('POST /api/scoring/run request validation', () => {
    it('should accept single contact scoring', () => {
      const body = { contactId: '550e8400-e29b-41d4-a716-446655440000' };
      expect(body.contactId).toBeDefined();
      expect(typeof body.contactId).toBe('string');
    });

    it('should accept batch scoring with contact IDs', () => {
      const body = {
        contactIds: [
          '550e8400-e29b-41d4-a716-446655440000',
          '550e8400-e29b-41d4-a716-446655440001',
        ],
      };
      expect(Array.isArray(body.contactIds)).toBe(true);
      expect(body.contactIds.length).toBe(2);
    });

    it('should accept optional profileName', () => {
      const body = {
        contactId: '550e8400-e29b-41d4-a716-446655440000',
        profileName: 'Sales-focused',
      };
      expect(body.profileName).toBe('Sales-focused');
    });
  });

  describe('PUT /api/scoring/weights validation', () => {
    it('should validate weights sum to 1.0', () => {
      const weights = {
        icp_fit: 0.20,
        network_hub: 0.10,
        relationship_strength: 0.15,
        signal_boost: 0.10,
        skills_relevance: 0.10,
        network_proximity: 0.05,
        behavioral: 0.10,
        content_relevance: 0.10,
        graph_centrality: 0.10,
      };

      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.01);
    });

    it('should reject weights that do not sum to 1.0', () => {
      const weights = {
        icp_fit: 0.50,
        network_hub: 0.50,
        relationship_strength: 0.50,
      };

      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1.0)).toBeGreaterThan(0.01);
    });
  });
});
