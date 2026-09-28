import { Pool, type PoolClient } from 'pg';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { importMessages } from '@/lib/import/messages-importer';
import { importPositions } from '@/lib/import/positions-importer';
import { importEducation } from '@/lib/import/education-importer';
import { importConnections } from '@/lib/import/connections-importer';
import { importFullProfile } from '@/lib/import/profile-importer';
import { runImportPipeline } from '@/lib/import/pipeline';
import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { POST as importFromDirectoryRoute } from '@/app/api/import/from-directory/route';
import { getPool } from '@/lib/db/client';

jest.mock('@/lib/db/client', () => ({ getPool: jest.fn(), query: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock('@/lib/import/directory-path', () => ({
  allowedImportDirectory: jest.fn(async (path: string) => path),
  validateDirectoryBatch: jest.fn().mockResolvedValue(undefined),
  readAllowedImportFile: jest.fn(async (_directory: string, path: string) =>
    jest.requireActual<typeof import('fs/promises')>('fs/promises').readFile(path)),
}));
jest.mock('@/lib/scoring/auto-score', () => ({ triggerBatchAutoScore: jest.fn() }));

jest.mock('@/lib/import/import-session', () => ({
  createImportSession: jest.fn().mockResolvedValue('550e8400-e29b-41d4-a716-446655440010'),
  updateSessionProgress: jest.fn().mockResolvedValue(undefined),
  completeSession: jest.fn().mockResolvedValue(undefined),
  createImportFileRecord: jest.fn().mockResolvedValue('550e8400-e29b-41d4-a716-446655440011'),
  updateImportFileRecord: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/import/embedding-generator', () => ({ generateEmbeddings: jest.fn().mockResolvedValue({}) }));
jest.mock('@/lib/taxonomy/seed', () => ({ seedTaxonomyIfEmpty: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/scoring/natural-icp', () => ({ computeNaturalICP: jest.fn().mockResolvedValue(null) }));

const databaseUrl = process.env.U9_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const owner = '550e8400-e29b-41d4-a716-446655440000';
const contact = '550e8400-e29b-41d4-a716-446655440001';
const recoveryContact = '550e8400-e29b-41d4-a716-446655440003';
const messages = 'From,To,Date,Subject,Content,Conversation ID\nAda Lovelace,Grace Hopper,2020-01-01T00:00:00Z,Hello,Test message,thread-1';
const positions = 'Company Name,Title,Started On,Finished On,Description\nAcme,Engineer,2018-01-01,2020-01-01,Builds things';
const education = 'School Name,Degree Name,Notes,Start Date,End Date\nUniversity,BS,Computing,2010-01-01,2014-01-01';

integration('U9 reruns against disposable PostgreSQL', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  beforeAll(async () => {
    await pool.query('CREATE SCHEMA IF NOT EXISTS u9_fixture');
    await pool.query(`CREATE TABLE u9_fixture.contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), linkedin_url text UNIQUE NOT NULL,
      full_name text, first_name text, last_name text, headline text, title text,
      current_company text, current_company_id uuid, location text, about text,
      email text, phone text, tags text[] DEFAULT '{}', dedup_hash text)`);
    await pool.query(`CREATE TABLE u9_fixture.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text UNIQUE NOT NULL, domain text, industry text, size_range text, linkedin_url text)`);
    await pool.query(`CREATE TABLE u9_fixture.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL, direction text NOT NULL, subject text, content text NOT NULL, conversation_id text, sent_at timestamptz NOT NULL, source text NOT NULL)`);
    await pool.query(`CREATE TABLE u9_fixture.message_stats (contact_id uuid PRIMARY KEY, total_messages int, sent_count int, received_count int, first_message_at timestamptz, last_message_at timestamptz, conversation_count int)`);
    await pool.query(`CREATE TABLE u9_fixture.work_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid, company_id uuid, company_name text, title text, start_date date, end_date date, is_current bool, description text, source text)`);
    await pool.query(`CREATE TABLE u9_fixture.education (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid, institution text, degree text, field_of_study text, start_date date, end_date date, source text)`);
    await pool.query(`CREATE TABLE u9_fixture.edges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_contact_id uuid, target_contact_id uuid, target_company_id uuid, edge_type text, weight real, properties jsonb)`);
    await pool.query(`CREATE TABLE u9_fixture.import_change_log (session_id uuid, contact_id uuid, change_type text, field_changes jsonb, old_values jsonb, new_values jsonb)`);
    const ownerSchema = await readFile(join(process.cwd(), '..', 'data/db/init/016-owner-profile-schema.sql'), 'utf8');
    const start = ownerSchema.indexOf('CREATE TABLE IF NOT EXISTS owner_profiles');
    const tableSql = ownerSchema.slice(start, ownerSchema.indexOf(');', start) + 2)
      .replace('CREATE TABLE IF NOT EXISTS owner_profiles', 'CREATE TABLE u9_fixture.owner_profiles')
      .replaceAll('uuid_generate_v4()', 'gen_random_uuid()').replaceAll('now_utc()', 'now()');
    await pool.query(tableSql);
    await pool.query(`INSERT INTO u9_fixture.contacts (id, linkedin_url, full_name, first_name, last_name)
      VALUES ($1, 'self:ada', 'Ada Lovelace', 'Ada', 'Lovelace'),
             ($2, 'https://linkedin.com/in/grace', 'Grace Hopper', 'Grace', 'Hopper'),
             ($3, 'https://linkedin.com/in/katherine', 'Katherine Johnson', 'Katherine', 'Johnson')`,
      [owner, contact, recoveryContact]);
    await pool.query(`INSERT INTO u9_fixture.companies (name, slug) VALUES ('Acme', 'acme'), ('University', 'university')`);
  });
  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS u9_fixture CASCADE');
    await pool.end();
  });

  it('counts repeated and concurrent identical child rows as skipped', async () => {
    const run = async (messageCsv = messages, positionCsv = positions, educationCsv = education) => {
      const client = await pool.connect();
      try {
        await client.query('SET search_path TO u9_fixture, public');
        return {
          messages: await importMessages(client, messageCsv, owner, owner, 'Ada Lovelace'),
          positions: await importPositions(client, positionCsv, owner),
          education: await importEducation(client, educationCsv, owner),
        };
      } finally { client.release(); }
    };
    const first = await run();
    const second = await run();
    const freshRows = [messages.replace('Test message', 'Second message'),
      positions.replace('Builds things', 'Builds more things'),
      education.replace('Computing', 'Mathematics')] as const;
    const concurrent = await Promise.all([run(...freshRows), run(...freshRows)]);
    for (const kind of ['messages', 'positions', 'education'] as const) {
      expect(first[kind]).toMatchObject({ totalRows: 1, newRecords: 1, skippedRecords: 0, errors: [] });
      expect(second[kind]).toMatchObject({ totalRows: 1, newRecords: 0, skippedRecords: 1, errors: [] });
      expect(concurrent.reduce((sum, result) => sum + result[kind].newRecords, 0)).toBe(1);
      expect(concurrent.reduce((sum, result) => sum + result[kind].skippedRecords, 0)).toBe(1);
      for (const result of concurrent) expect(result[kind].errors).toEqual([]);
    }
    for (const table of ['messages', 'work_history', 'education']) {
      expect((await pool.query(`SELECT count(*)::int AS count FROM u9_fixture.${table}`)).rows[0].count).toBe(2);
    }
    expect((await pool.query('SELECT total_messages, sent_count, received_count FROM u9_fixture.message_stats')).rows[0])
      .toMatchObject({ total_messages: 2, sent_count: 2, received_count: 0 });
    expect((await pool.query("SELECT count(*)::int AS count FROM u9_fixture.edges WHERE edge_type = 'MESSAGED'")).rows[0].count).toBe(1);
  });

  it('keeps one CONNECTED_TO edge when the same Connections.csv is rerun', async () => {
    const csv = 'Notes\nLinkedIn export\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nBob,Builder,https://linkedin.com/in/bob,,,,';
    const run = async (content = csv) => {
      const client = await pool.connect();
      try {
        await client.query('SET search_path TO u9_fixture, public');
        return await importConnections(client, content, owner, owner);
      } finally { client.release(); }
    };
    expect(await run()).toMatchObject({ totalRows: 1, newRecords: 1, skippedRecords: 0, errors: [] });
    expect(await run(csv.replace('bob,,,,', 'bob,,,,2020-01-01'))).toMatchObject({ totalRows: 1, newRecords: 0, skippedRecords: 1, errors: [] });
    const edges = await pool.query("SELECT count(*)::int AS count FROM u9_fixture.edges WHERE edge_type = 'CONNECTED_TO'");
    expect(edges.rows[0].count).toBe(1);
    expect((await pool.query("SELECT properties->>'connected_on' AS connected_on FROM u9_fixture.edges WHERE edge_type = 'CONNECTED_TO'")).rows[0].connected_on)
      .toBe('2020-01-01');
    await pool.query("DELETE FROM u9_fixture.edges WHERE edge_type = 'CONNECTED_TO'");
    const concurrent = await Promise.all([run(), run()]);
    for (const result of concurrent) expect(result).toMatchObject({ skippedRecords: 1, errors: [] });
    expect((await pool.query("SELECT count(*)::int AS count FROM u9_fixture.edges WHERE edge_type = 'CONNECTED_TO'")).rows[0].count).toBe(1);
  });

  it('concurrently imports a previously absent canonical connection without a row error', async () => {
    const csv = 'Notes\nLinkedIn export\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nTess,Pair,HTTPS://LINKEDIN.COM/IN/CONCURRENT-NEW/,,,,2020-01-01';
    const run = async () => {
      const client = await pool.connect();
      try {
        await client.query('SET search_path TO u9_fixture, public');
        return await importConnections(client, csv, owner, owner);
      } finally { client.release(); }
    };
    const results = await Promise.all([run(), run()]);
    expect(results.reduce((count, result) => count + result.newRecords, 0)).toBe(1);
    expect(results.reduce((count, result) => count + result.skippedRecords, 0)).toBe(1);
    for (const result of results) expect(result.errors).toEqual([]);
    const url = 'https://linkedin.com/in/concurrent-new';
    expect((await pool.query('SELECT count(*)::int AS count FROM u9_fixture.contacts WHERE linkedin_url = $1', [url])).rows[0].count).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS count FROM u9_fixture.edges e
      JOIN u9_fixture.contacts c ON c.id = e.target_contact_id
      WHERE c.linkedin_url = $1 AND e.edge_type = 'CONNECTED_TO'`, [url])).rows[0].count).toBe(1);
  });

  it('reuses historical www and tracked URLs while keeping profile/view ids distinct', async () => {
    const legacyId = '550e8400-e29b-41d4-a716-446655440020';
    const viewId = '550e8400-e29b-41d4-a716-446655440021';
    await pool.query(`INSERT INTO u9_fixture.contacts (id, linkedin_url, full_name, first_name, last_name) VALUES
      ($1, 'http://www.linkedin.com/in/historical/?trk=export', 'Historical Person', 'Historical', 'Person'),
      ($2, 'https://www.linkedin.com/profile/view?trk=legacy&id=101', 'View Person', 'View', 'Person')`, [legacyId, viewId]);
    const csv = 'Notes\nLinkedIn export\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nHistorical,Person,https://linkedin.com/in/historical,,,,\nView,Person,https://linkedin.com/profile/view?id=101,,,,\nOther,Person,https://linkedin.com/profile/view?id=102,,,,';
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO u9_fixture, public');
      expect(await importConnections(client, csv, owner, owner)).toMatchObject({
        totalRows: 3, newRecords: 1, skippedRecords: 2, errors: [],
      });
    } finally { client.release(); }
    expect((await pool.query("SELECT count(*)::int AS count FROM u9_fixture.contacts WHERE linkedin_url LIKE '%historical%' ")).rows[0].count).toBe(1);
    expect((await pool.query("SELECT linkedin_url FROM u9_fixture.contacts WHERE linkedin_url LIKE '%profile/view%' ORDER BY linkedin_url")).rows.map(row => row.linkedin_url))
      .toEqual(['https://linkedin.com/profile/view?id=102', 'https://www.linkedin.com/profile/view?trk=legacy&id=101']);
  });

  it('reports canonical and historical collisions without choosing a contact by id', async () => {
    const ids = ['550e8400-e29b-41d4-a716-446655440030', '550e8400-e29b-41d4-a716-446655440031'];
    await pool.query(`INSERT INTO u9_fixture.contacts (id, linkedin_url, full_name) VALUES
      ($1, 'https://linkedin.com/in/collision', 'Canonical'),
      ($2, 'http://www.linkedin.com/in/collision/?trk=old', 'Historical')`, ids);
    const csv = 'Notes\nLinkedIn export\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nWrong,Target,https://linkedin.com/in/collision,,,,\nDistinct,View,https://linkedin.com/profile/view?id=103,,,,';
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO u9_fixture, public');
      const result = await importConnections(client, csv, owner, owner);
      expect(result).toMatchObject({ totalRows: 2, newRecords: 1, skippedRecords: 1 });
      expect(result.errors[0].message).toContain('LinkedIn URL collision: 2 contacts');
      expect(result.errors[0].message).toContain(ids.join(', '));
    } finally { client.release(); }
    expect((await pool.query('SELECT full_name FROM u9_fixture.contacts WHERE id = ANY($1)', [ids])).rows.map(row => row.full_name).sort())
      .toEqual(['Canonical', 'Historical']);
  });

  it('rejects unsafe connection URLs before persistence but accepts LinkedIn host variants', async () => {
    const csv = 'Notes\nLinkedIn export\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nBad,Scheme,javascript:alert(1),,,,\nBad,Host,https://linkedin.com.evil.test/in/host,,,,\nValid,Variant,http://www.linkedin.com/in/valid-variant/,,,,\nValid,Legacy,https://uk.linkedin.com/pub/valid-legacy/1/2,,,,2020-01-01';
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO u9_fixture, public');
      expect(await importConnections(client, csv, owner, owner)).toMatchObject({
        totalRows: 4, newRecords: 2, skippedRecords: 2,
        errors: [expect.objectContaining({ message: expect.stringContaining('Invalid LinkedIn') }),
          expect.objectContaining({ message: expect.stringContaining('Invalid LinkedIn') })],
      });
    } finally { client.release(); }
    const rows = await pool.query("SELECT linkedin_url FROM u9_fixture.contacts WHERE first_name = 'Valid' ORDER BY linkedin_url");
    expect(rows.rows.map(row => row.linkedin_url)).toEqual([
      'https://linkedin.com/in/valid-variant', 'https://uk.linkedin.com/pub/valid-legacy/1/2',
    ]);
    expect((await pool.query("SELECT count(*)::int AS count FROM u9_fixture.contacts WHERE first_name = 'Bad'")).rows[0].count).toBe(0);
  });

  it('uses a captured Profile.csv owner name for local/upload route inputs and skips messages without it', async () => {
    const client = await pool.connect();
    const profilePath = '/synthetic/Profile.csv';
    const messagesPath = '/synthetic/Messages.csv';
    const content = 'From,To,Date,Subject,Content,Conversation ID\nAda Lovelace,Grace Hopper,2021-01-01T00:00:00Z,Outbound,Verified owner sent,owner-1\nGrace Hopper,Ada Lovelace,2021-01-02T00:00:00Z,Inbound,Verified owner received,owner-2';
    const snapshot = (value: string) => ({ bytes: Buffer.from(value), sha256: createHash('sha256').update(value).digest('hex') });
    try {
      await client.query('SET search_path TO u9_fixture, public');
      const snapshots = new Map([[profilePath, snapshot('First Name,Last Name\nAda,Lovelace')], [messagesPath, snapshot(content)]]);
      const imported = await runImportPipeline(client, [messagesPath, profilePath], owner, '', undefined, snapshots);
      expect(imported).toMatchObject({ totalRecords: 2, newRecords: 2, skippedRecords: 0, errors: [] });
      const rows = await pool.query("SELECT direction, content FROM u9_fixture.messages WHERE content LIKE 'Verified owner %' ORDER BY sent_at");
      expect(rows.rows).toEqual([
        { direction: 'sent', content: 'Verified owner sent' },
        { direction: 'received', content: 'Verified owner received' },
      ]);
      const skipped = await runImportPipeline(client, [messagesPath], owner, '', undefined,
        new Map([[messagesPath, snapshot(content.replaceAll('Verified owner', 'No owner'))]]));
      expect(skipped).toMatchObject({ totalRecords: 2, newRecords: 0, skippedRecords: 2 });
      expect(skipped.errors[0].message).toContain('valid Profile.csv');
      expect((await pool.query("SELECT count(*)::int AS count FROM u9_fixture.messages WHERE content LIKE 'No owner %'")).rows[0].count).toBe(0);
    } finally { client.release(); }
  });

  it('passes empty selfName through the directory route and imports both message directions', async () => {
    const directory = join(process.cwd(), 'uploads', 'imports', 'u9-route-fixture');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Profile.csv'), 'First Name,Last Name\nAda,Lovelace');
    await writeFile(join(directory, 'Messages.csv'),
      'From,To,Date,Subject,Content,Conversation ID\nAda Lovelace,Grace Hopper,2022-01-01T00:00:00Z,Route sent,Route sent body,route-1\nGrace Hopper,Ada Lovelace,2022-01-02T00:00:00Z,Route received,Route received body,route-2');
    jest.mocked(getPool).mockReturnValue({ connect: async () => {
      const client = await pool.connect();
      await client.query('SET search_path TO u9_fixture, public');
      return client;
    } } as unknown as Pool);
    try {
      const request = new NextRequest('http://localhost/api/import/from-directory', {
        method: 'POST', body: JSON.stringify({ directoryPath: directory, selfContactId: owner, selfName: '' }),
        headers: { 'content-type': 'application/json' },
      });
      const response = await importFromDirectoryRoute(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ totalRecords: 2, newRecords: 2, skippedRecords: 0, status: 'completed' });
      const rows = await pool.query("SELECT direction FROM u9_fixture.messages WHERE content LIKE 'Route %' ORDER BY sent_at");
      expect(rows.rows).toEqual([{ direction: 'sent' }, { direction: 'received' }]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('serializes aggregates for different simultaneous messages to one contact', async () => {
    const before = (await pool.query('SELECT count(*)::int AS count FROM u9_fixture.messages')).rows[0].count as number;
    const runs = Array.from({ length: 8 }, (_, index) => (async () => {
      const client = await pool.connect();
      try {
        await client.query('SET search_path TO u9_fixture, public');
        const csv = `From,To,Date,Subject,Content,Conversation ID\nAda Lovelace,Grace Hopper,2020-02-01T00:00:00Z,Concurrent ${index},Body ${index},thread-${index}`;
        return await importMessages(client, csv, owner, owner, 'Ada Lovelace');
      } finally { client.release(); }
    })());
    const results = await Promise.all(runs);
    for (const result of results) expect(result).toMatchObject({ newRecords: 1, skippedRecords: 0, errors: [] });
    const total = before + results.length;
    expect((await pool.query('SELECT total_messages FROM u9_fixture.message_stats WHERE contact_id = $1', [contact])).rows[0].total_messages).toBe(total);
    const edge = await pool.query("SELECT weight, properties FROM u9_fixture.edges WHERE edge_type = 'MESSAGED'");
    expect(edge.rows).toHaveLength(1);
    expect(edge.rows[0].properties.message_count).toBe(total);
    expect(edge.rows[0].weight).toBeCloseTo(Math.log(total + 1), 5);
  });

  it('repairs message stats and edge after a post-insert aggregate failure', async () => {
    const csv = 'From,To,Date,Subject,Content,Conversation ID\nAda Lovelace,Katherine Johnson,2020-03-01T00:00:00Z,Recovery,Stored before failure,recovery-thread';
    const raw = await pool.connect();
    await raw.query('SET search_path TO u9_fixture, public');
    let injected = false;
    const faultClient = { query: async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('INSERT INTO message_stats') && !injected) {
        injected = true;
        throw new Error('injected aggregate failure');
      }
      return raw.query(sql, values);
    } } as unknown as PoolClient;
    try {
      await expect(importMessages(faultClient, csv, owner, owner, 'Ada Lovelace'))
        .rejects.toThrow('injected aggregate failure');
    } finally { raw.release(); }
    expect((await pool.query('SELECT count(*)::int AS count FROM u9_fixture.messages WHERE contact_id = $1', [recoveryContact])).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM u9_fixture.message_stats WHERE contact_id = $1', [recoveryContact])).rows[0].count).toBe(0);
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO u9_fixture, public');
      expect(await importMessages(client, csv, owner, owner, 'Ada Lovelace'))
        .toMatchObject({ newRecords: 0, skippedRecords: 1, statsComputed: 1, errors: [] });
    } finally { client.release(); }
    expect((await pool.query('SELECT total_messages FROM u9_fixture.message_stats WHERE contact_id = $1', [recoveryContact])).rows[0].total_messages).toBe(1);
    const edges = await pool.query("SELECT weight, properties FROM u9_fixture.edges WHERE target_contact_id = $1 AND edge_type = 'MESSAGED'", [recoveryContact]);
    expect(edges.rows).toHaveLength(1);
    expect(edges.rows[0].properties.message_count).toBe(1);
    expect(edges.rows[0].weight).toBeCloseTo(Math.log(2), 5);
  });

  it('serializes concurrent owner-profile versions and leaves one current row', async () => {
    const snapshots = new Map([['Profile.csv', Buffer.from('First Name,Last Name\nAda,Lovelace')]]);
    const run = async () => {
      const client = await pool.connect();
      try {
        await client.query('SET search_path TO u9_fixture, public');
        return await importFullProfile(client, '/synthetic/export', snapshots, ['Profile.csv']);
      } finally { client.release(); }
    };
    const results = await Promise.all([run(), run()]);
    expect(results.map(result => result.version).sort()).toEqual([1, 2]);
    const rows = await pool.query('SELECT version, is_current FROM u9_fixture.owner_profiles ORDER BY version');
    expect(rows.rows).toEqual([{ version: 1, is_current: false }, { version: 2, is_current: true }]);
  });

  it('persists no guessed message direction for a partial owner name', async () => {
    const prior = new Map([['Profile.csv', Buffer.from('First Name,Last Name\nAda,Lovelace')],
      ['Messages.csv', Buffer.from('Conversation ID,From,To,Content\n1,Ada Lovelace,Grace Hopper,Known sender')]]);
    const priorClient = await pool.connect();
    try {
      await priorClient.query('SET search_path TO u9_fixture, public');
      await importFullProfile(priorClient, '/synthetic/export', prior, [...prior.keys()]);
    } finally { priorClient.release(); }
    const snapshots = new Map([
      ['Profile.csv', Buffer.from('First Name\nAda')],
      ['Messages.csv', Buffer.from('Conversation ID,From,To,Content\n1,Ada Lovelace,Grace Hopper,Ambiguous sender')],
    ]);
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO u9_fixture, public');
      const result = await importFullProfile(client, '/synthetic/export', snapshots, [...snapshots.keys()]);
      expect(result.skippedFiles).toContain('Messages.csv');
      expect(result.diagnostics[0]).toContain('both owner first and last name');
    } finally { client.release(); }
    const versions = await pool.query(`SELECT is_current, total_messages_sent, total_messages_received, total_conversations
      FROM u9_fixture.owner_profiles ORDER BY version DESC LIMIT 2`);
    expect(versions.rows[0]).toEqual({ is_current: true,
      total_messages_sent: null, total_messages_received: null, total_conversations: null });
    expect(versions.rows[1]).toEqual({ is_current: false,
      total_messages_sent: 1, total_messages_received: 0, total_conversations: 1 });
  });

  it('marks counts unavailable when neither message party is the verified owner', async () => {
    const snapshots = new Map([['Profile.csv', Buffer.from('First Name,Last Name\nAda,Lovelace')],
      ['Messages.csv', Buffer.from('Conversation ID,From,To,Content\n2,Unknown Sender,Grace Hopper,Unattributed')]]);
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO u9_fixture, public');
      const result = await importFullProfile(client, '/synthetic/export', snapshots, [...snapshots.keys()]);
      expect(result.skippedFiles).toContain('Messages.csv');
      expect(result.diagnostics).toContain('Messages.csv counts unavailable: sender or recipient cannot be matched to the verified owner.');
    } finally { client.release(); }
    expect((await pool.query(`SELECT total_messages_sent, total_messages_received, total_conversations
      FROM u9_fixture.owner_profiles WHERE is_current = TRUE`)).rows[0]).toEqual({
      total_messages_sent: null, total_messages_received: null, total_conversations: null,
    });
  });

  it('does not carry prior message totals into partial imports with absent or invalid Messages.csv', async () => {
    const prior = new Map([['Profile.csv', Buffer.from('First Name,Last Name\nAda,Lovelace')],
      ['Messages.csv', Buffer.from('Conversation ID,From,To,Content\n1,Ada Lovelace,Grace Hopper,Known sender')]]);
    const run = async (snapshots: Map<string, Buffer>) => {
      const client = await pool.connect();
      try {
        await client.query('SET search_path TO u9_fixture, public');
        return await importFullProfile(client, '/synthetic/export', snapshots, [...snapshots.keys()]);
      } finally { client.release(); }
    };
    const first = await run(prior);
    const missing = await run(new Map([['Profile.csv', Buffer.from('First Name\nAda')]]));
    expect(missing.diagnostics).toContain('Messages.csv counts unavailable: no Messages.csv was supplied in this import.');
    const invalid = await run(new Map([['Profile.csv', Buffer.from('First Name\nAda')],
      ['Messages.csv', Buffer.from('Conversation ID,To,Content\n2,Grace Hopper,Missing sender column')]]));
    expect(invalid.skippedFiles).toContain('Messages.csv');
    expect(invalid.diagnostics).toContain('Messages.csv counts unavailable: required From column is missing.');
    const versions = await pool.query(`SELECT id, total_messages_sent, total_messages_received, total_conversations
      FROM u9_fixture.owner_profiles WHERE id = ANY($1)`, [[first.profileId, missing.profileId, invalid.profileId]]);
    const byId = new Map(versions.rows.map(row => [row.id, row]));
    expect(byId.get(first.profileId)).toMatchObject({ total_messages_sent: 1, total_messages_received: 0, total_conversations: 1 });
    for (const id of [missing.profileId, invalid.profileId]) {
      expect(byId.get(id)).toMatchObject({ total_messages_sent: null, total_messages_received: null, total_conversations: null });
    }
  });
});
