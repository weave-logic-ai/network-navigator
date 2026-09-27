import type { PoolClient } from 'pg';
import { detectCommunitiesInTransaction, reconcileCommunityIds } from '@/lib/graph/communities';
import * as communities from '@/lib/graph/communities';
import * as graph from '@/lib/graph';

describe('community continuity', () => {
  it('has no standalone community publication entry point', () => {
    expect(communities).not.toHaveProperty('detectCommunities');
    expect(graph).not.toHaveProperty('detectCommunities');
  });

  it('retains an ID for substantial same-method overlap and rejects unrelated fragments', () => {
    expect(reconcileCommunityIds(
      [{ id: 'old', algorithm: 'spectral-ruvector', members: ['a', 'b', 'c', 'd'] }],
      [
        { algorithm: 'spectral-ruvector', members: ['a', 'b', 'c', 'e'] },
        { algorithm: 'spectral-ruvector', members: ['d', 'f'] },
        { algorithm: 'company-grouping', members: ['a', 'b', 'c', 'd'] },
      ]
    )).toEqual(['old', null, null]);
  });

  it('publishes a changed spectral group atomically while leaving stored attribute groups alone', async () => {
    const contacts = Array.from({ length: 11 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`);
    const oldId = '11111111-1111-4111-8111-111111111111';
    const clientQuery = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM edges')) return Promise.resolve({ rows: contacts.slice(1).map((id) => ({ source_contact_id: contacts[0], target_contact_id: id, weight: 1 })) });
      if (sql.includes('ruvector_spectral_cluster')) return Promise.resolve({ rows: [{ ruvector_spectral_cluster: contacts.map(() => 0) }] });
      if (sql.includes('COALESCE(c.current_company')) return Promise.resolve({ rows: [{ label: 'Acme' }] });
      if (sql.includes('SELECT cl.id')) return { rows: [
        ...contacts.slice(0, 10).map((id) => ({ id: oldId, algorithm: 'spectral-ruvector', contact_id: id })),
      ] };
      if (sql.includes('RETURNING id')) return { rows: [{ id: (params?.[0] as string) ?? 'new-id' }] };
      if (sql.includes('pg_advisory') || sql.includes('SAVEPOINT') || sql.includes('DELETE FROM clusters') || sql.includes('INSERT INTO cluster_memberships')) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const groups = (await detectCommunitiesInTransaction({ query: clientQuery } as unknown as PoolClient)).communities;
    expect(groups[0].clusterId).toBe(oldId);
    expect(groups[0].members).toHaveLength(11);
    expect(clientQuery.mock.calls.find((call) => String(call[0]).includes('DELETE FROM clusters'))?.[0])
      .toContain("algorithm = 'spectral-ruvector'");
    expect(clientQuery.mock.calls.find((call) => String(call[0]).includes('DELETE FROM clusters'))?.[0])
      .not.toContain('company-grouping');
    expect(clientQuery.mock.calls.some((call) => String(call[0]).includes('DELETE FROM cluster_memberships'))).toBe(false);
  });

  it('removes stale spectral groups but retains stored groups when sparse topology falls back', async () => {
    const clientQuery = jest.fn(async (sql: string) => {
      if (sql.includes('FROM edges')) return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT cl.id')) return Promise.resolve({ rows: [] });
      if (sql.includes('GROUP BY co.id, co.name')) return Promise.resolve({ rows: [{ company_id: 'company-1', company_name: 'Acme', industry: null, contact_ids: ['c1', 'c2'] }] });
      if (sql.includes('GROUP BY lower(trim(co.industry))')) return Promise.resolve({ rows: [] });
      if (sql.includes('pg_advisory') || sql.includes('DELETE FROM clusters')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const groups = (await detectCommunitiesInTransaction({ query: clientQuery } as unknown as PoolClient)).communities;
    expect(groups).toMatchObject([{ clusterId: 'company:company-1', memberCount: 2 }]);
    expect(clientQuery.mock.calls.find((call) => String(call[0]).includes('DELETE FROM clusters'))?.[0])
      .toContain("algorithm = 'spectral-ruvector'");
  });

  it('rejects partial spectral assignments before publishing incomplete memberships', async () => {
    const contacts = Array.from({ length: 11 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`);
    const clientQuery = jest.fn(async (sql: string) => {
      if (sql.includes('FROM edges')) return { rows: contacts.slice(1).map((id) => ({ source_contact_id: contacts[0], target_contact_id: id, weight: 1 })) };
      if (sql.includes('ruvector_spectral_cluster')) return { rows: [{ ruvector_spectral_cluster: [0, 0] }] };
      if (sql.includes('SELECT cl.id') || sql.includes('GROUP BY co.id, co.name') || sql.includes('GROUP BY lower(trim(co.industry))')) return { rows: [] };
      if (sql.includes('pg_advisory') || sql.includes('SAVEPOINT') || sql.includes('DELETE FROM clusters')) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    expect((await detectCommunitiesInTransaction({ query: clientQuery } as unknown as PoolClient)).communities).toEqual([]);
    expect(clientQuery.mock.calls.some((call) => String(call[0]).includes('INSERT INTO cluster_memberships'))).toBe(false);
    expect(clientQuery.mock.calls.some((call) => String(call[0]).includes('DELETE FROM clusters'))).toBe(true);
  });
});
