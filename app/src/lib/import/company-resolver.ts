// Company resolver: preserve distinct identities unless names match after case/space normalization.

import { PoolClient } from 'pg';
import { CompanyRecord } from './types';
import { createHash } from 'node:crypto';

function normalizeCompanyName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export class CompanyResolver {
  private cache: Map<string, CompanyRecord> = new Map();

  constructor(private client: PoolClient) {}

  async resolve(rawName: string | undefined | null): Promise<CompanyRecord | null> {
    if (!rawName || !rawName.trim()) return null;

    const normalized = normalizeCompanyName(rawName);
    const identity = normalized.toLocaleLowerCase('en-US');
    const slug = generateSlug(normalized);

    if (!slug) return null;

    // Check in-memory cache first
    const cached = this.cache.get(identity);
    if (cached) return cached;

    // A slug drops punctuation and can collide across unrelated names.
    const exactResult = await this.client.query<CompanyRecord>(
      'SELECT id, name, slug, domain, industry, size_range AS "sizeRange", linkedin_url AS "linkedinUrl" FROM companies WHERE lower(regexp_replace(trim(name), \'[[:space:]]+\', \' \', \'g\')) = $1 ORDER BY id LIMIT 1',
      [identity]
    );

    if (exactResult.rows.length > 0) {
      const company = exactResult.rows[0];
      this.cache.set(identity, company);
      return company;
    }

    const insertCompany = (candidateSlug: string) => this.client.query<CompanyRecord>(
      `INSERT INTO companies (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, name, slug, domain, industry, size_range AS "sizeRange", linkedin_url AS "linkedinUrl"`,
      [normalized, candidateSlug]
    );
    const baseInsert = await insertCompany(slug);
    let newCompany = baseInsert.rows[0];
    if (!newCompany) {
      const existing = await this.client.query<CompanyRecord>(
        'SELECT id, name, slug, domain, industry, size_range AS "sizeRange", linkedin_url AS "linkedinUrl" FROM companies WHERE slug = $1',
        [slug]
      );
      if (existing.rows[0] && normalizeCompanyName(existing.rows[0].name).toLocaleLowerCase('en-US') === identity) {
        newCompany = existing.rows[0];
      } else {
        const collisionSlug = `${slug}-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
        const collisionInsert = await insertCompany(collisionSlug);
        newCompany = collisionInsert.rows[0];
        if (!newCompany) {
          const resolved = await this.client.query<CompanyRecord>(
            'SELECT id, name, slug, domain, industry, size_range AS "sizeRange", linkedin_url AS "linkedinUrl" FROM companies WHERE slug = $1',
            [collisionSlug]
          );
          newCompany = resolved.rows[0];
          if (!newCompany || normalizeCompanyName(newCompany.name).toLocaleLowerCase('en-US') !== identity) {
            throw new Error('Company slug collision could not be resolved');
          }
        }
      }
    }
    this.cache.set(identity, newCompany);
    return newCompany;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// Export helpers for testing
export { normalizeCompanyName, generateSlug };
