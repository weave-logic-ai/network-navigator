// Import session tracking: create, update, complete sessions

import { PoolClient } from 'pg';
import { ImportError } from './types';

export async function createImportSession(
  client: PoolClient,
  totalFiles: number
): Promise<string> {
  const result = await client.query(
    `INSERT INTO import_sessions (total_files, status, started_at)
     VALUES ($1, 'processing', now_utc())
     RETURNING id`,
    [totalFiles]
  );
  return result.rows[0].id;
}

export async function updateSessionProgress(
  client: PoolClient,
  sessionId: string,
  updates: {
    processedFiles?: number;
    totalRecords?: number;
    newRecords?: number;
    updatedRecords?: number;
    skippedRecords?: number;
    errorCount?: number;
    errors?: ImportError[];
  }
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.processedFiles !== undefined) {
    setClauses.push(`processed_files = $${idx++}`);
    values.push(updates.processedFiles);
  }
  if (updates.totalRecords !== undefined) {
    setClauses.push(`total_records = $${idx++}`);
    values.push(updates.totalRecords);
  }
  if (updates.newRecords !== undefined) {
    setClauses.push(`new_records = $${idx++}`);
    values.push(updates.newRecords);
  }
  if (updates.updatedRecords !== undefined) {
    setClauses.push(`updated_records = $${idx++}`);
    values.push(updates.updatedRecords);
  }
  if (updates.skippedRecords !== undefined) {
    setClauses.push(`skipped_records = $${idx++}`);
    values.push(updates.skippedRecords);
  }
  if (updates.errorCount !== undefined) {
    setClauses.push(`error_count = $${idx++}`);
    values.push(updates.errorCount);
  }
  if (updates.errors !== undefined) {
    setClauses.push(`errors = $${idx++}`);
    values.push(JSON.stringify(updates.errors));
  }

  if (setClauses.length === 0) return;

  values.push(sessionId);
  await client.query(
    `UPDATE import_sessions SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values
  );
}

export async function completeSession(
  client: PoolClient,
  sessionId: string,
  status: 'completed' | 'failed',
  errors?: ImportError[]
): Promise<void> {
  await client.query(
    `UPDATE import_sessions
     SET status = $1, completed_at = now_utc(), errors = COALESCE($3, errors)
     WHERE id = $2`,
    [status, sessionId, errors ? JSON.stringify(errors) : null]
  );
}

export async function createImportFileRecord(
  client: PoolClient,
  sessionId: string,
  filename: string,
  fileType: string,
  fileSizeBytes?: number
): Promise<string> {
  const result = await client.query(
    `INSERT INTO import_files (session_id, filename, file_type, file_size_bytes)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [sessionId, filename, fileType, fileSizeBytes ?? null]
  );
  return result.rows[0].id;
}

export async function updateImportFileRecord(
  client: PoolClient,
  fileId: string,
  updates: {
    recordCount?: number;
    processedCount?: number;
    status?: string;
    errors?: ImportError[];
  }
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.recordCount !== undefined) {
    setClauses.push(`record_count = $${idx++}`);
    values.push(updates.recordCount);
  }
  if (updates.processedCount !== undefined) {
    setClauses.push(`processed_count = $${idx++}`);
    values.push(updates.processedCount);
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.errors !== undefined) {
    setClauses.push(`errors = $${idx++}`);
    values.push(JSON.stringify(updates.errors));
  }

  if (setClauses.length === 0) return;

  values.push(fileId);
  await client.query(
    `UPDATE import_files SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values
  );
}
