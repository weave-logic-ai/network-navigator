// Niche profiles DB queries

import { query } from '../client';

export interface NicheRow {
  id: string;
  name: string;
  description: string | null;
  industry_id: string | null;
  keywords: string[];
  company_size_range: string | null;
  geo_focus: string[];
  member_count: number;
  affordability: number | null;
  fitability: number | null;
  buildability: number | null;
  niche_score: number | null;
  created_at: Date;
  updated_at: Date;
}

export async function listNiches(): Promise<NicheRow[]> {
  const result = await query<NicheRow>(
    `SELECT id, name, description, industry_id, keywords, company_size_range,
            geo_focus, member_count, affordability, fitability, buildability,
            niche_score, created_at, updated_at
     FROM niche_profiles
     ORDER BY niche_score DESC NULLS LAST, name`
  );
  return result.rows;
}

export async function getNiche(id: string): Promise<NicheRow | null> {
  const result = await query<NicheRow>(
    `SELECT id, name, description, industry_id, keywords, company_size_range,
            geo_focus, member_count, affordability, fitability, buildability,
            niche_score, created_at, updated_at
     FROM niche_profiles
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createNiche(data: {
  name: string;
  description?: string;
  industryId?: string;
  keywords?: string[];
  affordability?: number;
  fitability?: number;
  buildability?: number;
}): Promise<NicheRow> {
  // Auto-associate to industry if not explicitly set
  let industryId = data.industryId ?? null;
  if (!industryId) {
    const searchText = [data.name, data.description, ...(data.keywords ?? [])].filter(Boolean).join(' ').toLowerCase();
    const matchResult = await query<{ id: string }>(
      `SELECT id FROM industries
       WHERE LOWER(name) != 'general'
         AND (LOWER(name) = ANY(string_to_array($1, ' '))
              OR $1 ILIKE '%' || LOWER(SPLIT_PART(name, ' ', 1)) || '%')
       ORDER BY length(name) DESC
       LIMIT 1`,
      [searchText]
    );
    if (matchResult.rows[0]) {
      industryId = matchResult.rows[0].id;
    } else {
      // Fall back to General
      const generalResult = await query<{ id: string }>(
        `SELECT id FROM industries WHERE slug = 'general' LIMIT 1`
      );
      if (generalResult.rows[0]) industryId = generalResult.rows[0].id;
    }
  }

  const result = await query<NicheRow>(
    `INSERT INTO niche_profiles (name, description, industry_id, keywords, affordability, fitability, buildability)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.name,
      data.description ?? null,
      industryId,
      data.keywords ?? [],
      data.affordability ?? null,
      data.fitability ?? null,
      data.buildability ?? null,
    ]
  );
  return result.rows[0];
}

export async function updateNiche(
  id: string,
  data: Record<string, unknown>
): Promise<NicheRow | null> {
  const allowedKeys = ['name', 'description', 'industry_id', 'keywords', 'affordability', 'fitability', 'buildability'];
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (allowedKeys.includes(key)) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return null;

  values.push(id);
  const result = await query<NicheRow>(
    `UPDATE niche_profiles SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteNiche(id: string): Promise<boolean> {
  const result = await query('DELETE FROM niche_profiles WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

export async function listNichesByIndustry(industryId: string): Promise<NicheRow[]> {
  const result = await query<NicheRow>(
    `SELECT id, name, description, industry_id, keywords, company_size_range,
            geo_focus, member_count, affordability, fitability, buildability,
            niche_score, created_at, updated_at
     FROM niche_profiles
     WHERE industry_id = $1
     ORDER BY niche_score DESC NULLS LAST, name`,
    [industryId]
  );
  return result.rows;
}

export async function findNicheByIndustryAndName(industryId: string, name: string): Promise<NicheRow | null> {
  const result = await query<NicheRow>(
    `SELECT id, name, description, industry_id, keywords, company_size_range,
            geo_focus, member_count, affordability, fitability, buildability,
            niche_score, created_at, updated_at
     FROM niche_profiles
     WHERE industry_id = $1 AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [industryId, name]
  );
  return result.rows[0] ?? null;
}
