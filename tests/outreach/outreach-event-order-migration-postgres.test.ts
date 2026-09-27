import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, shutdown } from '@/lib/db/client';

const dbUrl = process.env.DATABASE_URL;
const disposable = process.env.OUTREACH_DISPOSABLE_DB === '1' && !!dbUrl
  && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:localhost|127\.0\.0\.1):\d+\/outreach_stage_test$/.test(dbUrl);
const testIfDisposable = disposable ? test : test.skip;
const migration = readFileSync(join(__dirname, '../../data/db/init/061-outreach-event-order.sql'), 'utf8');
const rollback = readFileSync(join(__dirname, '../../data/db/rollback/061-outreach-event-order.sql'), 'utf8');

afterAll(async () => { await shutdown(); });

testIfDisposable.each([
  { first: 'won', second: 'not_started' },
  { first: 'not_started', second: 'won' },
])('061 preserves $first → $second despite reversed timestamps and rollback writes', async ({ first, second }) => {
  const client = await getPool().connect();
  const schema = `u7_event_order_${process.pid}_${Date.now()}`;
  const stateId = '11111111-1111-4111-8111-111111111111';
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE outreach_events (
      id UUID PRIMARY KEY, outreach_state_id UUID NOT NULL, event_type TEXT NOT NULL,
      event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query(`INSERT INTO outreach_events (id, outreach_state_id, event_type, created_at) VALUES
      ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'opened', '2025-01-01'),
      ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'sent', '2025-01-01')`);

    await client.query(migration);
    const ordered = async () => (await client.query<{ id: string; event_order: string }>(
      'SELECT id, event_order::text FROM outreach_events ORDER BY outreach_events.event_order'
    )).rows;
    const stage = async () => (await client.query<{ stage: string }>(
      `SELECT event_data->>'stage' AS stage FROM outreach_events
       WHERE outreach_state_id = $1 AND event_type = 'pipeline_stage_changed'
       ORDER BY event_order DESC LIMIT 1`, [stateId]
    )).rows[0].stage;
    const original = await ordered();
    expect(original).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', event_order: '1' },
      { id: '00000000-0000-4000-8000-000000000002', event_order: '2' },
    ]);
    await client.query(migration);
    expect(await ordered()).toEqual(original);
    // Consumed sequence values must not be reused when a rerun sees a gap.
    await client.query('SELECT nextval(\'outreach_event_order_seq\')');
    await client.query(migration);
    await client.query(`INSERT INTO outreach_events
      (id, outreach_state_id, event_type, event_data, created_at) VALUES
      ('00000000-0000-4000-8000-000000000003', $1, 'pipeline_stage_changed', jsonb_build_object('stage', $2::text), '2030-01-01'),
      ('00000000-0000-4000-8000-000000000004', $1, 'pipeline_stage_changed', jsonb_build_object('stage', $3::text), '2020-01-01')`,
      [stateId, first, second]);
    // An explicitly assigned order can run ahead of the sequence.
    await client.query(`INSERT INTO outreach_events
      (id, outreach_state_id, event_type, event_order, created_at) VALUES
      ('00000000-0000-4000-8000-000000000006', $1, 'opened', 100, '2015-01-01')`, [stateId]);
    const before = await ordered();
    expect(Number(before[2].event_order)).toBeGreaterThan(3);
    expect(before.map(({ id }) => id).slice(2, 4)).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
    ]);
    expect(await stage()).toBe(second);

    await client.query(rollback);
    expect((await client.query('SELECT COUNT(*)::int AS count FROM outreach_events')).rows[0].count).toBe(5);
    expect((await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'outreach_events' AND column_name = 'event_order'`, [schema])).rowCount).toBe(0);
    expect((await client.query('SELECT to_regclass($1) AS sequence', [`${schema}.outreach_event_order_seq`])).rows[0].sequence).not.toBeNull();
    expect((await client.query('SELECT to_regclass($1) AS index', [`${schema}.idx_outreach_events_order`])).rows[0].index).toBeNull();
    expect((await client.query('SELECT COUNT(*)::int AS count FROM outreach_event_order_rollback')).rows[0].count).toBe(5);
    const rolledBackStage = await client.query<{ stage: string }>(
      `SELECT oe.event_data->>'stage' AS stage FROM outreach_events oe
       JOIN outreach_event_order_rollback saved ON saved.event_id = oe.id
       WHERE oe.outreach_state_id = $1 AND oe.event_type = 'pipeline_stage_changed'
       ORDER BY saved.event_order DESC LIMIT 1`, [stateId]
    );
    expect(rolledBackStage.rows[0].stage).toBe(second);
    // The old application can still insert delivery events during rollback.
    await client.query(`INSERT INTO outreach_events (id, outreach_state_id, event_type, created_at)
      VALUES ('00000000-0000-4000-8000-000000000005', $1, 'opened', '2010-01-01')`, [stateId]);
    expect((await client.query('SELECT COUNT(*)::int AS count FROM outreach_event_order_rollback')).rows[0].count).toBe(6);
    expect(Number((await client.query<{ event_order: string }>(`SELECT event_order::text
      FROM outreach_event_order_rollback
      WHERE event_id = '00000000-0000-4000-8000-000000000005'`)).rows[0].event_order)).toBeGreaterThan(100);
    await client.query(migration);
    expect((await ordered()).slice(0, 5)).toEqual(before);
    expect(await stage()).toBe(second);
    expect((await ordered())).toHaveLength(6);
    expect((await client.query('SELECT to_regclass($1) AS saved', [`${schema}.outreach_event_order_rollback`])).rows[0].saved).toBeNull();
    await client.query(migration);
    expect(await stage()).toBe(second);
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});
