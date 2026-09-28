// Messages.csv importer: parse, direction detection, message_stats computation

import { PoolClient } from 'pg';
import { parseCsv } from './csv-parser';
import { createMessageEdge } from './edge-builder';
import { ImportError } from './types';

interface MessagesImportResult {
  totalRows: number;
  newRecords: number;
  skippedRecords: number;
  errors: ImportError[];
  statsComputed: number;
}

export function isOwnerSender(from: string, selfName: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return Boolean(normalize(selfName)) && normalize(from) === normalize(selfName);
}

export async function importMessages(
  client: PoolClient,
  csvContent: string,
  sessionId: string,
  selfContactId: string,
  selfName: string
): Promise<MessagesImportResult> {
  const result: MessagesImportResult = {
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
    statsComputed: 0,
  };

  const parsed = parseCsv(csvContent);
  result.totalRows = parsed.rowCount;
  if (!selfName.trim()) {
    result.skippedRecords = result.totalRows;
    result.errors.push({ file: 'messages.csv', message: 'Messages skipped: owner name is required' });
    return result;
  }

  // Recompute stats from stored messages, including rows imported previously.
  const touchedContacts = new Set<string>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    try {
      const from = row['from'] || '';
      const to = row['to'] || '';
      const dateStr = row['date'] || '';
      const subject = row['subject'] || '';
      const content = row['content'] || '';
      const conversationId = row['conversation_id'] || '';

      if (!content && !subject) {
        result.skippedRecords++;
        continue;
      }

      const sentAt = dateStr ? new Date(dateStr) : new Date(NaN);
      if (isNaN(sentAt.getTime())) {
        result.errors.push({ file: 'messages.csv', row: i + 1, message: 'Invalid date' });
        result.skippedRecords++;
        continue;
      }

      // Determine direction based on FROM matching user's name
      const isSent = isOwnerSender(from, selfName);
      const direction = isSent ? 'sent' : 'received';
      const otherPartyName = isSent ? to : from;

      // Resolve the contact by name match
      const contactResult = await client.query(
        `SELECT id FROM contacts
         WHERE full_name ILIKE $1 OR (first_name || ' ' || last_name) ILIKE $1
         LIMIT 1`,
        [otherPartyName.trim()]
      );

      if (contactResult.rows.length === 0) {
        result.skippedRecords++;
        continue;
      }

      const contactId = contactResult.rows[0].id;

      const identity = JSON.stringify([contactId, direction, subject, content, conversationId, sentAt.toISOString()]);
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [identity]);
        const existing = await client.query(
          `SELECT id FROM messages WHERE contact_id = $1 AND direction = $2
           AND subject IS NOT DISTINCT FROM $3 AND content = $4
           AND conversation_id IS NOT DISTINCT FROM $5 AND sent_at = $6 AND source = 'csv' LIMIT 1`,
          [contactId, direction, subject || null, content, conversationId || null, sentAt]
        );
        if (existing.rows.length) {
          result.skippedRecords++;
        } else {
          await client.query(
            `INSERT INTO messages (contact_id, direction, subject, content, conversation_id, sent_at, source)
             VALUES ($1, $2, $3, $4, $5, $6, 'csv')`,
            [contactId, direction, subject || null, content, conversationId || null, sentAt]
          );
          result.newRecords++;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      touchedContacts.add(contactId);
    } catch (err) {
      result.errors.push({
        file: 'messages.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      result.skippedRecords++;
    }
  }

  // Compute and upsert message_stats
  for (const contactId of touchedContacts) {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`message-aggregate:${contactId}`]);
      const aggregate = await client.query<{ total: number; sent: number; received: number; first_at: Date; last_at: Date; conversations: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE direction = 'sent')::int AS sent,
         count(*) FILTER (WHERE direction = 'received')::int AS received,
         min(sent_at) AS first_at, max(sent_at) AS last_at,
         count(DISTINCT conversation_id)::int AS conversations
       FROM messages WHERE contact_id = $1`, [contactId]
      );
      const stats = aggregate.rows[0];
      await client.query(
      `INSERT INTO message_stats (
        contact_id, total_messages, sent_count, received_count,
        first_message_at, last_message_at, conversation_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (contact_id) DO UPDATE SET
        total_messages = EXCLUDED.total_messages,
        sent_count = EXCLUDED.sent_count,
        received_count = EXCLUDED.received_count,
        first_message_at = EXCLUDED.first_message_at,
        last_message_at = EXCLUDED.last_message_at,
        conversation_count = EXCLUDED.conversation_count`,
      [contactId, stats.total, stats.sent, stats.received, stats.first_at, stats.last_at, stats.conversations]
      );

      // A previous import may have committed rows but failed before this
      // aggregate/edge transaction. Reconcile on every touched-contact rerun.
      const existingEdge = await client.query(
          `UPDATE edges SET weight = $3, properties = jsonb_set(COALESCE(properties, '{}'::jsonb),
             '{message_count}', to_jsonb($4::int))
           WHERE source_contact_id = $1 AND target_contact_id = $2 AND edge_type = 'MESSAGED'
           RETURNING id`,
          [selfContactId, contactId, Math.log(stats.total + 1), stats.total]
      );
      if (existingEdge.rows.length === 0) {
        await createMessageEdge(client, selfContactId, contactId, stats.total);
      }
      await client.query('COMMIT');
      result.statsComputed++;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  return result;
}
