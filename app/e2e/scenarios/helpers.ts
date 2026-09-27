import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { request as requestFactory, test as baseTest,
  type APIRequestContext, type APIResponse, type BrowserContext } from '@playwright/test';
import { OPERATOR_COOKIE } from '../../src/lib/auth/operator-session';

/** Unlock against the actual app with a secret configured only on the E2E server. */
export async function authenticatedScenarioRequest(
  context?: BrowserContext,
  baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000',
): Promise<APIRequestContext> {
  const secret = process.env.E2E_OPERATOR_SECRET;
  if (!secret || secret.length < 32) throw new Error('E2E_OPERATOR_SECRET is required');
  const url = new URL(baseURL);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Scenario app must use a loopback HTTP origin');
  }
  const origin = url.origin;
  const api = await requestFactory.newContext({ baseURL: origin,
    extraHTTPHeaders: { origin, 'sec-fetch-site': 'same-origin' } });
  try {
    const unlocked = await api.post('/api/operator/unlock', { data: { secret } });
    if (!unlocked.ok()) throw new Error(`Scenario operator unlock failed: ${unlocked.status()}`);
    const cookie = (await api.storageState()).cookies.find(item => item.name === OPERATOR_COOKIE);
    if (!cookie) throw new Error('Scenario operator unlock returned no session cookie');
    if (context) await context.addCookies([cookie]);
    return api;
  } catch (error) {
    await api.dispose();
    throw error;
  }
}

export const scenarioTest = baseTest.extend<{ scenarioRequest: APIRequestContext }>({
  scenarioRequest: async ({ context, baseURL }, use) => {
    const api = await authenticatedScenarioRequest(context, baseURL);
    try { await use(api); } finally { await api.dispose(); }
  },
});

/** Use the server snapshot for every scenario focus/clear, including cleanup. */
export async function focusScenarioTarget(
  request: Pick<APIRequestContext, 'get' | 'put'>,
  targetId: string | null,
  baseURL?: string,
): Promise<APIResponse> {
  const url = baseURL ? new URL('/api/targets/state', baseURL).toString() : '/api/targets/state';
  const current = await request.get(url);
  if (!current.ok()) throw new Error(`Could not read target context: ${current.status()}`);
  const body = await current.json() as { data?: { revision?: unknown } };
  const expectedRevision = body.data?.revision;
  if (typeof expectedRevision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(expectedRevision)) {
    throw new Error('Target context response has no valid revision');
  }
  return request.put(url, { data: { expectedRevision, action: { type: 'focus', targetId } } });
}

export interface ScenarioFixture {
  ownerId: string;
  companyId: string;
  firstContactId: string;
  secondContactId: string;
  close(): Promise<void>;
}

/** Seed only a dedicated test database; scenario tests never write to user data. */
export async function createScenarioFixture(): Promise<ScenarioFixture> {
  const connectionString = process.env.E2E_DATABASE_URL;
  if (!connectionString) throw new Error('E2E_DATABASE_URL is required');
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!/(?:_test|_validation)$/.test(databaseName)) {
    throw new Error('Scenario tests require a database ending in _test or _validation');
  }

  const pool = new Pool({ connectionString });
  const ownerId = randomUUID();
  const companyId = randomUUID();
  const firstContactId = randomUUID();
  const secondContactId = randomUUID();
  const client = await pool.connect();
  let seeded = false;
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM owner_profiles WHERE is_current = TRUE AND source <> 'e2e_scenario'"
    );
    if (Number(existing.rows[0].count) > 0) {
      throw new Error('Dedicated scenario database contains a non-test current owner');
    }
    await client.query("UPDATE owner_profiles SET is_current = FALSE WHERE source = 'e2e_scenario'");
    await client.query(
      `INSERT INTO owner_profiles (id, source, is_current, first_name, last_name)
       VALUES ($1, 'e2e_scenario', TRUE, 'Scenario', 'Owner')`,
      [ownerId]
    );
    await client.query(
      `INSERT INTO companies (id, name, slug) VALUES ($1, 'Scenario Acme', $2)`,
      [companyId, `scenario-acme-${companyId}`]
    );
    await client.query(
      `INSERT INTO contacts
         (id, linkedin_url, full_name, first_name, last_name, title, current_company, current_company_id, degree)
       VALUES
         ($1, $3, 'Scenario Alice', 'Scenario', 'Alice', 'CEO', 'Scenario Acme', $5, 1),
         ($2, $4, 'Scenario Bob', 'Scenario', 'Bob', 'CTO', 'Scenario Acme', $5, 1)`,
      [firstContactId, secondContactId,
        `https://www.linkedin.com/in/scenario-${firstContactId}`,
        `https://www.linkedin.com/in/scenario-${secondContactId}`, companyId]
    );
    await client.query(
      `INSERT INTO contact_scores (contact_id, composite_score, tier)
       VALUES ($1, 0.8, 'gold'), ($2, 0.4, 'silver')`,
      [firstContactId, secondContactId]
    );
    await client.query(
      `INSERT INTO edges (source_contact_id, target_contact_id, edge_type)
       VALUES ($1, $2, 'CONNECTED_TO')`,
      [firstContactId, secondContactId]
    );
    await client.query('COMMIT');
    seeded = true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    if (!seeded) await pool.end();
  }

  return {
    ownerId,
    companyId,
    firstContactId,
    secondContactId,
    async close() {
      try {
        // Remove the scenario's target rows explicitly before its subjects so
        // cleanup works on dedicated databases both before and after 057.
        await pool.query('DELETE FROM research_target_state WHERE user_id = $1', [ownerId]);
        await pool.query(
          `DELETE FROM research_targets
           WHERE owner_id = $1 OR contact_id = ANY($2::uuid[]) OR company_id = $3`,
          [ownerId, [firstContactId, secondContactId], companyId]
        );
        await pool.query('DELETE FROM contacts WHERE id = ANY($1::uuid[])',
          [[firstContactId, secondContactId]]);
        await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
        await pool.query('DELETE FROM owner_profiles WHERE id = $1', [ownerId]);
      } finally {
        await pool.end();
      }
    },
  };
}
