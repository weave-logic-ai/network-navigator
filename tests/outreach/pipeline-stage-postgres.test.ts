import { NextRequest } from '../../app/node_modules/next/server';
import { query, shutdown, getPool } from '@/lib/db/client';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { GET } from '../../app/src/app/api/outreach/pipeline/route';
import { PUT } from '../../app/src/app/api/outreach/pipeline/[id]/route';
import { GET as getContacts } from '../../app/src/app/api/contacts/route';
import { POST as recordEvent } from '../../app/src/app/api/outreach/events/route';
import { GET as previewAudience, POST as enrollAudience } from '../../app/src/app/api/outreach/campaigns/[id]/populate/route';
import { listCampaigns, getTemplatePerformanceStats, deleteTemplate } from '@/lib/db/queries/outreach';

jest.mock('@/lib/scoring/outreach-feedback', () => ({ processOutreachFeedback: jest.fn().mockResolvedValue(undefined) }));

const dbUrl = process.env.DATABASE_URL;
const disposable = process.env.OUTREACH_DISPOSABLE_DB === '1' && !!dbUrl
  && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:localhost|127\.0\.0\.1):\d+\/outreach_stage_test$/.test(dbUrl);
const testIfDisposable = disposable ? test : test.skip;
const secretBefore = process.env.LOCAL_OPERATOR_SECRET;
const contact = '11111111-1111-4111-8111-111111111111';
const freshContact = '55555555-5555-4555-8555-555555555555';
const campaignA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const campaignB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stateA = '33333333-3333-4333-8333-333333333333';
const stateB = '44444444-4444-4444-8444-444444444444';

// Migration 058 admits contact_scores writes only from the owner scoring
// writer, so fixture scores go through the same transaction-local flag.
async function seedOwnerScores(sql: string, params: unknown[]) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.score_owner_write', 'true', true)");
    await client.query(sql, params);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
const OWNER_BASIS = "'owner', repeat('a', 64)";

function req(path: string, cookie: string, method = 'GET', body?: string) {
  return new NextRequest(`http://localhost:3750${path}`, {
    method,
    headers: {
      host: 'localhost:3750', origin: 'http://localhost:3750', 'sec-fetch-site': 'same-origin',
      cookie: `${OPERATOR_COOKIE}=${cookie}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    }, body,
  });
}

testIfDisposable('real PostgreSQL: manual stages survive later delivery events and campaigns stay isolated', async () => {
  process.env.LOCAL_OPERATOR_SECRET = 'synthetic-operator-secret-for-outreach-tests';
  try {
    // Runs against the full data/db/init chain, including 058's owner-score guard.
    await query('INSERT INTO contacts (id, full_name, linkedin_url) VALUES ($1, $2, $3)',
      [contact, 'Synthetic Contact', 'https://www.linkedin.com/in/u7-synthetic-contact']);
    await query('INSERT INTO contacts (id, full_name, linkedin_url) VALUES ($1, $2, $3)',
      [freshContact, 'Fresh Contact', 'https://www.linkedin.com/in/u7-fresh-contact']);
    await query('INSERT INTO outreach_campaigns (id, name) VALUES ($1, $2), ($3, $4)',
      [campaignA, 'Campaign A', campaignB, 'Campaign B']);
    await query(`INSERT INTO outreach_states (id, contact_id, campaign_id, state) VALUES
      ($1, $2, $3, 'not_started'), ($4, $2, $5, 'replied')`, [stateA, contact, campaignA, stateB, campaignB]);
    const cookie = await createOperatorSession();
    const post = (campaignId?: string, eventType = 'replied', contactId = contact,
      eventData?: Record<string, unknown>) => recordEvent(req('/api/outreach/events', cookie!, 'POST',
      JSON.stringify({ contact_id: contactId, ...(campaignId ? { campaign_id: campaignId } : {}),
        event_type: eventType, ...(eventData ? { event_data: eventData } : {}) })));
    const move = async (stage: string, campaignId = campaignA) => {
      const version = (await query<{ version: string }>(
        'SELECT COALESCE(MAX(event_order), 0)::text AS version FROM outreach_events WHERE outreach_state_id = $1', [stateA])).rows[0].version;
      return PUT(req(`/api/outreach/pipeline/${stateA}`, cookie!, 'PUT',
        JSON.stringify({ stage, campaign_id: campaignId, event_version: Number(version) })),
        { params: Promise.resolve({ id: stateA }) });
    };
    const read = async (campaign: string) => {
      const response = await GET(req(`/api/outreach/pipeline?campaign_id=${campaign}`, cookie!));
      expect(response.status).toBe(200);
      return (await response.json()).stages;
    };
    const contactStage = async (campaign?: string, contactId = contact) => {
      const suffix = campaign ? `?campaign_id=${campaign}` : '';
      const response = await getContacts(req(`/api/contacts${suffix}`, cookie!));
      if (response.status !== 200) throw new Error(await response.text());
      const row = (await response.json()).data.find((item: { id: string }) => item.id === contactId);
      if (!row) throw new Error(`Contact ${contactId} missing from list`);
      return row.outreachStage as string | null;
    };

    // A contact without any outreach row must remain "No outreach" both in
    // latest-activity view and when a campaign is selected.
    expect(await contactStage(undefined, freshContact)).toBeNull();
    const beforeEnrollment = await getContacts(req(`/api/contacts?campaign_id=${campaignA}`, cookie!));
    expect((await beforeEnrollment.json()).data.find((item: { id: string }) => item.id === freshContact)).toBeUndefined();
    expect((await post(campaignA, 'accepted', freshContact)).status).toBe(201);
    const freshState = await query<{ id: string; state: string }>(
      'SELECT id, state FROM outreach_states WHERE contact_id = $1 AND campaign_id = $2',
      [freshContact, campaignA]
    );
    expect(freshState.rows).toHaveLength(1);
    expect(freshState.rows[0].state).toBe('accepted');
    expect(await contactStage(campaignA, freshContact)).toBe('contacted');
    expect((await read(campaignA)).contacted.map((row: { id: string }) => row.id)).toContain(freshContact);
    expect((await post(campaignA, 'opened', freshContact)).status).toBe(201);
    expect((await query<{ state: string }>('SELECT state FROM outreach_states WHERE id = $1',
      [freshState.rows[0].id])).rows[0].state).toBe('accepted');
    expect(await contactStage(campaignA, freshContact)).toBe('contacted');
    await query('DELETE FROM outreach_events WHERE outreach_state_id = $1', [freshState.rows[0].id]);
    await query('DELETE FROM outreach_states WHERE id = $1', [freshState.rows[0].id]);
    await query('DELETE FROM contacts WHERE id = $1', [freshContact]);

    // Without a manual move, a delayed open cannot undo acceptance.
    expect((await post(campaignA, 'accepted')).status).toBe(201);
    expect((await post(campaignA, 'opened')).status).toBe(201);
    expect((await read(campaignA)).contacted).toHaveLength(1);
    expect((await query<{ state: string }>('SELECT state FROM outreach_states WHERE id = $1', [stateA])).rows[0].state).toBe('accepted');
    const eventsBeforeMismatch = (await query('SELECT id FROM outreach_events WHERE outreach_state_id = $1', [stateA])).rowCount;
    expect((await move('won', campaignB)).status).toBe(409);
    expect((await PUT(req(`/api/outreach/pipeline/${stateB}`, cookie!, 'PUT',
      JSON.stringify({ stage: 'won', campaign_id: campaignA, event_version: 0 })),
    { params: Promise.resolve({ id: stateB }) })).status).toBe(409);
    expect((await query('SELECT id FROM outreach_events WHERE outreach_state_id = $1', [stateA])).rowCount).toBe(eventsBeforeMismatch);
    expect((await read(campaignA)).won).toHaveLength(0);
    expect((await read(campaignB)).won).toHaveLength(0);

    expect((await move('won')).status).toBe(200);
    expect((await read(campaignA)).won.map((row: { outreach_state_id: string; state: string; pipeline_stage: string }) =>
      [row.outreach_state_id, row.state, row.pipeline_stage])).toEqual([[stateA, 'accepted', 'won']]);
    expect(await contactStage(campaignA)).toBe('won');
    await query('UPDATE outreach_states SET current_step = current_step WHERE id = $1', [stateB]);
    expect(await contactStage()).toBe('won');
    const contactsResponse = await getContacts(req(`/api/contacts?campaign_id=${campaignA}`, cookie!));
    expect((await contactsResponse.json()).data[0].outreachState).toBe('accepted');
    expect((await query<{ outreach_state: string }>(
      'SELECT state AS outreach_state FROM outreach_states WHERE id = $1', [stateA]
    )).rows[0].outreach_state).toBe('accepted');
    expect((await read(campaignB)).replied.map((row: { outreach_state_id: string }) => row.outreach_state_id)).toEqual([stateB]);
    expect(await contactStage(campaignB)).toBe('replied');
    const allCampaigns = await GET(req('/api/outreach/pipeline', cookie!));
    expect(allCampaigns.status).toBe(200);
    const allStages = (await allCampaigns.json()).stages;
    expect([...allStages.won, ...allStages.replied].map((row: {
      outreach_state_id: string; campaign_id: string; campaign_name: string;
    }) => [row.outreach_state_id, row.campaign_id, row.campaign_name]).sort()).toEqual([
      [stateA, campaignA, 'Campaign A'], [stateB, campaignB, 'Campaign B'],
    ]);
    expect((await post(campaignB, 'replied')).status).toBe(201);
    expect((await post(campaignB, 'accepted')).status).toBe(201);
    expect((await post(campaignB, 'opened')).status).toBe(201);
    expect((await read(campaignB)).replied).toHaveLength(1);
    expect((await read(campaignB)).won).toHaveLength(0);
    expect(await contactStage(campaignB)).toBe('replied');
    expect((await query<{ state: string }>('SELECT state FROM outreach_states WHERE id = $1', [stateB])).rows[0].state).toBe('replied');
    expect((await read(campaignA)).won).toHaveLength(1);
    expect((await post()).status).toBe(400);
    expect((await query('SELECT * FROM outreach_states WHERE contact_id = $1', [contact])).rowCount).toBe(2);
    await query(`INSERT INTO outreach_events (outreach_state_id, event_type) VALUES ($1, 'future_event')`, [stateA]);
    expect((await read(campaignA)).won).toHaveLength(1);
    expect(await contactStage(campaignA)).toBe('won');
    expect((await post(campaignA, 'opened')).status).toBe(201);
    expect((await post(campaignA, 'accepted')).status).toBe(201);
    await query('UPDATE outreach_events SET created_at = $2 WHERE outreach_state_id = $1',
      [stateA, '2025-01-01T00:00:00Z']);
    expect((await read(campaignA)).won).toHaveLength(1);
    expect(await contactStage(campaignA)).toBe('won');
    expect((await move('meeting_booked')).status).toBe(200);
    expect((await read(campaignA)).meeting_booked).toHaveLength(1);
    expect(await contactStage(campaignA)).toBe('meeting_booked');
    expect((await move('not_started')).status).toBe(200);
    expect((await read(campaignA)).not_started).toHaveLength(1);
    expect(await contactStage(campaignA)).toBe('not_started');
    // Old replies remain in the audit, while a new reply advances the board.
    expect((await post(campaignA, 'replied')).status).toBe(201);
    expect((await read(campaignA)).replied).toHaveLength(1);
    expect(await contactStage(campaignA)).toBe('replied');
    expect((await move('not_started')).status).toBe(200);
    expect((await post(campaignA, 'opened')).status).toBe(201);
    expect((await post(campaignA, 'accepted')).status).toBe(201);
    expect((await read(campaignA)).contacted).toHaveLength(1);
    expect(await contactStage(campaignA)).toBe('contacted');
    expect(await contactStage()).toBe('contacted');

    // A retry of an already reset stage must leave the event stream untouched.
    expect((await move('not_started')).status).toBe(200);
    const beforeRetry = await query<{ last_action_at: Date; updated_at: Date; event_count: string }>(
      `SELECT os.last_action_at, os.updated_at,
         (SELECT COUNT(*)::text FROM outreach_events oe WHERE oe.outreach_state_id = os.id) AS event_count
       FROM outreach_states os WHERE os.id = $1`, [stateA]
    );
    expect((await move('not_started')).status).toBe(200);
    const afterRetry = await query<{ last_action_at: Date; updated_at: Date; event_count: string }>(
      `SELECT os.last_action_at, os.updated_at,
         (SELECT COUNT(*)::text FROM outreach_events oe WHERE oe.outreach_state_id = os.id) AS event_count
       FROM outreach_states os WHERE os.id = $1`, [stateA]
    );
    expect(afterRetry.rows).toEqual(beforeRetry.rows);

    // A future-dated event in B cannot hide a later Won → Reset in A.
    const futureEvent = await query<{ id: string }>(`INSERT INTO outreach_events (outreach_state_id, event_type, created_at)
      VALUES ($1, 'opened', '2999-01-01') RETURNING id`, [stateB]);
    await query(`UPDATE outreach_states SET last_action_at = '2999-01-01' WHERE id = $1`, [stateB]);
    expect(await contactStage()).toBe('replied');
    expect((await move('not_started')).status).toBe(200);
    expect(await contactStage()).toBe('replied');
    expect((await move('won')).status).toBe(200);
    expect(await contactStage()).toBe('won');
    expect((await move('not_started')).status).toBe(200);
    expect(await contactStage()).toBe('not_started');
    expect(await contactStage(campaignB)).toBe('replied');
    await query('DELETE FROM outreach_events WHERE id = $1', [futureEvent.rows[0].id]);
    await query(`UPDATE outreach_states SET last_action_at = now_utc() WHERE id = $1`, [stateB]);
    expect((await read(campaignB)).replied).toHaveLength(1);
    expect(await contactStage(campaignB)).toBe('replied');
    const rows = await query<{ campaign_id: string; state: string }>('SELECT campaign_id, state FROM outreach_states ORDER BY campaign_id');
    expect(rows.rows).toEqual([
      { campaign_id: campaignA, state: 'replied' },
      { campaign_id: campaignB, state: 'replied' },
    ]);
    expect((await query('SELECT * FROM outreach_events WHERE outreach_state_id = $1', [stateB])).rowCount).toBe(3);

    // After isolation is proved, reset the other row to expose the inverse
    // Contacts mismatch: its raw delivery state remains replied.
    const stateBVersion = (await query<{ version: string }>(
      'SELECT MAX(event_order)::text AS version FROM outreach_events WHERE outreach_state_id = $1', [stateB])).rows[0].version;
    expect((await PUT(req(`/api/outreach/pipeline/${stateB}`, cookie!, 'PUT',
      JSON.stringify({ stage: 'not_started', campaign_id: campaignB, event_version: Number(stateBVersion) })),
    { params: Promise.resolve({ id: stateB }) })).status).toBe(200);
    expect((await read(campaignB)).not_started).toHaveLength(1);
    expect(await contactStage(campaignB)).toBe('not_started');
    expect((await query<{ outreach_state: string }>(
      'SELECT state AS outreach_state FROM outreach_states WHERE id = $1', [stateB]
    )).rows[0].outreach_state).toBe('replied');
    expect((await post(campaignB, 'opened')).status).toBe(201);
    expect((await post(campaignB, 'accepted')).status).toBe(201);
    expect((await read(campaignB)).contacted).toHaveLength(1);
    expect((await read(campaignA)).not_started).toHaveLength(1);
    expect((await query<{ id: string; state: string }>(
      'SELECT id, state FROM outreach_states WHERE contact_id = $1 ORDER BY campaign_id', [contact]
    )).rows).toEqual([{ id: stateA, state: 'replied' }, { id: stateB, state: 'replied' }]);

    // Simultaneous writes serialize on the state row. The last manual event
    // by event_order owns the stage even when delivery events interleave.
    const beforeOrder = await query<{ event_order: string }>(
      'SELECT MAX(event_order)::text AS event_order FROM outreach_events WHERE outreach_state_id = $1', [stateA]
    );
    const concurrent = await Promise.all([
      move('won'), post(campaignA, 'opened'), move('not_started'), post(campaignA, 'accepted'),
    ]);
    expect(concurrent[1].status).toBe(201);
    expect(concurrent[3].status).toBe(201);
    expect([200, 409]).toContain(concurrent[0].status);
    expect([200, 409]).toContain(concurrent[2].status);
    const laterEvents = await query<{ event_order: string; event_type: string; event_data: { stage?: string } }>(
      `SELECT event_order::text, event_type, event_data FROM outreach_events
       WHERE outreach_state_id = $1 AND event_order > $2 ORDER BY outreach_events.event_order DESC`,
      [stateA, beforeOrder.rows[0].event_order]
    );
    expect(laterEvents.rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(laterEvents.rows.map((event) => event.event_order)).size).toBe(laterEvents.rows.length);
    const finalMove = laterEvents.rows.find((event) => event.event_type === 'pipeline_stage_changed');
    if (finalMove) {
      expect(finalMove.event_data.stage).toMatch(/^(won|not_started)$/);
      expect((await read(campaignA))[finalMove.event_data.stage!]).toHaveLength(1);
      expect(await contactStage(campaignA)).toBe(finalMove.event_data.stage);
    }
    expect((await query<{ state: string }>('SELECT state FROM outreach_states WHERE id = $1', [stateA])).rows[0].state).toBe('replied');
    expect((await read(campaignB)).contacted).toHaveLength(1);

    // A delayed retry from the Won snapshot must not undo a later Reset.
    expect((await move('won')).status).toBe(200);
    const staleVersion = (await query<{ version: string }>(
      'SELECT MAX(event_order)::text AS version FROM outreach_events WHERE outreach_state_id = $1', [stateA])).rows[0].version;
    expect((await move('not_started')).status).toBe(200);
    const beforeStale = (await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM outreach_events WHERE outreach_state_id = $1', [stateA])).rows[0].count;
    const stale = await PUT(req(`/api/outreach/pipeline/${stateA}`, cookie!, 'PUT',
      JSON.stringify({ stage: 'won', campaign_id: campaignA, event_version: Number(staleVersion) })),
      { params: Promise.resolve({ id: stateA }) });
    expect(stale.status).toBe(409);
    expect((await read(campaignA)).not_started).toHaveLength(1);
    expect((await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM outreach_events WHERE outreach_state_id = $1', [stateA])).rows[0].count).toBe(beforeStale);

    // A terminal negative outcome wins over an earlier Won and over any
    // later manual event already in the log. Both API views use this rule.
    expect((await move('won')).status).toBe(200);
    expect(await contactStage(campaignA)).toBe('won');
    expect((await post(campaignA, 'opted_out')).status).toBe(201);
    expect((await query<{ state: string }>('SELECT state FROM outreach_states WHERE id = $1', [stateA])).rows[0].state).toBe('opted_out');
    expect((await read(campaignA)).lost).toHaveLength(1);
    // Campaign summaries use event/state records, not stale stored counters.
    await query(`INSERT INTO outreach_events (outreach_state_id, event_type) VALUES ($1, 'sent')`, [stateA]);
    // A label without a template id must not rename the unattributed row.
    await query(`INSERT INTO outreach_events (outreach_state_id, event_type, event_data)
      VALUES ($1, 'sent', '{"template_name": "Spoofed label"}'::jsonb)`, [stateA]);
    const summaries = await listCampaigns();
    expect(summaries.find(c => c.id === campaignA)).toMatchObject({ target_count: 1, sent_count: 1 });
    expect(summaries.find(c => c.id === campaignB)).toMatchObject({ target_count: 1, response_count: 1 });
    expect(await getTemplatePerformanceStats()).toContainEqual(expect.objectContaining({
      template_name: 'Unattributed events', total_sent: 1,
    }));
    const taggedTemplate = '88888888-8888-4888-8888-888888888888';
    await query(`INSERT INTO outreach_templates (id, name, category, body_template)
      VALUES ($1, 'Synthetic template', 'custom', 'Test only')`, [taggedTemplate]);
    await query(`INSERT INTO outreach_events (outreach_state_id, event_type, event_data)
      VALUES ($1, 'sent', jsonb_build_object('template_id', $2::text))`, [stateA, taggedTemplate]);
    // The earlier untagged replies are not attributed to this send. The UI
    // exposes independent counts and no invalid template conversion rate.
    expect(await getTemplatePerformanceStats()).toContainEqual(expect.objectContaining({
      template_id: taggedTemplate, total_sent: 1, total_replied: 0,
    }));
    expect(await deleteTemplate(taggedTemplate)).toBe(true);
    expect(await getTemplatePerformanceStats()).toContainEqual(expect.objectContaining({
      template_id: taggedTemplate, template_name: 'Synthetic template', total_sent: 1, total_replied: 0,
    }));
    expect((await query<{ template_name: string }>(
      `SELECT event_data->>'template_name' AS template_name FROM outreach_events
       WHERE outreach_state_id = $1 AND event_data->>'template_id' = $2`,
      [stateA, taggedTemplate])).rows[0].template_name).toBe('Synthetic template');
    // An ordinary API writer holds a share lock on its template until commit.
    // Deletion must wait, then retain the event's historical name.
    const racingTemplate = '88888888-8888-4888-8888-999999999999';
    await query(`INSERT INTO outreach_templates (id, name, category, body_template)
      VALUES ($1, 'Race template', 'custom', 'Test only')`, [racingTemplate]);
    await query(`CREATE FUNCTION u7_pause_tagged_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_data->>'template_id' = '${racingTemplate}' THEN
          PERFORM pg_advisory_xact_lock(918274::bigint);
          PERFORM pg_sleep(2);
        END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER u7_pause_tagged_event BEFORE INSERT ON outreach_events
      FOR EACH ROW EXECUTE FUNCTION u7_pause_tagged_event()`);
    const observer = await getPool().connect();
    let racingEvent: ReturnType<typeof post> | null = null;
    let racingDelete: ReturnType<typeof deleteTemplate> | null = null;
    try {
      racingEvent = post(campaignA, 'sent', contact, { template_id: racingTemplate, template_name: 'Spoofed' });
      let paused = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const got = (await observer.query<{ got: boolean }>(
          'SELECT pg_try_advisory_lock(918274::bigint) AS got')).rows[0].got;
        if (!got) { paused = true; break; }
        await observer.query('SELECT pg_advisory_unlock(918274::bigint)');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(paused).toBe(true);
      racingDelete = deleteTemplate(racingTemplate);
      expect((await racingEvent).status).toBe(201);
      expect(await racingDelete).toBe(true);
      expect(await getTemplatePerformanceStats()).toContainEqual(expect.objectContaining({
        template_id: racingTemplate, template_name: 'Race template', total_sent: 1,
      }));
      expect((await query<{ template_name: string }>(
        `SELECT event_data->>'template_name' AS template_name FROM outreach_events
         WHERE outreach_state_id = $1 AND event_data->>'template_id' = $2`,
        [stateA, racingTemplate])).rows[0].template_name).toBe('Race template');
      const beforeRejected = (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM outreach_events
         WHERE event_data->>'template_id' = $1`, [racingTemplate])).rows[0].count;
      expect((await post(campaignA, 'sent', contact, { template_id: racingTemplate })).status).toBe(409);
      expect((await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM outreach_events
         WHERE event_data->>'template_id' = $1`, [racingTemplate])).rows[0].count).toBe(beforeRejected);
    } finally {
      if (racingEvent) await racingEvent.catch(() => undefined);
      if (racingDelete) await racingDelete.catch(() => undefined);
      observer.release();
      await query('DROP TRIGGER IF EXISTS u7_pause_tagged_event ON outreach_events');
      await query('DROP FUNCTION IF EXISTS u7_pause_tagged_event()');
    }
    const renamedTemplate = '88888888-8888-4888-8888-777777777777';
    await query(`INSERT INTO outreach_templates (id, name, category, body_template)
      VALUES ($1, 'Original name', 'custom', 'Test only')`, [renamedTemplate]);
    const snapshotted = await post(campaignA, 'sent', contact, { template_id: renamedTemplate });
    expect(snapshotted.status).toBe(201);
    const snapshottedId = (await snapshotted.json()).data.id as string;
    await query('UPDATE outreach_templates SET name = $2 WHERE id = $1', [renamedTemplate, 'New name']);
    const legacy = await query<{ id: string }>(
      `INSERT INTO outreach_events (outreach_state_id, event_type, event_data)
       VALUES ($1, 'sent', jsonb_build_object('template_id', $2::text)) RETURNING id`,
      [stateA, renamedTemplate]);
    expect(await deleteTemplate(renamedTemplate)).toBe(true);
    const historicalNames = await query<{ id: string; template_name: string }>(
      `SELECT id, event_data->>'template_name' AS template_name FROM outreach_events
       WHERE id = ANY($1::uuid[])`, [[snapshottedId, legacy.rows[0].id]]);
    expect(Object.fromEntries(historicalNames.rows.map(row => [row.id, row.template_name]))).toEqual({
      [snapshottedId]: 'Original name',
      [legacy.rows[0].id]: 'New name',
    });
    const deletedHistorically = '99999999-9999-4999-8999-999999999999';
    await query(`INSERT INTO outreach_events (outreach_state_id, event_type, event_data)
      VALUES ($1, 'sent', jsonb_build_object('template_id', $2::text))`, [stateA, deletedHistorically]);
    expect(await getTemplatePerformanceStats()).toContainEqual(expect.objectContaining({
      template_id: deletedHistorically, template_name: `Deleted template (${deletedHistorically})`, total_sent: 1,
    }));

    // The same scored contact can belong to two draft campaigns without
    // creating a delivery event or changing the other campaign's stage.
    const candidate = '66666666-6666-4666-8666-666666666666';
    await query('INSERT INTO contacts (id, full_name, linkedin_url, degree) VALUES ($1, $2, $3, 1)',
      [candidate, 'Audience Candidate', 'https://www.linkedin.com/in/u7-audience-candidate']);
    await seedOwnerScores(`INSERT INTO contact_scores (contact_id, composite_score, tier, basis_kind, basis_hash)
      VALUES ($1, 0.8, 'gold', ${OWNER_BASIS})`, [candidate]);
    const contextA = { params: Promise.resolve({ id: campaignA }) };
    const contextB = { params: Promise.resolve({ id: campaignB }) };
    const urlA = `/api/outreach/campaigns/${campaignA}/populate?tier=gold`;
    const urlB = `/api/outreach/campaigns/${campaignB}/populate?tier=gold`;
    const previewIds = async (url: string, context: typeof contextA) =>
      (await (await previewAudience(req(url, cookie!), context)).json()).data.map((c: { id: string }) => c.id) as string[];
    const enroll = (url: string, context: typeof contextA, ids: string[]) =>
      enrollAudience(req(url, cookie!, 'POST', JSON.stringify({ contact_ids: ids })), context);
    expect(await previewIds(urlA, contextA)).toContain(candidate);

    // A new high-ranked contact displaces the preview's 100th row. The old
    // preview cannot enroll that unseen contact or a silently changed set.
    await query(`INSERT INTO contacts (full_name, linkedin_url, degree)
      SELECT 'Preview ' || n, 'https://www.linkedin.com/in/u7-preview-' || n, 1
      FROM generate_series(1, 100) n`);
    await seedOwnerScores(`INSERT INTO contact_scores (contact_id, composite_score, tier, basis_kind, basis_hash)
      SELECT id, 0.5, 'gold', ${OWNER_BASIS} FROM contacts
      WHERE linkedin_url LIKE 'https://www.linkedin.com/in/u7-preview-%'`);
    const oldPreview = await previewIds(urlA, contextA);
    expect(oldPreview).toHaveLength(100);
    const newcomer = '77777777-7777-4777-8777-777777777777';
    await query('INSERT INTO contacts (id, full_name, linkedin_url, degree) VALUES ($1, $2, $3, 1)',
      [newcomer, 'Newcomer', 'https://www.linkedin.com/in/u7-preview-newcomer']);
    await seedOwnerScores(`INSERT INTO contact_scores (contact_id, composite_score, tier, basis_kind, basis_hash)
      VALUES ($1, 0.9, 'gold', ${OWNER_BASIS})`, [newcomer]);
    expect((await enroll(urlA, contextA, oldPreview)).status).toBe(409);
    expect((await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM outreach_states WHERE campaign_id = $1 AND contact_id = ANY($2::uuid[])',
      [campaignA, [...oldPreview, newcomer]])).rows[0].count).toBe('0');
    await query("DELETE FROM contacts WHERE linkedin_url LIKE 'https://www.linkedin.com/in/u7-preview-%'");

    expect((await (await enroll(urlA, contextA, await previewIds(urlA, contextA))).json()).added).toBe(1);
    expect((await (await previewAudience(req(urlA, cookie!), contextA)).json()).data).toHaveLength(0);
    expect(await previewIds(urlB, contextB)).toContain(candidate);
    const previewB = await previewIds(urlB, contextB);
    expect((await (await enroll(urlB, contextB, previewB)).json()).added).toBe(1);
    expect((await enroll(urlB, contextB, previewB)).status).toBe(409);
    expect((await query<{ campaign_id: string }>(
      'SELECT campaign_id FROM outreach_states WHERE contact_id = $1 ORDER BY campaign_id', [candidate]
    )).rows.map(r => r.campaign_id)).toEqual([campaignA, campaignB]);
    const membersA = await getContacts(req(`/api/contacts?campaign_id=${campaignA}`, cookie!));
    expect((await membersA.json()).data.map((c: { id: string }) => c.id)).toContain(candidate);
    await query('DELETE FROM contacts WHERE id = $1', [candidate]);

    // Force a real unique-key race after the preview comparison. The fixture
    // writer bypasses its FK trigger only to reach the unique index while the
    // API transaction holds the campaign lock. Ordinary app writers take the
    // campaign row lock through that FK and serialize before the comparison;
    // they cannot create this precise post-comparison conflict. The bypass is
    // confined to this disposable fixture and tests the defensive rollback.
    const raceFirst = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const raceSecond = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    await query(`INSERT INTO contacts (id, full_name, linkedin_url, degree) VALUES
      ($1, 'Race First', 'https://www.linkedin.com/in/u7-race-first', 1),
      ($2, 'Race Second', 'https://www.linkedin.com/in/u7-race-second', 1)`, [raceFirst, raceSecond]);
    await seedOwnerScores(`INSERT INTO contact_scores (contact_id, composite_score, tier, basis_kind, basis_hash) VALUES
      ($1, 0.8, 'gold', ${OWNER_BASIS}), ($2, 0.7, 'gold', ${OWNER_BASIS})`, [raceFirst, raceSecond]);
    await query(`CREATE FUNCTION u7_pause_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.contact_id = '${raceSecond}'::uuid THEN
          PERFORM pg_advisory_xact_lock(918273::bigint);
          PERFORM pg_sleep(2);
        END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER u7_pause_enrollment BEFORE INSERT ON outreach_states
      FOR EACH ROW EXECUTE FUNCTION u7_pause_enrollment()`);
    const writer = await getPool().connect();
    let racing: ReturnType<typeof enroll> | null = null;
    try {
      const racePreview = await previewIds(urlA, contextA);
      expect(racePreview).toEqual([raceFirst, raceSecond]);
      racing = enroll(urlA, contextA, racePreview);
      let paused = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const got = (await writer.query<{ got: boolean }>(
          'SELECT pg_try_advisory_lock(918273::bigint) AS got')).rows[0].got;
        if (!got) { paused = true; break; }
        await writer.query('SELECT pg_advisory_unlock(918273::bigint)');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(paused).toBe(true);
      await writer.query('SET session_replication_role = replica');
      await writer.query(`INSERT INTO outreach_states (contact_id, campaign_id, state)
        VALUES ($1, $2, 'queued')`, [raceSecond, campaignA]);
      await writer.query('SET session_replication_role = DEFAULT');
      expect((await racing).status).toBe(409);
      const persisted = await query<{ contact_id: string }>(
        'SELECT contact_id FROM outreach_states WHERE campaign_id = $1 AND contact_id = ANY($2::uuid[])',
        [campaignA, racePreview]);
      expect(persisted.rows.map(row => row.contact_id)).toEqual([raceSecond]);
    } finally {
      if (racing) await racing.catch(() => undefined);
      await writer.query('SET session_replication_role = DEFAULT');
      writer.release();
      await query('DROP TRIGGER IF EXISTS u7_pause_enrollment ON outreach_states');
      await query('DROP FUNCTION IF EXISTS u7_pause_enrollment()');
      await query('DELETE FROM contacts WHERE id IN ($1, $2)', [raceFirst, raceSecond]);
    }
    expect((await read(campaignA)).won).toHaveLength(0);
    expect(await contactStage(campaignA)).toBe('lost');
    expect(await contactStage()).toBe('lost');
    const terminalEventCount = (await query('SELECT id FROM outreach_events WHERE outreach_state_id = $1', [stateA])).rowCount;
    expect((await move('won')).status).toBe(409);
    expect((await move('not_started')).status).toBe(409);
    expect((await query('SELECT id FROM outreach_events WHERE outreach_state_id = $1', [stateA])).rowCount).toBe(terminalEventCount);
    await query(`INSERT INTO outreach_events (outreach_state_id, event_type, event_data)
      VALUES ($1, 'pipeline_stage_changed', '{"stage":"won"}'::jsonb)`, [stateA]);
    expect((await read(campaignA)).lost).toHaveLength(1);
    expect(await contactStage(campaignA)).toBe('lost');

    // Reset has the same precedence, while the other campaign remains isolated.
    expect((await post(campaignB, 'opted_out')).status).toBe(201);
    expect((await query<{ state: string }>('SELECT state FROM outreach_states WHERE id = $1', [stateB])).rows[0].state).toBe('opted_out');
    expect((await read(campaignB)).lost).toHaveLength(1);
    expect((await read(campaignB)).not_started).toHaveLength(0);
    expect(await contactStage(campaignB)).toBe('lost');
    expect((await PUT(req(`/api/outreach/pipeline/${stateB}`, cookie!, 'PUT',
      JSON.stringify({ stage: 'not_started', campaign_id: campaignB, event_version: 0 })),
    { params: Promise.resolve({ id: stateB }) })).status).toBe(409);
    expect((await read(campaignA)).lost).toHaveLength(1);
  } finally {
    if (secretBefore === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
    else process.env.LOCAL_OPERATOR_SECRET = secretBefore;
    await query("DELETE FROM contacts WHERE linkedin_url LIKE 'https://www.linkedin.com/in/u7-preview-%'");
    await query('DELETE FROM outreach_events WHERE outreach_state_id IN ($1, $2)', [stateA, stateB]);
    await query('DELETE FROM outreach_events WHERE outreach_state_id IN (SELECT id FROM outreach_states WHERE contact_id = $1)', [freshContact]);
    await query('DELETE FROM outreach_states WHERE id IN ($1, $2)', [stateA, stateB]);
    await query('DELETE FROM outreach_states WHERE contact_id = $1', [freshContact]);
    await query('DELETE FROM outreach_campaigns WHERE id IN ($1, $2)', [campaignA, campaignB]);
    await query('DELETE FROM contacts WHERE id = $1', [contact]);
    await query('DELETE FROM contacts WHERE id = $1', [freshContact]);
    await shutdown();
  }
}, 20000);
