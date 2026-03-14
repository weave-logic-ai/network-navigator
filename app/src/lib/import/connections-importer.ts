// Connections.csv importer: map fields, company resolution, dedup, edge creation

import { PoolClient } from 'pg';
import { parseCsv } from './csv-parser';
import { CompanyResolver } from './company-resolver';
import { deduplicateContact } from './deduplication';
import { createConnectionEdge } from './edge-builder';
import { ImportError } from './types';

interface ConnectionsImportResult {
  totalRows: number;
  newRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  errors: ImportError[];
}

export async function importConnections(
  client: PoolClient,
  csvContent: string,
  sessionId: string,
  selfContactId: string
): Promise<ConnectionsImportResult> {
  const result: ConnectionsImportResult = {
    totalRows: 0,
    newRecords: 0,
    updatedRecords: 0,
    skippedRecords: 0,
    errors: [],
  };

  // LinkedIn Connections.csv has 2 preamble lines
  const parsed = parseCsv(csvContent, { preambleLines: 2 });
  result.totalRows = parsed.rowCount;

  if (parsed.errors.length > 0) {
    result.errors.push(
      ...parsed.errors.map((e) => ({
        file: 'Connections.csv',
        row: e.row,
        message: e.message,
      }))
    );
  }

  const companyResolver = new CompanyResolver(client);

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    try {
      const firstName = row['first_name'] || '';
      const lastName = row['last_name'] || '';
      const linkedinUrl = row['url'] || '';
      const email = row['email_address'] || '';
      const company = row['company'] || '';
      const title = row['position'] || '';
      const connectedOn = row['connected_on'] || '';
      const fullName = [firstName, lastName].filter(Boolean).join(' ');

      if (!linkedinUrl) {
        result.errors.push({
          file: 'Connections.csv',
          row: i + 1,
          message: 'Missing LinkedIn URL, skipping row',
        });
        result.skippedRecords++;
        continue;
      }

      // Resolve company
      const companyRecord = await companyResolver.resolve(company);

      // Deduplicate and upsert contact
      const dedupResult = await deduplicateContact(client, {
        linkedinUrl,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        fullName: fullName || undefined,
        title: title || undefined,
        currentCompany: company || undefined,
        currentCompanyId: companyRecord?.id,
        email: email || undefined,
      });

      // Track the change in import_change_log
      await client.query(
        `INSERT INTO import_change_log (session_id, contact_id, change_type, field_changes, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sessionId,
          dedupResult.contactId,
          dedupResult.action,
          JSON.stringify(dedupResult.changes.map((c) => c.field)),
          JSON.stringify(
            Object.fromEntries(dedupResult.changes.map((c) => [c.field, c.oldValue]))
          ),
          JSON.stringify(
            Object.fromEntries(dedupResult.changes.map((c) => [c.field, c.newValue]))
          ),
        ]
      );

      // Create CONNECTED_TO edge
      await createConnectionEdge(client, selfContactId, dedupResult.contactId, connectedOn);

      // Update counters
      if (dedupResult.action === 'created') result.newRecords++;
      else if (dedupResult.action === 'updated') result.updatedRecords++;
      else result.skippedRecords++;
    } catch (err) {
      result.errors.push({
        file: 'Connections.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}
