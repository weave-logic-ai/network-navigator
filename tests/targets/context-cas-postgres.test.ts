import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPool, shutdown, transaction } from '@/lib/db/client';
import { commandTargetState, getResearchTargetState, getTargetStateSnapshot, TargetStateCommandError } from '@/lib/targets/service';
import { softDeleteLens, listLensesForTarget, getActiveLensForTarget, getActiveLensIcps, getLensById, createLensForTarget } from '@/lib/targets/lens-service';
import { GET as stateGet, PUT as statePut } from '@/app/api/targets/state/route';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { TargetSurface } from '@/components/targets/target-surface';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { NextRequest } from '../../app/node_modules/next/server';

const run = process.env.CAS_TEST_DATABASE_URL ? describe : describe.skip;
const pool = getPool();
const tenant = '10000000-0000-4000-8000-000000000001';
const owner = '10000000-0000-4000-8000-000000000002';
const self = '10000000-0000-4000-8000-000000000003';
const a = '10000000-0000-4000-8000-000000000004';
const b = '10000000-0000-4000-8000-000000000005';
const x = '10000000-0000-4000-8000-000000000006';
const y = '10000000-0000-4000-8000-000000000007';

run('revisioned target state against Postgres', () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/cas_test') {
      throw new Error('CAS Postgres tests require the dedicated cas_test database');
    }
    await pool.query(`DROP TABLE IF EXISTS research_target_state, research_target_icps,
      icp_profiles, research_lenses, research_targets, owner_profiles, contacts, companies, tenants CASCADE`);
    await pool.query(`
      CREATE TABLE tenants (id uuid PRIMARY KEY, slug text NOT NULL);
      CREATE TABLE owner_profiles (id uuid PRIMARY KEY, is_current boolean NOT NULL, first_name text, last_name text);
      CREATE TABLE contacts (id uuid PRIMARY KEY);
      CREATE TABLE companies (id uuid PRIMARY KEY);
      CREATE TABLE research_targets (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, kind text NOT NULL,
        owner_id uuid REFERENCES owner_profiles(id) ON DELETE SET NULL,
        contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
        label text NOT NULL,
        pinned boolean DEFAULT false, created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(), last_used_at timestamptz DEFAULT now(),
        CONSTRAINT chk_target_exactly_one CHECK (
          (owner_id IS NOT NULL)::int + (contact_id IS NOT NULL)::int +
          (company_id IS NOT NULL)::int = 1));
      CREATE TABLE research_lenses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid,
        primary_target_id uuid, secondary_target_id uuid, name text NOT NULL,
        config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
        is_default boolean NOT NULL DEFAULT false, deleted_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE icp_profiles (
        id uuid PRIMARY KEY, name text NOT NULL, description text,
        is_active boolean NOT NULL DEFAULT true, criteria jsonb NOT NULL DEFAULT '{}',
        weight_overrides jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE research_target_icps (
        target_id uuid NOT NULL, icp_profile_id uuid NOT NULL, lens_id uuid,
        UNIQUE (target_id, icp_profile_id, lens_id));
      CREATE TABLE research_target_state (
        tenant_id uuid NOT NULL, user_id uuid NOT NULL,
        primary_target_id uuid REFERENCES research_targets(id) ON DELETE SET NULL,
        secondary_target_id uuid REFERENCES research_targets(id) ON DELETE SET NULL,
        last_used_lens_id uuid, history jsonb NOT NULL DEFAULT '[]',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id));
    `);
    const migration = readFileSync(resolve(process.cwd(), '../data/db/init/057-target-state-revision.sql'), 'utf8');
    await pool.query(migration);
    await pool.query(migration); // Existing-volume rerun is idempotent.
    await pool.query(`INSERT INTO tenants VALUES ($1, 'default')`, [tenant]);
    await pool.query(`INSERT INTO owner_profiles VALUES ($1, true, 'Test', 'Owner')`, [owner]);
    await pool.query(`INSERT INTO contacts VALUES ($1), ($2)`, [a, b]);
    await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, owner_id, label)
      VALUES ($1, $2, 'self', $3, 'Self')`, [self, tenant, owner]);
    for (const [id, label] of [[a, 'A'], [b, 'B']]) {
      await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, contact_id, label)
        VALUES ($1, $2, 'contact', $1, $3)`, [id, tenant, label]);
    }
    for (const [id, targetId, name] of [[x, a, 'X'], [y, b, 'Y']]) {
      await pool.query(`INSERT INTO research_lenses (id, tenant_id, user_id, primary_target_id, name)
        VALUES ($1, $2, $3, $4, $5)`,
        [id, tenant, owner, targetId, name]);
    }
  });

  beforeEach(async () => {
    await pool.query(`UPDATE research_lenses SET deleted_at = NULL WHERE id = ANY($1::uuid[])`, [[x, y]]);
    await pool.query(`DELETE FROM research_target_state`);
    await pool.query(`INSERT INTO research_target_state (tenant_id, user_id, primary_target_id)
      VALUES ($1, $2, $3)`, [tenant, owner, self]);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS research_target_state, research_target_icps,
      icp_profiles, research_lenses, research_targets, owner_profiles, contacts, companies, tenants CASCADE`);
    await shutdown();
  });

  it('serializes same-revision commands and returns an authorized 409 snapshot', async () => {
    const outcomes = await Promise.allSettled([
      commandTargetState(owner, '0', { type: 'focus', targetId: a }),
      commandTargetState(owner, '0', { type: 'focus', targetId: b }),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(result => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status !== 'rejected') return;
    expect(rejected.reason).toBeInstanceOf(TargetStateCommandError);
    expect(rejected.reason.status).toBe(409);
    const state = await getTargetStateSnapshot(owner);
    expect(rejected.reason.current).toMatchObject({ revision: '1', focusTargetId: state?.focusTargetId });
    const noop = await commandTargetState(owner, '1', { type: 'focus', targetId: state?.focusTargetId ?? null });
    expect(noop.revision).toBe('2');
  });

  it('rolls back focus, lens and revision when history storage fails', async () => {
    await pool.query(`CREATE FUNCTION reject_cas_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.history <> OLD.history THEN RAISE EXCEPTION 'injected history failure'; END IF;
      RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER trg_reject_cas_history BEFORE UPDATE ON research_target_state
      FOR EACH ROW EXECUTE FUNCTION reject_cas_history()`);
    try {
      await expect(commandTargetState(owner, '0', { type: 'focus', targetId: a })).rejects.toThrow();
      expect(await getTargetStateSnapshot(owner)).toMatchObject({
        revision: '0', focusTargetId: null, activeLensId: null, history: [],
      });
    } finally {
      await pool.query(`DROP TRIGGER trg_reject_cas_history ON research_target_state`);
      await pool.query(`DROP FUNCTION reject_cas_history()`);
    }
  });

  it('makes activation and focus on the same revision mutually exclusive', async () => {
    await commandTargetState(owner, '0', { type: 'focus', targetId: a });
    const outcomes = await Promise.allSettled([
      commandTargetState(owner, '1', { type: 'activateLens', targetId: a, lensId: x }),
      commandTargetState(owner, '1', { type: 'focus', targetId: b }),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const state = await getTargetStateSnapshot(owner);
    expect(state?.revision).toBe('2');
    if (state?.focusTargetId === b) expect(state.activeLensId).toBeNull();
    else expect(state).toMatchObject({ focusTargetId: a, activeLensId: x });
  });

  it('serializes activation with soft deletion of the same lens', async () => {
    await commandTargetState(owner, '0', { type: 'focus', targetId: a });
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`SELECT 1 FROM research_target_state
      WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`, [tenant, owner]);
    const pending = Promise.allSettled([
      commandTargetState(owner, '1', { type: 'activateLens', targetId: a, lensId: x }),
      softDeleteLens(a, x, { tenantId: tenant, ownerId: owner }),
    ]);
    try {
      // Both commands must wait on the same state row before either can
      // inspect or change the lens. This exercises their shared lock order.
      await new Promise(resolve => setTimeout(resolve, 30));
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    const outcomes = await pending;
    expect(outcomes[1]).toMatchObject({ status: 'fulfilled', value: { id: x } });
    if (outcomes[0].status === 'rejected') {
      expect(outcomes[0].reason).toMatchObject({ status: 400 });
    }
    const stored = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM research_lenses WHERE id = $1`, [x]);
    expect(stored.rows[0].deleted_at).not.toBeNull();
    expect(await getTargetStateSnapshot(owner)).toMatchObject({
      focusTargetId: a, activeLensId: null,
    });
  });

  it('clears an already active lens and advances revision on soft deletion', async () => {
    await commandTargetState(owner, '0', { type: 'focus', targetId: a });
    await commandTargetState(owner, '1', { type: 'activateLens', targetId: a, lensId: x });
    expect((await softDeleteLens(a, x, { tenantId: tenant, ownerId: owner }))?.deletedAt).not.toBeNull();
    expect(await getTargetStateSnapshot(owner)).toMatchObject({
      revision: '3', focusTargetId: a, activeLensId: null,
    });
    await expect(commandTargetState(owner, '2', { type: 'activateLens', targetId: a, lensId: x }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects foreign-tenant targets and wrong-target lenses before mutation', async () => {
    const otherTenant = '20000000-0000-4000-8000-000000000001';
    const foreign = '20000000-0000-4000-8000-000000000002';
    await pool.query(`INSERT INTO contacts VALUES ($1)`, [foreign]);
    await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, contact_id, label)
      VALUES ($1, $2, 'contact', $1, 'Foreign')`, [foreign, otherTenant]);
    await expect(commandTargetState(owner, '0', { type: 'focus', targetId: foreign }))
      .rejects.toMatchObject({ status: 400 });
    const focused = await commandTargetState(owner, '0', { type: 'focus', targetId: b });
    await expect(commandTargetState(owner, focused.revision,
      { type: 'activateLens', targetId: b, lensId: x }))
      .rejects.toMatchObject({ status: 400 });
    expect(await getTargetStateSnapshot(owner)).toMatchObject({
      revision: '1', focusTargetId: b, activeLensId: null,
    });
  });

  it('serializes simultaneous first lens creates and enforces one default in Postgres', async () => {
    const targetId = '20000000-0000-4000-8000-000000000021';
    await pool.query(`INSERT INTO contacts VALUES ($1)`, [targetId]);
    await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, contact_id, label)
      VALUES ($1, $2, 'contact', $1, 'New target')`, [targetId, tenant]);
    const created = await Promise.all([
      createLensForTarget({ targetId, tenantId: tenant, userId: owner, name: 'First' }),
      createLensForTarget({ targetId, tenantId: tenant, userId: owner, name: 'Second' }),
    ]);
    expect(created.filter(lens => lens.isDefault)).toHaveLength(1);
    const stored = await pool.query<{ id: string; is_default: boolean }>(
      `SELECT id, is_default FROM research_lenses WHERE primary_target_id = $1`, [targetId]);
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.filter(lens => lens.is_default)).toHaveLength(1);
    await expect(pool.query(`UPDATE research_lenses SET is_default = TRUE
      WHERE id = $1`, [stored.rows.find(lens => !lens.is_default)?.id]))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('does not resolve lens ICPs across owner or tenant boundaries', async () => {
    const otherTenant = '20000000-0000-4000-8000-000000000031';
    const otherOwner = '20000000-0000-4000-8000-000000000032';
    const privateLens = '20000000-0000-4000-8000-000000000033';
    const icp = '20000000-0000-4000-8000-000000000034';
    await pool.query(`INSERT INTO tenants VALUES ($1, 'foreign')`, [otherTenant]);
    await pool.query(`INSERT INTO owner_profiles VALUES ($1, false, 'Foreign', 'Owner')`, [otherOwner]);
    await pool.query(`INSERT INTO icp_profiles (id, name, criteria)
      VALUES ($1, 'Private ICP', '{"roles":["SECRET"]}')`, [icp]);
    await pool.query(`INSERT INTO research_lenses
      (id, tenant_id, user_id, primary_target_id, name, is_default)
      VALUES ($1, $2, $3, $4, 'Private lens', TRUE)`, [privateLens, tenant, otherOwner, a]);
    await pool.query(`INSERT INTO research_target_icps VALUES ($1, $2, $3)`, [a, icp, privateLens]);
    expect(await getActiveLensIcps(a, { tenantId: tenant, ownerId: owner })).toEqual([]);
    expect((await getActiveLensIcps(a, { tenantId: tenant, ownerId: otherOwner })).map(row => row.id))
      .toEqual([icp]);
    expect(await getActiveLensIcps(a, { tenantId: otherTenant, ownerId: otherOwner })).toEqual([]);
    expect(await getActiveLensIcps(self, { tenantId: tenant, ownerId: otherOwner })).toEqual([]);
  });

  it('reads lens selection through the caller transaction snapshot', async () => {
    const scope = { tenantId: tenant, ownerId: owner };
    await transaction(async client => {
      await client.query(`UPDATE research_target_state SET last_used_lens_id = $1
        WHERE tenant_id = $2 AND user_id = $3`, [x, tenant, owner]);
      expect((await getActiveLensForTarget(a, scope, client))?.id).toBe(x);
      expect(await getActiveLensForTarget(a, { tenantId: tenant, ownerId: y }, client))
        .toBeNull();
    });
  });

  it('scopes real lens reads and deletes across two tenants and owners without config leaks', async () => {
    const otherTenant = '20000000-0000-4000-8000-000000000011';
    const otherOwner = '20000000-0000-4000-8000-000000000012';
    const otherTarget = '20000000-0000-4000-8000-000000000013';
    const ownerLens = '20000000-0000-4000-8000-000000000014';
    const tenantLens = '20000000-0000-4000-8000-000000000015';
    const otherSelf = '20000000-0000-4000-8000-000000000016';
    const sharedSelfLens = '20000000-0000-4000-8000-000000000017';
    await pool.query(`INSERT INTO tenants VALUES ($1, 'other')`, [otherTenant]);
    await pool.query(`INSERT INTO owner_profiles VALUES ($1, false, 'Other', 'Owner')`, [otherOwner]);
    await pool.query(`INSERT INTO contacts VALUES ($1)`, [otherTarget]);
    await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, contact_id, label)
      VALUES ($1, $2, 'contact', $1, 'Other target')`, [otherTarget, otherTenant]);
    await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, owner_id, label)
      VALUES ($1, $2, 'self', $3, 'Other self')`, [otherSelf, tenant, otherOwner]);
    await pool.query(`INSERT INTO research_lenses
      (id, tenant_id, user_id, primary_target_id, name, config) VALUES
      ($1, $2, $3, $4, 'Other owner', '{"secret":"owner-secret"}'),
      ($5, $6, $3, $4, 'Other tenant', '{"secret":"tenant-secret"}')`,
      [ownerLens, tenant, otherOwner, a, tenantLens, otherTenant]);
    await pool.query(`INSERT INTO research_lenses
      (id, tenant_id, user_id, primary_target_id, name, config)
      VALUES ($1, $2, NULL, $3, 'Shared self', '{"secret":"self-secret"}')`,
      [sharedSelfLens, tenant, otherSelf]);
    const scope = { tenantId: tenant, ownerId: owner };
    const visible = await listLensesForTarget(a, scope);
    expect(visible.map(lens => lens.id)).toEqual([x]);
    expect(JSON.stringify(visible)).not.toMatch(/owner-secret|tenant-secret/);
    expect((await getActiveLensForTarget(a, scope))?.id).toBe(x);
    expect(await getLensById(ownerLens, scope)).toBeNull();
    expect(await getLensById(tenantLens, scope)).toBeNull();
    expect(await getLensById(sharedSelfLens, scope)).toBeNull();
    expect(await softDeleteLens(a, ownerLens, scope)).toBeNull();
    expect(await softDeleteLens(a, tenantLens, scope)).toBeNull();
    expect(await softDeleteLens(otherTarget, tenantLens, scope)).toBeNull();
    expect(await softDeleteLens(otherSelf, sharedSelfLens, scope)).toBeNull();
    const stored = await pool.query(`SELECT id FROM research_lenses
      WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [[ownerLens, tenantLens, sharedSelfLens]]);
    expect(stored.rows).toHaveLength(3);
  });

  it('restores B/Y then A/X and warns when a saved lens was deleted', async () => {
    let state = await commandTargetState(owner, '0', { type: 'focus', targetId: a });
    state = await commandTargetState(owner, state.revision, { type: 'activateLens', targetId: a, lensId: x });
    state = await commandTargetState(owner, state.revision, { type: 'focus', targetId: b });
    state = await commandTargetState(owner, state.revision, { type: 'activateLens', targetId: b, lensId: y });
    state = await commandTargetState(owner, state.revision, { type: 'focus', targetId: null });
    state = await commandTargetState(owner, state.revision, { type: 'back' });
    expect(state).toMatchObject({ focusTargetId: b, activeLensId: y });
    state = await commandTargetState(owner, state.revision, { type: 'back' });
    expect(state).toMatchObject({ focusTargetId: a, activeLensId: x });
    state = await commandTargetState(owner, state.revision, { type: 'focus', targetId: b });
    state = await commandTargetState(owner, state.revision, { type: 'activateLens', targetId: b, lensId: y });
    state = await commandTargetState(owner, state.revision, { type: 'focus', targetId: null });
    await pool.query(`UPDATE research_lenses SET deleted_at = now() WHERE id = $1`, [y]);
    state = await commandTargetState(owner, state.revision, { type: 'back' });
    expect(state.focusTargetId).toBe(b);
    expect(state.activeLensId).toBeNull();
    expect(state.warning).toMatch(/saved lens was deleted/);
  });
  it('skips a deleted target in Back history', async () => {
    let state = await commandTargetState(owner, '0', { type: 'focus', targetId: a });
    state = await commandTargetState(owner, state.revision, { type: 'focus', targetId: b });
    await pool.query(`DELETE FROM contacts WHERE id = $1`, [a]);
    try {
      state = await commandTargetState(owner, state.revision, { type: 'back' });
      expect(state).toMatchObject({ revision: '3', focusTargetId: null });
      expect(state.warning).toMatch(/prior target is unavailable/);
    } finally {
      await pool.query(`INSERT INTO contacts VALUES ($1)`, [a]);
      await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, contact_id, label)
        VALUES ($1, $2, 'contact', $1, 'A')`, [a, tenant]);
    }
  });

  it('hides and skips legacy history pointing at another owner or tenant self target', async () => {
    const otherOwner = '30000000-0000-4000-8000-000000000001';
    const otherSelf = '30000000-0000-4000-8000-000000000002';
    const otherTenant = '30000000-0000-4000-8000-000000000003';
    const tenantSelf = '30000000-0000-4000-8000-000000000004';
    await pool.query(`INSERT INTO owner_profiles VALUES ($1, false, 'Other', 'Owner')`, [otherOwner]);
    await pool.query(`INSERT INTO tenants VALUES ($1, 'legacy-other')`, [otherTenant]);
    await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, owner_id, label)
      VALUES ($1, $2, 'self', $3, 'Private self'),
             ($4, $5, 'self', $3, 'Other tenant self')`,
      [otherSelf, tenant, otherOwner, tenantSelf, otherTenant]);
    const openedAt = '2026-09-27T00:00:00.000Z';
    await pool.query(`UPDATE research_target_state SET secondary_target_id = $3,
      history = $4::jsonb WHERE tenant_id = $1 AND user_id = $2`,
      [tenant, owner, b, JSON.stringify([
        { targetId: otherSelf, lensId: null, openedAt },
        { targetId: tenantSelf, lensId: null, openedAt },
        { targetId: a, lensId: null, openedAt },
      ])]);

    const before = await getTargetStateSnapshot(owner);
    expect(before?.history.map(entry => entry.targetId)).toEqual([a]);
    expect(before?.history.map(entry => entry.targetLabel).join(' ')).not.toMatch(/Private|Other tenant/);
    await expect(commandTargetState(owner, 'stale', { type: 'back' }))
      .rejects.toMatchObject({ status: 409, current: { history: [{ targetId: a }] } });
    const restored = await commandTargetState(owner, before!.revision, { type: 'back' });
    expect(restored).toMatchObject({ focusTargetId: a, history: [],
      revision: String(Number(before!.revision) + 1) });
    expect(restored.warning).toMatch(/prior target is unavailable/);
    const stored = await pool.query(`SELECT secondary_target_id, history FROM research_target_state
      WHERE tenant_id = $1 AND user_id = $2`, [tenant, owner]);
    expect(stored.rows[0]).toMatchObject({ secondary_target_id: a, history: [] });
  });

  it('repairs pre-CAS foreign pointers before GET, server render, 409 and Back', async () => {
    const otherOwner = '40000000-0000-4000-8000-000000000001';
    const otherSelf = '40000000-0000-4000-8000-000000000002';
    const otherTenant = '40000000-0000-4000-8000-000000000003';
    const tenantSelf = '40000000-0000-4000-8000-000000000004';
    const sharedLens = '40000000-0000-4000-8000-000000000005';
    const foreignName = 'Private shared lens';
    await pool.query(`INSERT INTO owner_profiles VALUES ($1, false, 'Other', 'Owner')`, [otherOwner]);
    await pool.query(`INSERT INTO tenants VALUES ($1, 'legacy-state-other')`, [otherTenant]);
    await pool.query(`INSERT INTO research_targets (id, tenant_id, kind, owner_id, label)
      VALUES ($1, $2, 'self', $3, 'Private owner'),
             ($4, $5, 'self', $3, 'Private tenant')`,
      [otherSelf, tenant, otherOwner, tenantSelf, otherTenant]);
    await pool.query(`INSERT INTO research_lenses
      (id, tenant_id, user_id, primary_target_id, name)
      VALUES ($1, $2, NULL, $3, $4)`, [sharedLens, tenant, otherSelf, foreignName]);
    const history = JSON.stringify([
      { targetId: otherSelf, lensId: sharedLens, openedAt: '2026-09-27T00:00:00.000Z' },
      { targetId: a, lensId: null, openedAt: '2026-09-27T00:00:01.000Z' },
    ]);
    const inject = async (primary: string, secondary: string) => {
      const result = await pool.query<{ revision: string }>(
        `UPDATE research_target_state SET primary_target_id = $3,
         secondary_target_id = $4, last_used_lens_id = $5, history = $6::jsonb
         WHERE tenant_id = $1 AND user_id = $2 RETURNING revision`,
        [tenant, owner, primary, secondary, sharedLens, history]);
      return String(result.rows[0].revision);
    };
    const assertClean = (value: unknown) => {
      const body = JSON.stringify(value);
      for (const secret of [otherSelf, tenantSelf, 'Private owner', 'Private tenant',
        sharedLens, foreignName]) expect(body).not.toContain(secret);
    };
    const previousSecret = process.env.LOCAL_OPERATOR_SECRET;
    const previousFlag = RESEARCH_FLAGS.targets;
    process.env.LOCAL_OPERATOR_SECRET = 'synthetic-cas-review-secret-1234567890';
    RESEARCH_FLAGS.targets = true;
    try {
      const session = await createOperatorSession();
      expect(session).toBeTruthy();
      const request = (method = 'GET', body?: unknown) => new NextRequest(
        'http://localhost:3751/api/targets/state', { method, headers: {
          host: 'localhost:3751', 'sec-fetch-site': 'same-origin',
          cookie: `${OPERATOR_COOKIE}=${session}`,
          ...(method === 'PUT' ? { 'content-type': 'application/json' } : {}),
        }, ...(body ? { body: JSON.stringify(body) } : {}) });

      const corruptRevision = await inject(otherSelf, otherSelf);
      const getResponse = await stateGet(request());
      expect(getResponse.status).toBe(200);
      const getBody = await getResponse.json();
      assertClean(getBody);
      expect(getBody.data).toMatchObject({ primaryTargetId: self,
        secondaryTargetId: null, focusTargetId: null, activeLensId: null,
        primaryLabel: 'Self', activeLensLabel: null, revision: String(Number(corruptRevision) + 1) });
      expect((await getResearchTargetState(owner))?.revision).toBe(getBody.data.revision);

      const primaryOnlyRevision = await inject(otherSelf, a);
      const primaryOnly = await getResearchTargetState(owner);
      assertClean(primaryOnly);
      expect(primaryOnly).toMatchObject({ primaryTargetId: self,
        secondaryTargetId: a, activeLensId: null,
        revision: String(Number(primaryOnlyRevision) + 1) });

      await inject(self, otherSelf);
      const surface = await TargetSurface();
      assertClean(surface);
      expect(JSON.stringify(surface)).toContain(self);
      const afterRender = await getResearchTargetState(owner);
      expect(afterRender).toMatchObject({ primaryTargetId: self, secondaryTargetId: null,
        activeLensId: null });

      const conflictRevision = await inject(otherSelf, tenantSelf);
      const conflict = await statePut(request('PUT', {
        expectedRevision: conflictRevision, action: { type: 'back' },
      }));
      expect(conflict.status).toBe(409);
      const conflictBody = await conflict.json();
      assertClean(conflictBody);
      expect(conflictBody.data).toMatchObject({ primaryTargetId: self,
        secondaryTargetId: null, activeLensId: null,
        revision: String(Number(conflictRevision) + 1) });

      await inject(otherSelf, otherSelf);
      const repaired = await getResearchTargetState(owner);
      expect(repaired).toMatchObject({ primaryTargetId: self, secondaryTargetId: null,
        activeLensId: null });
      const restored = await commandTargetState(owner, repaired!.revision, { type: 'back' });
      assertClean(restored);
      expect(restored).toMatchObject({ primaryTargetId: self, secondaryTargetId: a,
        activeLensId: null, focusTargetId: a });
      expect(restored.warning).toMatch(/prior target is unavailable/);
      const stored = await pool.query(`SELECT primary_target_id, secondary_target_id,
        last_used_lens_id, revision FROM research_target_state
        WHERE tenant_id = $1 AND user_id = $2`, [tenant, owner]);
      expect(stored.rows[0]).toMatchObject({ primary_target_id: self,
        secondary_target_id: a, last_used_lens_id: null,
        revision: restored.revision });
    } finally {
      RESEARCH_FLAGS.targets = previousFlag;
      if (previousSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
      else process.env.LOCAL_OPERATOR_SECRET = previousSecret;
    }
  });

  it('advances revision when a contact deletion cascades its target', async () => {
    await commandTargetState(owner, '0', { type: 'focus', targetId: a });
    await pool.query(`DELETE FROM contacts WHERE id = $1`, [a]);
    expect(await getTargetStateSnapshot(owner)).toMatchObject({
      revision: '2', focusTargetId: null, activeLensId: null,
    });
    await expect(commandTargetState(owner, '1', { type: 'focus', targetId: b }))
      .rejects.toMatchObject({ status: 409 });
  });
});
