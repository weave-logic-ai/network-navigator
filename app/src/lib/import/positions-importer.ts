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

      // Resolve company
      const companyRecord = await companyResolver.resolve(companyName);

      // Insert work history
      await client.query(
        `INSERT INTO work_history (contact_id, company_id, company_name, title, start_date, end_date, is_current, description, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'csv')`,
        [
          selfContactId,
          companyRecord?.id || null,
          companyName || 'Unknown',
          title || 'Unknown',
          startDate && !isNaN(startDate.getTime()) ? startDate : null,
          endDate && !isNaN(endDate.getTime()) ? endDate : null,
          isCurrent,
          description || null,
        ]
      );

      // Create appropriate edge
      if (companyRecord) {
        if (isCurrent) {
          await createWorksAtEdge(client, selfContactId, companyRecord.id, title);
        } else {
          await createWorkedAtEdge(
            client,
            selfContactId,
            companyRecord.id,
            title,
            startDateStr,
            endDateStr
          );
        }
      }

      result.newRecords++;
    } catch (err) {
      result.errors.push({
        file: 'Positions.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}
