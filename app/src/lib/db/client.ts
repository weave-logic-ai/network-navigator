// PostgreSQL connection pool using pg library

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

const transactionQueryContext = new AsyncLocalStorage<PoolClient>();

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
  const client = transactionQueryContext.getStore();
  return client ? client.query<T>(text, params) : pool.query<T>(text, params);
}

/** Route-scoped transaction for services whose helpers use `query`. */
export async function transactionWithQueryContext<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction((client) => transactionQueryContext.run(client, () => fn(client)));
}

/** Keep an optional snippet effect from aborting a surrounding receipt transaction. */
export async function withQuerySavepoint<T>(name: 'snippet_chain' | 'snippet_link', fn: () => Promise<T>): Promise<T> {
  const client = transactionQueryContext.getStore();
  if (!client) return fn();
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
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
