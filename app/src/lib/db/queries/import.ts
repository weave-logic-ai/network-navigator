// Import session query functions

import { query } from '../client';

interface ImportSessionRow {
  id: string;
  status: string;
  total_files: number;
  processed_files: number;
  total_records: number;
  new_records: number;
  updated_records: number;
  skipped_records: number;
  error_count: number;
  errors: unknown[];
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

interface ImportFileRow {
  id: string;
  session_id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number | null;
  record_count: number;
  processed_count: number;
  status: string;
  errors: unknown[];
  created_at: Date;
}

interface ChangeLogRow {
  id: string;
  session_id: string;
  contact_id: string | null;
  change_type: string;
  field_changes: Record<string, unknown>;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  created_at: Date;
}

export async function createImportSession(): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO import_sessions (status) VALUES ('pending') RETURNING id`
  );
  return result.rows[0].id;
}

export async function getImportSession(
  id: string
): Promise<{ session: ImportSessionRow; files: ImportFileRow[] } | null> {
  const sessionResult = await query<ImportSessionRow>(
    'SELECT * FROM import_sessions WHERE id = $1',
    [id]
  );

  if (sessionResult.rows.length === 0) return null;

  const filesResult = await query<ImportFileRow>(
    'SELECT * FROM import_files WHERE session_id = $1 ORDER BY created_at',
    [id]
  );

  return {
    session: sessionResult.rows[0],
    files: filesResult.rows,
  };
}

export async function listImportSessions(
  page: number = 1,
  limit: number = 20
): Promise<{
  data: ImportSessionRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*)::text as count FROM import_sessions'
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataResult = await query<ImportSessionRow>(
    'SELECT * FROM import_sessions ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function updateImportSession(
  id: string,
  data: Partial<{
    status: string;
    total_files: number;
    processed_files: number;
    total_records: number;
    new_records: number;
    updated_records: number;
    skipped_records: number;
    error_count: number;
    errors: unknown[];
    started_at: Date;
    completed_at: Date;
  }>
): Promise<ImportSessionRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (key === 'errors') {
      setClauses.push(`${key} = $${idx++}`);
      values.push(JSON.stringify(value));
    } else {
      setClauses.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return null;

  values.push(id);
  const result = await query<ImportSessionRow>(
    `UPDATE import_sessions SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function getImportChangeLog(
  sessionId: string,
  page: number = 1,
  limit: number = 100
): Promise<{
  data: ChangeLogRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*)::text as count FROM import_change_log WHERE session_id = $1',
    [sessionId]
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataResult = await query<ChangeLogRow>(
    'SELECT * FROM import_change_log WHERE session_id = $1 ORDER BY created_at LIMIT $2 OFFSET $3',
    [sessionId, limit, offset]
  );

  return {
    data: dataResult.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
