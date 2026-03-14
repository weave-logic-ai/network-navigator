import { normalizeCompanyName, generateSlug } from '@/lib/import/company-resolver';

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
