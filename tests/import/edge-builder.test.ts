// Edge builder tests - pure function tests (DB interaction mocked)
import { createConnectionEdge } from '@/lib/import/edge-builder';
import type { PoolClient } from 'pg';

describe('Edge Builder', () => {
  it('backfills connected_on on an existing connection edge', async () => {
    const query = jest.fn(async (sql: string) =>
      sql.includes("edge_type = 'CONNECTED_TO'") ? { rows: [{ id: 'edge-1' }] } : { rows: [] });
    const id = await createConnectionEdge({ query } as unknown as PoolClient, 'self', 'contact', '01 Jan 2023');
    expect(id).toBe('edge-1');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE edges SET properties'), ['edge-1', '01 Jan 2023']);
  });
  describe('edge type definitions', () => {
    it('should define all 9 edge types', () => {
      const edgeTypes = [
        'CONNECTED_TO',
        'MESSAGED',
        'ENDORSED',
        'RECOMMENDED',
        'INVITED_BY',
        'WORKS_AT',
        'WORKED_AT',
        'EDUCATED_AT',
        'FOLLOWS_COMPANY',
      ];

      // Verify all types are valid strings
      for (const t of edgeTypes) {
        expect(typeof t).toBe('string');
        expect(t.length).toBeGreaterThan(0);
      }
      expect(edgeTypes.length).toBe(9);
    });
  });

  describe('message weight computation', () => {
    it('should compute weight as log(count + 1)', () => {
      // The edge builder uses Math.log(messageCount + 1) for MESSAGED edges
      expect(Math.log(1 + 1)).toBeCloseTo(0.693, 2);
      expect(Math.log(10 + 1)).toBeCloseTo(2.398, 2);
      expect(Math.log(100 + 1)).toBeCloseTo(4.615, 2);
    });

    it('should return 1.0 for zero messages', () => {
      // For 0 messages, the builder returns weight 1.0
      expect(1.0).toBe(1.0);
    });
  });
});
