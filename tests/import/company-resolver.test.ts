import { normalizeCompanyName, generateSlug, CompanyResolver } from '@/lib/import/company-resolver';
import type { PoolClient } from 'pg';

describe('Company Resolver', () => {
  describe('normalizeCompanyName', () => {
    it('should trim whitespace', () => {
      expect(normalizeCompanyName('  Acme Corp  ')).toBe('Acme Corp');
    });

    it('should collapse multiple spaces', () => {
      expect(normalizeCompanyName('Acme   Corp')).toBe('Acme Corp');
    });

    it('should handle empty string', () => {
      expect(normalizeCompanyName('')).toBe('');
    });
  });

  describe('generateSlug', () => {
    it('should generate a slug from company name', () => {
      expect(generateSlug('Acme Corp')).toBe('acme-corp');
    });

    it('should remove special characters', () => {
      expect(generateSlug('Acme Corp.')).toBe('acme-corp');
    });

    it('should handle multiple spaces and dashes', () => {
      expect(generateSlug('Acme  --  Corp')).toBe('acme-corp');
    });

    it('should lowercase', () => {
      expect(generateSlug('ACME CORP')).toBe('acme-corp');
    });

    it('should handle ampersand and special chars', () => {
      expect(generateSlug('Ben & Jerry\'s')).toBe('ben-jerrys');
    });

    it('should trim leading/trailing dashes', () => {
      expect(generateSlug(' - Acme - ')).toBe('acme');
    });
  });
});

describe('CompanyResolver identity boundary', () => {
  it('keeps edit-distance neighbors and punctuation collisions distinct', async () => {
    const rows: Array<{ id: string; name: string; slug: string }> = [];
    const client = { query: jest.fn(async (sql: string, params: string[]) => {
      if (sql.includes('WHERE slug = $1')) return { rows: rows.filter((row) => row.slug === params[0]) };
      if (sql.startsWith('SELECT')) return { rows: rows.filter((row) => row.name.toLowerCase() === params[0]) };
      if (rows.some((row) => row.slug === params[1])) return { rows: [] };
      const row = { id: String(rows.length + 1), name: params[0], slug: params[1] };
      rows.push(row);
      return { rows: [row] };
    }) } as unknown as PoolClient;
    const resolver = new CompanyResolver(client);
    const acme = await resolver.resolve('Acme');
    const acne = await resolver.resolve('Acne');
    const punctuated = await resolver.resolve('A&B');
    const plain = await resolver.resolve('AB');
    expect(new Set([acme?.id, acne?.id, punctuated?.id, plain?.id]).size).toBe(4);
    expect(acme?.slug).toBe('acme');
    expect(punctuated?.slug).not.toBe(plain?.slug);
    expect((await resolver.resolve(' ACME '))?.id).toBe(acme?.id);
    expect((client.query as jest.Mock).mock.calls.map((call) => String(call[0])).join(' ')).not.toContain('levenshtein');
  });
});
