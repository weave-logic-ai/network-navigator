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
      if (text.includes('last_used_lens_id') && text.includes('owner_profiles')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: 'lens-preferred' },
        ]) as ReturnType<typeof query>;
      }
      if (
        text.includes('FROM research_lenses') &&
        text.includes('WHERE id = $1') &&
        text.includes('primary_target_id = $2')
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
    const lens = await svc.getActiveLensForTarget('target-1');
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
      if (text.includes('last_used_lens_id') && text.includes('owner_profiles')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: 'lens-on-other-target' },
        ]) as ReturnType<typeof query>;
      }
      if (
        text.includes('FROM research_lenses') &&
        text.includes('WHERE id = $1') &&
        text.includes('primary_target_id = $2')
      ) {
        stalePointerLookupFired = true;
        // Stale pointer — no row matches.
        return mockRows<Record<string, unknown>>([]) as ReturnType<typeof query>;
      }
      if (
        text.includes('FROM research_lenses') &&
        text.includes('WHERE primary_target_id = $1')
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
    const lens = await svc.getActiveLensForTarget('target-1');
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
      if (text.includes('last_used_lens_id') && text.includes('owner_profiles')) {
        return mockRows<Record<string, unknown>>([
          { last_used_lens_id: null },
        ]) as ReturnType<typeof query>;
      }
      if (
        text.includes('FROM research_lenses') &&
        text.includes('WHERE primary_target_id = $1')
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
    const lens = await svc.getActiveLensForTarget('target-1');
    expect(lens?.id).toBe('lens-older');
  });

  it('activateLensForTarget writes last_used_lens_id on research_target_state inside a transaction', async () => {
    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));
    const { transaction } = await import('@/lib/db/client');
    const clientQueries: Array<{ sql: string; params: unknown[] }> = [];
    const clientStub = {
      query: (sql: string, params?: unknown[]) => {
        clientQueries.push({ sql, params: params ?? [] });
        if (sql.includes('SELECT * FROM research_lenses') && sql.includes('primary_target_id')) {
          return mockRows<Record<string, unknown>>([
            {
              id: 'lens-2',
              tenant_id: 't',
              user_id: null,
              name: 'Target lens',
              primary_target_id: 'target-1',
              secondary_target_id: null,
              config: {},
              is_default: false,
              created_at: 'x',
              updated_at: 'x',
            },
          ]);
        }
        if (sql.includes('SELECT id FROM research_lenses')) {
          // No existing default — so the activate call should promote.
          return mockRows<Record<string, unknown>>([]);
        }
        if (sql.includes('UPDATE research_lenses') && sql.includes('is_default = TRUE')) {
          return mockRows<Record<string, unknown>>([
            {
              id: 'lens-2',
              tenant_id: 't',
              user_id: null,
              name: 'Target lens',
              primary_target_id: 'target-1',
              secondary_target_id: null,
              config: {},
              is_default: true,
              created_at: 'x',
              updated_at: 'x',
            },
          ]);
        }
        return mockRows<Record<string, unknown>>([]);
      },
    };
    (transaction as jest.MockedFunction<typeof transaction>).mockImplementation(
      async (fn) => fn(clientStub as unknown as Parameters<typeof fn>[0])
    );

    const svc = await import('@/lib/targets/lens-service');
    const lens = await svc.activateLensForTarget('target-1', 'lens-2');
    expect(lens?.id).toBe('lens-2');

    // The key new invariant: we must have issued a state-row UPDATE that
    // writes last_used_lens_id.
    const stateUpdate = clientQueries.find((q) =>
      q.sql.includes('UPDATE research_target_state') &&
      q.sql.includes('last_used_lens_id = $1')
    );
    expect(stateUpdate).toBeDefined();
    expect(stateUpdate?.params[0]).toBe('lens-2');
  });

  it('activateLensForTarget does NOT clobber an existing is_default sibling (per-user, not per-row semantics)', async () => {
    jest.doMock('@/lib/db/client', () => ({
      query: jest.fn(),
      transaction: jest.fn(),
      healthCheck: jest.fn(),
      getPool: jest.fn(),
      shutdown: jest.fn(),
    }));
    const { transaction } = await import('@/lib/db/client');
    const clientQueries: Array<{ sql: string; params: unknown[] }> = [];
    const clientStub = {
      query: (sql: string, params?: unknown[]) => {
        clientQueries.push({ sql, params: params ?? [] });
        if (sql.includes('SELECT * FROM research_lenses') && sql.includes('primary_target_id')) {
          return mockRows<Record<string, unknown>>([
            {
              id: 'lens-b',
              tenant_id: 't',
              user_id: null,
              name: 'B',
              primary_target_id: 'target-1',
              secondary_target_id: null,
              config: {},
              is_default: false,
              created_at: 'x',
              updated_at: 'x',
            },
          ]);
        }
        if (sql.includes('SELECT id FROM research_lenses')) {
          // An existing default exists — so the activate call must NOT
          // promote or clear anything.
          return mockRows<Record<string, unknown>>([{ id: 'lens-a' }]);
        }
        return mockRows<Record<string, unknown>>([]);
      },
    };
    (transaction as jest.MockedFunction<typeof transaction>).mockImplementation(
      async (fn) => fn(clientStub as unknown as Parameters<typeof fn>[0])
    );

    const svc = await import('@/lib/targets/lens-service');
    await svc.activateLensForTarget('target-1', 'lens-b');

    // No is_default writes issued.
    const defaultWrites = clientQueries.filter((q) =>
      q.sql.includes('UPDATE research_lenses') && q.sql.includes('is_default')
    );
    expect(defaultWrites).toEqual([]);
  });
});

describe('GET target lenses active state', () => {
  it('returns the resolved active lens even when the default is different', async () => {
    jest.resetModules();
    const lenses = [
      { id: 'lens-default', isDefault: true },
      { id: 'lens-preferred', isDefault: false },
    ];
    jest.doMock('@/lib/targets/service', () => ({
      getTargetById: jest.fn().mockResolvedValue({ id: 'target-1' }),
    }));
    jest.doMock('@/lib/targets/lens-service', () => ({
      listLensesForTarget: jest.fn().mockResolvedValue(lenses),
      getActiveLensForTarget: jest.fn().mockResolvedValue(lenses[1]),
    }));

    const { GET } = await import('@/app/api/targets/[id]/lenses/route');
    const response = await GET(
      {} as import('next/server').NextRequest,
      { params: Promise.resolve({ id: 'target-1' }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: lenses,
      activeLensId: 'lens-preferred',
    });
  });
});
