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

  // Track messages per contact for stats computation
  const contactMessages: Map<string, { sent: number; received: number; conversations: Set<string>; firstAt: Date; lastAt: Date }> = new Map();

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

      const sentAt = dateStr ? new Date(dateStr) : new Date();
      if (isNaN(sentAt.getTime())) {
        result.errors.push({ file: 'messages.csv', row: i + 1, message: 'Invalid date' });
        result.skippedRecords++;
        continue;
      }

      // Determine direction based on FROM matching user's name
      const isSent = from.toLowerCase().includes(selfName.toLowerCase());
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

      // Insert message
      await client.query(
        `INSERT INTO messages (contact_id, direction, subject, content, conversation_id, sent_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'csv')`,
        [contactId, direction, subject || null, content, conversationId || null, sentAt]
      );
      result.newRecords++;

      // Track for stats
      if (!contactMessages.has(contactId)) {
        contactMessages.set(contactId, {
          sent: 0,
          received: 0,
          conversations: new Set(),
          firstAt: sentAt,
          lastAt: sentAt,
        });
      }
      const stats = contactMessages.get(contactId)!;
      if (isSent) stats.sent++;
      else stats.received++;
      if (conversationId) stats.conversations.add(conversationId);
      if (sentAt < stats.firstAt) stats.firstAt = sentAt;
      if (sentAt > stats.lastAt) stats.lastAt = sentAt;
    } catch (err) {
      result.errors.push({
        file: 'messages.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Compute and upsert message_stats
  for (const [contactId, stats] of contactMessages) {
    const total = stats.sent + stats.received;
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
      [contactId, total, stats.sent, stats.received, stats.firstAt, stats.lastAt, stats.conversations.size]
    );
    result.statsComputed++;

    // Create MESSAGED edge
    await createMessageEdge(client, selfContactId, contactId, total);
  }

  return result;
}
