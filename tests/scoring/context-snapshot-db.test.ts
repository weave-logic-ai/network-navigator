import { getPool } from '@/lib/db/client';
import { captureOwnerScoringBasis, previewContactForTarget, scoreBatch, scoreContact } from '@/lib/scoring/pipeline';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { ECC_FLAGS } from '@/lib/ecc/types';
import { getContactScoreBreakdown, upsertContactScore } from '@/lib/db/queries/scoring';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CompositeScore } from '@/lib/scoring/types';
import * as impulseDispatcher from '@/lib/ecc/impulses/dispatcher';
import { drainPendingScoringImpulses, drainScoringImpulses } from '@/lib/scoring/transition-writer';
import { triggerRescoreAll } from '@/lib/scoring/auto-score';
import { createLegacyImportScoreJob, drainPendingImportScoreJobs } from '@/lib/scoring/import-job';
import { executeNotification } from '@/lib/ecc/impulses/handlers/notification';
import type { Impulse } from '@/lib/ecc/types';

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.SCORE_CONTEXT_DISPOSABLE_DB === 'true';
const targetId = '550e8400-e29b-41d4-a716-446655440001';
const contactId = '550e8400-e29b-41d4-a716-446655440003';
const legacyInvalidId = '550e8400-e29b-41d4-a716-446655440094';
const lensA = '550e8400-e29b-41d4-a716-446655440020';
const lensB = '550e8400-e29b-41d4-a716-446655440021';
const icpA = '550e8400-e29b-41d4-a716-446655440010';
const icpB = '550e8400-e29b-41d4-a716-446655440011';
const tenantA = '550e8400-e29b-41d4-a716-446655440045';
const ownerA = '550e8400-e29b-41d4-a716-446655440030';
const foreignTenant = '550e8400-e29b-41d4-a716-446655440046';
const foreignOwner = '550e8400-e29b-41d4-a716-446655440031';
const foreignTarget = '550e8400-e29b-41d4-a716-446655440002';
const foreignContact = '550e8400-e29b-41d4-a716-446655440004';
const foreignLens = '550e8400-e29b-41d4-a716-446655440022';

(enabled ? describe : describe.skip)('context preview PostgreSQL snapshot', () => {
  const pool = getPool();

  beforeAll(async () => {
    const url = new URL(databaseUrl ?? '');
    if (url.hostname !== '127.0.0.1' || !['55439', '55440'].includes(url.port) || url.pathname !== '/score_context_fixture') {
      throw new Error('Disposable snapshot test requires the local score_context_fixture database');
    }
    RESEARCH_FLAGS.targets = true;
    await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE TABLE owner_profiles (id uuid, is_current boolean);
      CREATE TABLE research_target_state (
        tenant_id uuid, user_id uuid, primary_target_id uuid,
        secondary_target_id uuid, last_used_lens_id uuid
      );
      CREATE TABLE research_targets (id uuid, tenant_id uuid, kind text, owner_id uuid, contact_id uuid);
      CREATE TABLE research_lenses (
        id uuid, tenant_id uuid, user_id uuid, name text, primary_target_id uuid,
        secondary_target_id uuid, config jsonb, is_default boolean,
        created_at timestamptz, updated_at timestamptz, deleted_at timestamptz
      );
      CREATE TABLE research_target_icps (target_id uuid, lens_id uuid, icp_profile_id uuid);
      CREATE TABLE icp_profiles (
        id uuid, name text, description text, is_active boolean, criteria jsonb,
        weight_overrides jsonb, niche_id uuid, source text,
        owner_baseline boolean NOT NULL DEFAULT false,
        created_at timestamptz, updated_at timestamptz
      );
      CREATE TABLE niche_profiles (
        id uuid, industry_id uuid, name text, description text, keywords text[],
        company_size_range text, geo_focus text[], member_count integer,
        affordability numeric, fitability numeric, buildability numeric,
        niche_score numeric, created_at timestamptz, updated_at timestamptz
      );
      CREATE TABLE industries (
        id uuid, name text, slug text, description text, metadata jsonb,
        created_at timestamptz, updated_at timestamptz
      );
      CREATE TABLE scoring_weight_profiles (
        id uuid, name text, description text, weights jsonb, is_default boolean,
        created_at timestamptz, updated_at timestamptz
      );
      CREATE TABLE contacts (
        id uuid PRIMARY KEY, degree integer, full_name text, first_name text,
        last_name text, linkedin_url text, title text, headline text, about text,
        current_company text, current_company_id uuid, connections_count integer,
        tags text[], location text, created_at timestamptz, is_archived boolean
      );
      CREATE TABLE companies (id uuid, industry text, size_range text);
      CREATE TABLE edges (source_contact_id uuid, target_contact_id uuid, edge_type text);
      CREATE TABLE graph_metrics (contact_id uuid, pagerank real, betweenness_centrality real, degree_centrality real);
      CREATE TABLE behavioral_observations (contact_id uuid);
      CREATE TABLE content_profiles (contact_id uuid, topics text[], posting_frequency text, avg_engagement real);
      CREATE TABLE cluster_memberships (contact_id uuid, cluster_id uuid);
      CREATE TABLE clusters (id uuid);
      CREATE TABLE contact_icp_fits (
        contact_id uuid REFERENCES contacts(id), icp_profile_id uuid,
        fit_score real, fit_breakdown jsonb, computed_at timestamptz,
        PRIMARY KEY (contact_id, icp_profile_id)
      );
      CREATE TABLE tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, description text,
        task_type text, status text, priority integer, contact_id uuid REFERENCES contacts(id),
        source text, url text, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now()
      );
      CREATE UNIQUE INDEX uq_tasks_pending_identity_repair_contact
        ON tasks(contact_id)
        WHERE task_type = 'REPAIR_IDENTITY' AND status = 'pending'
          AND source IN ('auto-score', 'impulse');
      COMMENT ON INDEX uq_tasks_pending_identity_repair_contact IS 'U1-056-auto-only-v3';
      CREATE UNIQUE INDEX uq_tasks_pending_auto_recommendation
        ON tasks(contact_id, source, task_type)
        WHERE status = 'pending' AND source IN ('auto-score', 'impulse')
          AND task_type IN ('SEND_MESSAGE', 'RESEARCH', 'ENGAGE_CONTENT');
      COMMENT ON INDEX uq_tasks_pending_auto_recommendation IS 'U1-056-auto-only-v3';
      CREATE TABLE scoring_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_type text, status text,
        total_contacts integer, scored_contacts integer DEFAULT 0, failed_contacts integer DEFAULT 0,
        started_at timestamptz, completed_at timestamptz, error_message text
      );
      CREATE TABLE tenants (id uuid PRIMARY KEY, slug text);
      INSERT INTO tenants VALUES ('550e8400-e29b-41d4-a716-446655440045', 'default');
      CREATE TABLE impulses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id),
        impulse_type text, source_entity_type text, source_entity_id uuid,
        payload jsonb, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE impulse_handlers (
        id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), impulse_type text,
        handler_type text, config jsonb, enabled boolean DEFAULT true, priority integer,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE impulse_acks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        impulse_id uuid REFERENCES impulses(id), handler_id uuid REFERENCES impulse_handlers(id),
        status text, result jsonb, processed_at timestamptz DEFAULT now()
      );
    `);
    await pool.query(`
      INSERT INTO owner_profiles VALUES ('550e8400-e29b-41d4-a716-446655440030', true);
      INSERT INTO research_target_state
        (tenant_id, user_id, primary_target_id, last_used_lens_id)
        VALUES ('${tenantA}', '${ownerA}', '${targetId}', '${lensA}');
      INSERT INTO research_lenses VALUES
        ('${lensA}', '${tenantA}', '${ownerA}', 'A', '${targetId}', NULL, '{}', true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', NULL),
        ('${lensB}', '${tenantA}', '${ownerA}', 'B', '${targetId}', NULL, '{}', false, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', NULL);
      INSERT INTO industries VALUES ('550e8400-e29b-41d4-a716-446655440060', 'Software', 'software', NULL, '{}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
      INSERT INTO niche_profiles VALUES
        ('550e8400-e29b-41d4-a716-446655440050', '550e8400-e29b-41d4-a716-446655440060', 'Tech', NULL, '{}', NULL, '{}', 0, NULL, NULL, NULL, NULL, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
      INSERT INTO icp_profiles
        (id, name, description, is_active, criteria, weight_overrides, niche_id, source,
         owner_baseline, created_at, updated_at) VALUES
        ('${icpA}', 'A', NULL, true, '{"roles":["Engineer"],"industries":["Software"]}', '{}',
         '550e8400-e29b-41d4-a716-446655440050', NULL, true,
         '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
        ('${icpB}', 'B', NULL, true, '{"roles":["Sales"]}', '{}', NULL, NULL, false,
         '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
      INSERT INTO research_target_icps VALUES ('${targetId}', '${lensA}', '${icpA}'), ('${targetId}', '${lensB}', '${icpB}');
      INSERT INTO scoring_weight_profiles VALUES
        ('550e8400-e29b-41d4-a716-446655440070', 'default', NULL,
         '{"icp_fit":0.2,"relationship_strength":0.4,"network_proximity":0.4}', true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
      INSERT INTO companies VALUES ('550e8400-e29b-41d4-a716-446655440080', 'Software', NULL);
      INSERT INTO contacts
        (id, degree, title, headline, about, current_company, current_company_id,
         connections_count, tags, location, created_at, is_archived) VALUES
        ('${contactId}', 1, 'Engineer', NULL, NULL, NULL, '550e8400-e29b-41d4-a716-446655440080', 0, '{}', NULL, '2026-09-01T00:00:00Z', false);
      UPDATE contacts SET full_name = 'Ada Lovelace',
        linkedin_url = 'https://www.linkedin.com/in/ada-lovelace/' WHERE id = '${contactId}';
      INSERT INTO research_targets VALUES
        ('550e8400-e29b-41d4-a716-446655440090', '${tenantA}', 'self', '${ownerA}', NULL),
        ('${targetId}', '${tenantA}', 'contact', NULL, '${contactId}');
    `);
  });

  beforeEach(async () => {
    ECC_FLAGS.impulses = false;
    await pool.query('UPDATE owner_profiles SET is_current = (id = $1)', [ownerA]);
    await pool.query('UPDATE research_target_state SET last_used_lens_id = $1', [lensA]);
    await pool.query(`UPDATE icp_profiles SET criteria = '{"roles":["Engineer"],"industries":["Software"]}', updated_at = '2026-09-01T00:00:00Z' WHERE id = $1`, [icpA]);
    await pool.query(`UPDATE industries SET name = 'Software', updated_at = '2026-09-01T00:00:00Z'`);
    await pool.query(`UPDATE scoring_weight_profiles SET weights = '{"icp_fit":0.2,"relationship_strength":0.4,"network_proximity":0.4}', updated_at = '2026-09-01T00:00:00Z'`);
    await pool.query(`UPDATE contacts SET title = 'Engineer' WHERE id = $1`, [contactId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('isolates preview IDs across two tenants and owners in PostgreSQL', async () => {
    await pool.query(`
      INSERT INTO tenants VALUES ('${foreignTenant}', 'other');
      INSERT INTO owner_profiles VALUES ('${foreignOwner}', false);
      INSERT INTO contacts (id, degree, full_name, linkedin_url, tags, is_archived)
        VALUES ('${foreignContact}', 1, 'Foreign', 'https://example.com/foreign', '{}', false);
      INSERT INTO research_targets VALUES
        ('550e8400-e29b-41d4-a716-446655440091', '${foreignTenant}', 'self', '${foreignOwner}', NULL),
        ('${foreignTarget}', '${foreignTenant}', 'contact', NULL, '${foreignContact}');
      INSERT INTO research_lenses VALUES
        ('${foreignLens}', '${foreignTenant}', '${foreignOwner}', 'Foreign', '${foreignTarget}',
         NULL, '{}', true, now(), now(), NULL);
      INSERT INTO research_target_icps VALUES ('${foreignTarget}', '${foreignLens}', '${icpA}');
    `);
    try {
      await expect(previewContactForTarget(contactId, foreignTarget)).rejects.toMatchObject({ status: 404 });
      await expect(previewContactForTarget(foreignContact, targetId)).rejects.toMatchObject({ status: 404 });
      await expect(previewContactForTarget(foreignContact, foreignTarget)).rejects.toMatchObject({ status: 404 });
      await pool.query('UPDATE research_lenses SET user_id = $1 WHERE id = $2', [foreignOwner, lensA]);
      await expect(previewContactForTarget(contactId, targetId)).rejects.toMatchObject({ status: 404 });
      await pool.query('UPDATE research_lenses SET user_id = $1 WHERE id = $2', [ownerA, lensA]);
      await pool.query('UPDATE owner_profiles SET is_current = true WHERE id = $1', [foreignOwner]);
      await expect(previewContactForTarget(contactId, targetId)).rejects.toMatchObject({ status: 404 });
      await pool.query('UPDATE owner_profiles SET is_current = false WHERE id = $1', [ownerA]);
      await expect(previewContactForTarget(contactId, targetId)).rejects.toMatchObject({ status: 404 });
    } finally {
      await pool.query('UPDATE research_lenses SET user_id = $1 WHERE id = $2', [ownerA, lensA]);
      await pool.query('UPDATE owner_profiles SET is_current = (id = $1)', [ownerA]);
      await pool.query('DELETE FROM research_target_icps WHERE target_id = $1', [foreignTarget]);
      await pool.query('DELETE FROM research_lenses WHERE id = $1', [foreignLens]);
      await pool.query('DELETE FROM research_targets WHERE tenant_id = $1', [foreignTenant]);
      await pool.query('DELETE FROM contacts WHERE id = $1', [foreignContact]);
      await pool.query('DELETE FROM owner_profiles WHERE id = $1', [foreignOwner]);
      await pool.query('DELETE FROM tenants WHERE id = $1', [foreignTenant]);
    }
  });

  it('keeps lens, ICP, weights, contact, and taxonomy on the first snapshot while another client commits changes', async () => {
    const originalConnect = pool.connect.bind(pool);
    let resume!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    let interceptFirst = true;
    let restoreClientQuery = () => {};
    const connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => {
      const client = await originalConnect();
      if (interceptFirst) {
        interceptFirst = false;
        const originalQuery = client.query;
        restoreClientQuery = () => { client.query = originalQuery; };
        const realQuery = client.query.bind(client);
        client.query = ((sql: string, params?: unknown[]) => {
          const result = realQuery(sql, params);
          if (sql.startsWith('SELECT transaction_timestamp')) {
            return result.then(async value => {
              reached();
              await released;
              return value;
            });
          }
          return result;
        }) as typeof client.query;
      }
      return client;
    });

    try {
      const pending = previewContactForTarget(contactId, targetId);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          paused,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Snapshot was not reached')), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      const writer = await originalConnect();
      try {
        await writer.query('UPDATE research_target_state SET last_used_lens_id = $1', [lensB]);
        await writer.query(`UPDATE icp_profiles SET criteria = '{"roles":["Sales"]}', updated_at = '2026-09-02T00:00:00Z' WHERE id = $1`, [icpA]);
        await writer.query(`UPDATE industries SET name = 'Finance', updated_at = '2026-09-02T00:00:00Z'`);
        await writer.query(`UPDATE scoring_weight_profiles SET weights = '{"icp_fit":0.9,"relationship_strength":0.05,"network_proximity":0.05}', updated_at = '2026-09-02T00:00:00Z'`);
        await writer.query(`UPDATE contacts SET title = 'Sales' WHERE id = $1`, [contactId]);
      } finally {
        writer.release();
      }
      resume();
      const preview = await pending;
      expect(preview.basis.lensId).toBe(lensA);
      expect(preview.basis.selectedIcpId).toBe(icpA);
      expect(preview.basis.icps[0].updatedAt).toBe('2026-09-01T00:00:00.000Z');
      expect(preview.basis.weightProfileUpdatedAt).toBe('2026-09-01T00:00:00.000Z');
      expect(preview.basis.weights.icp_fit).toBe(0.2);
      expect(preview.basis.scope).toBe('composite-and-referral');
      expect(preview.score.referralLikelihood).toEqual(expect.any(Number));
      expect(preview.basis.referralBaselines.totalClusters).toBe(1);
      expect(preview.score.dimensions.find(d => d.dimension === 'icp_fit')?.rawValue).toBe(1);
      expect(preview.basis.snapshotId).toEqual(expect.any(String));

      const next = await previewContactForTarget(contactId, targetId);
      expect(next.basis.lensId).toBe(lensB);
      expect(next.basis.selectedIcpId).toBe(icpB);
    } finally {
      resume();
      restoreClientQuery();
      connectSpy.mockRestore();
    }
  }, 15000);

  it('captures and freezes the owner basis before later database changes', async () => {
    const basis = await captureOwnerScoringBasis();
    const sameBasis = await captureOwnerScoringBasis();
    expect(sameBasis.basisHash).toBe(basis.basisHash);
    expect(basis.basisHash).toMatch(/^[0-9a-f]{64}$/);
    expect(basis.weightProfile.weights.icp_fit).toBe(0.2);
    expect(basis.icpProfiles.map(icp => icp.id)).toEqual([icpA]);
    expect(basis.icpProfiles.find(icp => icp.id === icpA)?.criteria.roles).toEqual(['Engineer']);
    expect(basis.criteriaByIcpId[icpA].industries).toEqual(['Software']);
    expect(basis.referralBaselines).toEqual({ p90Mutuals: 20, p90Edges: 10, totalClusters: 1 });
    expect(Object.isFrozen(basis.weightProfile.weights)).toBe(true);
    expect(Object.isFrozen(basis.criteriaByIcpId[icpA].roles)).toBe(true);

    await pool.query(`UPDATE icp_profiles SET criteria = '{"roles":["Sales"]}' WHERE id = $1`, [icpA]);
    await pool.query(`UPDATE industries SET name = 'Finance'`);
    await pool.query(`UPDATE scoring_weight_profiles SET weights = '{"icp_fit":0.9,"relationship_strength":0.05,"network_proximity":0.05}'`);

    expect(basis.weightProfile.weights.icp_fit).toBe(0.2);
    expect(basis.icpProfiles.find(icp => icp.id === icpA)?.criteria.roles).toEqual(['Engineer']);
    expect(basis.criteriaByIcpId[icpA].industries).toEqual(['Software']);
    const next = await captureOwnerScoringBasis();
    expect(next.basisHash).not.toBe(basis.basisHash);
    expect(next.weightProfile.weights.icp_fit).toBe(0.9);
    expect(next.criteriaByIcpId[icpA].industries).toEqual(['Finance']);
  });

  it('marks first owner write, backs up legacy score once, and restores it on rollback', async () => {
    const scoreId = '550e8400-e29b-41d4-a716-446655440090';
    await pool.query(`
      CREATE TABLE contact_scores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid UNIQUE REFERENCES contacts(id),
        composite_score real, tier text, persona text, behavioral_persona text,
        scoring_version integer, scored_at timestamptz, referral_likelihood real,
        referral_tier text, referral_persona text, behavioral_signals jsonb, referral_signals jsonb
      );
      CREATE TABLE score_dimensions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_score_id uuid REFERENCES contact_scores(id),
        dimension text, raw_value real, weighted_value real, weight real,
        metadata jsonb, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE referral_dimensions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_score_id uuid REFERENCES contact_scores(id),
        component text, raw_value real, weighted_value real, weight real,
        metadata jsonb, created_at timestamptz DEFAULT now()
      );
      INSERT INTO contact_scores (id, contact_id, composite_score, tier, persona,
        behavioral_persona, scoring_version, scored_at, referral_likelihood)
      VALUES ('${scoreId}', '${contactId}', 0.9, 'gold', 'buyer', 'super-connector', 1,
        '2026-09-01T00:00:00Z', 0.75);
      INSERT INTO contacts (id, degree, full_name, linkedin_url, title, tags, created_at, is_archived)
      VALUES ('${legacyInvalidId}', 1, 'Unknown', 'https://www.linkedin.com/in/unknown',
        'Engineer', '{}', '2026-09-01T00:00:00Z', false);
      INSERT INTO contact_scores (contact_id, composite_score, tier, persona, scoring_version, scored_at)
      VALUES ('${legacyInvalidId}', 0.95, 'gold', 'buyer', 1, '2026-09-01T00:00:00Z');
      INSERT INTO score_dimensions (contact_score_id, dimension, raw_value, weighted_value, weight, metadata)
      VALUES ('${scoreId}', 'icp_fit', 0.9, 0.9, 1, '{"legacy":true}');
      INSERT INTO referral_dimensions (contact_score_id, component, raw_value, weighted_value, weight, metadata)
      VALUES ('${scoreId}', 'referralRole', 0.75, 0.75, 1, '{"legacy":true}');
    `);
    const migration = readFileSync(resolve(process.cwd(), '../data/db/init/058-owner-score-basis.sql'), 'utf8');
    await pool.query(migration);
    const legacy = await getContactScoreBreakdown(contactId);
    expect(legacy?.basisKind).toBe('legacy-unverified');
    expect(legacy?.basisHash).toBeNull();

    const ownerScore: CompositeScore = {
      compositeScore: 0.2, tier: 'watch', persona: 'unknown',
      behavioralPersona: 'passive-observer', scoringVersion: 1,
      dimensions: [{ dimension: 'icp_fit', rawValue: 0.2, weightedValue: 0.2, weight: 1 }],
      referralLikelihood: null, referralTier: null, referralPersona: null,
      referralDimensions: null, behavioralSignals: null, referralSignals: null,
    };
    const hash = 'a'.repeat(64);
    const firstWrite = await upsertContactScore(contactId, ownerScore, hash);
    const secondWrite = await upsertContactScore(contactId, { ...ownerScore, compositeScore: 0.25 }, hash);
    expect(firstWrite).toMatchObject({ comparable: false, previous: null });
    expect(secondWrite).toMatchObject({ comparable: true, previous: { compositeScore: expect.closeTo(0.2) } });
    const persisted = await getContactScoreBreakdown(contactId);
    expect(persisted?.basisKind).toBe('owner');
    expect(persisted?.basisHash).toBe(hash);
    const backup = await pool.query<{ score_row: { composite_score: number }; dimensions: unknown[]; referral_dimensions: unknown[] }>(
      'SELECT score_row, dimensions, referral_dimensions FROM score_context_legacy_backups WHERE contact_id = $1',
      [contactId]
    );
    expect(backup.rows).toHaveLength(1);
    expect(backup.rows[0].score_row.composite_score).toBeCloseTo(0.9);
    expect(backup.rows[0].dimensions).toHaveLength(1);
    expect(backup.rows[0].referral_dimensions).toHaveLength(1);

    const restored = await pool.query<{ restored: boolean }>(
      'SELECT restore_legacy_contact_score($1) AS restored', [contactId]
    );
    expect(restored.rows[0].restored).toBe(true);
    const after = await getContactScoreBreakdown(contactId);
    expect(after?.basisKind).toBe('legacy-unverified');
    expect(after?.basisHash).toBeNull();
    expect(after?.tier).toBe('gold');
    expect(after?.persona).toBe('buyer');
    expect(after?.dimensions[0].rawValue).toBeCloseTo(0.9);
    expect(after?.referralDimensions[0].rawValue).toBeCloseTo(0.75);
  });

  it('repairs invalid identity when a retained legacy score is replaced, without outreach', async () => {
    const before = await getContactScoreBreakdown(legacyInvalidId);
    expect(before).toMatchObject({ basisKind: 'legacy-unverified', tier: 'gold', persona: 'buyer' });

    ECC_FLAGS.impulses = true;
    expect(await scoreBatch([legacyInvalidId])).toHaveLength(1);
    expect(await scoreBatch([legacyInvalidId])).toHaveLength(1);
    const tasks = await pool.query<{ task_type: string }>(
      `SELECT task_type FROM tasks WHERE contact_id = $1 ORDER BY task_type`, [legacyInvalidId]
    );
    expect(tasks.rows).toEqual([{ task_type: 'REPAIR_IDENTITY' }]);
    expect((await getContactScoreBreakdown(legacyInvalidId))?.basisKind).toBe('owner');
    const backup = await pool.query('SELECT contact_id FROM score_context_legacy_backups WHERE contact_id = $1',
      [legacyInvalidId]);
    expect(backup.rows).toHaveLength(1);
    expect((await pool.query('SELECT id FROM impulses WHERE source_entity_id = $1', [legacyInvalidId])).rows)
      .toHaveLength(0);
  });

  it('keeps the same score impulse identity on an exact batch retry and emits a real change', async () => {
    const retryContactId = '550e8400-e29b-41d4-a716-446655440095';
    await pool.query(`UPDATE scoring_weight_profiles SET weights = '{"icp_fit":1}'`);
    await pool.query(
      `INSERT INTO contacts (id, degree, full_name, linkedin_url, title, tags, is_archived)
       VALUES ($1, 1, 'Retry Contact', 'https://www.linkedin.com/in/retry-contact/', 'Engineer', '{}', false)`,
      [retryContactId]
    );
    ECC_FLAGS.impulses = true;
    const dispatch = jest.spyOn(impulseDispatcher, 'dispatchImpulse').mockImplementation(
      async impulseId => ({ impulseId, handlersExecuted: 0, results: [] })
    );
    const events = async () => (await pool.query<{ id: string; impulse_type: string }>(
      `SELECT id, impulse_type FROM impulses WHERE source_entity_id = $1
       ORDER BY score_revision, score_event_order`, [retryContactId]
    )).rows;
    try {
      expect(await scoreBatch([retryContactId])).toHaveLength(1);
      const first = await events();
      expect(first.map(event => event.impulse_type)).toEqual(['score_computed']);
      expect(dispatch).toHaveBeenCalledTimes(1);

      expect(await scoreBatch([retryContactId])).toHaveLength(1);
      expect(await events()).toEqual(first);
      expect(dispatch).toHaveBeenCalledTimes(1);

      await pool.query('UPDATE contacts SET title = $2 WHERE id = $1', [retryContactId, 'Sales']);
      expect(await scoreBatch([retryContactId])).toHaveLength(1);
      const changed = await events();
      expect(changed.filter(event => event.impulse_type === 'score_computed')).toHaveLength(2);
      expect(changed.map(event => event.impulse_type)).toEqual([
        'score_computed', 'score_computed', 'tier_changed', 'persona_assigned',
      ]);
      expect(changed[0].id).toBe(first[0].id);
      expect(changed[1].id).not.toBe(first[0].id);
      expect(dispatch).toHaveBeenCalledTimes(4);
    } finally {
      dispatch.mockRestore();
      ECC_FLAGS.impulses = false;
    }
  });

  it('commits and dispatches batch score transitions with one outreach task', async () => {
    await pool.query(`UPDATE scoring_weight_profiles SET weights = '{"icp_fit":1}'`);
    const basis = await captureOwnerScoringBasis();
    const computed = await scoreContact(contactId, undefined, undefined, basis, false);
    expect(computed.score.tier).toBe('gold');
    await upsertContactScore(contactId, { ...computed.score, tier: 'watch' }, basis.basisHash);
    ECC_FLAGS.impulses = true;
    const dispatch = jest.spyOn(impulseDispatcher, 'dispatchImpulse').mockImplementation(
      async impulseId => ({ impulseId, handlersExecuted: 0, results: [] })
    );
    try {
      expect(await scoreBatch([contactId])).toHaveLength(1);
      const tasks = await pool.query<{ task_type: string }>(
        `SELECT task_type FROM tasks WHERE contact_id = $1 ORDER BY task_type`, [contactId]
      );
      expect(tasks.rows.some(row => row.task_type === 'SEND_MESSAGE')).toBe(true);
      const impulses = await pool.query<{ impulse_type: string; score_dispatched_at: Date | null }>(
        `SELECT impulse_type, score_dispatched_at FROM impulses WHERE source_entity_id = $1
         ORDER BY score_revision, score_event_order`, [contactId]
      );
      expect(impulses.rows.map(row => row.impulse_type)).toEqual(['score_computed', 'tier_changed']);
      expect(impulses.rows.every(row => row.score_dispatched_at !== null)).toBe(true);
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(await scoreBatch([contactId])).toHaveLength(1);
      expect((await pool.query<{ id: string }>(
        'SELECT id FROM impulses WHERE source_entity_id = $1 ORDER BY score_revision, score_event_order',
        [contactId]
      )).rows).toHaveLength(2);
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect((await pool.query(`SELECT count(*)::int AS n FROM tasks
        WHERE contact_id = $1 AND task_type = 'SEND_MESSAGE'`, [contactId])).rows[0].n).toBe(1);
    } finally {
      dispatch.mockRestore();
      ECC_FLAGS.impulses = false;
    }
  });

  it('keeps Rescore All on the owner basis after a lens-only ICP edit', async () => {
    const before = await captureOwnerScoringBasis();
    await pool.query(`UPDATE icp_profiles SET criteria = '{"roles":["Executive"]}',
      updated_at = '2026-09-03T00:00:00Z' WHERE id = $1`, [icpB]);
    const after = await captureOwnerScoringBasis();
    expect(after.basisHash).toBe(before.basisHash);
    expect(after.icpProfiles.map(icp => icp.id)).toEqual([icpA]);
    const runId = await triggerRescoreAll();
    let status = 'running';
    for (let attempt = 0; attempt < 60 && status === 'running'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      status = (await pool.query<{ status: string }>('SELECT status FROM scoring_runs WHERE id = $1',
        [runId])).rows[0].status;
    }
    expect(status).toBe('completed');
    const scored = await getContactScoreBreakdown(contactId);
    expect(scored?.basisHash).toBe(before.basisHash);
    expect(scored?.basisKind).toBe('owner');
  }, 10000);

  it('rejects an older ON CONFLICT writer without corrupting verified owner score labels', async () => {
    const ownerScore: CompositeScore = {
      compositeScore: 0.4, tier: 'silver', persona: 'unknown',
      behavioralPersona: 'passive-observer', scoringVersion: 1,
      dimensions: [], referralLikelihood: null, referralTier: null, referralPersona: null,
      referralDimensions: null, behavioralSignals: null, referralSignals: null,
    };
    const hash = 'b'.repeat(64);
    await upsertContactScore(contactId, ownerScore, hash);
    await expect(pool.query(`
      INSERT INTO contact_scores (contact_id, composite_score, tier, persona, scoring_version)
      VALUES ($1, 0.8, 'gold', 'buyer', 1)
      ON CONFLICT (contact_id) DO UPDATE SET
        composite_score = EXCLUDED.composite_score, tier = EXCLUDED.tier,
        persona = EXCLUDED.persona, scoring_version = EXCLUDED.scoring_version
    `, [contactId])).rejects.toThrow('Contact score write requires owner scoring writer');
    const oldWriterResult = await getContactScoreBreakdown(contactId);
    expect(oldWriterResult).toMatchObject({
      compositeScore: expect.closeTo(0.4), tier: 'silver', basisKind: 'owner', basisHash: hash,
    });
    expect(await upsertContactScore(contactId, ownerScore, hash)).toMatchObject({
      comparable: true, previous: { tier: 'silver' },
    });
  });

  it('rejects an old-app insert instead of exposing an unverified new tier', async () => {
    const unscored = '550e8400-e29b-41d4-a716-446655440004';
    await pool.query('INSERT INTO contacts (id, title) VALUES ($1, $2)', [unscored, 'Sales']);
    await expect(pool.query(
      "INSERT INTO contact_scores (contact_id, composite_score, tier, persona) VALUES ($1, 0.99, 'gold', 'buyer')",
      [unscored]
    )).rejects.toThrow('Contact score write requires owner scoring writer');
    const rows = await pool.query('SELECT id FROM contact_scores WHERE contact_id = $1', [unscored]);
    expect(rows.rows).toHaveLength(0);
  });

  it('locks the predecessor so a concurrent scorer compares with the row it actually replaces', async () => {
    const hash = 'c'.repeat(64);
    const base: CompositeScore = {
      compositeScore: 0.3, tier: 'bronze', persona: 'unknown',
      behavioralPersona: 'passive-observer', scoringVersion: 1,
      dimensions: [], referralLikelihood: null, referralTier: null, referralPersona: null,
      referralDimensions: null, behavioralSignals: null, referralSignals: null,
    };
    await upsertContactScore(contactId, base, hash);
    const secondScore = { ...base, compositeScore: 0.65, tier: 'gold' as const };
    const writer = await pool.connect();
    let committed = false;
    try {
      await writer.query('BEGIN');
      await writer.query("SELECT set_config('app.score_owner_write', 'true', true)");
      await writer.query(
        "UPDATE contact_scores SET composite_score = 0.45, tier = 'silver' WHERE contact_id = $1",
        [contactId]
      );
      const writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const second = upsertContactScore(contactId, secondScore, hash);
      let blocked = false;
      for (let attempt = 0; attempt < 30 && !blocked; attempt++) {
        const state = await pool.query<{ blocked: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity a
             WHERE a.datname = current_database() AND a.pid <> pg_backend_pid()
               AND $1 = ANY(pg_blocking_pids(a.pid))
               AND a.query LIKE '%contact_scores WHERE contact_id%'
           ) AS blocked`, [writerPid]
        );
        blocked = state.rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
      await writer.query('COMMIT');
      committed = true;
      const secondResult = await second;
      expect(secondResult).toMatchObject({ comparable: true, previous: { tier: 'silver' } });
      expect(secondResult.previous?.compositeScore).toBeCloseTo(0.45);
      expect((await getContactScoreBreakdown(contactId))?.compositeScore).toBeCloseTo(0.65);
    } finally {
      if (!committed) await writer.query('ROLLBACK');
      writer.release();
    }
  }, 15000);

  it('reads scoring inputs only after the contact lock, even when a writer commits while scoring waits', async () => {
    const basis = await captureOwnerScoringBasis();
    const writer = await pool.connect();
    let committed = false;
    try {
      await writer.query('BEGIN');
      await writer.query("UPDATE contacts SET title = 'Sales' WHERE id = $1", [contactId]);
      const writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = scoreContact(contactId, undefined, undefined, basis, false);
      let blocked = false;
      for (let attempt = 0; attempt < 30 && !blocked; attempt++) {
        const state = await pool.query<{ blocked: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity a
             WHERE a.datname = current_database() AND a.pid <> pg_backend_pid()
               AND $1 = ANY(pg_blocking_pids(a.pid))
               AND a.query LIKE '%SELECT id FROM contacts WHERE id = $1 FOR UPDATE%'
           ) AS blocked`, [writerPid]
        );
        blocked = state.rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
      await writer.query('COMMIT');
      committed = true;
      const scored = await pending;
      const engineerFit = scored.icpFits.find(fit => fit.icpProfileId === icpA)?.fitScore ?? -1;
      expect(scored.icpFits.map(fit => fit.icpProfileId)).toEqual([icpA]);
      const engineerBaseline = await pool.query('UPDATE contacts SET title = $2 WHERE id = $1 RETURNING title',
        [contactId, 'Engineer']);
      expect(engineerBaseline.rows[0].title).toBe('Engineer');
      const rescored = await scoreContact(contactId, undefined, undefined, basis, false);
      expect(rescored.icpFits[0].fitScore).toBeGreaterThan(engineerFit);
      const persisted = await pool.query<{ fit_score: number }>(
        'SELECT fit_score FROM contact_icp_fits WHERE contact_id = $1 AND icp_profile_id = $2',
        [contactId, icpA]
      );
      expect(persisted.rows[0].fit_score).toBeCloseTo(rescored.icpFits[0].fitScore);
    } finally {
      if (!committed) await writer.query('ROLLBACK');
      writer.release();
    }
  }, 15000);

  it('rolls back score, dimensions, tasks, and fits when an ICP fit fails on single and batch paths', async () => {
    const basis = await captureOwnerScoringBasis();
    await scoreContact(contactId, undefined, undefined, basis, false);
    const beforeScore = await pool.query<{ composite_score: number; score_revision: string }>(
      'SELECT composite_score, score_revision FROM contact_scores WHERE contact_id = $1', [contactId]
    );
    const beforeFits = await pool.query<{ icp_profile_id: string; fit_score: number }>(
      'SELECT icp_profile_id, fit_score FROM contact_icp_fits WHERE contact_id = $1 ORDER BY icp_profile_id', [contactId]
    );
    const beforeTasks = await pool.query<{ count: string }>('SELECT count(*) FROM tasks');
    const beforeImpulses = await pool.query<{ count: string }>('SELECT count(*) FROM impulses');
    await pool.query(`
      CREATE FUNCTION fail_score_fit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected ICP fit failure'; END; $$;
      CREATE TRIGGER trg_fail_score_fit BEFORE INSERT OR UPDATE ON contact_icp_fits
      FOR EACH ROW EXECUTE FUNCTION fail_score_fit();
    `);
    try {
      await expect(scoreContact(contactId, undefined, undefined, basis)).rejects.toThrow('injected ICP fit failure');
      expect(await scoreBatch([contactId])).toEqual([]);
      const afterScore = await pool.query<{ composite_score: number; score_revision: string }>(
        'SELECT composite_score, score_revision FROM contact_scores WHERE contact_id = $1', [contactId]
      );
      const afterFits = await pool.query<{ icp_profile_id: string; fit_score: number }>(
        'SELECT icp_profile_id, fit_score FROM contact_icp_fits WHERE contact_id = $1 ORDER BY icp_profile_id', [contactId]
      );
      expect(afterScore.rows).toEqual(beforeScore.rows);
      expect(afterFits.rows).toEqual(beforeFits.rows);
      expect((await pool.query('SELECT count(*) FROM tasks')).rows).toEqual(beforeTasks.rows);
      expect((await pool.query('SELECT count(*) FROM impulses')).rows).toEqual(beforeImpulses.rows);
    } finally {
      await pool.query('DROP TRIGGER trg_fail_score_fit ON contact_icp_fits; DROP FUNCTION fail_score_fit()');
    }
  });

  it('dispatches concurrent committed score impulses in revision order', async () => {
    const basis = await captureOwnerScoringBasis();
    await scoreContact(contactId, undefined, undefined, basis, false);
    const before = await pool.query<{ score_revision: string }>(
      'SELECT score_revision FROM contact_scores WHERE contact_id = $1', [contactId]
    );
    const revision = Number(before.rows[0].score_revision);
    await pool.query('UPDATE contacts SET title = $2 WHERE id = $1', [contactId, 'Sales']);
    ECC_FLAGS.impulses = true;
    const dispatched: number[] = [];
    let reached!: () => void;
    let release!: () => void;
    const firstDispatch = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const spy = jest.spyOn(impulseDispatcher, 'dispatchImpulse').mockImplementation(async impulseId => {
      const event = await pool.query<{ score_revision: string }>(
        'SELECT score_revision FROM impulses WHERE id = $1', [impulseId]
      );
      if (dispatched.length === 0) { reached(); await resume; }
      dispatched.push(Number(event.rows[0].score_revision));
      return { impulseId, handlersExecuted: 0, results: [] };
    });
    try {
      const first = scoreContact(contactId, undefined, undefined, basis);
      await firstDispatch;
      await pool.query('UPDATE contacts SET title = $2 WHERE id = $1', [contactId, 'Engineer']);
      const second = scoreContact(contactId, undefined, undefined, basis);
      let secondCommitted = false;
      for (let attempt = 0; attempt < 30 && !secondCommitted; attempt++) {
        const row = await pool.query<{ score_revision: string }>(
          'SELECT score_revision FROM contact_scores WHERE contact_id = $1', [contactId]
        );
        secondCommitted = Number(row.rows[0].score_revision) === revision + 2;
        if (!secondCommitted) await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(secondCommitted).toBe(true);
      release();
      await Promise.all([first, second]);
      expect([...new Set(dispatched)]).toEqual([revision + 1, revision + 2]);
      const pending = await pool.query<{ count: string }>(
        'SELECT count(*) FROM impulses WHERE source_entity_id = $1 AND score_dispatched_at IS NULL',
        [contactId]
      );
      expect(Number(pending.rows[0].count)).toBe(0);
    } finally {
      release();
      spy.mockRestore();
      ECC_FLAGS.impulses = false;
    }
  }, 15000);

  it('keeps committed impulses pending after dispatch failure and replays them', async () => {
    const basis = await captureOwnerScoringBasis();
    await scoreContact(contactId, undefined, undefined, basis, false);
    await pool.query('UPDATE contacts SET title = $2 WHERE id = $1', [contactId, 'Sales']);
    ECC_FLAGS.impulses = true;
    const spy = jest.spyOn(impulseDispatcher, 'dispatchImpulse')
      .mockRejectedValueOnce(new Error('injected dispatcher failure'))
      .mockImplementation(async impulseId => ({ impulseId, handlersExecuted: 0, results: [] }));
    try {
      await scoreContact(contactId, undefined, undefined, basis);
      const pending = await pool.query<{ count: string }>(
        'SELECT count(*) FROM impulses WHERE source_entity_id = $1 AND score_dispatched_at IS NULL', [contactId]
      );
      expect(Number(pending.rows[0].count)).toBeGreaterThan(0);
      await drainScoringImpulses(contactId);
      const after = await pool.query<{ count: string }>(
        'SELECT count(*) FROM impulses WHERE source_entity_id = $1 AND score_dispatched_at IS NULL', [contactId]
      );
      expect(Number(after.rows[0].count)).toBe(0);
    } finally {
      spy.mockRestore();
      ECC_FLAGS.impulses = false;
    }
  });

  it('recovers committed pending impulses in bounded passes', async () => {
    ECC_FLAGS.impulses = true;
    const highest = await pool.query<{ revision: string }>(
      'SELECT COALESCE(MAX(score_revision), 0) AS revision FROM impulses WHERE source_entity_id = $1', [contactId]
    );
    const revision = Number(highest.rows[0].revision) + 100;
    await pool.query(
      `INSERT INTO impulses (tenant_id, impulse_type, source_entity_type, source_entity_id,
        payload, score_revision, score_event_order)
       VALUES ('550e8400-e29b-41d4-a716-446655440045', 'score_computed', 'contact', $1, '{}', $2, 0),
              ('550e8400-e29b-41d4-a716-446655440045', 'tier_changed', 'contact', $1, '{}', $2, 1)`,
      [contactId, revision]
    );
    const spy = jest.spyOn(impulseDispatcher, 'dispatchImpulse')
      .mockImplementation(async impulseId => ({ impulseId, handlersExecuted: 0, results: [] }));
    try {
      expect(await drainPendingScoringImpulses(1, 1)).toBe(1);
      const pending = () => pool.query<{ count: string }>(
        'SELECT count(*) FROM impulses WHERE source_entity_id = $1 AND score_dispatched_at IS NULL', [contactId]
      );
      expect(Number((await pending()).rows[0].count)).toBe(1);
      expect(await drainPendingScoringImpulses(1, 1)).toBe(1);
      expect(Number((await pending()).rows[0].count)).toBe(0);
    } finally {
      spy.mockRestore();
      ECC_FLAGS.impulses = false;
    }
  });

  it('keeps handler completion on disk and reuses webhook keys after an ack crash', async () => {
    const handlerA = '550e8400-e29b-41d4-a716-446655440091';
    const handlerB = '550e8400-e29b-41d4-a716-446655440092';
    await pool.query(
      `INSERT INTO impulse_handlers (id, tenant_id, impulse_type, handler_type, config, priority)
       VALUES ($1, '550e8400-e29b-41d4-a716-446655440045', 'score_computed', 'webhook',
               '{"target_url":"https://example.test/a"}', 1),
              ($2, '550e8400-e29b-41d4-a716-446655440045', 'score_computed', 'webhook',
               '{"target_url":"https://example.test/b"}', 2)`, [handlerA, handlerB]
    );
    const revision = Number((await pool.query<{ revision: string }>(
      'SELECT COALESCE(MAX(score_revision), 0) AS revision FROM impulses WHERE source_entity_id = $1', [contactId]
    )).rows[0].revision) + 1000;
    const impulse = await pool.query<{ id: string }>(
      `INSERT INTO impulses (tenant_id, impulse_type, source_entity_type, source_entity_id,
        payload, score_revision, score_event_order)
       VALUES ('550e8400-e29b-41d4-a716-446655440045', 'score_computed', 'contact', $1,
         '{}', $2, 0) RETURNING id`, [contactId, revision]
    );
    await pool.query(`
      CREATE FUNCTION fail_second_ack() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.handler_id = '${handlerB}' AND NEW.status = 'success' THEN
          RAISE EXCEPTION 'injected ack crash';
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER trg_fail_second_ack BEFORE INSERT ON impulse_acks
      FOR EACH ROW EXECUTE FUNCTION fail_second_ack();
    `);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);
    try {
      const first = await impulseDispatcher.dispatchImpulse(impulse.rows[0].id);
      expect(first.results.map(result => result.status)).toEqual(['success', 'failed']);
      await pool.query('DROP TRIGGER trg_fail_second_ack ON impulse_acks; DROP FUNCTION fail_second_ack()');
      const retry = await impulseDispatcher.dispatchImpulse(impulse.rows[0].id);
      expect(retry.results.map(result => result.status)).toEqual(['skipped', 'success']);
      const acks = await pool.query<{ handler_id: string; count: string }>(
        `SELECT handler_id, count(*) FROM impulse_acks
         WHERE impulse_id = $1 AND status = 'success' GROUP BY handler_id`, [impulse.rows[0].id]
      );
      expect(acks.rows.map(row => [row.handler_id, Number(row.count)]).sort())
        .toEqual([[handlerA, 1], [handlerB, 1]]);
      const deliveries = fetchSpy.mock.calls.map(([url, options]) => ({
        url, key: (options as RequestInit).headers &&
          ((options as RequestInit).headers as Record<string, string>)['Idempotency-Key'],
      }));
      expect(deliveries.map(item => item.url)).toEqual([
        'https://example.test/a', 'https://example.test/b', 'https://example.test/b',
      ]);
      expect(deliveries[1].key).toBe(`${impulse.rows[0].id}:${handlerB}`);
      expect(deliveries[2].key).toBe(deliveries[1].key);
      // HTTP succeeded before the ack failed: the remote endpoint received
      // this delivery twice. Only a receiver honoring the key can dedupe it.
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      ECC_FLAGS.impulses = true;
      await drainScoringImpulses(contactId);
    } finally {
      fetchSpy.mockRestore();
      ECC_FLAGS.impulses = false;
      await pool.query('DROP TRIGGER IF EXISTS trg_fail_second_ack ON impulse_acks; DROP FUNCTION IF EXISTS fail_second_ack()');
    }
  });

  it('dedupes notification tasks by impulse, while distinct impulses may notify one contact', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440045';
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO impulses (tenant_id, impulse_type, source_entity_type, source_entity_id, payload)
       VALUES ($1, 'score_computed', 'contact', $2, '{}'),
              ($1, 'score_computed', 'contact', $2, '{}') RETURNING id`, [tenantId, contactId]
    );
    const impulse = (id: string): Impulse => ({ id, tenantId, impulseType: 'score_computed',
      sourceEntityType: 'contact', sourceEntityId: contactId, payload: { tier: 'gold' },
      createdAt: new Date().toISOString() });
    const [first, retry] = await Promise.all([
      executeNotification(impulse(inserted.rows[0].id), { channel: 'task' }),
      executeNotification(impulse(inserted.rows[0].id), { channel: 'task' }),
    ]);
    const second = await executeNotification(impulse(inserted.rows[1].id), { channel: 'task' });
    expect(first.taskId).toBe(retry.taskId);
    expect(second.taskId).not.toBe(first.taskId);
    const tasks = await pool.query<{ id: string }>(
      `SELECT id FROM tasks WHERE id = ANY($1::uuid[]) AND task_type = 'notification'
       AND status = 'pending' AND contact_id = $2`, [[first.taskId, second.taskId], contactId]
    );
    expect(tasks.rows).toHaveLength(2);
    const mapping = await pool.query('SELECT impulse_id FROM impulse_notification_tasks WHERE impulse_id = ANY($1::uuid[])',
      [inserted.rows.map(row => row.id)]);
    expect(mapping.rows).toHaveLength(2);
    await pool.query('DELETE FROM tasks WHERE id = $1', [first.taskId]);
    const afterDeletion = await executeNotification(impulse(inserted.rows[0].id), { channel: 'task' });
    expect(afterDeletion.taskId).toBeNull();
    expect((await pool.query('SELECT task_id FROM impulse_notification_tasks WHERE impulse_id = $1',
      [inserted.rows[0].id])).rows).toEqual([{ task_id: null }]);
  });

  it('resumes a committed import score job after a failed pass without partial score writes', async () => {
    const client = await pool.connect();
    let jobId: string | null = null;
    try {
      await client.query('BEGIN');
      jobId = await createLegacyImportScoreJob(client, [contactId]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(jobId).toEqual(expect.any(String));
    const before = await pool.query<{ score_revision: string }>(
      'SELECT score_revision FROM contact_scores WHERE contact_id = $1', [contactId]
    );
    await pool.query(`CREATE FUNCTION fail_import_fit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected import fit failure'; END; $$;
      CREATE TRIGGER trg_fail_import_fit BEFORE INSERT OR UPDATE ON contact_icp_fits
      FOR EACH ROW EXECUTE FUNCTION fail_import_fit();`);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await drainPendingImportScoreJobs(10, 25)).toBeGreaterThan(0);
      const pending = await pool.query<{ scored_at: Date | null; attempts: number }>(
        'SELECT scored_at, attempts FROM score_import_job_contacts WHERE job_id = $1', [jobId]
      );
      expect(pending.rows[0].scored_at).toBeNull();
      expect(pending.rows[0].attempts).toBeGreaterThan(0);
      expect((await pool.query('SELECT score_revision FROM contact_scores WHERE contact_id = $1',
        [contactId])).rows).toEqual(before.rows);
    } finally {
      log.mockRestore();
      await pool.query('DROP TRIGGER trg_fail_import_fit ON contact_icp_fits; DROP FUNCTION fail_import_fit()');
    }
    expect(await drainPendingImportScoreJobs(10, 25)).toBeGreaterThan(0);
    const completed = await pool.query<{ scored_at: Date; completed_at: Date; basis_hash: string }>(
      `SELECT jc.scored_at, j.completed_at, j.basis_hash
       FROM score_import_jobs j JOIN score_import_job_contacts jc ON jc.job_id = j.id
       WHERE j.id = $1`, [jobId]
    );
    expect(completed.rows[0].scored_at).not.toBeNull();
    expect(completed.rows[0].completed_at).not.toBeNull();
    expect((await getContactScoreBreakdown(contactId))?.basisHash).toBe(completed.rows[0].basis_hash);
    const after = await pool.query('SELECT score_revision FROM contact_scores WHERE contact_id = $1',
      [contactId]);
    await drainPendingImportScoreJobs(10, 25);
    expect((await pool.query('SELECT score_revision FROM contact_scores WHERE contact_id = $1',
      [contactId])).rows).toEqual(after.rows);
  });

  it('terminally skips archived import contacts so a later healthy contact is scored', async () => {
    const archivedIds = Array.from({ length: 25 }, (_, index) =>
      `550e8400-e29b-41d4-a716-${String(100 + index).padStart(12, '0')}`);
    const healthyId = '550e8400-e29b-41d4-a716-000000000200';
    await pool.query(
      `INSERT INTO contacts(id, title, is_archived)
       SELECT id, 'Engineer', TRUE FROM unnest($1::uuid[]) AS archived(id)`, [archivedIds]
    );
    await pool.query('INSERT INTO contacts(id, title, is_archived) VALUES ($1, $2, FALSE)',
      [healthyId, 'Engineer']);
    const client = await pool.connect();
    let jobId: string | null = null;
    try {
      await client.query('BEGIN');
      jobId = await createLegacyImportScoreJob(client, [...archivedIds, healthyId]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await drainPendingImportScoreJobs(1, 25)).toBe(1);
    const skipped = await pool.query<{ count: string }>(
      'SELECT count(*) FROM score_import_job_contacts WHERE job_id = $1 AND skipped_at IS NOT NULL',
      [jobId]
    );
    expect(Number(skipped.rows[0].count)).toBe(25);
    expect((await pool.query('SELECT 1 FROM contact_scores WHERE contact_id = $1',
      [healthyId])).rows).toHaveLength(0);
    expect(await drainPendingImportScoreJobs(1, 25)).toBe(1);
    const scored = await getContactScoreBreakdown(healthyId);
    expect(scored?.basisKind).toBe('owner');
    expect(scored?.basisHash).toMatch(/^[0-9a-f]{64}$/);
    const job = await pool.query<{ completed_at: Date }>(
      'SELECT completed_at FROM score_import_jobs WHERE id = $1', [jobId]
    );
    expect(job.rows[0].completed_at).not.toBeNull();
  });

  it('keeps revisions monotonic after a scoring purge leaves older impulses', async () => {
    const purgedContact = '550e8400-e29b-41d4-a716-000000000251';
    await pool.query('INSERT INTO contacts(id, title, is_archived) VALUES ($1, $2, FALSE)',
      [purgedContact, 'Engineer']);
    const basis = await captureOwnerScoringBasis();
    ECC_FLAGS.impulses = true;
    const dispatch = jest.spyOn(impulseDispatcher, 'dispatchImpulse').mockImplementation(
      async impulseId => ({ impulseId, handlersExecuted: 0, results: [] })
    );
    try {
      await scoreContact(purgedContact, undefined, undefined, basis);
      const first = await pool.query<{ score_revision: string }>(
        'SELECT score_revision FROM contact_scores WHERE contact_id = $1', [purgedContact]
      );
      expect(Number(first.rows[0].score_revision)).toBe(1);
      await pool.query(`DELETE FROM score_dimensions WHERE contact_score_id IN
        (SELECT id FROM contact_scores WHERE contact_id = $1)`, [purgedContact]);
      await pool.query(`DELETE FROM referral_dimensions WHERE contact_score_id IN
        (SELECT id FROM contact_scores WHERE contact_id = $1)`, [purgedContact]);
      await pool.query('DELETE FROM contact_scores WHERE contact_id = $1', [purgedContact]);
      await scoreContact(purgedContact, undefined, undefined, basis);
      const second = await pool.query<{ score_revision: string }>(
        'SELECT score_revision FROM contact_scores WHERE contact_id = $1', [purgedContact]
      );
      expect(Number(second.rows[0].score_revision)).toBe(2);
      const impulses = await pool.query<{ score_revision: string }>(
        `SELECT score_revision FROM impulses WHERE source_entity_id = $1
         ORDER BY score_revision`, [purgedContact]
      );
      expect(impulses.rows.map(row => Number(row.score_revision))).toEqual([1, 2]);
    } finally {
      dispatch.mockRestore();
      ECC_FLAGS.impulses = false;
    }
  });

  it('rotates a failing contact so the bounded recovery sweep reaches another contact', async () => {
    const nextContact = '550e8400-e29b-41d4-a716-446655440093';
    await pool.query(
      `INSERT INTO contacts (id, full_name, degree, created_at) VALUES ($1, 'Next', 1, now())`,
      [nextContact]
    );
    const revision = Number((await pool.query<{ revision: string }>(
      'SELECT COALESCE(MAX(score_revision), 0) AS revision FROM impulses WHERE source_entity_id = $1', [contactId]
    )).rows[0].revision) + 1000;
    await pool.query(
      `INSERT INTO impulses (tenant_id, impulse_type, source_entity_type, source_entity_id,
         payload, score_revision, score_event_order, created_at)
       VALUES ('550e8400-e29b-41d4-a716-446655440045', 'tier_changed', 'contact', $1,
         '{}', $3, 0, now() - interval '2 minutes'),
         ('550e8400-e29b-41d4-a716-446655440045', 'tier_changed', 'contact', $2,
         '{}', 1, 0, now() - interval '1 minute')`, [contactId, nextContact, revision]
    );
    ECC_FLAGS.impulses = true;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const dispatchSpy = jest.spyOn(impulseDispatcher, 'dispatchImpulse').mockImplementation(async impulseId => {
      const row = await pool.query<{ source_entity_id: string }>(
        'SELECT source_entity_id FROM impulses WHERE id = $1', [impulseId]
      );
      return { impulseId, handlersExecuted: 1, results: [{
        handlerId: 'mock', status: row.rows[0].source_entity_id === contactId ? 'failed' : 'success',
        result: {}, durationMs: 0,
      }] };
    });
    try {
      expect(await drainPendingScoringImpulses(1, 1)).toBe(1);
      expect(await drainPendingScoringImpulses(1, 1)).toBe(1);
      const status = await pool.query<{ score_dispatched_at: Date | null }>(
        'SELECT score_dispatched_at FROM impulses WHERE source_entity_id = $1 AND score_revision = 1',
        [nextContact]
      );
      expect(status.rows[0].score_dispatched_at).not.toBeNull();
    } finally {
      dispatchSpy.mockRestore();
      errorSpy.mockRestore();
      ECC_FLAGS.impulses = false;
    }
  });
});
