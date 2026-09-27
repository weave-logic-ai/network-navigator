import type { PoolClient } from 'pg';
import { getPool, query } from '../db/client';
import { captureOwnerScoringBasis, restoreOwnerScoringBasis, scoreContact } from './pipeline';
import type { OwnerScoringBasis } from './pipeline';

/** Call inside the same transaction that commits imported source data. */
export async function createLegacyImportScoreJob(
  client: PoolClient, contactIds: string[]
): Promise<string | null> {
  if (contactIds.length === 0) return null;
  const created = await client.query<{ id: string }>(
    "INSERT INTO score_import_jobs(source) VALUES ('legacy-graph') RETURNING id"
  );
  const jobId = created.rows[0].id;
  await client.query(
    `INSERT INTO score_import_job_contacts(job_id, contact_id)
     SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [jobId, contactIds]
  );
  return jobId;
}

async function restartAfterOwnerChange(client: PoolClient, jobId: string): Promise<void> {
  await client.query('BEGIN');
  try {
    const successor = await client.query<{ id: string }>(
      "INSERT INTO score_import_jobs(source) VALUES ('legacy-graph') RETURNING id"
    );
    await client.query(
      `INSERT INTO score_import_job_contacts(job_id, contact_id)
       SELECT $2, contact_id FROM score_import_job_contacts
       WHERE job_id = $1 AND skipped_at IS NULL`,
      [jobId, successor.rows[0].id]
    );
    await client.query(
      `UPDATE score_import_jobs SET failed_at = NOW(),
         failure_reason = 'Current owner changed since scoring basis capture',
         restarted_as_job_id = $2 WHERE id = $1`,
      [jobId, successor.rows[0].id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Resume a bounded set of committed import jobs, including after restart. */
export async function drainPendingImportScoreJobs(maxJobs = 2, maxContacts = 25): Promise<number> {
  const jobs = await query<{ id: string }>(
    `SELECT id FROM score_import_jobs WHERE completed_at IS NULL AND failed_at IS NULL
     ORDER BY COALESCE(last_attempt_at, created_at), id LIMIT $1`,
    [Math.max(1, Math.min(maxJobs, 10))]
  );
  let handled = 0;
  for (const job of jobs.rows) {
    const client = await getPool().connect();
    try {
      const lock = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(580061, hashtext($1)) AS locked', [job.id]
      );
      if (!lock.rows[0]?.locked) continue;
      try {
        handled++;
        await client.query('UPDATE score_import_jobs SET last_attempt_at = NOW() WHERE id = $1', [job.id]);
        const row = await client.query<{ basis_json: unknown; basis_hash: string | null }>(
          'SELECT basis_json, basis_hash FROM score_import_jobs WHERE id = $1', [job.id]
        );
        if (!row.rows[0]) continue;
        let basis: OwnerScoringBasis;
        if (row.rows[0].basis_json === null) {
          const captured = await captureOwnerScoringBasis();
          const saved = await client.query<{ basis_json: unknown }>(
            `UPDATE score_import_jobs SET basis_json = $2::jsonb, basis_hash = $3
             WHERE id = $1 AND basis_json IS NULL RETURNING basis_json`,
            [job.id, JSON.stringify(captured), captured.basisHash]
          );
          if (!saved.rows[0]) throw new Error('Import scoring basis changed during capture');
          basis = restoreOwnerScoringBasis(saved.rows[0].basis_json);
        } else {
          basis = restoreOwnerScoringBasis(row.rows[0].basis_json);
          if (basis.basisHash !== row.rows[0].basis_hash) {
            throw new Error('Import scoring job basis metadata mismatch');
          }
        }
        const contacts = await client.query<{ contact_id: string }>(
          `SELECT contact_id FROM score_import_job_contacts
           WHERE job_id = $1 AND scored_at IS NULL AND skipped_at IS NULL
           ORDER BY attempts, contact_id LIMIT $2`,
          [job.id, Math.max(1, Math.min(maxContacts, 50))]
        );
        for (const contact of contacts.rows) {
          try {
            await scoreContact(contact.contact_id, undefined, undefined, basis, true, job.id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message === 'Current owner changed since scoring basis capture') {
              await restartAfterOwnerChange(client, job.id);
              console.error('[scoring] Import job restarted after owner change', { jobId: job.id });
              break;
            }
            const archived = await client.query(
              `UPDATE score_import_job_contacts jc SET skipped_at = NOW(),
                 skip_reason = 'archived', attempts = attempts + 1, last_error = NULL
               WHERE jc.job_id = $1 AND jc.contact_id = $2
                 AND jc.scored_at IS NULL AND jc.skipped_at IS NULL
                 AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = jc.contact_id
                             AND c.is_archived = TRUE)
               RETURNING jc.contact_id`, [job.id, contact.contact_id]
            );
            if (archived.rows[0]) continue;
            await client.query(
              `UPDATE score_import_job_contacts SET attempts = attempts + 1, last_error = $3
               WHERE job_id = $1 AND contact_id = $2 AND scored_at IS NULL AND skipped_at IS NULL`,
              [job.id, contact.contact_id, message.slice(0, 500)]
            );
            console.error('[scoring] Import contact score deferred', { jobId: job.id,
              contactId: contact.contact_id, error });
          }
        }
        const remaining = await client.query(
          `SELECT 1 FROM score_import_job_contacts
           WHERE job_id = $1 AND scored_at IS NULL AND skipped_at IS NULL LIMIT 1`, [job.id]
        );
        if (remaining.rows.length === 0) {
          await client.query('UPDATE score_import_jobs SET completed_at = NOW() WHERE id = $1', [job.id]);
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock(580061, hashtext($1))', [job.id]);
      }
    } catch (error) {
      console.error('[scoring] Import score job deferred', { jobId: job.id, error });
    } finally {
      client.release();
    }
  }
  return handled;
}
