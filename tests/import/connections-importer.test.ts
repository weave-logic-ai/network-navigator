// Connections importer tests - testing CSV parsing logic (DB mocked)

import { parseCsv } from '@/lib/import/csv-parser';

describe('Connections Importer', () => {
  const sampleConnectionsCsv = [
    'Notes:',
    '"Your connections list"',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'John,Doe,https://www.linkedin.com/in/johndoe,john@example.com,Acme Corp,Software Engineer,01 Jan 2023',
    'Jane,Smith,https://www.linkedin.com/in/janesmith,,Tech Inc,Product Manager,15 Mar 2023',
    'Bob,Wilson,https://www.linkedin.com/in/bobwilson,bob@test.com,StartupXYZ,CTO,20 Jun 2023',
  ].join('\n');

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
