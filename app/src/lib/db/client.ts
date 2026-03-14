// PostgreSQL connection pool using pg library

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: 2,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Parameterized query helper
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

// Transaction helper: commits on success, rolls back on error
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Health check: returns true if database is reachable
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Get the pool for direct access (e.g., in import pipeline)
export function getPool(): Pool {
  return pool;
}

// Graceful shutdown (idempotent)
let shuttingDown = false;
export async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await pool.end();
}
