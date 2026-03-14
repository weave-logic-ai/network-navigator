// Education.csv importer: education records with EDUCATED_AT edges

import { PoolClient } from 'pg';
import { parseCsv } from './csv-parser';
import { CompanyResolver } from './company-resolver';
import { createEducatedAtEdge } from './edge-builder';
import { ImportError } from './types';

interface EducationImportResult {
  totalRows: number;
  newRecords: number;
  skippedRecords: number;
  errors: ImportError[];
}

export async function importEducation(
  client: PoolClient,
  csvContent: string,
  selfContactId: string
): Promise<EducationImportResult> {
  const result: EducationImportResult = {
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
      const institution = row['school_name'] || row['institution'] || '';
      const degree = row['degree_name'] || row['degree'] || '';
      const fieldOfStudy = row['notes'] || row['field_of_study'] || '';
      const startDateStr = row['start_date'] || '';
      const endDateStr = row['end_date'] || '';

      if (!institution) {
        result.skippedRecords++;
        continue;
      }

      const startDate = startDateStr ? new Date(startDateStr) : null;
      const endDate = endDateStr ? new Date(endDateStr) : null;

      // Insert education record
      await client.query(
        `INSERT INTO education (contact_id, institution, degree, field_of_study, start_date, end_date, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'csv')`,
        [
          selfContactId,
          institution,
          degree || null,
          fieldOfStudy || null,
          startDate && !isNaN(startDate.getTime()) ? startDate : null,
          endDate && !isNaN(endDate.getTime()) ? endDate : null,
        ]
      );

      // Create EDUCATED_AT edge (using company resolver for institution)
      const institutionCompany = await companyResolver.resolve(institution);
      if (institutionCompany) {
        await createEducatedAtEdge(client, selfContactId, institutionCompany.id, degree, fieldOfStudy);
      }

      result.newRecords++;
    } catch (err) {
      result.errors.push({
        file: 'Education.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}
