import { matchesRole, IcpFitScorer } from '@/lib/scoring/scorers/icp-fit';
import { GET } from '@/app/api/contacts/[id]/icp-breakdown/route';
import { query } from '@/lib/db/client';
import type { NextRequest } from 'next/server';

jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}), { virtual: true });

const mockQuery = query as jest.Mock;

describe('U3 whole-role matching', () => {
  beforeEach(() => mockQuery.mockReset());

  it.each([
    ['CTO', true],
    ['Co-Founder & CTO', true],
    ['Chief Technology Officer (CTO)', true],
    ['Chief Technology Officer', true],
    ['Creative Director', false],
    ['Director of Operations', false],
    ['CTOship', false],
    ['', false],
  ])('%s matches CTO: %s', (title, expected) => {
    expect(matchesRole(title, 'CTO')).toBe(expected);
  });

  it('matches Natural ICP group criteria against their source roles', () => {
    expect(matchesRole('CTO', 'CTO/Tech Leader')).toBe(true);
    expect(matchesRole('Chief Technology Officer', 'CTO/Tech Leader')).toBe(true);
    expect(matchesRole('Founder', 'CEO/Founder')).toBe(true);
    expect(matchesRole('Creative Director', 'CTO/Tech Leader')).toBe(false);
  });

  it('uses the same decision in scoring and explanation', async () => {
    for (const title of ['CTO', 'Creative Director']) {
      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'contact-1', title, headline: null, about: null, current_company: null, connections_count: null, tags: [], location: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'icp-1', name: 'Tech leaders', niche_id: null, criteria: { roles: ['CTO'] } }] });
      const request = { url: 'http://localhost/api/contacts/contact-1/icp-breakdown?icpId=icp-1' } as NextRequest;
      const response = await GET(request, { params: Promise.resolve({ id: 'contact-1' }) });
      const body = await response.json();
      const expected = title === 'CTO';
      expect(response.status).toBe(200);
      expect(body.data.criteria[0].matched).toBe(expected);
      expect(body.data.overallFit).toBe(expected ? 1 : 0);
      expect(new IcpFitScorer().score({ title } as Parameters<IcpFitScorer['score']>[0], { roles: ['CTO'] })).toBe(expected ? 1 : 0);
    }
  });
});
