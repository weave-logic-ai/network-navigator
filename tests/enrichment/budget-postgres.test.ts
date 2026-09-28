// Opt-in against a disposable local PostgreSQL cluster. Creates and drops its own database.
import { readFileSync } from 'fs';
import path from 'path';
import { Client } from '../../app/node_modules/pg';

const fixtureUrl = process.env.U8_TEST_DATABASE_URL;
const run = fixtureUrl && new URL(fixtureUrl).hostname === '127.0.0.1' ? describe : describe.skip;
const dbName = `u8_budget_${process.pid}`;
const migrationSql = readFileSync(path.resolve(__dirname,
  '../../data/db/init/063-enrichment-budget-exclusion.sql'), 'utf8');
const productionBudgetSql = readFileSync(path.resolve(__dirname,
  '../../data/db/init/012-budget-schema.sql'), 'utf8');
const productionContactsSql = readFileSync(path.resolve(__dirname,
  '../../data/db/init/002-core-schema.sql'), 'utf8').split('-- Edges')[0];
const runbook = readFileSync(path.resolve(__dirname,
  '../../docs/runbooks/enrichment-budget-063.md'), 'utf8');
const overlapQuery = runbook.match(/```sql\n([\s\S]*?)\n```/)?.[1];

run('U8 budget reservation on disposable PostgreSQL', () => {
  let admin: Client;
  let db: Client;
  let shutdownPool: (() => Promise<void>) | undefined;
  const url = new URL(fixtureUrl || 'postgresql://localhost/postgres');
  url.pathname = `/${dbName}`;

  beforeAll(async () => {
    admin = new Client({ connectionString: fixtureUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE FUNCTION now_utc() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
      CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.updated_at = now(); RETURN NEW; END $$;`);
    await db.query(productionContactsSql);
    await db.query(productionBudgetSql);
    await db.query(`INSERT INTO contacts(id, linkedin_url) SELECT id::uuid,
      'https://linkedin.com/in/u8-fixture-' || row_number() OVER () FROM (VALUES
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      ('11111111-1111-4111-8111-111111111111'),
      ('55555555-5555-4555-8555-555555555555'),
      ('88888888-8888-4888-8888-888888888888'),
      ('99999999-9999-4999-8999-999999999990'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd')) AS ids(id)`);
    await db.query(`INSERT INTO budget_periods(period_type,period_start,period_end,budget_cents,spent_cents)
      VALUES ('monthly','2025-01-01','2025-01-31',100,30),
             ('weekly','2025-01-10','2025-01-16',50,10)`);
    process.env.DATABASE_URL = url.toString();
  });

  it('reports populated overlaps without changing spend; explicit resolution is reversible and rerunnable', async () => {
    const providerId = (await db.query("SELECT id FROM enrichment_providers WHERE name='pdl'")).rows[0].id;
    await expect(db.query(`INSERT INTO enrichment_transactions(provider_id,cost_cents,status)
      VALUES ($1,0,'reconciled')`, [providerId])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(migrationSql)).rejects.toThrow('Overlapping active budget periods');
    const before = await db.query(`SELECT period_type,spent_cents,is_active FROM budget_periods ORDER BY period_type`);
    expect(before.rows).toMatchObject([
      { period_type: 'monthly', spent_cents: 30, is_active: true },
      { period_type: 'weekly', spent_cents: 10, is_active: true },
    ]);
    await db.query(`UPDATE budget_periods SET is_active=FALSE WHERE period_type='weekly'`);
    await db.query(migrationSql);
    await db.query(migrationSql);
    await db.query(`INSERT INTO enrichment_transactions(provider_id,cost_cents,status)
      VALUES ($1,0,'reconciled')`, [providerId]);
    await expect(db.query(`INSERT INTO enrichment_transactions(provider_id,cost_cents,status)
      VALUES ($1,0,'invalid')`, [providerId])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`UPDATE budget_periods SET is_active=TRUE WHERE period_type='weekly'`))
      .rejects.toMatchObject({ code: '23P01' });
    const after = await db.query(`SELECT period_type,spent_cents,is_active FROM budget_periods ORDER BY period_type`);
    expect(after.rows).toMatchObject([
      { period_type: 'monthly', spent_cents: 30, is_active: true },
      { period_type: 'weekly', spent_cents: 10, is_active: false },
    ]);
  });

  it('executes runbook enumeration of every populated overlap and proves manual rollback/reapply', async () => {
    if (!overlapQuery) throw new Error('Runbook overlap query missing');
    await db.query('ALTER TABLE budget_periods DROP CONSTRAINT budget_periods_active_no_overlap');
    await db.query(`UPDATE budget_periods SET is_active=true WHERE period_type='weekly' AND period_start<'2025-02-01'`);
    await db.query(`INSERT INTO budget_periods(period_type,period_start,period_end,budget_cents,spent_cents)
      VALUES ('daily','2025-01-12','2025-01-12',20,4)`);
    const ids = await db.query(`SELECT id, period_type FROM budget_periods WHERE period_start < '2025-02-01' ORDER BY period_type`);
    const providerId = (await db.query("SELECT id FROM enrichment_providers WHERE name='pdl'")).rows[0].id;
    for (const row of ids.rows) {
      await db.query(`INSERT INTO enrichment_transactions(provider_id,budget_period_id,cost_cents,status)
        VALUES ($1,$2,$3,'success')`,
        [providerId, row.id, row.period_type === 'monthly' ? 30 : row.period_type === 'weekly' ? 10 : 4]);
    }
    const pairs = await db.query(overlapQuery);
    expect(pairs.rowCount).toBe(3);
    expect(pairs.rows.every(row => row.first_transactions === '1' && row.second_transactions === '1')).toBe(true);
    await expect(db.query(migrationSql)).rejects.toThrow('Overlapping active budget periods');
    await db.query('BEGIN');
    await db.query(`UPDATE budget_periods SET is_active=false WHERE period_type IN ('weekly','daily') AND period_start<'2025-02-01'`);
    expect((await db.query(overlapQuery)).rowCount).toBe(0);
    await db.query('ROLLBACK');
    expect((await db.query(overlapQuery)).rowCount).toBe(3);
    await db.query(`UPDATE budget_periods SET is_active=false WHERE period_type IN ('weekly','daily') AND period_start<'2025-02-01'`);
    await db.query(migrationSql);
    await db.query(migrationSql);
    expect((await db.query(overlapQuery)).rowCount).toBe(0);
    expect((await db.query('SELECT count(*) FROM enrichment_transactions')).rows[0].count).toBe('4');
    expect((await db.query(`SELECT sum(spent_cents) AS spent FROM budget_periods WHERE period_start<'2025-02-01'`)).rows[0].spent).toBe('44');
  });

  afterAll(async () => {
    if (shutdownPool) await shutdownPool();
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('rejects overlapping active dates, including a different period type', async () => {
    const { createCurrentMonthlyBudget } = await import('@/lib/db/queries/enrichment');
    const { shutdown } = await import('@/lib/db/client');
    shutdownPool = shutdown;
    expect(await createCurrentMonthlyBudget(10)).not.toBeNull();
    expect(await createCurrentMonthlyBudget(10)).toBeNull();
    await expect(db.query(`INSERT INTO budget_periods(period_type,period_start,period_end,budget_cents)
      VALUES ('weekly', CURRENT_DATE, CURRENT_DATE + 6, 10)`)).rejects.toMatchObject({ code: '23P01' });
  });

  it('allows one of two concurrent reservations and settles unused cents', async () => {
    const { reserveBudgetSpend, settleBudgetSpend } = await import('@/lib/db/queries/enrichment');
    const row = await db.query('SELECT id FROM budget_periods WHERE period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE LIMIT 1');
    const id = row.rows[0].id as string;
    const outcomes = await Promise.all([reserveBudgetSpend(id, 7), reserveBudgetSpend(id, 7)]);
    expect(outcomes.sort()).toEqual([false, true]);
    await settleBudgetSpend(id, 7, 4);
    const after = await db.query('SELECT spent_cents,lookup_count FROM budget_periods WHERE id=$1', [id]);
    expect(after.rows[0]).toMatchObject({ spent_cents: 4, lookup_count: 1 });
    expect(await reserveBudgetSpend(id, 7)).toBe(false);
  });

  it('lets an active original request finish after recovery saved a provisional response', async () => {
    const { claimEnrichmentQuote, saveEnrichmentRecovery, reserveEnrichmentLookup,
      saveEnrichmentResult, completeEnrichmentLookup, saveEnrichmentResponse,
      getEnrichmentAttempt } = await import('@/lib/db/queries/enrichment');
    const budgetId = (await db.query('SELECT id FROM budget_periods WHERE period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE')).rows[0].id;
    const providerId = (await db.query("SELECT id FROM enrichment_providers WHERE name='pdl'")).rows[0].id;
    const quoteId = '99999999-9999-4999-8999-999999999998';
    const contactId = '88888888-8888-4888-8888-888888888888';
    await db.query('UPDATE budget_periods SET budget_cents=spent_cents+100 WHERE id=$1', [budgetId]);
    await claimEnrichmentQuote(quoteId);
    await saveEnrichmentRecovery(quoteId, { data: [], partial: true });
    expect(await reserveEnrichmentLookup(quoteId, contactId, 'pdl', budgetId, 10)).toBe(true);
    await saveEnrichmentResult(quoteId, contactId, { providerId: 'pdl', providerName: 'PDL',
      success: true, fields: [{ field: 'email', value: 'fixture@example.invalid', confidence: 1 }], costCents: 10 });
    await completeEnrichmentLookup(quoteId, { contactId, provider: 'pdl', providerId,
      costCents: 10, success: true, fieldsReturned: ['email'] });
    const final = { data: [{ contactId, delta: [{ field: 'email', newValue: 'fixture@example.invalid' }] }], partial: false };
    await saveEnrichmentResponse(quoteId, final, 200);
    expect(await getEnrichmentAttempt(quoteId)).toMatchObject({ response: final, response_status: 200 });
  });

  it('claims a confirmed quote only once across concurrent requests', async () => {
    const { claimEnrichmentQuote } = await import('@/lib/db/queries/enrichment');
    const quoteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const outcomes = await Promise.all([claimEnrichmentQuote(quoteId), claimEnrichmentQuote(quoteId)]);
    expect(outcomes.sort()).toEqual([false, true]);
  });

  it('durably closes a crash immediately after claim without any charge or provider claim', async () => {
    const { claimEnrichmentQuote, closeUnstartedEnrichmentQuote, getEnrichmentAttempt,
      reserveEnrichmentLookup } = await import('@/lib/db/queries/enrichment');
    const quoteId = 'a0000000-0000-4000-8000-000000000001';
    const contactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const budgetId = (await db.query('SELECT id FROM budget_periods WHERE period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE')).rows[0].id;
    const before = (await db.query('SELECT spent_cents FROM budget_periods WHERE id=$1', [budgetId])).rows[0].spent_cents;
    expect(await claimEnrichmentQuote(quoteId)).toBe(true);
    expect(await closeUnstartedEnrichmentQuote(quoteId)).toBe(true);
    expect(await getEnrichmentAttempt(quoteId)).toMatchObject({ execution_state: 'no_charge',
      response_status: 200, response: { noCharge: true, data: [], totalCostCents: 0 } });
    expect(await closeUnstartedEnrichmentQuote(quoteId)).toBe(false);
    expect(await reserveEnrichmentLookup(quoteId, contactId, 'pdl', budgetId, 10)).toBe(false);
    expect((await db.query('SELECT count(*) FROM enrichment_provider_claims WHERE quote_id=$1', [quoteId])).rows[0].count).toBe('0');
    expect((await db.query('SELECT spent_cents FROM budget_periods WHERE id=$1', [budgetId])).rows[0].spent_cents).toBe(before);
  });

  it('keeps a claimed quote running during a paid call and refuses no-charge closure', async () => {
    const { claimEnrichmentQuote, closeUnstartedEnrichmentQuote, getEnrichmentAttempt,
      reserveEnrichmentLookup } = await import('@/lib/db/queries/enrichment');
    const quoteId = 'a0000000-0000-4000-8000-000000000002';
    const contactId = '99999999-9999-4999-8999-999999999990';
    const budgetId = (await db.query('SELECT id FROM budget_periods WHERE period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE')).rows[0].id;
    await db.query('UPDATE budget_periods SET budget_cents=spent_cents+100 WHERE id=$1', [budgetId]);
    expect(await claimEnrichmentQuote(quoteId)).toBe(true);
    expect(await reserveEnrichmentLookup(quoteId, contactId, 'pdl', budgetId, 10)).toBe(true);
    expect(await closeUnstartedEnrichmentQuote(quoteId)).toBe(false);
    expect(await getEnrichmentAttempt(quoteId)).toMatchObject({ execution_state: 'running',
      response: null, pending: { contactId, reservedCents: 10 } });
  });

  it('rejects a stale reviewed value and records one atomic apply receipt for replay', async () => {
    const { claimEnrichmentQuote, saveEnrichmentResponse } = await import('@/lib/db/queries/enrichment');
    const { applyReviewedEnrichment } = await import('@/lib/db/queries/enrichment-apply');
    const quoteId = 'a0000000-0000-4000-8000-000000000003';
    const contactId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await db.query('UPDATE contacts SET email=NULL WHERE id=$1', [contactId]);
    expect(await claimEnrichmentQuote(quoteId)).toBe(true);
    await saveEnrichmentResponse(quoteId, { data: [{ contactId,
      delta: [{ field: 'email', oldValue: null, newValue: 'paid@example.invalid' }] }] }, 200);
    await db.query("UPDATE contacts SET email='manual@example.invalid' WHERE id=$1", [contactId]);
    expect(await applyReviewedEnrichment(quoteId, contactId,
      [{ field: 'email', value: 'paid@example.invalid' }])).toMatchObject({ state: 'conflict' });
    expect((await db.query('SELECT email FROM contacts WHERE id=$1', [contactId])).rows[0].email).toBe('manual@example.invalid');
    expect((await db.query('SELECT count(*) FROM enrichment_apply_receipts WHERE quote_id=$1', [quoteId])).rows[0].count).toBe('0');
    await db.query('UPDATE contacts SET email=NULL WHERE id=$1', [contactId]);
    const outcomes = await Promise.all([applyReviewedEnrichment(quoteId, contactId,
      [{ field: 'email', value: 'paid@example.invalid' }]), applyReviewedEnrichment(quoteId, contactId,
      [{ field: 'email', value: 'paid@example.invalid' }])]);
    expect(outcomes.map(item => item.state).sort()).toEqual(['applied', 'replayed']);
    await db.query("UPDATE contacts SET email='later@example.invalid' WHERE id=$1", [contactId]);
    expect(await applyReviewedEnrichment(quoteId, contactId,
      [{ field: 'email', value: 'paid@example.invalid' }])).toMatchObject({ state: 'replayed' });
    expect((await db.query('SELECT email FROM contacts WHERE id=$1', [contactId])).rows[0].email).toBe('later@example.invalid');
    expect((await db.query('SELECT count(*) FROM enrichment_apply_receipts WHERE quote_id=$1', [quoteId])).rows[0].count).toBe('1');
    expect(await applyReviewedEnrichment(quoteId, contactId,
      [{ field: 'email', value: 'forged@example.invalid' }])).toMatchObject({ state: 'conflict' });
  });

  it('persists a provisional crash recovery that Apply can read, then accepts the final response', async () => {
    const { claimEnrichmentQuote, getEnrichmentAttempt, saveEnrichmentRecovery,
      saveEnrichmentResponse } = await import('@/lib/db/queries/enrichment');
    const quoteId = '77777777-7777-4777-8777-777777777777';
    const contactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await claimEnrichmentQuote(quoteId);
    const partial = { data: [{ contactId, delta: [{ field: 'email', newValue: 'saved@example.invalid' }] }],
      partial: true, stopReason: 'interrupted_preview' };
    const recovered = await saveEnrichmentRecovery(quoteId, partial);
    expect(recovered).toMatchObject({ status: null, pending: null, response: partial });
    expect((await getEnrichmentAttempt(quoteId))?.response?.data).toEqual(partial.data);
    expect((await saveEnrichmentRecovery(quoteId, { data: [] })).response).toEqual(partial);
    const final = { ...partial, partial: false };
    await saveEnrichmentResponse(quoteId, final, 200);
    expect(await getEnrichmentAttempt(quoteId)).toMatchObject({ response: final, response_status: 200 });
    expect((await saveEnrichmentRecovery(quoteId, { data: [] })).response).toEqual(final);
  });

  it('durably stores paid intent and fields before response and never reclaims the quote', async () => {
    const { claimEnrichmentQuote, reserveEnrichmentLookup, saveEnrichmentResult,
      getEnrichmentAttempt, hasUnreconciledEnrichmentAttempt, flagEnrichmentReconciliation,
      finishEnrichmentProvider, saveEnrichmentResponse } =
      await import('@/lib/db/queries/enrichment');
    const quoteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const contactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const budgetId = (await db.query('SELECT id FROM budget_periods WHERE period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE')).rows[0].id;
    await db.query('UPDATE budget_periods SET spent_cents=0,budget_cents=100 WHERE id=$1', [budgetId]);
    expect(await claimEnrichmentQuote(quoteId)).toBe(true);
    expect(await reserveEnrichmentLookup(quoteId, contactId, 'pdl', budgetId, 10)).toBe(true);
    expect((await getEnrichmentAttempt(quoteId))?.pending).toMatchObject({ reservedCents: 10 });
    expect(await hasUnreconciledEnrichmentAttempt([contactId])).toBe(true);
    const competingQuote = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    expect(await claimEnrichmentQuote(competingQuote)).toBe(true);
    expect(await reserveEnrichmentLookup(competingQuote, contactId, 'pdl', budgetId, 10)).toBe(false);
    await saveEnrichmentResult(quoteId, contactId, { providerId: 'pdl', providerName: 'PDL',
      success: true, fields: [{ field: 'email', value: 'saved@example.com', confidence: 1 }], costCents: 10 });
    await flagEnrichmentReconciliation(quoteId);
    expect((await getEnrichmentAttempt(quoteId))?.reconciliation_required).toBe(true);
    expect((await getEnrichmentAttempt(quoteId))?.results[0].result.fields[0].value).toBe('saved@example.com');
    expect(await claimEnrichmentQuote(quoteId)).toBe(false);
    await finishEnrichmentProvider(quoteId, false);
    await saveEnrichmentResponse(quoteId, { data: [{ contactId, delta: [] }], partial: false }, 200);
    expect((await getEnrichmentAttempt(quoteId))?.response_status).toBe(200);
    expect((await getEnrichmentAttempt(quoteId))?.pending).toBeNull();
    expect(await hasUnreconciledEnrichmentAttempt([contactId])).toBe(false);
    expect(await reserveEnrichmentLookup(competingQuote, contactId, 'pdl', budgetId, 10)).toBe(false);
    expect((await db.query('SELECT spent_cents FROM budget_periods WHERE id=$1', [budgetId])).rows[0].spent_cents).toBe(10);
  });

  it('rolls back claim and pending marker when the debit cannot commit, then serializes two quotes', async () => {
    const { claimEnrichmentQuote, reserveEnrichmentLookup, getEnrichmentAttempt } =
      await import('@/lib/db/queries/enrichment');
    const budgetId = (await db.query('SELECT id FROM budget_periods WHERE period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE')).rows[0].id;
    const contactId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const first = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const second = '99999999-9999-4999-8999-999999999999';
    await claimEnrichmentQuote(first);
    await claimEnrichmentQuote(second);
    await db.query('UPDATE budget_periods SET budget_cents=spent_cents WHERE id=$1', [budgetId]);
    expect(await reserveEnrichmentLookup(first, contactId, 'pdl', budgetId, 10)).toBe(false);
    expect((await getEnrichmentAttempt(first))?.pending).toBeNull();
    expect((await db.query('SELECT count(*) FROM enrichment_provider_claims WHERE contact_id=$1', [contactId])).rows[0].count).toBe('0');
    await db.query('UPDATE budget_periods SET budget_cents=spent_cents+100 WHERE id=$1', [budgetId]);
    const outcomes = await Promise.all([
      reserveEnrichmentLookup(first, contactId, 'pdl', budgetId, 10),
      reserveEnrichmentLookup(second, contactId, 'pdl', budgetId, 10),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect((await db.query('SELECT count(*) FROM enrichment_provider_claims WHERE contact_id=$1', [contactId])).rows[0].count).toBe('1');
  });

  it('releases a completed zero-cost no-match claim, but retains a charged claim across quotes', async () => {
    const { claimEnrichmentQuote, reserveEnrichmentLookup, saveEnrichmentResult,
      completeEnrichmentLookup, listClaimedEnrichmentProviders } = await import('@/lib/db/queries/enrichment');
    const budgetId = (await db.query('SELECT id FROM budget_periods WHERE period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE')).rows[0].id;
    const contactId = '11111111-1111-4111-8111-111111111111';
    const first = '22222222-2222-4222-8222-222222222222';
    const second = '33333333-3333-4333-8333-333333333333';
    await db.query('UPDATE budget_periods SET budget_cents=spent_cents+100 WHERE id=$1', [budgetId]);
    await claimEnrichmentQuote(first);
    await claimEnrichmentQuote(second);
    expect(await reserveEnrichmentLookup(first, contactId, 'pdl', budgetId, 10)).toBe(true);
    await saveEnrichmentResult(first, contactId, { providerId: 'pdl', providerName: 'PDL',
      success: false, fields: [], costCents: 0 });
    await completeEnrichmentLookup(first, { contactId, provider: 'pdl',
      providerId: (await db.query("SELECT id FROM enrichment_providers WHERE name='pdl'")).rows[0].id,
      costCents: 0, success: false, fieldsReturned: [] });
    expect(await listClaimedEnrichmentProviders(contactId)).toEqual([]);
    expect(await reserveEnrichmentLookup(second, contactId, 'pdl', budgetId, 10)).toBe(true);
    await saveEnrichmentResult(second, contactId, { providerId: 'pdl', providerName: 'PDL',
      success: true, fields: [{ field: 'email', value: 'fixture@example.invalid', confidence: 1 }], costCents: 10 });
    await completeEnrichmentLookup(second, { contactId, provider: 'pdl',
      providerId: (await db.query("SELECT id FROM enrichment_providers WHERE name='pdl'")).rows[0].id,
      costCents: 10, success: true, fieldsReturned: ['email'] });
    expect(await listClaimedEnrichmentProviders(contactId)).toEqual(['pdl']);
    const third = '44444444-4444-4444-8444-444444444444';
    await claimEnrichmentQuote(third);
    expect(await reserveEnrichmentLookup(third, contactId, 'pdl', budgetId, 10)).toBe(false);
  });

  it('settles an ambiguous charge once from an invoice without releasing the paid claim', async () => {
    const { claimEnrichmentQuote, reserveEnrichmentLookup, reconcileEnrichmentCharge,
      listPendingEnrichmentReconciliations, listClaimedEnrichmentProviders, flagEnrichmentReconciliation } =
      await import('@/lib/db/queries/enrichment');
    const budgetId = (await db.query('SELECT id FROM budget_periods WHERE period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE')).rows[0].id;
    const contactId = '55555555-5555-4555-8555-555555555555';
    const quoteId = '66666666-6666-4666-8666-666666666666';
    await db.query('UPDATE budget_periods SET budget_cents=spent_cents+100 WHERE id=$1', [budgetId]);
    await claimEnrichmentQuote(quoteId);
    const before = (await db.query('SELECT spent_cents FROM budget_periods WHERE id=$1', [budgetId])).rows[0].spent_cents;
    expect(await reserveEnrichmentLookup(quoteId, contactId, 'pdl', budgetId, 10)).toBe(true);
    expect((await listPendingEnrichmentReconciliations()).some(item => item.quoteId === quoteId)).toBe(false);
    await flagEnrichmentReconciliation(quoteId);
    expect((await listPendingEnrichmentReconciliations()).some(item => item.quoteId === quoteId)).toBe(true);
    expect(await reconcileEnrichmentCharge(quoteId, 11, 'invoice-test')).toBe(false);
    expect(await reconcileEnrichmentCharge(quoteId, 4, 'invoice-test')).toBe(true);
    expect(await reconcileEnrichmentCharge(quoteId, 4, 'invoice-test')).toBe(false);
    expect((await db.query('SELECT spent_cents FROM budget_periods WHERE id=$1', [budgetId])).rows[0].spent_cents).toBe(before + 4);
    expect((await db.query('SELECT reconciliation_reference,reconciled_cents FROM enrichment_quote_uses WHERE quote_id=$1', [quoteId])).rows[0])
      .toMatchObject({ reconciliation_reference: 'invoice-test', reconciled_cents: 4 });
    expect(await listClaimedEnrichmentProviders(contactId)).toEqual(['pdl']);
    expect((await db.query("SELECT count(*) FROM enrichment_transactions WHERE status='reconciled' AND contact_id=$1", [contactId])).rows[0].count).toBe('1');
  });
  it('measures reconciliation staleness from the current lookup, not the quote claim', async () => {
    const { claimEnrichmentQuote, reserveEnrichmentLookup, reconcileEnrichmentCharge,
      listPendingEnrichmentReconciliations } = await import('@/lib/db/queries/enrichment');
    const budgetId = (await db.query('SELECT id FROM budget_periods WHERE period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE')).rows[0].id;
    const contactId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const quoteId = 'a0000000-0000-4000-8000-000000000004';
    await db.query('UPDATE budget_periods SET budget_cents=spent_cents+100 WHERE id=$1', [budgetId]);
    await claimEnrichmentQuote(quoteId);
    // A long bulk quote: claimed 30 minutes ago, its current lookup just started.
    await db.query("UPDATE enrichment_quote_uses SET created_at=now()-interval '30 minutes' WHERE quote_id=$1", [quoteId]);
    expect(await reserveEnrichmentLookup(quoteId, contactId, 'pdl', budgetId, 10)).toBe(true);
    expect((await listPendingEnrichmentReconciliations()).some(item => item.quoteId === quoteId)).toBe(false);
    expect(await reconcileEnrichmentCharge(quoteId, 0, 'too-early')).toBe(false);
    await db.query(`UPDATE enrichment_quote_uses
      SET pending=jsonb_set(pending, '{pendingAt}', to_jsonb(now()-interval '20 minutes')) WHERE quote_id=$1`, [quoteId]);
    expect((await listPendingEnrichmentReconciliations()).some(item => item.quoteId === quoteId)).toBe(true);
    expect(await reconcileEnrichmentCharge(quoteId, 10, 'invoice-stale')).toBe(true);
  });
});
