// Company Follows.csv importer: FOLLOWS_COMPANY edges

import { PoolClient } from 'pg';
import { parseCsv } from './csv-parser';
import { CompanyResolver } from './company-resolver';
import { createFollowsCompanyEdge } from './edge-builder';
import { ImportError } from './types';

interface CompanyFollowsImportResult {
  totalRows: number;
  newRecords: number;
  skippedRecords: number;
  errors: ImportError[];
}

export async function importCompanyFollows(
  client: PoolClient,
  csvContent: string,
  selfContactId: string
): Promise<CompanyFollowsImportResult> {
  const result: CompanyFollowsImportResult = {
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
      const companyName = row['organization'] || row['company'] || row['name'] || '';

      if (!companyName.trim()) {
        result.skippedRecords++;
        continue;
      }

      const companyRecord = await companyResolver.resolve(companyName);
      if (companyRecord) {
        await createFollowsCompanyEdge(client, selfContactId, companyRecord.id);
        result.newRecords++;
      } else {
        result.skippedRecords++;
      }
    } catch (err) {
      result.errors.push({
        file: 'Company_Follows.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}
