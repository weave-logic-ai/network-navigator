import { computeAllGauges } from '@/lib/ecc/gauges';
import { query } from '@/lib/db/client';

jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));
const mockQuery = query as jest.Mock;

describe('U3 gauges score join and partial response', () => {
  beforeEach(() => mockQuery.mockReset());

  it('reads composite score from contact_scores and retains successful gauges', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contacts c LEFT JOIN contact_scores cs')) {
        return { rows: [{ full_name: 'Synthetic Person', title: 'CTO', headline: null, current_company: null, email: null, phone: null, linkedin_url: null, about: null, location: null, tags: [], composite_score: 0.8, connections_count: 1 }] };
      }
      if (sql.includes('SELECT edge_type, weight, properties, created_at')) throw new Error('synthetic edge failure');
      return { rows: [{ cnt: '0' }] };
    });
    const result = await computeAllGauges('synthetic-id');
    const fieldQueries = mockQuery.mock.calls.map(([sql]) => sql as string).filter(sql => sql.includes('cs.composite_score'));
    expect(fieldQueries).toHaveLength(2);
    expect(fieldQueries.every(sql => sql.includes('LEFT JOIN contact_scores cs ON cs.contact_id = c.id'))).toBe(true);
    expect(result.errors).toEqual(['rste']);
    expect(result.data.dcte?.segments.scoring).toBe(1);
    expect(result.data.scen?.factors.dataPoints).toBeGreaterThan(0);
  });

  it('reports enrichment query failures in affected gauges', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM person_enrichments')) throw new Error('synthetic enrichment outage');
      if (sql.includes('FROM contacts c LEFT JOIN contact_scores cs')) {
        return { rows: [{ full_name: 'Synthetic Person', title: 'CTO', composite_score: 0.8 }] };
      }
      return { rows: [{ cnt: '0' }] };
    });
    const result = await computeAllGauges('synthetic-id');
    expect(result.errors).toEqual(expect.arrayContaining(['dcte', 'scen']));
    expect(result.data.dcte).toBeUndefined();
    expect(result.data.scen).toBeUndefined();
  });
});
