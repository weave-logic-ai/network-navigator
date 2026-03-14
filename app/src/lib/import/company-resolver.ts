// Company resolver: normalize, slugify, exact match, Levenshtein fuzzy match, cache

import { PoolClient } from 'pg';
import { CompanyRecord } from './types';

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
    const slug = generateSlug(normalized);

    if (!slug) return null;

    // Check in-memory cache first
    const cached = this.cache.get(slug);
    if (cached) return cached;

    // Exact match on slug (fast path)
    const exactResult = await this.client.query<CompanyRecord>(
      'SELECT id, name, slug, domain, industry, size_range AS "sizeRange", linkedin_url AS "linkedinUrl" FROM companies WHERE slug = $1',
      [slug]
    );

    if (exactResult.rows.length > 0) {
      const company = exactResult.rows[0];
      this.cache.set(slug, company);
      return company;
    }

    // Fuzzy match using Levenshtein distance < 3
    const fuzzyResult = await this.client.query<CompanyRecord>(
      `SELECT id, name, slug, domain, industry, size_range AS "sizeRange", linkedin_url AS "linkedinUrl"
       FROM companies
       WHERE levenshtein(lower(name), lower($1)) < 3
       ORDER BY levenshtein(lower(name), lower($1))
       LIMIT 1`,
      [normalized]
    );

    if (fuzzyResult.rows.length > 0) {
      const company = fuzzyResult.rows[0];
      this.cache.set(slug, company);
      return company;
    }

    // No match found: create new company
    const insertResult = await this.client.query<CompanyRecord>(
      `INSERT INTO companies (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, slug, domain, industry, size_range AS "sizeRange", linkedin_url AS "linkedinUrl"`,
      [normalized, slug]
    );

    const newCompany = insertResult.rows[0];
    this.cache.set(slug, newCompany);
    return newCompany;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// Export helpers for testing
export { normalizeCompanyName, generateSlug };
