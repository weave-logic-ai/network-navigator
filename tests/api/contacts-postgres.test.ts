// Run only against the disposable local fixture database created for U2.
import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/contacts/route';
import { POST as applyEnrichment } from '@/app/api/enrichment/apply/route';
import { query, shutdown } from '@/lib/db/client';
import { listContacts } from '@/lib/db/queries/contacts';
import { recordTransaction } from '@/lib/db/queries/enrichment';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';

jest.mock('@/lib/scoring/auto-score', () => ({ triggerAutoScore: jest.fn() }));
jest.mock('@/lib/auth/local-request-boundary', () => ({
  ...jest.requireActual('@/lib/auth/local-request-boundary'),
  requireLocalDashboardRequest: jest.fn(async () => null),
}));

const safeDatabase = process.env.DATABASE_URL ===
  'postgresql://u2test@127.0.0.1:55432/u2_fixture';
const integration = safeDatabase ? describe : describe.skip;
const priorOperatorSecret = process.env.LOCAL_OPERATOR_SECRET;

integration('Contacts list on disposable Postgres', () => {
  beforeAll(async () => {
    process.env.LOCAL_OPERATOR_SECRET = 'synthetic-operator-secret-for-u2-tests';
    await query(`DROP TABLE IF EXISTS outreach_events, outreach_states, person_enrichments, enrichment_transactions,
      enrichment_providers, contact_scores, contacts, companies;
      CREATE TABLE companies (id uuid PRIMARY KEY, name text, industry text);
      CREATE TABLE contacts (id uuid PRIMARY KEY, full_name text, first_name text, last_name text,
        headline text, title text, current_company text, current_company_id uuid,
        degree integer, is_archived boolean, tags text[], created_at timestamptz, updated_at timestamptz,
        email text, phone text, location text, about text, linkedin_url text, connections_count integer);
      CREATE TABLE contact_scores (contact_id uuid PRIMARY KEY, composite_score real, tier text,
        referral_likelihood real, referral_tier text);
      CREATE TABLE person_enrichments (contact_id uuid, enriched_fields text[], expires_at timestamptz);
      CREATE TABLE outreach_states (id uuid PRIMARY KEY, contact_id uuid, campaign_id uuid,
        state text, last_action_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz);
      CREATE TABLE outreach_events (id uuid PRIMARY KEY, outreach_state_id uuid, event_type text,
        event_order bigint GENERATED ALWAYS AS IDENTITY,
        event_data jsonb, created_at timestamptz);
      CREATE TABLE enrichment_providers (id uuid PRIMARY KEY, name text);
      CREATE TABLE enrichment_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES enrichment_providers(id), contact_id uuid REFERENCES contacts(id),
        company_id uuid, budget_period_id uuid, cost_cents integer NOT NULL,
        status text NOT NULL CHECK (status IN ('success', 'failed', 'cached', 'rate_limited')),
        fields_returned text[] DEFAULT '{}', created_at timestamptz DEFAULT now());
      CREATE OR REPLACE FUNCTION u2_update_contact_timestamp() RETURNS trigger AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER u2_contacts_updated_at BEFORE UPDATE ON contacts
        FOR EACH ROW EXECUTE FUNCTION u2_update_contact_timestamp();`);
    await query(`INSERT INTO contacts (id, full_name, first_name, last_name, headline, title,
      current_company, current_company_id, degree, is_archived, tags, created_at, updated_at) VALUES
      ('00000000-0000-0000-0000-000000000001','Ada','Ada',NULL,'Engineer','CTO','Acme',NULL,1,false,'{}','2024-01-01','2024-01-01'),
      ('00000000-0000-0000-0000-000000000002','Bea','Bea',NULL,'Designer','Designer','Beta',NULL,1,false,'{}','2024-01-02','2024-01-02'),
      ('00000000-0000-0000-0000-000000000003','Cal','Cal',NULL,'Founder','CEO','Gamma',NULL,1,false,'{}','2024-01-03','2024-01-03'),
      ('00000000-0000-0000-0000-000000000004','Dee','Dee',NULL,'Analyst','Analyst','Delta',NULL,1,false,'{}','2024-01-04','2024-01-04'),
      ('00000000-0000-0000-0000-000000000005','Zed','Zed',NULL,'Unknown','Unknown','Zeta',NULL,1,false,'{}','2024-01-05','2024-01-05');
      INSERT INTO contact_scores VALUES
      ('00000000-0000-0000-0000-000000000001',0.8,'gold',0.7,'silver-referral'),
      ('00000000-0000-0000-0000-000000000002',0.6,'silver',0.1,'watch-referral'),
      ('00000000-0000-0000-0000-000000000003',0.4,'bronze',0.9,'gold-referral'),
      ('00000000-0000-0000-0000-000000000004',0,'watch',0.3,'bronze-referral');
      INSERT INTO person_enrichments VALUES
      ('00000000-0000-0000-0000-000000000001',ARRAY['title'],NULL),
      ('00000000-0000-0000-0000-000000000002',ARRAY[]::text[],NULL),
      ('00000000-0000-0000-0000-000000000003',ARRAY['email'],'2020-01-01'),
      ('00000000-0000-0000-0000-000000000004',ARRAY['location'],'2999-01-01');
      INSERT INTO enrichment_providers VALUES ('20000000-0000-0000-0000-000000000001','fixture');
      INSERT INTO outreach_states (id, contact_id, state, created_at, updated_at) VALUES
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','queued','2024-01-01','2024-01-01'),
      ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','replied','2024-01-02','2024-01-02');`);
  });

  afterAll(async () => {
    if (priorOperatorSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
    else process.env.LOCAL_OPERATOR_SECRET = priorOperatorSecret;
    await shutdown();
  });

  it.each([
    ['tier', ['Dee', 'Cal', 'Bea', 'Ada', 'Zed'], ['Ada', 'Bea', 'Cal', 'Dee', 'Zed']],
    ['referralTier', ['Bea', 'Dee', 'Ada', 'Cal', 'Zed'], ['Cal', 'Ada', 'Dee', 'Bea', 'Zed']],
  ])('sorts %s by rank in both directions with unknown last', async (sort, ascending, descending) => {
    expect((await listContacts({ sort, order: 'asc' })).data.map((c) => c.full_name)).toEqual(ascending);
    expect((await listContacts({ sort, order: 'desc' })).data.map((c) => c.full_name)).toEqual(descending);
  });

  it('sorts name and score with unknown score last', async () => {
    expect((await listContacts({ sort: 'fullName', order: 'asc' })).data.map((c) => c.full_name))
      .toEqual(['Ada', 'Bea', 'Cal', 'Dee', 'Zed']);
    expect((await listContacts({ sort: 'compositeScore', order: 'asc' })).data.map((c) => c.full_name))
      .toEqual(['Dee', 'Cal', 'Bea', 'Ada', 'Zed']);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'returns 200 and created_at order for inherited API sort key %s',
    async (sort) => {
      const url = `http://localhost/api/contacts?${new URLSearchParams({ sort_by: sort })}`;
      const cookie = await createOperatorSession();
      const response = await GET(new (await import('../../app/node_modules/next/server')).NextRequest(url, {
        headers: { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'same-origin',
          cookie: `${OPERATOR_COOKIE}=${cookie}` },
      }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.map((contact: { fullName: string }) => contact.fullName))
        .toEqual(['Zed', 'Dee', 'Cal', 'Bea', 'Ada']);
    }
  );

  it('filters tier, enrichment, and search membership', async () => {
    for (const [tier, name] of [['gold', 'Ada'], ['silver', 'Bea'], ['bronze', 'Cal'], ['watch', 'Dee']]) {
      expect((await listContacts({ tier })).data.map((c) => c.full_name)).toEqual([name]);
    }
    expect((await listContacts({ enrichmentStatus: 'has_data', sort: 'fullName', order: 'asc' })).data.map((c) => c.full_name)).toEqual(['Ada', 'Cal', 'Dee']);
    expect((await listContacts({ enrichmentStatus: 'no_data', sort: 'fullName', order: 'asc' })).data.map((c) => c.full_name)).toEqual(['Bea', 'Zed']);
    expect((await listContacts({ search: 'Designer' })).data.map((c) => c.full_name)).toEqual(['Bea']);
  });

  it('finds a contact by the first/last-name fallback displayed in the table', async () => {
    const id = '00000000-0000-0000-0000-000000000006';
    await query(`INSERT INTO contacts (id, first_name, last_name, title, degree, is_archived, tags)
      VALUES ($1, 'Nora', 'Vale', 'Engineer', 1, false, '{}')`, [id]);
    try {
      for (const search of ['Nora', 'Vale', 'Nora Vale']) {
        expect((await listContacts({ search })).data.map((c) => c.id)).toContain(id);
      }
    } finally {
      await query('DELETE FROM contacts WHERE id = $1', [id]);
    }
  });

  it('shows lookup data after preview without claiming that the field was applied', async () => {
    const contactId = '00000000-0000-0000-0000-000000000002';
    const transactionId = await recordTransaction({
      providerId: '20000000-0000-0000-0000-000000000001',
      contactId,
      costCents: 0,
      status: 'success',
      fieldsReturned: ['email'],
    });
    try {
      expect((await listContacts({ enrichmentStatus: 'has_data' })).data.map((c) => c.id)).toContain(contactId);

      await query("UPDATE contacts SET title = 'Unrelated edit' WHERE id = $1", [contactId]);
      expect((await listContacts({ enrichmentStatus: 'has_data' })).data.map((c) => c.id)).toContain(contactId);

      const response = await applyEnrichment({
        json: async () => ({ contactId, fields: [{ field: 'email', value: 'bea@example.test' }] }),
      } as NextRequest);
      expect(response.status).toBe(400);
      expect((await query<{ email: string | null }>('SELECT email FROM contacts WHERE id = $1', [contactId])).rows[0].email)
        .toBeNull();
      expect((await listContacts({ enrichmentStatus: 'has_data' })).data.map((c) => c.id)).toContain(contactId);
      expect((await listContacts({ enrichmentStatus: 'no_data' })).data.map((c) => c.id)).not.toContain(contactId);
    } finally {
      await query('DELETE FROM enrichment_transactions WHERE id = $1', [transactionId]);
      await query('UPDATE contacts SET email = NULL WHERE id = $1', [contactId]);
      await query("UPDATE contacts SET title = 'Designer' WHERE id = $1", [contactId]);
    }
  });

  it('does not count failed or empty provider lookups as data', async () => {
    const contactId = '00000000-0000-0000-0000-000000000005';
    const providerId = '20000000-0000-0000-0000-000000000001';
    const failedId = await recordTransaction({ providerId, contactId, costCents: 0,
      status: 'failed', fieldsReturned: ['email'] });
    const emptyId = await recordTransaction({ providerId, contactId, costCents: 0,
      status: 'success', fieldsReturned: [] });
    try {
      expect((await listContacts({ enrichmentStatus: 'no_data' })).data.map((c) => c.id))
        .toContain(contactId);
      expect((await listContacts({ enrichmentStatus: 'has_data' })).data.map((c) => c.id))
        .not.toContain(contactId);
    } finally {
      await query('DELETE FROM enrichment_transactions WHERE id IN ($1, $2)', [failedId, emptyId]);
    }
  });

  it('projects unknown scores separately from zero and selects the latest outreach state', async () => {
    const rows = (await listContacts({ sort: 'fullName', order: 'asc' })).data;
    expect(rows[0]).toMatchObject({ full_name: 'Ada', referral_tier: 'silver-referral', enrichment_status: 'has_data', outreach_state: 'replied' });
    expect(rows[1]).toMatchObject({ full_name: 'Bea', enrichment_status: 'no_data', outreach_state: null });
    expect(rows[2]).toMatchObject({ full_name: 'Cal', enrichment_status: 'has_data' });
    expect(rows[3]).toMatchObject({ full_name: 'Dee', composite_score: 0, enrichment_status: 'has_data' });
    expect(rows[4]).toMatchObject({ full_name: 'Zed', composite_score: null, enrichment_status: 'no_data' });
  });
});
