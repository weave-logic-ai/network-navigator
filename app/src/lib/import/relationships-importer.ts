// Relationships importers: Invitations, Endorsements, Recommendations

import { PoolClient } from 'pg';
import { parseCsv } from './csv-parser';
import {
  createInvitationEdge,
  createEndorsementEdge,
  createRecommendationEdge,
} from './edge-builder';
import { ImportError } from './types';

interface RelationshipImportResult {
  totalRows: number;
  newRecords: number;
  skippedRecords: number;
  errors: ImportError[];
}

// Resolve a contact by name when URL is unavailable
async function resolveContactByName(
  client: PoolClient,
  name: string
): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const result = await client.query(
    `SELECT id FROM contacts
     WHERE full_name ILIKE $1 OR (first_name || ' ' || last_name) ILIKE $1
     LIMIT 1`,
    [name.trim()]
  );
  return result.rows[0]?.id ?? null;
}

export async function importInvitations(
  client: PoolClient,
  csvContent: string,
  selfContactId: string
): Promise<RelationshipImportResult> {
  const result: RelationshipImportResult = {
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  };

  const parsed = parseCsv(csvContent);
  result.totalRows = parsed.rowCount;

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    try {
      const name = row['from'] || row['to'] || row['name'] || '';
      const direction = row['direction'] || 'sent';
      const sentAt = row['sent_at'] || row['date'] || '';

      const contactId = await resolveContactByName(client, name);
      if (!contactId) {
        result.skippedRecords++;
        continue;
      }

      if (direction === 'sent') {
        await createInvitationEdge(client, selfContactId, contactId, sentAt);
      } else {
        await createInvitationEdge(client, contactId, selfContactId, sentAt);
      }
      result.newRecords++;
    } catch (err) {
      result.errors.push({
        file: 'Invitations.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}

export async function importEndorsements(
  client: PoolClient,
  csvContent: string,
  selfContactId: string,
  isGiven: boolean
): Promise<RelationshipImportResult> {
  const result: RelationshipImportResult = {
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  };

  const parsed = parseCsv(csvContent);
  result.totalRows = parsed.rowCount;

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    try {
      const name = row['endorsee'] || row['endorser'] || row['name'] || '';
      const skill = row['skill'] || row['skill_name'] || '';

      const contactId = await resolveContactByName(client, name);
      if (!contactId) {
        result.skippedRecords++;
        continue;
      }

      if (isGiven) {
        await createEndorsementEdge(client, selfContactId, contactId, skill);
      } else {
        await createEndorsementEdge(client, contactId, selfContactId, skill);
      }
      result.newRecords++;
    } catch (err) {
      result.errors.push({
        file: isGiven ? 'Endorsements_Given.csv' : 'Endorsements_Received.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}

export async function importRecommendations(
  client: PoolClient,
  csvContent: string,
  selfContactId: string,
  isGiven: boolean
): Promise<RelationshipImportResult> {
  const result: RelationshipImportResult = {
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  };

  const parsed = parseCsv(csvContent);
  result.totalRows = parsed.rowCount;

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    try {
      const name = row['recommendee'] || row['recommender'] || row['name'] || '';
      const text = row['recommendation'] || row['text'] || '';

      const contactId = await resolveContactByName(client, name);
      if (!contactId) {
        result.skippedRecords++;
        continue;
      }

      if (isGiven) {
        await createRecommendationEdge(client, selfContactId, contactId, text);
      } else {
        await createRecommendationEdge(client, contactId, selfContactId, text);
      }
      result.newRecords++;
    } catch (err) {
      result.errors.push({
        file: isGiven ? 'Recommendations_Given.csv' : 'Recommendations_Received.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}
