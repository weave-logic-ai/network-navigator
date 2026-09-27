jest.mock('@/lib/db/client', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('@/lib/auth/operator-session', () => ({ hasOperatorSession: jest.fn().mockResolvedValue(true) }));

import { NextRequest } from '../../app/node_modules/next/server';
import { query, transaction } from '@/lib/db/client';
import { GET } from '@/app/api/graph/knowledge/route';

const queryMock = query as jest.Mock;
const transactionMock = transaction as jest.Mock;
const NICHE_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset().mockImplementation(async (fn: (client: { query: jest.Mock }) => Promise<unknown>) =>
    fn({ query: queryMock }));
});

it('serves an uncached niche through the post-024 industry_id schema', async () => {
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('pg_advisory_xact_lock(1733164046, 1)')) return { rows: [] };
    if (sql.includes('SELECT 1 FROM niche_profiles')) {
      expect(params).toEqual([NICHE_ID]);
      return { rows: [{ '?column?': 1 }] };
    }
    if (sql.includes('FROM knowledge_snapshots')) return { rows: [] };
    if (sql.includes('FROM niche_profiles np')) {
      expect(sql).toContain('i.id = np.industry_id');
      expect(sql).toContain('i.name AS industry');
      expect(sql).not.toMatch(/SELECT\s+keywords,\s*industry\s+FROM niche_profiles/);
      expect(params).toEqual([NICHE_ID]);
      return { rows: [{ keywords: ['robotics'], industry: 'Manufacturing', industry_slug: 'manufacturing' }] };
    }
    if (sql.includes('FROM contacts c')) {
      expect(sql).toContain('co.industry ILIKE');
      expect(params).toEqual(['robotics', '%robotics%', '%Manufacturing%']);
      return { rows: [{
        id: 'contact-1', title: 'Robotics Engineer', headline: null, about: null,
        tags: ['robotics'], current_company: 'Example', company_industry: 'Manufacturing',
      }] };
    }
    if (sql.includes('INSERT INTO knowledge_snapshots')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const request = new NextRequest(`http://localhost:3750/api/graph/knowledge?nicheId=${NICHE_ID}`, {
    headers: {
      host: 'localhost:3750', origin: 'http://localhost:3750', 'sec-fetch-site': 'same-origin',
    },
  });
  const response = await GET(request);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.nodes.some((node: { label: string }) => node.label === 'robotics')).toBe(true);
  expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO knowledge_snapshots'))).toBe(true);
});

it('does not apply the General fallback as a company industry filter', async () => {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM niche_profiles np')) {
      return { rows: [{ keywords: [], industry: 'General', industry_slug: 'general' }] };
    }
    if (sql.includes('FROM contacts c')) {
      expect(sql).not.toContain('co.industry ILIKE');
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const { buildKnowledgeGraph } = await import('@/lib/graph/knowledge-local');
  expect(await buildKnowledgeGraph(NICHE_ID)).toEqual({ nodes: [], edges: [], clusters: [] });
});
