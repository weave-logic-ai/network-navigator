// Connections importer tests - testing CSV parsing logic (DB mocked)

import { parseCsv } from '@/lib/import/csv-parser';
import { importConnections } from '@/lib/import/connections-importer';
import type { PoolClient } from 'pg';

describe('Connections Importer', () => {
  const sampleConnectionsCsv = [
    'Notes:',
    '"Your connections list"',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'John,Doe,https://www.linkedin.com/in/johndoe,john@example.com,Acme Corp,Software Engineer,01 Jan 2023',
    'Jane,Smith,https://www.linkedin.com/in/janesmith,,Tech Inc,Product Manager,15 Mar 2023',
    'Bob,Wilson,https://www.linkedin.com/in/bobwilson,bob@test.com,StartupXYZ,CTO,20 Jun 2023',
  ].join('\n');

  it('counts a failed row as skipped so completed progress reaches all rows', async () => {
    const client = { query: jest.fn().mockRejectedValue(new Error('synthetic database failure')) } as unknown as PoolClient;
    const result = await importConnections(client, sampleConnectionsCsv,
      '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001');
    expect(result.totalRows).toBe(3);
    expect(result.errors).toHaveLength(3);
    expect(result.newRecords + result.updatedRecords + result.skippedRecords).toBe(result.totalRows);
  });

  it('rejects legacy view links without a valid identity instead of merging contacts', async () => {
    const csv = ['Notes:', 'Connections', 'First Name,Last Name,URL',
      'Ada,One,https://linkedin.com/profile/view?trk=one',
      'Ada,Two,https://linkedin.com/profile/view?id=',
      'Ada,Three,https://linkedin.com/profile/view?id=123'].join('\n');
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM companies')) return { rows: [] };
      if (sql.includes('FROM contacts')) return { rows: [] };
      if (sql.includes('INSERT INTO contacts')) return { rows: [{ id: 'contact-3' }] };
      return { rows: [{ id: 'edge-1' }] };
    });
    const result = await importConnections({ query } as unknown as PoolClient, csv, 'session', 'self');
    expect(result.skippedRecords).toBe(2);
    expect(result.errors.filter(error => error.message.includes('Invalid LinkedIn'))).toHaveLength(2);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO contacts'))).toHaveLength(1);
  });

  describe('CSV parsing for Connections.csv', () => {
    it('should parse LinkedIn Connections.csv with 2 preamble lines', () => {
      const result = parseCsv(sampleConnectionsCsv, { preambleLines: 2 });
      expect(result.rowCount).toBe(3);
      expect(result.errorCount).toBe(0);
    });

    it('should extract correct field names', () => {
      const result = parseCsv(sampleConnectionsCsv, { preambleLines: 2 });
      expect(result.headers).toContain('first_name');
      expect(result.headers).toContain('last_name');
      expect(result.headers).toContain('url');
      expect(result.headers).toContain('email_address');
      expect(result.headers).toContain('company');
      expect(result.headers).toContain('position');
      expect(result.headers).toContain('connected_on');
    });

    it('should extract correct values from first row', () => {
      const result = parseCsv(sampleConnectionsCsv, { preambleLines: 2 });
      const firstRow = result.rows[0];
      expect(firstRow['first_name']).toBe('John');
      expect(firstRow['last_name']).toBe('Doe');
      expect(firstRow['url']).toBe('https://www.linkedin.com/in/johndoe');
      expect(firstRow['email_address']).toBe('john@example.com');
      expect(firstRow['company']).toBe('Acme Corp');
      expect(firstRow['position']).toBe('Software Engineer');
    });

    it('should handle empty email fields', () => {
      const result = parseCsv(sampleConnectionsCsv, { preambleLines: 2 });
      expect(result.rows[1]['email_address']).toBe('');
    });

    it('should construct full_name from first + last', () => {
      const result = parseCsv(sampleConnectionsCsv, { preambleLines: 2 });
      const row = result.rows[0];
      const fullName = [row['first_name'], row['last_name']].filter(Boolean).join(' ');
      expect(fullName).toBe('John Doe');
    });
  });

  describe('field mapping validation', () => {
    it('should have URL for dedup key', () => {
      const result = parseCsv(sampleConnectionsCsv, { preambleLines: 2 });
      for (const row of result.rows) {
        expect(row['url']).toBeTruthy();
        expect(row['url']).toContain('linkedin.com');
      }
    });
  });
});
