import {
  parseCsv,
  stripBom,
  normalizeHeader,
  detectPreambleLines,
  parseCSVLine,
} from '@/lib/import/csv-parser';

describe('CSV Parser', () => {
  describe('stripBom', () => {
    it('should strip BOM from beginning of string', () => {
      expect(stripBom('\uFEFFhello')).toBe('hello');
    });

    it('should return string unchanged if no BOM', () => {
      expect(stripBom('hello')).toBe('hello');
    });

    it('should handle empty string', () => {
      expect(stripBom('')).toBe('');
    });
  });

  describe('normalizeHeader', () => {
    it('should lowercase and replace spaces with underscores', () => {
      expect(normalizeHeader('First Name')).toBe('first_name');
    });

    it('should trim whitespace', () => {
      expect(normalizeHeader('  Email Address  ')).toBe('email_address');
    });

    it('should replace special characters', () => {
      expect(normalizeHeader('Connected On (Date)')).toBe('connected_on_date');
    });

    it('should handle already normalized headers', () => {
      expect(normalizeHeader('first_name')).toBe('first_name');
    });
  });

  describe('detectPreambleLines', () => {
    it('should detect 2 preamble lines for LinkedIn CSVs', () => {
      const lines = [
        'Notes:',
        '"Your connections list"',
        'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
        'John,Doe,https://linkedin.com/in/johndoe,john@test.com,Acme,Engineer,01 Jan 2023',
      ];
      expect(detectPreambleLines(lines)).toBe(2);
    });

    it('should detect 0 preamble lines for standard CSVs', () => {
      const lines = [
        'first_name,last_name,email,company',
        'John,Doe,john@test.com,Acme',
      ];
      expect(detectPreambleLines(lines)).toBe(0);
    });

    it('should detect 1 preamble line', () => {
      const lines = [
        'Exported on 2024-01-01',
        'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
        'John,Doe,https://linkedin.com/in/johndoe,john@test.com,Acme,Engineer,01 Jan 2023',
      ];
      expect(detectPreambleLines(lines)).toBe(1);
    });
  });

  describe('parseCSVLine', () => {
    it('should parse simple comma-separated values', () => {
      expect(parseCSVLine('a,b,c', ',')).toEqual(['a', 'b', 'c']);
    });

    it('should handle quoted fields', () => {
      expect(parseCSVLine('"hello world",b,c', ',')).toEqual(['hello world', 'b', 'c']);
    });

    it('should handle escaped quotes', () => {
      expect(parseCSVLine('"say ""hello""",b', ',')).toEqual(['say "hello"', 'b']);
    });

    it('should handle commas within quotes', () => {
      expect(parseCSVLine('"a,b",c', ',')).toEqual(['a,b', 'c']);
    });

    it('should trim values', () => {
      expect(parseCSVLine(' a , b , c ', ',')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('parseCsv', () => {
    it('should parse a simple CSV', () => {
      const csv = 'Name,Email\nJohn,john@test.com\nJane,jane@test.com';
      const result = parseCsv(csv);

      expect(result.rowCount).toBe(2);
      expect(result.headers).toEqual(['name', 'email']);
      expect(result.rows[0]).toEqual({ name: 'John', email: 'john@test.com' });
      expect(result.rows[1]).toEqual({ name: 'Jane', email: 'jane@test.com' });
      expect(result.errorCount).toBe(0);
    });

    it('should handle LinkedIn Connections.csv with 2 preamble lines', () => {
      const csv = [
        'Notes:',
        '"Your connections"',
        'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
        'John,Doe,https://linkedin.com/in/johndoe,john@test.com,Acme Corp,Engineer,01 Jan 2023',
      ].join('\n');

      const result = parseCsv(csv, { preambleLines: 2 });

      expect(result.rowCount).toBe(1);
      expect(result.rows[0]['first_name']).toBe('John');
      expect(result.rows[0]['last_name']).toBe('Doe');
      expect(result.rows[0]['url']).toBe('https://linkedin.com/in/johndoe');
    });

    it('should strip BOM', () => {
      const csv = '\uFEFFName,Email\nJohn,john@test.com';
      const result = parseCsv(csv);

      expect(result.headers).toEqual(['name', 'email']);
      expect(result.rowCount).toBe(1);
    });

    it('should handle empty content', () => {
      const result = parseCsv('');
      expect(result.rowCount).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it('should handle CRLF line endings', () => {
      const csv = 'Name,Email\r\nJohn,john@test.com\r\nJane,jane@test.com';
      const result = parseCsv(csv);
      expect(result.rowCount).toBe(2);
    });

    it('should use custom delimiter', () => {
      const csv = 'Name;Email\nJohn;john@test.com';
      const result = parseCsv(csv, { delimiter: ';' });
      expect(result.rows[0]).toEqual({ name: 'John', email: 'john@test.com' });
    });
  });
});
