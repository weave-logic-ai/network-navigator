// Run explicitly with U1_TEST_DATABASE_URL pointing at a disposable Postgres
// cluster. This suite creates and drops two databases on that cluster.
import { readFileSync } from 'fs';
import path from 'path';
import { Client } from '../../app/node_modules/pg';

const fixtureUrl = process.env.U1_TEST_DATABASE_URL;
const run = fixtureUrl ? describe : describe.skip;
const suffix = process.pid.toString();
const freshName = `u1_fresh_${suffix}`;
const upgradedName = `u1_upgraded_${suffix}`;
const migrationSql = readFileSync(
  path.resolve(__dirname, '../../data/db/init/056-pending-identity-repair-unique.sql'), 'utf8'
);

const schemaSql = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE TABLE contacts (
    id uuid PRIMARY KEY, full_name text, first_name text, last_name text,
    linkedin_url text, degree integer, is_archived boolean DEFAULT false,
    current_company text, tags text[], title text
  );
  CREATE TABLE goals (
    id uuid PRIMARY KEY, title text, goal_type text, status text,
    source text DEFAULT 'system', metadata jsonb DEFAULT '{}'::jsonb,
    priority integer DEFAULT 5, created_at timestamptz DEFAULT now()
  );
  CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), goal_id uuid,
    contact_id uuid, title text, description text, task_type text,
    status text DEFAULT 'pending', priority integer, url text, source text,
    metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now()
  );
  CREATE TABLE goal_check_feedback (
    check_type text, goal_type text, context_hash text, accepted boolean
  );
  CREATE TABLE import_change_log (
    contact_id uuid, change_type text, field_changes jsonb,
    new_values jsonb, old_values jsonb, created_at timestamptz
  );
  CREATE TABLE offerings (id uuid, name text, description text, is_active boolean);
  CREATE TABLE content_profiles (contact_id uuid, topics text[], avg_engagement integer);
  CREATE TABLE contact_icp_fits (contact_id uuid, icp_profile_id uuid, fit_score real);
  CREATE TABLE icp_offerings (icp_id uuid, offering_id uuid);
`;

const selfId = '11111111-1111-1111-1111-111111111111';
const unknownId = '22222222-2222-2222-2222-222222222222';
const validId = '33333333-3333-3333-3333-333333333333';
const validConcurrencyId = '44444444-4444-4444-4444-444444444444';
const migrationActiveId = '55555555-5555-5555-5555-555555555555';
const migrationSuggestedId = '66666666-6666-6666-6666-666666666666';
const repairId = '99999999-9999-9999-9999-999999999999';
const raceId = 'abababab-abab-abab-abab-abababababab';

function databaseUrl(name: string): string {
  const url = new URL(fixtureUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

run('U1 real PostgreSQL fixture', () => {
  let admin: Client;
  let fresh: Client;
  let upgraded: Client;
  let shutdownAppPool: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    admin = new Client({ connectionString: fixtureUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${freshName}`);
    await admin.query(`CREATE DATABASE ${upgradedName}`);
    fresh = new Client({ connectionString: databaseUrl(freshName) });
    upgraded = new Client({ connectionString: databaseUrl(upgradedName) });
    await Promise.all([fresh.connect(), upgraded.connect()]);
    await Promise.all([fresh.query(schemaSql), upgraded.query(schemaSql)]);
    process.env.DATABASE_URL = databaseUrl(freshName);
    process.env.ECC_IMPULSES = 'false';
  });

  afterAll(async () => {
    if (shutdownAppPool) await shutdownAppPool();
    await Promise.all([fresh?.end(), upgraded?.end()]);
    await admin?.query(`DROP DATABASE IF EXISTS ${freshName} WITH (FORCE)`);
    await admin?.query(`DROP DATABASE IF EXISTS ${upgradedName} WITH (FORCE)`);
    await admin?.end();
  });

  it('gates an unupgraded volume, then preserves user repairs while deduplicating automatic tasks', async () => {
    const { requireIdentityTaskIndexes } = await import('@/lib/contacts/task-schema');
    const { shutdown } = await import('@/lib/db/client');
    shutdownAppPool = shutdown;
    await expect(requireIdentityTaskIndexes()).rejects.toThrow('056-pending-identity-repair-unique.sql');

    await fresh.query(
      `INSERT INTO contacts(id,full_name,linkedin_url,degree) VALUES
       ($1,'Owner','self:owner',1),
       ($2,'Unknown Person','https://www.linkedin.com/in/unknown',1),
       ($3,'Ada Lovelace','https://www.linkedin.com/in/ada-lovelace/',1),
       ($4,'Grace Hopper','https://www.linkedin.com/in/grace-hopper/',1),
       ($5,'Unknown Person','https://www.linkedin.com/in/unknown',1),
       ($6,'Race Contact','https://www.linkedin.com/in/race-contact/',1)`,
      [selfId, unknownId, validId, validConcurrencyId, repairId, raceId]
    );
    await fresh.query(
      `INSERT INTO goals(id,title,goal_type,status,source,metadata) VALUES
       ($1,'Introduce two contacts','relationship','active','system','{}'),
       ($2,'Suggest unknown contact','relationship','suggested','system',$3)`,
      [migrationActiveId, migrationSuggestedId, JSON.stringify({ suggestedTasks: [
        { taskType: 'SEND_MESSAGE', contactId: validId },
        { taskType: 'SEND_MESSAGE', contactId: unknownId },
      ] })]
    );
    await fresh.query(
      `INSERT INTO tasks(contact_id,title,task_type,source) VALUES
       ($1,'User self repair','REPAIR_IDENTITY','user'),
       ($1,'Auto self repair','REPAIR_IDENTITY','impulse'),
       ($2,'User unknown repair','REPAIR_IDENTITY','user'),
       ($2,'Auto repair 1','REPAIR_IDENTITY','auto-score'),
       ($2,'Auto repair 2','REPAIR_IDENTITY','impulse'),
       ($3,'Research 1','RESEARCH','auto-score'),
       ($3,'Research 2','RESEARCH','auto-score'),
       ($3,'Obsolete automatic repair','REPAIR_IDENTITY','auto-score'),
       ($3,'User valid-contact repair','REPAIR_IDENTITY','user'),
       ($1,'User outreach','SEND_MESSAGE','user'),
       ($1,'Auto outreach','SEND_MESSAGE','impulse')`,
      [selfId, unknownId, validId]
    );
    await fresh.query(
      `INSERT INTO tasks(goal_id,contact_id,title,task_type,source) VALUES
       ($1,$2,'Goal valid outreach','SEND_MESSAGE','system'),
       ($1,$3,'Goal unknown outreach','SEND_MESSAGE','system'),
       ($1,$3,'User goal outreach','SEND_MESSAGE','user')`,
      [migrationActiveId, validId, unknownId]
    );
    await fresh.query(
      `INSERT INTO tasks(contact_id,title,task_type,source) VALUES
       ($1,'Repair contact automatically','REPAIR_IDENTITY','auto-score'),
       ($1,'Repair contact manually','REPAIR_IDENTITY','user')`, [repairId]
    );
    await fresh.query(migrationSql);
    await expect(requireIdentityTaskIndexes()).resolves.toBeUndefined();

    const result = await fresh.query<{
      title: string; status: string; reason: string | null;
    }>(`SELECT title,status,metadata->'u1_identity_migration'->>'reason' AS reason FROM tasks`);
    const byTitle = Object.fromEntries(result.rows.map((row) => [row.title, row]));
    expect(byTitle['User self repair'].status).toBe('pending');
    expect(byTitle['User unknown repair'].status).toBe('pending');
    expect(byTitle['User outreach'].status).toBe('pending');
    expect(byTitle['Auto self repair'].reason).toBe('self_or_missing_repair');
    expect(byTitle['Obsolete automatic repair'].reason).toBe('identity_already_repaired');
    expect(byTitle['User valid-contact repair'].status).toBe('pending');
    expect(byTitle['Auto outreach'].reason).toBe('invalid_outreach_identity');
    expect(['Auto repair 1', 'Auto repair 2'].filter((title) => byTitle[title].status === 'pending')).toHaveLength(1);
    expect(['Research 1', 'Research 2'].filter((title) => byTitle[title].status === 'pending')).toHaveLength(1);
    expect(['Research 1', 'Research 2'].some((title) => byTitle[title].reason === 'duplicate_auto_task')).toBe(true);
    expect(byTitle['Goal unknown outreach'].reason).toBe('invalid_outreach_identity');
    expect(byTitle['Goal valid outreach'].reason).toBe('cancelled_stale_goal');
    expect(byTitle['User goal outreach'].status).toBe('pending');
    const migratedGoals = await fresh.query(
      `SELECT id,status,metadata->'u1_identity_migration'->>'reason' AS reason
       FROM goals WHERE id IN ($1,$2) ORDER BY id`, [migrationActiveId, migrationSuggestedId]
    );
    expect(migratedGoals.rows.map((row) => [row.status, row.reason])).toEqual([
      ['cancelled', 'stale_active_identity'],
      ['cancelled', 'stale_suggested_identity'],
    ]);
  });

  it('upgrades an earlier broad repair index without cancelling user tasks', async () => {
    await upgraded.query(
      `INSERT INTO contacts(id,full_name,linkedin_url,degree) VALUES
       ($1,'Unknown Person','https://www.linkedin.com/in/unknown',1)`, [unknownId]
    );
    await upgraded.query(
      `INSERT INTO tasks(contact_id,title,task_type,source) VALUES
       ($1,'Existing user repair','REPAIR_IDENTITY','user')`, [unknownId]
    );
    await upgraded.query(
      `CREATE UNIQUE INDEX uq_tasks_pending_identity_repair_contact ON tasks(contact_id)
       WHERE task_type='REPAIR_IDENTITY' AND status='pending'`
    );
    await upgraded.query(migrationSql);
    const user = await upgraded.query(`SELECT status FROM tasks WHERE title='Existing user repair'`);
    expect(user.rows[0].status).toBe('pending');
    await upgraded.query(
      `INSERT INTO tasks(contact_id,title,task_type,source) VALUES
       ($1,'New automatic repair','REPAIR_IDENTITY','auto-score')`, [unknownId]
    );
    const both = await upgraded.query(
      `SELECT source FROM tasks WHERE contact_id=$1 AND status='pending' ORDER BY source`, [unknownId]
    );
    expect(both.rows.map((row) => row.source)).toEqual(['auto-score', 'user']);
  });

  it('selects a valid later contact before LIMIT 1 in signal and relevance checks', async () => {
    await fresh.query(`UPDATE contacts SET tags=ARRAY['automation'] WHERE id IN ($1,$2)`, [selfId, validId]);
    await fresh.query(
      `INSERT INTO import_change_log VALUES
       ($1,'updated','["title"]','{"title":"Owner"}','{}',now()-interval '1 minute'),
       ($2,'updated','["title"]','{"title":"VP"}','{}',now()-interval '2 minutes')`,
      [selfId, validId]
    );
    await fresh.query(`INSERT INTO offerings VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Automation','automation',true)`);
    await fresh.query(
      `INSERT INTO content_profiles VALUES ($1,ARRAY['automation'],100),($2,ARRAY['automation'],10)`,
      [selfId, validId]
    );
    await fresh.query(
      `INSERT INTO contact_icp_fits VALUES
       ($1,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',0.99),
       ($2,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',0.9)`,
      [selfId, validId]
    );
    await fresh.query(`INSERT INTO icp_offerings VALUES
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')`);
    const { signalChecks } = await import('@/lib/goals/checks/signal-checks');
    const { relevanceChecks } = await import('@/lib/goals/checks/relevance-checks');
    const results = await Promise.all([
      signalChecks[0]({ page: 'dashboard' }),
      signalChecks[1]({ page: 'dashboard' }),
      relevanceChecks[1]({ page: 'discover', selectedIcpId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }),
    ]);
    expect(results.map((result) => result[0]?.metadata.suggestedTasks[0].contactId))
      .toEqual([validId, validId, validId]);
  });

  it('cancels a mixed stale goal without tasks or feedback, then accepts a valid linked goal', async () => {
    const mixedId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const validGoalId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const task = (id: string) => ({ title: 'Reach contact', taskType: 'SEND_MESSAGE', priority: 2, contactId: id });
    await fresh.query(
      `INSERT INTO goals(id,title,goal_type,status,source,metadata) VALUES
       ($1,'Stale title','test','suggested','system',$3),
       ($2,'Valid title','test','suggested','system',$4)`,
      [mixedId, validGoalId,
        JSON.stringify({ checkType: 'test', contextHash: mixedId, suggestedTasks: [task(validId), task(unknownId)] }),
        JSON.stringify({ checkType: 'test', contextHash: validGoalId, suggestedTasks: [task(validId)] })]
    );
    const { acceptGoal } = await import('@/lib/goals/engine');
    expect(await acceptGoal(mixedId)).toBe(false);
    expect(await acceptGoal(validGoalId)).toBe(true);
    const goals = await fresh.query(`SELECT id,status FROM goals WHERE id IN ($1,$2) ORDER BY id`, [mixedId, validGoalId]);
    const mixed = goals.rows.find((row) => row.id === mixedId);
    const valid = goals.rows.find((row) => row.id === validGoalId);
    expect(mixed.status).toBe('cancelled');
    expect(valid.status).toBe('active');
    const tasks = await fresh.query(`SELECT goal_id,url FROM tasks WHERE goal_id IN ($1,$2)`, [mixedId, validGoalId]);
    expect(tasks.rows).toEqual([{ goal_id: validGoalId, url: `/contacts/${validId}` }]);
    const feedback = await fresh.query(`SELECT context_hash FROM goal_check_feedback`);
    expect(feedback.rows).toEqual([{ context_hash: validGoalId }]);
  });

  it('reconciles suggested goals before listing and repairs identity through contact PATCH', async () => {
    const staleId = '77777777-7777-7777-7777-777777777777';
    const userGoalId = '88888888-8888-8888-8888-888888888888';
    const task = { taskType: 'SEND_MESSAGE', contactId: repairId };
    await fresh.query(
      `INSERT INTO goals(id,title,goal_type,status,source,metadata) VALUES
       ($1,'New stale suggestion','relationship','suggested','system',$3),
       ($2,'User draft','custom','suggested','user',$3)`,
      [staleId, userGoalId, JSON.stringify({ suggestedTasks: [task] })]
    );
    const { listGoals } = await import('@/lib/db/queries/goals');
    const listed = await listGoals({ status: 'suggested' });
    expect(listed.some((goal) => goal.id === staleId)).toBe(false);
    expect(listed.some((goal) => goal.id === userGoalId)).toBe(true);
    const stale = await fresh.query(
      `SELECT status,metadata->'u1_identity_guard'->>'reason' AS reason FROM goals WHERE id=$1`, [staleId]
    );
    expect(stale.rows[0]).toEqual({ status: 'cancelled', reason: 'stale_suggested_identity' });

    const { PATCH } = await import('@/app/api/contacts/[id]/route');
    const request = new Request(`http://localhost/api/contacts/${repairId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ full_name: 'Katherine Johnson',
        linkedin_url: 'https://www.linkedin.com/in/katherine-johnson/' }),
    });
    const response = await PATCH(request as Parameters<typeof PATCH>[0], { params: Promise.resolve({ id: repairId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.linkedinUrl).toBe('https://www.linkedin.com/in/katherine-johnson/');
    const repaired = await fresh.query(`SELECT full_name,linkedin_url FROM contacts WHERE id=$1`, [repairId]);
    expect(repaired.rows[0].full_name).toBe('Katherine Johnson');
    const repairs = await fresh.query(
      `SELECT source,status,metadata->'u1_identity_guard'->>'reason' AS reason
       FROM tasks WHERE contact_id=$1 AND task_type='REPAIR_IDENTITY' ORDER BY source`, [repairId]
    );
    expect(repairs.rows.filter((row) => row.source === 'user').every((row) => row.status === 'pending')).toBe(true);
    expect(repairs.rows.filter((row) => row.source !== 'user').every(
      (row) => row.status === 'skipped' && row.reason === 'identity_repaired')).toBe(true);

    const selfEdit = new Request(`http://localhost/api/contacts/${selfId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkedin_url: 'https://www.linkedin.com/in/owner/' }),
    });
    expect((await PATCH(selfEdit as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: selfId }) })).status).toBe(404);
    const self = await fresh.query(`SELECT linkedin_url FROM contacts WHERE id=$1`, [selfId]);
    expect(self.rows[0].linkedin_url).toBe('self:owner');
  });

  it('cancels a mixed active system goal when contact identity becomes invalid on PATCH', async () => {
    const goalId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const suggestionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await fresh.query(
      `INSERT INTO goals(id,title,goal_type,status,source,metadata) VALUES
       ($1,'Reach two people','relationship','active','system','{}'),
       ($2,'Suggest Ada','relationship','suggested','system',$3)`,
      [goalId, suggestionId, JSON.stringify({ suggestedTasks: [
        { taskType: 'SEND_MESSAGE', contactId: validId },
      ] })]
    );
    await fresh.query(
      `INSERT INTO tasks(goal_id,contact_id,title,task_type,status,source) VALUES
       ($1,$2,'Stale system outreach','SEND_MESSAGE','in_progress','system'),
       ($1,$3,'Valid companion outreach','SEND_MESSAGE','in_progress','system'),
       ($1,$2,'User authored outreach','SEND_MESSAGE','in_progress','user')`,
      [goalId, validId, validConcurrencyId]
    );
    const { PATCH } = await import('@/app/api/contacts/[id]/route');
    const request = new Request(`http://localhost/api/contacts/${validId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ full_name: 'Unknown Person' }),
    });
    const response = await PATCH(request as Parameters<typeof PATCH>[0], { params: Promise.resolve({ id: validId }) });
    expect(response.status).toBe(200);
    const goalRows = await fresh.query(
      `SELECT id,status FROM goals WHERE id IN ($1,$2) ORDER BY id`, [goalId, suggestionId]
    );
    expect(goalRows.rows.map((row) => row.status)).toEqual(['cancelled', 'cancelled']);
    const taskRows = await fresh.query(
      `SELECT title,status,metadata->'u1_identity_guard'->>'reason' AS reason,
        metadata->'u1_identity_guard'->>'prior_status' AS prior_status
       FROM tasks WHERE goal_id=$1 ORDER BY title`, [goalId]
    );
    expect(taskRows.rows).toEqual([
      { title: 'Stale system outreach', status: 'skipped', reason: 'invalid_outreach_identity', prior_status: 'in_progress' },
      { title: 'User authored outreach', status: 'in_progress', reason: null, prior_status: null },
      { title: 'Valid companion outreach', status: 'skipped', reason: 'cancelled_stale_goal', prior_status: 'in_progress' },
    ]);
  });

  it('keeps one pending repair and one pending recommendation under concurrent generator calls', async () => {
    const { checkAndGenerateTasks } = await import('@/lib/scoring/task-triggers');
    const { executeTaskGenerator } = await import('@/lib/ecc/impulses/handlers/task-generator');
    const score = { tier: 'gold', persona: null, referralPersona: null, behavioralPersona: null };
    const impulse = (id: string) => ({
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', tenantId: 't',
      impulseType: 'tier_changed' as const, sourceEntityType: 'contact' as const,
      sourceEntityId: id, payload: { from: 'silver', to: 'gold' }, createdAt: '2026-01-01',
    });
    await Promise.all([
      checkAndGenerateTasks(unknownId, null, score as never),
      executeTaskGenerator(impulse(unknownId) as never, {}),
    ]);
    const repairs = await fresh.query(
      `SELECT count(*)::int AS n FROM tasks WHERE contact_id=$1 AND task_type='REPAIR_IDENTITY' AND status='pending'
         AND source IN ('auto-score','impulse')`, [unknownId]
    );
    expect(repairs.rows[0].n).toBe(1);

    const outcomes = await Promise.all([
      executeTaskGenerator(impulse(validConcurrencyId) as never, {}),
      executeTaskGenerator(impulse(validConcurrencyId) as never, {}),
    ]);
    expect(outcomes.reduce((sum, outcome) => sum + Number(outcome.tasksCreated), 0)).toBe(1);
    const recommendations = await fresh.query(
      `SELECT count(*)::int AS n FROM tasks WHERE contact_id=$1 AND source='impulse'
         AND task_type='SEND_MESSAGE' AND status='pending'`, [validConcurrencyId]
    );
    expect(recommendations.rows[0].n).toBe(1);
  });

  it('rechecks identity after a concurrent contact update before either generator inserts', async () => {
    const { checkAndGenerateTasks } = await import('@/lib/scoring/task-triggers');
    const { executeTaskGenerator } = await import('@/lib/ecc/impulses/handlers/task-generator');
    await fresh.query('BEGIN');
    try {
      await fresh.query(`UPDATE contacts SET full_name='Unknown Person' WHERE id=$1`, [raceId]);
      const legacy = checkAndGenerateTasks(raceId, null, {
        tier: 'gold', persona: null, referralPersona: null, behavioralPersona: null,
      } as never);
      const ecc = executeTaskGenerator({
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', tenantId: 't',
        impulseType: 'tier_changed', sourceEntityType: 'contact',
        sourceEntityId: raceId, payload: { from: 'silver', to: 'gold' }, createdAt: '2026-01-01',
      } as never, {});
      await new Promise((resolve) => setTimeout(resolve, 40));
      await fresh.query('COMMIT');
      await Promise.all([legacy, ecc]);
    } catch (error) {
      await fresh.query('ROLLBACK');
      throw error;
    }
    const remaining = await fresh.query(
      `SELECT count(*)::int AS n FROM tasks WHERE contact_id=$1 AND status='pending'`, [raceId]
    );
    expect(remaining.rows[0].n).toBe(0);
  });
});
