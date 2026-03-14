import { computeDedupHash } from '@/lib/import/deduplication';

// Note: deduplicateContact requires a DB connection, so we test the pure functions here.
// Integration tests would test the full dedup flow against the database.

describe('Deduplication', () => {
  describe('computeDedupHash', () => {
    it('should compute a SHA-256 hash', () => {
      const hash = computeDedupHash(
        'https://linkedin.com/in/johndoe',
        'John Doe',
        'Engineer',
        'Acme Corp'
      );
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 hex length
    });

    it('should produce the same hash for same inputs', () => {
      const hash1 = computeDedupHash('url', 'name', 'title', 'company');
      const hash2 = computeDedupHash('url', 'name', 'title', 'company');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = computeDedupHash('url1', 'name', 'title', 'company');
      const hash2 = computeDedupHash('url2', 'name', 'title', 'company');
      expect(hash1).not.toBe(hash2);
    });

    it('should be case insensitive', () => {
      const hash1 = computeDedupHash('URL', 'NAME', 'TITLE', 'COMPANY');
      const hash2 = computeDedupHash('url', 'name', 'title', 'company');
      expect(hash1).toBe(hash2);
    });

    it('should handle null/empty values', () => {
      const hash = computeDedupHash('url', '', '', '');
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });

    it('should detect job change via different hash', () => {
      const hashBefore = computeDedupHash('url', 'John Doe', 'Engineer', 'Acme');
      const hashAfter = computeDedupHash('url', 'John Doe', 'Senior Engineer', 'New Corp');
      expect(hashBefore).not.toBe(hashAfter);
    });
  });
});
