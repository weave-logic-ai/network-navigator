import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getPool } from '@/lib/db/client';
import { importFullProfile } from '@/lib/import/profile-importer';

const enabled = process.env.SCORE_CONTEXT_DISPOSABLE_DB === 'true';
const fixtureRoot = resolve(process.cwd(), '../data/drives');

(enabled ? describe : describe.skip)('supported full-profile import on disposable PostgreSQL', () => {
  const pool = getPool();

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || !['55439', '55440'].includes(url.port) ||
        url.pathname !== '/full_profile_fixture') {
      throw new Error('Full-profile fixture requires a dedicated disposable PostgreSQL database');
    }
    await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE FUNCTION now_utc() RETURNS timestamptz LANGUAGE sql AS 'SELECT now()';
      CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
      CREATE TABLE tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL);
      INSERT INTO tenants(slug) VALUES ('default');`);
    await pool.query(readFileSync(resolve(process.cwd(), '../data/db/init/016-owner-profile-schema.sql'), 'utf8'));
    await pool.query(`CREATE TABLE research_targets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id),
      kind text NOT NULL, owner_id uuid REFERENCES owner_profiles(id), label text NOT NULL,
      UNIQUE (tenant_id, owner_id)
    )`);
  });

  afterAll(async () => { await pool.end(); });

  it('creates a self target for every imported owner version before scoring begins', async () => {
    const directory = await mkdtemp(join(fixtureRoot, 'full-profile-fixture-'));
    try {
      await writeFile(join(directory, 'Profile.csv'),
        'First Name,Last Name,Headline\nAda,Lovelace,Engineer\n');
      const client = await pool.connect();
      try {
        for (const version of [1, 2]) {
          const imported = await importFullProfile(client, directory);
          expect(imported.version).toBe(version);
          const owner = await client.query<{ owner_id: string }>(
            `SELECT owner.id AS owner_id FROM tenants tenant
             JOIN owner_profiles owner ON owner.is_current = TRUE
             JOIN research_targets self_target ON self_target.tenant_id = tenant.id
               AND self_target.kind = 'self' AND self_target.owner_id = owner.id
             WHERE tenant.slug = 'default'`);
          expect(owner.rows).toEqual([{ owner_id: imported.profileId }]);
        }
      } finally {
        client.release();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
