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

      const normalizedStart = startDate && !isNaN(startDate.getTime()) ? startDate : null;
      const normalizedEnd = endDate && !isNaN(endDate.getTime()) ? endDate : null;
      const values = [selfContactId, institution, degree || null, fieldOfStudy || null, normalizedStart, normalizedEnd];
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(values)]);
        const existing = await client.query(
          `SELECT id FROM education WHERE contact_id = $1 AND institution = $2
           AND degree IS NOT DISTINCT FROM $3 AND field_of_study IS NOT DISTINCT FROM $4
           AND start_date IS NOT DISTINCT FROM $5 AND end_date IS NOT DISTINCT FROM $6 AND source = 'csv' LIMIT 1`, values
        );
        if (existing.rows.length) {
          result.skippedRecords++;
          await client.query('COMMIT');
          continue;
        }
        await client.query(
          `INSERT INTO education (contact_id, institution, degree, field_of_study, start_date, end_date, source)
           VALUES ($1, $2, $3, $4, $5, $6, 'csv')`,
          [selfContactId, institution, degree || null, fieldOfStudy || null, normalizedStart, normalizedEnd]
        );

        // Create EDUCATED_AT edge only for a new education row.
        const institutionCompany = await companyResolver.resolve(institution);
        if (institutionCompany) {
          await createEducatedAtEdge(client, selfContactId, institutionCompany.id, degree, fieldOfStudy);
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
        file: 'Education.csv',
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      result.skippedRecords++;
    }
  }

  return result;
}
