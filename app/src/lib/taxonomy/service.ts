// Taxonomy service: Industry CRUD, hierarchy queries, ICP→Niche→Industry resolution

import { query } from '../db/client';
import type { Industry, IndustryWithNiches, NicheWithIcps, TaxonomyChain } from './types';

// --- Industries ---

export async function listIndustries(): Promise<Industry[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT id, name, slug, description, metadata, created_at, updated_at
     FROM industries ORDER BY name`
  );
  return result.rows.map(mapIndustry);
}

export async function getIndustry(id: string): Promise<Industry | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT id, name, slug, description, metadata, created_at, updated_at
     FROM industries WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? mapIndustry(result.rows[0]) : null;
}

export async function getIndustryBySlug(slug: string): Promise<Industry | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT id, name, slug, description, metadata, created_at, updated_at
     FROM industries WHERE slug = $1`,
    [slug]
  );
  return result.rows[0] ? mapIndustry(result.rows[0]) : null;
}

export async function createIndustry(data: {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<Industry> {
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const result = await query<Record<string, unknown>>(
    `INSERT INTO industries (name, slug, description, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.name, slug, data.description ?? null, JSON.stringify(data.metadata ?? {})]
  );
  return mapIndustry(result.rows[0]);
}

export async function updateIndustry(id: string, data: {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<Industry | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(data.name);
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    sets.push(`slug = $${idx++}`);
    values.push(slug);
  }
  if (data.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(data.description);
  }
  if (data.metadata !== undefined) {
    sets.push(`metadata = $${idx++}`);
    values.push(JSON.stringify(data.metadata));
  }

  if (sets.length === 0) return null;

  values.push(id);
  const result = await query<Record<string, unknown>>(
    `UPDATE industries SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ? mapIndustry(result.rows[0]) : null;
}

export async function deleteIndustry(id: string): Promise<boolean> {
  const result = await query('DELETE FROM industries WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

// --- Hierarchy Queries ---

export async function getIndustryWithNiches(id: string): Promise<IndustryWithNiches | null> {
  const industry = await getIndustry(id);
  if (!industry) return null;

  const nichesResult = await query<Record<string, unknown>>(
    `SELECT id, industry_id, name, description, keywords, company_size_range,
            geo_focus, member_count, affordability, fitability, buildability,
            niche_score, created_at, updated_at
     FROM niche_profiles WHERE industry_id = $1 ORDER BY name`,
    [id]
  );

  return {
    ...industry,
    niches: nichesResult.rows.map(mapNiche),
    nicheCount: nichesResult.rows.length,
  };
}

export async function getNicheWithIcps(nicheId: string): Promise<NicheWithIcps | null> {
  const nicheResult = await query<Record<string, unknown>>(
    `SELECT np.*, i.id as i_id, i.name as i_name, i.slug as i_slug,
            i.description as i_description, i.metadata as i_metadata,
            i.created_at as i_created_at, i.updated_at as i_updated_at
     FROM niche_profiles np
     LEFT JOIN industries i ON i.id = np.industry_id
     WHERE np.id = $1`,
    [nicheId]
  );
  if (nicheResult.rows.length === 0) return null;

  const row = nicheResult.rows[0];
  const niche = mapNiche(row);

  const icpsResult = await query<Record<string, unknown>>(
    `SELECT id, niche_id, name, description, is_active, criteria, weight_overrides,
            created_at, updated_at
     FROM icp_profiles WHERE niche_id = $1 ORDER BY name`,
    [nicheId]
  );

  const industry = row.i_id ? {
    id: String(row.i_id),
    name: String(row.i_name),
    slug: String(row.i_slug),
    description: row.i_description as string | null,
    metadata: (row.i_metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.i_created_at),
    updatedAt: String(row.i_updated_at),
  } : undefined;

  return {
    ...niche,
    icps: icpsResult.rows.map(mapIcp),
    icpCount: icpsResult.rows.length,
    industry,
  };
}

// --- ICP → Niche → Industry Resolution ---

export async function resolveTaxonomyChain(icpProfileId: string): Promise<TaxonomyChain> {
  const result = await query<Record<string, unknown>>(
    `SELECT
       ip.id as icp_id, ip.niche_id, ip.name as icp_name, ip.description as icp_desc,
       ip.is_active, ip.criteria, ip.weight_overrides, ip.created_at as icp_created,
       ip.updated_at as icp_updated,
       np.id as niche_id_val, np.industry_id, np.name as niche_name, np.description as niche_desc,
       np.keywords, np.company_size_range, np.geo_focus, np.member_count,
       np.affordability, np.fitability, np.buildability, np.niche_score,
       np.created_at as niche_created, np.updated_at as niche_updated,
       i.id as i_id, i.name as i_name, i.slug as i_slug, i.description as i_description,
       i.metadata as i_metadata, i.created_at as i_created, i.updated_at as i_updated
     FROM icp_profiles ip
     LEFT JOIN niche_profiles np ON np.id = ip.niche_id
     LEFT JOIN industries i ON i.id = np.industry_id
     WHERE ip.id = $1`,
    [icpProfileId]
  );

  if (result.rows.length === 0) {
    return { industry: null, niche: null, icp: null };
  }

  const row = result.rows[0];

  const icp: TaxonomyChain['icp'] = {
    id: String(row.icp_id),
    nicheId: row.niche_id as string | null,
    name: String(row.icp_name),
    description: row.icp_desc as string | null,
    isActive: Boolean(row.is_active),
    criteria: (row.criteria ?? {}) as Record<string, unknown>,
    weightOverrides: (row.weight_overrides ?? {}) as Record<string, number>,
    createdAt: String(row.icp_created),
    updatedAt: String(row.icp_updated),
  };

  const niche: TaxonomyChain['niche'] = row.niche_id_val ? {
    id: String(row.niche_id_val),
    industryId: row.industry_id as string | null,
    name: String(row.niche_name),
    description: row.niche_desc as string | null,
    keywords: (row.keywords ?? []) as string[],
    companySizeRange: row.company_size_range as string | null,
    geoFocus: (row.geo_focus ?? []) as string[],
    memberCount: Number(row.member_count ?? 0),
    affordability: row.affordability as number | null,
    fitability: row.fitability as number | null,
    buildability: row.buildability as number | null,
    nicheScore: row.niche_score as number | null,
    createdAt: String(row.niche_created),
    updatedAt: String(row.niche_updated),
  } : null;

  const industry: TaxonomyChain['industry'] = row.i_id ? {
    id: String(row.i_id),
    name: String(row.i_name),
    slug: String(row.i_slug),
    description: row.i_description as string | null,
    metadata: (row.i_metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.i_created),
    updatedAt: String(row.i_updated),
  } : null;

  return { industry, niche, icp };
}

// --- Backward-compat aliases for callers that still import old names ---
export const listVerticals = listIndustries;
export const getVerticalWithNiches = getIndustryWithNiches;
export const createVertical = createIndustry;
export const updateVertical = updateIndustry;
export const deleteVertical = deleteIndustry;

// --- Mappers ---

function mapIndustry(row: Record<string, unknown>): Industry {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: row.description as string | null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapNiche(row: Record<string, unknown>): import('./types').NicheProfile {
  return {
    id: String(row.id),
    industryId: (row.industry_id ?? row.vertical_id ?? null) as string | null,
    name: String(row.name),
    description: row.description as string | null,
    keywords: (row.keywords ?? []) as string[],
    companySizeRange: row.company_size_range as string | null,
    geoFocus: (row.geo_focus ?? []) as string[],
    memberCount: Number(row.member_count ?? 0),
    affordability: row.affordability as number | null,
    fitability: row.fitability as number | null,
    buildability: row.buildability as number | null,
    nicheScore: row.niche_score as number | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapIcp(row: Record<string, unknown>): import('./types').IcpProfileWithNiche {
  return {
    id: String(row.id),
    nicheId: row.niche_id as string | null,
    name: String(row.name),
    description: row.description as string | null,
    isActive: Boolean(row.is_active),
    criteria: (row.criteria ?? {}) as Record<string, unknown>,
    weightOverrides: (row.weight_overrides ?? {}) as Record<string, number>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
