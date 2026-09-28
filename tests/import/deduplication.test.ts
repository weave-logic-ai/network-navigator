import { computeDedupHash, deduplicateContact } from '@/lib/import/deduplication';
import type { PoolClient } from 'pg';

// Note: deduplicateContact requires a DB connection, so we test the pure functions here.
// Integration tests would test the full dedup flow against the database.

describe('Deduplication', () => {
  it('skips an unchanged re-import without inserting a second contact', async () => {
    let stored: Record<string, unknown> | null = null;
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM contacts WHERE lower(')) return { rows: stored ? [stored] : [] };
      if (sql.includes('INSERT INTO contacts')) {
        stored = { id: 'contact-1', linkedin_url: values?.[0], full_name: values?.[3],
          title: values?.[5], current_company: values?.[6], dedup_hash: values?.[13] };
        return { rows: [{ id: 'contact-1' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as unknown as PoolClient;
    const contact = {
      linkedinUrl: 'https://www.linkedin.com/in/ada',
      fullName: 'Ada Lovelace',
      title: 'Mathematician',
      currentCompany: 'Analytical Engine',
    };

    expect((await deduplicateContact(client, contact)).action).toBe('created');
    expect((await deduplicateContact(client, contact)).action).toBe('skipped');
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO contacts'))).toHaveLength(1);
  });

  it('updates a corrected email even when a stored legacy hash matches', async () => {
    const existing = {
      id: 'contact-1', linkedin_url: 'https://linkedin.com/in/ada',
      first_name: null, last_name: null, full_name: 'Ada Lovelace', headline: null,
      title: 'Engineer', current_company: 'Acme', current_company_id: null,
      location: null, about: null, email: 'old@example.org', phone: null,
      tags: [], dedup_hash: computeDedupHash('https://linkedin.com/in/ada', 'Ada Lovelace', 'Engineer', 'Acme'),
    };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM contacts WHERE lower(')) return { rows: [existing] };
      if (sql.startsWith('UPDATE contacts')) return { rows: [existing] };
      throw new Error(sql);
    });
    const result = await deduplicateContact({ query } as unknown as PoolClient, {
      linkedinUrl: existing.linkedin_url, fullName: existing.full_name,
      title: existing.title, currentCompany: existing.current_company, email: 'new@example.org',
    });
    expect(result.action).toBe('updated');
    expect(result.changes).toContainEqual({ field: 'email', oldValue: 'old@example.org', newValue: 'new@example.org' });
  });

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
