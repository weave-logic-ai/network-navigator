// Positions.csv importer: work history with company resolution, WORKS_AT/WORKED_AT edges

import { PoolClient } from 'pg';
import { parseCsv } from './csv-parser';
import { CompanyResolver } from './company-resolver';
import { createWorksAtEdge, createWorkedAtEdge } from './edge-builder';
import { ImportError } from './types';

interface PositionsImportResult {
  totalRows: number;
  newRecords: number;
  skippedRecords: number;
  errors: ImportError[];
}

export async function importPositions(
  client: PoolClient,
  csvContent: string,
  selfContactId: string
): Promise<PositionsImportResult> {
  const result: PositionsImportResult = {
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  };

  const parsed = parseCsv(csvContent);
  result.totalRows = parsed.rowCount;

  const companyResolver = new CompanyResolver(client);

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    try {
      const companyName = row['company_name'] || row['company'] || '';
      const title = row['title'] || row['position'] || '';
      const startDateStr = row['started_on'] || row['start_date'] || '';
      const endDateStr = row['finished_on'] || row['end_date'] || '';
      const description = row['description'] || '';

      if (!companyName && !title) {
        result.skippedRecords++;
        continue;
      }

      const startDate = startDateStr ? new Date(startDateStr) : null;
      const endDate = endDateStr ? new Date(endDateStr) : null;
      const isCurrent = !endDate || isNaN(endDate.getTime());

      const normalizedStart = startDate && !isNaN(startDate.getTime()) ? startDate : null;
      const normalizedEnd = endDate && !isNaN(endDate.getTime()) ? endDate : null;
      const values = [selfContactId, companyName || 'Unknown', title || 'Unknown', normalizedStart,
        normalizedEnd, isCurrent, description || null];
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(values)]);
        const existing = await client.query(
          `SELECT id FROM work_history WHERE contact_id = $1 AND company_name = $2 AND title = $3
           AND start_date IS NOT DISTINCT FROM $4 AND end_date IS NOT DISTINCT FROM $5
           AND is_current = $6 AND description IS NOT DISTINCT FROM $7 AND source = 'csv' LIMIT 1`, values
        );
        if (existing.rows.length) {
          result.skippedRecords++;
          await client.query('COMMIT');
          continue;
        }
        const companyRecord = await companyResolver.resolve(companyName);
        await client.query(
          `INSERT INTO work_history (contact_id, company_id, company_name, title, start_date, end_date, is_current, description, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'csv')`,
          [selfContactId, companyRecord?.id || null, companyName || 'Unknown', title || 'Unknown',
            normalizedStart, normalizedEnd, isCurrent, description || null]
        );

        // Create appropriate edge only for a new position.
        if (companyRecord) {
          if (isCurrent) {
            await createWorksAtEdge(client, selfContactId, companyRecord.id, title);
          } else {
            await createWorkedAtEdge(client, selfContactId, companyRecord.id, title, startDateStr, endDateStr);
          }
        }
        await client.query('COMMIT');
        result.newRecords++;
      } catch (error) {
        await client.query('ROLLBACK');
        companyResolver.clearCache();
        throw error;
      }
    } catch (err) {
      result.errors.push({
        file: 'Positions.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      result.skippedRecords++;
    }
  }

  return result;
}
