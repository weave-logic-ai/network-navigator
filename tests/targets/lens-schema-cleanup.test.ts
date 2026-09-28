// WS-4 polish — migration 045 (lens schema cleanup) + lens-service rewire.
//
// Two concerns:
//
//   1. Migration 045 must add `lens_id` on `research_target_icps` and
//      `last_used_lens_id` on `research_target_state`, both idempotent
//      (ADD COLUMN IF NOT EXISTS), with indexes on both FKs, and a
//      backfill that respects existing is_default lenses.
//
//   2. The lens-service read path must now prefer
//      `research_target_state.last_used_lens_id` over the `is_default`
//      hint, with safe fall-through when the pointer is stale.

import fs from 'fs';
import path from 'path';
jest.mock('@/lib/auth/local-request-boundary', () => ({
  requireLocalDashboardRequest: jest.fn().mockResolvedValue(null),
}));

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../data/db/init/046-lens-schema-cleanup.sql'
);
const CANONICAL_MIGRATION_PATH = path.resolve(
  __dirname,
  '../../data/db/init/053-lens-icp-canonical.sql'
);

describe('migration 053 — canonical lens ICP associations', () => {
  const sql = fs.readFileSync(CANONICAL_MIGRATION_PATH, 'utf8');

  it('allows the same ICP on two lenses while keeping one unscoped legacy row', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS research_target_icps_pkey/);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_research_target_icps_scoped\s+ON research_target_icps\(target_id, lens_id, icp_profile_id\)\s+WHERE lens_id IS NOT NULL/);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_research_target_icps_unscoped\s+ON research_target_icps\(target_id, icp_profile_id\)\s+WHERE lens_id IS NULL/);
  });

  it('restores legacy rows before copying only explicit config associations', () => {
    expect(sql).toMatch(/conname = 'research_target_icps_pkey'/);
    expect(sql).toMatch(/UPDATE research_target_icps SET lens_id = NULL WHERE lens_id IS NOT NULL/);
    expect(sql).toMatch(/INSERT INTO research_target_icps \(target_id, icp_profile_id, lens_id\)/);
    expect(sql).toMatch(/JOIN icp_profiles ip ON ip.id::text = lower\(listed.icp_id\)/);
  });
});

describe('migration 046 — lens schema cleanup', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

  it('adds research_target_icps.lens_id as a nullable FK to research_lenses', () => {
    expect(sql).toMatch(
      /ALTER TABLE research_target_icps\s+ADD COLUMN IF NOT EXISTS lens_id UUID\s+REFERENCES research_lenses\(id\) ON DELETE SET NULL/
    );
  });

  it('adds research_target_state.last_used_lens_id as a nullable FK to research_lenses', () => {
    expect(sql).toMatch(
      /ALTER TABLE research_target_state\s+ADD COLUMN IF NOT EXISTS last_used_lens_id UUID\s+REFERENCES research_lenses\(id\) ON DELETE SET NULL/
    );
  });

  it('creates indexes on both new FKs', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS ix_research_target_icps_lens\s+ON research_target_icps\(lens_id\)/
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS ix_research_target_state_last_used_lens\s+ON research_target_state\(last_used_lens_id\)/
    );
  });

  it('backfills lens_id from each target’s is_default=TRUE lens', () => {
    expect(sql).toMatch(/UPDATE research_target_icps rti/);
    expect(sql).toMatch(/WHERE rl\.primary_target_id = rti\.target_id/);
    expect(sql).toMatch(/AND rl\.is_default = TRUE/);
    expect(sql).toMatch(/WHERE rti\.lens_id IS NULL/);
  });

  it('backfills last_used_lens_id from the primary target’s default lens', () => {
    expect(sql).toMatch(/UPDATE research_target_state rts/);
    expect(sql).toMatch(/WHERE rl\.primary_target_id = rts\.primary_target_id/);
    expect(sql).toMatch(/rts\.last_used_lens_id IS NULL/);
  });
});

describe('lens-service read path after 045', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function mockRows<T>(rows: T[]) {
    return Promise.resolve({
      rows,
      command: '',
      rowCount: rows.length,
      oid: 0,
      fields: [],
    });
  }

  it('getActiveLensForTarget picks the lens pointed to by last_used_lens_id', async () => {
    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;

    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('last_used_lens_id') && text.includes('FROM research_target_state')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: 'lens-preferred' },
        ]) as ReturnType<typeof query>;
      }
      if (
        text.includes('FROM research_lenses') &&
        text.includes('WHERE lens.id = $1') &&
        text.includes('lens.primary_target_id = $2')
      ) {
        return mockRows<Record<string, unknown>>([
          {
            id: 'lens-preferred',
            tenant_id: 't',
            user_id: null,
            name: 'User pick',
            primary_target_id: 'target-1',
            secondary_target_id: null,
            config: { icpProfileIds: ['icp-1'] },
            is_default: false,
            created_at: 'x',
            updated_at: 'x',
          },
        ]) as ReturnType<typeof query>;
      }
      return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.getActiveLensForTarget('target-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(lens?.id).toBe('lens-preferred');
    expect(lens?.isDefault).toBe(false);
  });

  it('getActiveLensForTarget falls back to is_default when last_used_lens_id is stale (points at a lens on a DIFFERENT target)', async () => {
    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;

    let stalePointerLookupFired = false;
    let fallbackListFired = false;

    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('last_used_lens_id') && text.includes('FROM research_target_state')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: 'lens-on-other-target' },
        ]) as ReturnType<typeof query>;
      }
      if (
        text.includes('FROM research_lenses') &&
        text.includes('WHERE lens.id = $1') &&
        text.includes('lens.primary_target_id = $2')
      ) {
        stalePointerLookupFired = true;
        // Stale pointer — no row matches.
        return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
      }
      if (
        text.includes('FROM research_lenses') &&
        text.includes('WHERE lens.primary_target_id = $1')
      ) {
        fallbackListFired = true;
        return mockRows<Record<string, unknown>>([
          {
            id: 'lens-default',
            tenant_id: 't',
            user_id: null,
            name: 'Default',
            primary_target_id: 'target-1',
            secondary_target_id: null,
            config: {},
            is_default: true,
            created_at: 'a',
            updated_at: 'a',
          },
        ]) as ReturnType<typeof query>;
      }
      return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.getActiveLensForTarget('target-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(stalePointerLookupFired).toBe(true);
    expect(fallbackListFired).toBe(true);
    expect(lens?.id).toBe('lens-default');
  });

  it('getActiveLensForTarget falls back to oldest when no default exists', async () => {
    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('last_used_lens_id') && text.includes('FROM research_target_state')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: null },
        ]) as ReturnType<typeof query>;
      }
      if (
        text.includes('FROM research_lenses') &&
        text.includes('WHERE lens.primary_target_id = $1')
      ) {
        // ORDER BY is_default DESC, created_at ASC — service sorts it on SQL
        // side; here we return already-sorted rows.
        return mockRows<Record<string, unknown>>([
          {
            id: 'lens-older',
            tenant_id: 't',
            user_id: null,
            name: 'Oldest',
            primary_target_id: 'target-1',
            secondary_target_id: null,
            config: {},
            is_default: false,
            created_at: 'a',
            updated_at: 'a',
          },
        ]) as ReturnType<typeof query>;
      }
      return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.getActiveLensForTarget('target-1', { tenantId: 't', ownerId: 'owner-1' });
    expect(lens?.id).toBe('lens-older');
  });

  it('rejects legacy activation without a revision', async () => {
    const { transaction } = await import('@/lib/db/client');
    const svc = await import('@/lib/targets/lens-service');
    await expect(svc.activateLensForTarget('target-1', 'lens-2'))
      .rejects.toThrow(/revisioned target state/);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('GET target lenses active state', () => {
  it('returns the resolved active lens even when the default is different', async () => {
    jest.resetModules();
    const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const lenses = [
      { id: 'lens-default', isDefault: true },
      { id: 'lens-preferred', isDefault: false },
    ];
    jest.doMock('@/lib/targets/service', () => ({
      getTargetById: jest.fn().mockResolvedValue({ id: targetId, tenantId: 'tenant', kind: 'contact' }),
      getCurrentOwnerProfileId: jest.fn().mockResolvedValue('owner'),
      getResearchTargetState: jest.fn().mockResolvedValue({ tenantId: 'tenant' }),
    }));
    jest.doMock('@/lib/targets/lens-service', () => ({
      listLensesForTarget: jest.fn().mockResolvedValue(lenses),
      getActiveLensForTarget: jest.fn().mockResolvedValue(lenses[1]),
    }));

    const { GET } = await import('@/app/api/targets/[id]/lenses/route');
    const response = await GET(
      {} as import('next/server').NextRequest,
      { params: Promise.resolve({ id: targetId }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: lenses,
      activeLensId: 'lens-preferred',
    });
  });
});

describe('POST target lens associations', () => {
  it('passes canonical ICP IDs through create and returns them in the DTO', async () => {
    jest.resetModules();
    const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const icpId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const created = { id: 'lens-new', name: 'Duplicate', config: { color: 'blue' },
      icpProfileIds: [icpId] };
    jest.doMock('@/lib/targets/service', () => ({
      getTargetById: jest.fn().mockResolvedValue({ id: targetId, tenantId: 'tenant', kind: 'contact' }),
      getCurrentOwnerProfileId: jest.fn().mockResolvedValue('owner'),
      getResearchTargetState: jest.fn().mockResolvedValue({ tenantId: 'tenant' }),
    }));
    const create = jest.fn().mockResolvedValue(created);
    jest.doMock('@/lib/targets/lens-service', () => ({
      listLensesForTarget: jest.fn(), getActiveLensForTarget: jest.fn(),
      createLensForTarget: create,
    }));
    const { POST } = await import('@/app/api/targets/[id]/lenses/route');
    const params = { params: Promise.resolve({ id: targetId }) };
    const request = (icpProfileIds: unknown) => ({ json: async () => ({
      name: 'Duplicate', config: { color: 'blue' }, icpProfileIds,
    }) }) as import('next/server').NextRequest;
    expect((await POST(request(['invalid']), params)).status).toBe(400);
    const response = await POST(request([icpId]), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data.icpProfileIds).toEqual([icpId]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      targetId, icpProfileIds: [icpId], configExtras: { color: 'blue' },
    }));
  });
});
