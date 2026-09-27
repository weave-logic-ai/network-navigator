import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

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
    // These fixed visual-fixture scores are deliberately unverified legacy
    // data. Never label them owner scores with an invented basis hash.
    await client.query("SELECT set_config('app.score_owner_restore', 'true', true)");
    await client.query(
      `INSERT INTO contact_scores (contact_id, composite_score, tier, basis_kind, basis_hash)
       VALUES ($1, 0.8, 'gold', 'legacy-unverified', NULL),
              ($2, 0.4, 'silver', 'legacy-unverified', NULL)`,
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
        // The target FKs use ON DELETE SET NULL while target CHECKs require a
        // subject, so remove targets before deleting their subjects.
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
