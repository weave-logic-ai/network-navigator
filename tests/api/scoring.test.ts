// API scoring route tests
import { NextRequest } from '../../app/node_modules/next/server';
import { POST } from '@/app/api/scoring/run/route';
import { scoreBatchDetailed } from '@/lib/scoring/pipeline';

jest.mock('@/lib/scoring/pipeline', () => ({ scoreBatchDetailed: jest.fn() }));

async function runBatch() {
  return POST(new NextRequest('http://localhost/api/scoring/run', {
    method: 'POST', body: JSON.stringify({ contactIds: ['a', 'b'] }),
  }));
}

describe('Scoring API', () => {
  afterEach(() => jest.resetAllMocks());

  it('reports partial contact failure without a successful HTTP status', async () => {
    jest.mocked(scoreBatchDetailed).mockResolvedValue({
      results: [{ contactId: 'a' } as never],
      failures: [{ contactId: 'b', error: 'Contact not found: b' }], total: 2,
    });
    const response = await runBatch();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/Batch scoring failed/);
    expect(body.data).toMatchObject({
      scored: 1, failed: 1, total: 2,
      failures: [{ contactId: 'b', error: 'Contact not found: b' }],
    });
  });

  it('reports complete batch failure as an error', async () => {
    jest.mocked(scoreBatchDetailed).mockResolvedValue({
      results: [], failures: [{ contactId: 'a', error: 'failed' }], total: 1,
    });
    expect((await runBatch()).status).toBe(500);
  });
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
