// Opt-in disposable PostgreSQL lifecycle test. Never point at a demo volume.
import { readFileSync } from 'fs';
import path from 'path';
import { Client } from '../../app/node_modules/pg';
jest.mock('@/lib/scoring/auto-score', () => ({ triggerAutoScore: jest.fn() }));

const fixtureUrl = process.env.U1_TEST_DATABASE_URL;
const run = fixtureUrl ? describe : describe.skip;
const databaseName = `u1_import_lifecycle_${process.pid}`;
const migrationSql = readFileSync(path.resolve(
  __dirname, '../../data/db/init/056-pending-identity-repair-unique.sql'
), 'utf8');

function fixtureDatabaseUrl(): string {
  const url = new URL(fixtureUrl!);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const schemaSql = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
  CREATE TABLE companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
    slug text UNIQUE NOT NULL, domain text, industry text, size_range text,
    linkedin_url text
  );
  CREATE TABLE contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), linkedin_url text UNIQUE NOT NULL,
    first_name text, last_name text, full_name text, headline text, title text,
    current_company text, current_company_id uuid REFERENCES companies(id),
    location text, about text,
    email text, phone text, tags text[] DEFAULT '{}', dedup_hash text,
    connections_count integer, degree integer DEFAULT 1,
    discovered_via text[] DEFAULT '{}', is_archived boolean DEFAULT false,
    updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE goals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, goal_type text,
    status text, source text DEFAULT 'system', metadata jsonb DEFAULT '{}'::jsonb,
    priority integer DEFAULT 5, created_at timestamptz DEFAULT now()
  );
  CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), goal_id uuid, contact_id uuid,
    title text, description text, task_type text, status text DEFAULT 'pending',
    priority integer, url text, source text, metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE impulses (id uuid PRIMARY KEY);
  CREATE TABLE impulse_notification_tasks (
    impulse_id uuid PRIMARY KEY REFERENCES impulses(id) ON DELETE CASCADE,
    task_id uuid UNIQUE REFERENCES tasks(id) ON DELETE SET NULL
  );
  CREATE TABLE goal_check_feedback (
    check_type text, goal_type text, context_hash text, accepted boolean
  );
  CREATE TABLE import_change_log (
    session_id text, contact_id uuid, change_type text,
    field_changes jsonb, old_values jsonb, new_values jsonb
  );
  CREATE TABLE edges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_contact_id uuid,
    target_contact_id uuid, edge_type text, weight real, properties jsonb
  );
`;

run('U1 importer and lock lifecycle on disposable PostgreSQL', () => {
  let admin: Client;
  let db: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: fixtureUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    db = new Client({ connectionString: fixtureDatabaseUrl() });
    await db.connect();
    await db.query(schemaSql);
    process.env.DATABASE_URL = fixtureDatabaseUrl();
  });

  afterAll(async () => {
    const { shutdown } = await import('@/lib/db/client');
    await shutdown();
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin?.end();
  });

  it('upgrades mixed in-progress system outreach and preserves user and completed work', async () => {
    const invalid = '10101010-1010-1010-1010-101010101010';
    const valid = '20202020-2020-2020-2020-202020202020';
    const goal = '30303030-3030-3030-3030-303030303030';
    const encoded = '31313131-3131-3131-3131-313131313131';
    const padded = '32323232-3232-3232-3232-323232323232';
    await db.query(`INSERT INTO contacts(id,linkedin_url,full_name) VALUES
      ($1,'https://www.linkedin.com/in/unknown','Unknown Person'),
      ($2,'https://www.linkedin.com/in/valid-contact','Valid Contact'),
      ($3,'https://www.linkedin.com/in/%75nknown','Encoded Unknown'),
      ($4,'https://www.linkedin.com/in/padded-unknown',$5)`,
    [invalid, valid, encoded, padded, ' \tUnknown Person\n']);
    await db.query(`INSERT INTO goals(id,title,goal_type,status,source) VALUES
      ($1,'Reach two contacts','relationship','active','system')`, [goal]);
    await db.query(`INSERT INTO tasks(goal_id,contact_id,title,task_type,status,source) VALUES
      ($1,$2,'Invalid in progress','SEND_MESSAGE','in_progress','system'),
      ($1,$3,'Companion in progress','SEND_MESSAGE','in_progress','system'),
      ($1,$2,'User in progress','SEND_MESSAGE','in_progress','user'),
      ($1,$2,'Completed system work','SEND_MESSAGE','completed','system')`,
    [goal, invalid, valid]);
    await db.query(`INSERT INTO tasks(contact_id,title,task_type,status,source) VALUES
      ($1,'Encoded invalid outreach','SEND_MESSAGE','pending','system'),
      ($1,'Encoded repair','REPAIR_IDENTITY','pending','auto-score')`, [encoded]);
    await db.query(`INSERT INTO tasks(contact_id,title,task_type,status,source) VALUES
      ($1,'Padded invalid outreach','SEND_MESSAGE','pending','system'),
      ($1,'Padded repair','REPAIR_IDENTITY','pending','auto-score')`, [padded]);
    await db.query(migrationSql);
    const tasks = await db.query(`SELECT title,status,
      metadata->'u1_identity_migration'->>'prior_status' AS prior_status
      FROM tasks WHERE goal_id=$1 ORDER BY title`, [goal]);
    expect(tasks.rows).toEqual([
      { title: 'Companion in progress', status: 'skipped', prior_status: 'in_progress' },
      { title: 'Completed system work', status: 'completed', prior_status: null },
      { title: 'Invalid in progress', status: 'skipped', prior_status: 'in_progress' },
      { title: 'User in progress', status: 'in_progress', prior_status: null },
    ]);
    const result = await db.query(`SELECT status FROM goals WHERE id=$1`, [goal]);
    expect(result.rows[0].status).toBe('cancelled');
    const encodedTasks = await db.query(`SELECT title,status FROM tasks
      WHERE contact_id=$1 ORDER BY title`, [encoded]);
    expect(encodedTasks.rows).toEqual([
      { title: 'Encoded invalid outreach', status: 'skipped' },
      { title: 'Encoded repair', status: 'pending' },
    ]);
    const paddedTasks = await db.query(`SELECT title,status FROM tasks
      WHERE contact_id=$1 ORDER BY title`, [padded]);
    expect(paddedTasks.rows).toEqual([
      { title: 'Padded invalid outreach', status: 'skipped' },
      { title: 'Padded repair', status: 'pending' },
    ]);
  });

  it('matches application and SQL eligibility for encoded, malformed and ordinary profiles', async () => {
    const { CONTACT_RECOMMENDATION_ELIGIBLE_SQL, isRecommendationEligible } =
      await import('@/lib/contacts/identity');
    for (const [url, expected] of [
      ['https://www.linkedin.com/in/%75nknown', false],
      ['https://www.linkedin.com/in/person%ZZ', false],
      ['https://www.linkedin.com/in/', false],
      ['https://www.linkedin.com/in/unknown', false],
      ['https://www.linkedin.com/in/valid-person/', true],
    ] as const) {
      const row = { full_name: 'Valid Person', first_name: null, last_name: null,
        linkedin_url: url, degree: 1, is_archived: false };
      const sql = await db.query(`SELECT (${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}) AS eligible
        FROM (SELECT $1::text AS full_name, $2::text AS first_name,
          $3::text AS last_name, $4::text AS linkedin_url,
          $5::integer AS degree, $6::boolean AS is_archived) c`,
      [row.full_name, row.first_name, row.last_name, row.linkedin_url, row.degree, row.is_archived]);
      expect([isRecommendationEligible(row), sql.rows[0].eligible]).toEqual([expected, expected]);
    }
    for (const [name, expected] of [
      [' \tUnknown Person\n', false],
      ['\rUnknown\t\tPerson\v', false],
      ['\nnot\tavailable\f', false],
      ['\t\n', false],
      ['\tAda\nLovelace\r', true],
    ] as const) {
      const row = { full_name: name, first_name: null, last_name: null,
        linkedin_url: 'https://www.linkedin.com/in/name-check', degree: 1,
        is_archived: false };
      const sql = await db.query(`SELECT (${CONTACT_RECOMMENDATION_ELIGIBLE_SQL}) AS eligible
        FROM (SELECT $1::text AS full_name, NULL::text AS first_name,
          NULL::text AS last_name, $2::text AS linkedin_url,
          1 AS degree, false AS is_archived) c`, [name, row.linkedin_url]);
      expect([isRecommendationEligible(row), sql.rows[0].eligible]).toEqual([expected, expected]);
    }
  });

  it('keeps distinct ECC notification impulses and reuses the same task on replay', async () => {
    const { executeNotification } = await import('@/lib/ecc/impulses/handlers/notification');
    const contact = '20202020-2020-2020-2020-202020202020';
    const base = { tenantId: 'fixture', impulseType: 'score_computed' as const,
      sourceEntityType: 'contact', sourceEntityId: contact,
      payload: { tier: 'gold' }, createdAt: new Date().toISOString() };
    const first = { ...base, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    const second = { ...base, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
    await db.query('INSERT INTO impulses(id) VALUES ($1), ($2)', [first.id, second.id]);
    const a = await executeNotification(first, { channel: 'task' });
    const b = await executeNotification(second, { channel: 'task' });
    const replay = await executeNotification(first, { channel: 'task' });
    expect(a.taskId).toBeTruthy();
    expect(b.taskId).toBeTruthy();
    expect(b.taskId).not.toBe(a.taskId);
    expect(replay.taskId).toBe(a.taskId);
    await db.query(migrationSql);
    const tasks = await db.query(`SELECT metadata->>'impulseId' AS impulse_id
      FROM tasks WHERE task_type='notification' AND contact_id=$1 ORDER BY impulse_id`, [contact]);
    expect(tasks.rows).toEqual([{ impulse_id: first.id }, { impulse_id: second.id }]);
  });

  it('CSV dedup repairs identity and closes automatic repairs in its transaction', async () => {
    const id = '40404040-4040-4040-4040-404040404040';
    const owner = '41414141-4141-4141-4141-414141414141';
    const url = 'https://www.linkedin.com/in/csv-repaired';
    await db.query(`INSERT INTO contacts(id,linkedin_url,full_name) VALUES
      ($1,$2,'Unknown Person'),($3,'self:csv-owner','Owner')`, [id, url, owner]);
    await db.query(`INSERT INTO tasks(contact_id,title,task_type,status,source) VALUES
      ($1,'CSV pending repair','REPAIR_IDENTITY','pending','auto-score'),
      ($1,'CSV in-progress repair','REPAIR_IDENTITY','in_progress','impulse'),
      ($1,'CSV user repair','REPAIR_IDENTITY','pending','user')`, [id]);

    const { importConnections } = await import('@/lib/import/connections-importer');
    const csv = [
      'Notes:', '"Your connections list"',
      'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
      `Ada,Lovelace,${url},,,,`,
    ].join('\n');
    const result = await importConnections(db as never, csv, 'csv-session', owner);
    expect(result.errors).toEqual([]);
    expect(result.updatedRecords).toBe(1);
    const tasks = await db.query(`SELECT title,status,
      metadata->'u1_identity_guard'->>'reason' AS reason
      FROM tasks WHERE contact_id=$1 ORDER BY title`, [id]);
    expect(tasks.rows).toEqual([
      { title: 'CSV in-progress repair', status: 'skipped', reason: 'identity_repaired' },
      { title: 'CSV pending repair', status: 'skipped', reason: 'identity_repaired' },
      { title: 'CSV user repair', status: 'pending', reason: null },
    ]);
  });

  it('does not reuse a rolled-back company ID on the next CSV row or retry', async () => {
    const owner = '42424242-4242-4242-4242-424242424242';
    const failedUrl = 'https://www.linkedin.com/in/failed-company-row';
    const healthyUrl = 'https://www.linkedin.com/in/healthy-company-row';
    await db.query(`INSERT INTO contacts(id,linkedin_url,full_name)
      VALUES ($1,'self:company-cache-owner','Owner')`, [owner]);
    await db.query(`CREATE FUNCTION reject_fail_csv_change() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF EXISTS (SELECT 1 FROM contacts WHERE id = NEW.contact_id AND first_name = 'Fail') THEN
          RAISE EXCEPTION 'simulated CSV row failure';
        END IF;
        RETURN NEW;
      END $$`);
    await db.query(`CREATE TRIGGER reject_fail_csv_change BEFORE INSERT ON import_change_log
      FOR EACH ROW EXECUTE FUNCTION reject_fail_csv_change()`);
    const { importConnections } = await import('@/lib/import/connections-importer');
    const preamble = [
      'Notes:', '"Your connections list"',
      'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    ];
    const csv = [...preamble,
      `Fail,Row,${failedUrl},,Acme Retry,,`,
      `Healthy,Row,${healthyUrl},,Acme Retry,,`,
    ].join('\n');
    const first = await importConnections(db as never, csv, 'company-cache-failure', owner);
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0].message).toContain('simulated CSV row failure');
    expect(first.newRecords).toBe(1);
    const persisted = await db.query(`SELECT c.linkedin_url, c.current_company_id,
      co.slug FROM contacts c JOIN companies co ON co.id = c.current_company_id
      WHERE c.linkedin_url = $1`, [healthyUrl]);
    expect(persisted.rows).toEqual([{
      linkedin_url: healthyUrl, current_company_id: expect.any(String), slug: 'acme-retry',
    }]);
    expect((await db.query(`SELECT count(*)::int AS n FROM companies WHERE slug='acme-retry'`))
      .rows[0].n).toBe(1);

    const retry = [...preamble, `Recovered,Row,${failedUrl},,Acme Retry,,`].join('\n');
    const second = await importConnections(db as never, retry, 'company-cache-retry', owner);
    expect(second.errors).toEqual([]);
    expect(second.newRecords).toBe(1);
    const contacts = await db.query(`SELECT count(*)::int AS n FROM contacts
      WHERE current_company_id = $1`, [persisted.rows[0].current_company_id]);
    expect(contacts.rows[0].n).toBe(2);
  });

  it('legacy graph contact upsert repairs identity and preserves user repairs', async () => {
    const id = '50505050-5050-5050-5050-505050505050';
    const url = 'https://www.linkedin.com/in/legacy-repaired';
    await db.query(`INSERT INTO contacts(id,linkedin_url,full_name) VALUES
      ($1,$2,'Unknown Person')`, [id, url]);
    await db.query(`INSERT INTO tasks(contact_id,title,task_type,status,source) VALUES
      ($1,'Legacy automatic repair','REPAIR_IDENTITY','pending','impulse'),
      ($1,'Legacy user repair','REPAIR_IDENTITY','pending','user')`, [id]);
    const { importLegacyContacts } = await import('@/lib/import/legacy-contacts');
    await db.query('BEGIN');
    try {
      await importLegacyContacts(db as never, {
        [url]: { profileUrl: url, name: 'Grace Hopper', degree: 1 },
      }, new Map());
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    const tasks = await db.query(`SELECT title,status FROM tasks WHERE contact_id=$1 ORDER BY title`, [id]);
    expect(tasks.rows).toEqual([
      { title: 'Legacy automatic repair', status: 'skipped' },
      { title: 'Legacy user repair', status: 'pending' },
    ]);
  });

  it('profile parser repairs a name and closes only automatic repairs', async () => {
    const id = '51515151-5151-5151-5151-515151515151';
    const url = 'https://www.linkedin.com/in/parser-profile';
    await db.query(`INSERT INTO contacts(id,linkedin_url,full_name) VALUES ($1,$2,'Unknown Person')`, [id, url]);
    await db.query(`INSERT INTO tasks(contact_id,title,task_type,status,source) VALUES
      ($1,'Parser auto repair','REPAIR_IDENTITY','pending','auto-score'),
      ($1,'Parser user repair','REPAIR_IDENTITY','pending','user')`, [id]);
    const { upsertContactFromProfile } = await import('@/lib/parser/contact-upsert');
    await upsertContactFromProfile({ name: 'Katherine Johnson', headline: null,
      location: null, about: null, connectionsCount: null, experience: [],
      education: [], skills: [], profileImageUrl: null }, url, 0.9);
    const tasks = await db.query(`SELECT title,status FROM tasks WHERE contact_id=$1 ORDER BY title`, [id]);
    expect(tasks.rows).toEqual([
      { title: 'Parser auto repair', status: 'skipped' },
      { title: 'Parser user repair', status: 'pending' },
    ]);
  });

  it('search parser fills a missing name and closes automatic repairs', async () => {
    const id = '52525252-5252-5252-5252-525252525252';
    const url = 'https://www.linkedin.com/in/parser-search';
    await db.query(`INSERT INTO contacts(id,linkedin_url) VALUES ($1,$2)`, [id, url]);
    await db.query(`INSERT INTO tasks(contact_id,title,task_type,status,source) VALUES
      ($1,'Search auto repair','REPAIR_IDENTITY','pending','impulse'),
      ($1,'Search user repair','REPAIR_IDENTITY','pending','user')`, [id]);
    const { upsertContactsFromSearch } = await import('@/lib/parser/contact-upsert');
    expect(await upsertContactsFromSearch([{ name: 'Dorothy Vaughan', headline: null,
      profileUrl: url, location: null, connectionDegree: '1st', mutualConnections: null }], url))
      .toEqual({ created: 0, updated: 1, skipped: 0 });
    const tasks = await db.query(`SELECT title,status FROM tasks WHERE contact_id=$1 ORDER BY title`, [id]);
    expect(tasks.rows).toEqual([
      { title: 'Search auto repair', status: 'skipped' },
      { title: 'Search user repair', status: 'pending' },
    ]);
  });

  it('keeps suggested goals visible across reloads until explicit accept or reject', async () => {
    const contact = '53535353-5353-5353-5353-535353535353';
    const acceptedGoal = '54545454-5454-5454-5454-545454545454';
    const rejectedGoal = '55555555-5555-5555-5555-555555555556';
    await db.query(`INSERT INTO contacts(id,linkedin_url,full_name) VALUES
      ($1,'https://www.linkedin.com/in/reviewable-person','Reviewable Person')`, [contact]);
    for (const goal of [acceptedGoal, rejectedGoal]) {
      await db.query(`INSERT INTO goals(id,title,goal_type,status,source,metadata) VALUES
        ($1,'Review before outreach','relationship','suggested','system',$2)`,
      [goal, JSON.stringify({ checkType: 'test', contextHash: goal, suggestedTasks: [
        { title: 'Reach reviewable person', taskType: 'SEND_MESSAGE', priority: 2,
          contactId: contact },
      ] })]);
    }
    const { listGoals } = await import('@/lib/db/queries/goals');
    const { acceptGoal, rejectGoal } = await import('@/lib/goals/engine');
    for (let reload = 0; reload < 2; reload++) {
      const suggestions = await listGoals({ status: 'suggested' });
      expect(suggestions.filter((goal) => [acceptedGoal, rejectedGoal].includes(goal.id)))
        .toHaveLength(2);
      const tasks = await db.query(`SELECT count(*)::int AS n FROM tasks
        WHERE goal_id = ANY($1::uuid[])`, [[acceptedGoal, rejectedGoal]]);
      expect(tasks.rows[0].n).toBe(0);
    }
    expect(await acceptGoal(acceptedGoal)).toBe(true);
    await rejectGoal(rejectedGoal);
    const statuses = await db.query(`SELECT id,status FROM goals
      WHERE id = ANY($1::uuid[]) ORDER BY id`, [[acceptedGoal, rejectedGoal]]);
    expect(statuses.rows).toEqual([
      { id: acceptedGoal, status: 'active' },
      { id: rejectedGoal, status: 'rejected' },
    ]);
  });

  it('contact edit and acceptance use contact→goal locks without deadlock', async () => {
    const id = '60606060-6060-6060-6060-606060606060';
    const goal = '70707070-7070-7070-7070-707070707070';
    await db.query(`INSERT INTO contacts(id,linkedin_url,full_name) VALUES
      ($1,'https://www.linkedin.com/in/lock-race','Lock Race')`, [id]);
    await db.query(`INSERT INTO goals(id,title,goal_type,status,source,metadata) VALUES
      ($1,'Race suggestion','relationship','suggested','system',$2)`,
    [goal, JSON.stringify({ checkType: 'test', contextHash: goal, suggestedTasks: [
      { title: 'Reach contact', taskType: 'SEND_MESSAGE', priority: 2, contactId: id },
    ] })]);

    const { acceptGoal } = await import('@/lib/goals/engine');
    const { reconcileContactIdentity } = await import('@/lib/contacts/identity-lifecycle');
    await db.query('BEGIN');
    try {
      const changed = await db.query(`UPDATE contacts SET full_name='Unknown Person'
        WHERE id=$1 RETURNING full_name,first_name,last_name,linkedin_url,degree,is_archived`, [id]);
      const acceptance = acceptGoal(goal);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const activity = await admin.query(`SELECT 1 FROM pg_stat_activity
          WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%FOR SHARE%'`, [databaseName]);
        if (activity.rows.length > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await reconcileContactIdentity(db as never, id, changed.rows[0]);
      await db.query('COMMIT');
      expect(await acceptance).toBe(false);
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    const result = await db.query(`SELECT status FROM goals WHERE id=$1`, [goal]);
    expect(result.rows[0].status).toBe('cancelled');
    const tasks = await db.query(`SELECT count(*)::int AS n FROM tasks WHERE goal_id=$1`, [goal]);
    expect(tasks.rows[0].n).toBe(0);
  }, 10000);

  it('two simultaneous identity edits of contacts in one goal serialize before task locks', async () => {
    const ids = ['81818181-8181-8181-8181-818181818181',
      '82828282-8282-8282-8282-828282828282'];
    const goal = '83838383-8383-8383-8383-838383838383';
    await db.query(`INSERT INTO contacts(id,linkedin_url,full_name) VALUES
      ($1,'https://www.linkedin.com/in/lock-one','Lock One'),
      ($2,'https://www.linkedin.com/in/lock-two','Lock Two')`, ids);
    await db.query(`INSERT INTO goals(id,title,goal_type,status,source) VALUES
      ($1,'Two-contact outreach','relationship','active','system')`, [goal]);
    await db.query(`INSERT INTO tasks(goal_id,contact_id,title,task_type,status,source) VALUES
      ($1,$2,'First outreach','SEND_MESSAGE','in_progress','system'),
      ($1,$3,'Second outreach','SEND_MESSAGE','pending','system')`, [goal, ...ids]);
    const clients = await Promise.all(ids.map(async () => {
      const client = new Client({ connectionString: fixtureDatabaseUrl() });
      await client.connect();
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout='3s'`);
      return client;
    }));
    try {
      const rows = await Promise.all(clients.map((client, index) => client.query(
        `UPDATE contacts SET full_name='Unknown Person' WHERE id=$1
         RETURNING full_name,first_name,last_name,linkedin_url,degree,is_archived`, [ids[index]
      ])));
      const { reconcileContactIdentity } = await import('@/lib/contacts/identity-lifecycle');
      // Hold the shared goal row while both contact updates remain uncommitted.
      await clients[0].query(`SELECT id FROM goals WHERE id=$1 FOR UPDATE`, [goal]);
      const second = reconcileContactIdentity(clients[1] as never, ids[1], rows[1].rows[0]);
      // The second edit must wait on the shared goal while the first completes.
      let blockedOnGoal = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const activity = await admin.query(`SELECT 1 FROM pg_stat_activity
          WHERE datname=$1 AND wait_event_type='Lock'
            AND query LIKE '%ORDER BY g.id FOR UPDATE%'`, [databaseName]);
        if (activity.rows.length > 0) { blockedOnGoal = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blockedOnGoal).toBe(true);
      await reconcileContactIdentity(clients[0] as never, ids[0], rows[0].rows[0]);
      await clients[0].query('COMMIT');
      await second;
      await clients[1].query('COMMIT');
      const result = await db.query(`SELECT status FROM goals WHERE id=$1`, [goal]);
      expect(result.rows[0].status).toBe('cancelled');
      const tasks = await db.query(`SELECT status FROM tasks WHERE goal_id=$1`, [goal]);
      expect(tasks.rows.every((task) => task.status === 'skipped')).toBe(true);
    } finally {
      for (const client of clients) {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.end();
      }
    }
  }, 10000);
});
