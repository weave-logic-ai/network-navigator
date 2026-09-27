import type { NextRequest } from 'next/server';
import { buildContactsUrl } from '@/lib/api/contacts';
import { GET } from '@/app/api/contacts/route';
import { listContacts } from '@/lib/db/queries/contacts';
import { query } from '@/lib/db/client';

jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));
jest.mock('@/lib/auth/local-request-boundary', () => ({ requireLocalDashboardRequest: jest.fn().mockResolvedValue(null) }));

const mockQuery = query as jest.MockedFunction<typeof query>;
const request = (url: string) => ({ url }) as NextRequest;

describe('Contacts list contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes a selected campaign from the table URL into the scoped stage query', async () => {
    const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    const response = await GET(request(`http://localhost${buildContactsUrl({ campaignId })}`));
    expect(response.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toContain('member.campaign_id = $1');
    expect(mockQuery.mock.calls[0][1]).toEqual([campaignId]);
    expect(mockQuery.mock.calls[1][0]).toContain('AND campaign_id = $2');
    expect(mockQuery.mock.calls[1][1]).toEqual([campaignId, campaignId, 20, 0]);
  });

  it('sends the table sort and filter names through the route to the query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    const url = buildContactsUrl({ sortBy: 'referralTier', sortOrder: 'asc', enrichmentStatus: 'has_data', tier: 'gold', search: 'Ada' });
    const response = await GET(request(`http://localhost${url}`));
    expect(response.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toContain('cs.tier = $1');
    expect(mockQuery.mock.calls[0][0]).toContain('EXISTS (\n  SELECT 1 FROM person_enrichments');
    expect(mockQuery.mock.calls[0][1]).toEqual(['gold', '%Ada%']);
    expect(mockQuery.mock.calls[1][0]).toContain('ORDER BY CASE cs.referral_tier');
    expect(mockQuery.mock.calls[1][0]).toContain('WHEN \'gold-referral\' THEN 4');
  });

  it('sorts every exposed table key by a selected SQL expression', async () => {
    for (const key of ['fullName', 'compositeScore', 'tier', 'referralTier']) {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);
      await listContacts({ sort: key });
      const sql = mockQuery.mock.calls.at(-1)?.[0];
      expect(sql).toMatch(/ORDER BY (?!c\.created_at)/);
    }
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'uses the safe created_at fallback for inherited sort key %s',
    async (sort) => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);
      const response = await GET(request(`http://localhost/api/contacts?${new URLSearchParams({ sort_by: sort })}`));
      expect(response.status).toBe(200);
      expect(mockQuery.mock.calls[1][0]).toContain('ORDER BY c.created_at DESC NULLS LAST');
    }
  );

  it('projects lookup data without claiming it was applied or is pending', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    await listContacts({ enrichmentStatus: 'no_data' });
    const [count, data] = mockQuery.mock.calls.map((call) => call[0]);
    expect(count).toContain('NOT (EXISTS (\n  SELECT 1 FROM person_enrichments');
    expect(count).toContain('COALESCE(cardinality(pe.enriched_fields), 0) > 0');
    expect(count).toContain('FROM enrichment_transactions et');
    expect(count).toContain("et.status = 'success'");
    expect(count).toContain('COALESCE(cardinality(et.fields_returned), 0) > 0');
    expect(count).not.toContain('c.updated_at >= et.created_at');
    expect(data).toContain('COALESCE(cardinality(pe.enriched_fields), 0) > 0');
    expect(data).toContain('FROM enrichment_transactions et');
    expect(data).toContain('cs.referral_tier');
    expect(data).toContain('os.state AS outreach_state');
    expect(data).toContain('presentation.pipeline_stage AS outreach_stage');
    expect(data).toContain('ORDER BY event_order DESC LIMIT 1');
    expect(data).toContain('MAX(oe.event_order)');
    expect(data).not.toContain('MAX(oe.created_at)');
  });

  it('searches the first and last name used by the table fallback', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    await listContacts({ search: 'Nora Vale' });
    const countSql = mockQuery.mock.calls[0][0];
    expect(countSql).toContain('c.first_name ILIKE $1');
    expect(countSql).toContain('c.last_name ILIKE $1');
    expect(countSql).toContain("TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) ILIKE $1");
    expect(mockQuery.mock.calls[0][1]).toEqual(['%Nora Vale%']);
  });

  it('rejects unsupported enrichment values and preserves legacy dashboard score sorting', async () => {
    const invalid = await GET(request('http://localhost/api/contacts?enrichment_status=failed'));
    expect(invalid.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    await GET(request('http://localhost/api/contacts?sort=score&order=desc'));
    expect(mockQuery.mock.calls[1][0]).toContain('ORDER BY cs.composite_score DESC NULLS LAST');
  });
});
