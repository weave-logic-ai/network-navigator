// Taxonomy service: Vertical CRUD, hierarchy queries, ICP->Niche->Vertical resolution

import { query } from '../db/client';
import type { Vertical, VerticalWithNiches, NicheWithIcps, TaxonomyChain } from './types';

// --- Verticals ---

export async function listVerticals(): Promise<Vertical[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT id, name, slug, description, metadata, created_at, updated_at
     FROM verticals ORDER BY name`
  );
  return result.rows.map(mapVertical);
}

export async function getVertical(id: string): Promise<Vertical | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT id, name, slug, description, metadata, created_at, updated_at
     FROM verticals WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? mapVertical(result.rows[0]) : null;
}

export async function getVerticalBySlug(slug: string): Promise<Vertical | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT id, name, slug, description, metadata, created_at, updated_at
     FROM verticals WHERE slug = $1`,
    [slug]
  );
  return result.rows[0] ? mapVertical(result.rows[0]) : null;
}

export async function createVertical(data: {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<Vertical> {
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const result = await query<Record<string, unknown>>(
    `INSERT INTO verticals (name, slug, description, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.name, slug, data.description ?? null, JSON.stringify(data.metadata ?? {})]
  );
  return mapVertical(result.rows[0]);
}

export async function updateVertical(id: string, data: {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<Vertical | null> {
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
    `UPDATE verticals SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ? mapVertical(result.rows[0]) : null;
}

export async function deleteVertical(id: string): Promise<boolean> {
  const result = await query('DELETE FROM verticals WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

// --- Hierarchy Queries ---

export async function getVerticalWithNiches(id: string): Promise<VerticalWithNiches | null> {
  const vertical = await getVertical(id);
  if (!vertical) return null;

  const nichesResult = await query<Record<string, unknown>>(
    `SELECT id, vertical_id, name, description, keywords, company_size_range,
            geo_focus, member_count, affordability, fitability, buildability,
            niche_score, created_at, updated_at
     FROM niche_profiles WHERE vertical_id = $1 ORDER BY name`,
    [id]
  );

  return {
    ...vertical,
    niches: nichesResult.rows.map(mapNiche),
    nicheCount: nichesResult.rows.length,
  };
}

export async function getNicheWithIcps(nicheId: string): Promise<NicheWithIcps | null> {
  const nicheResult = await query<Record<string, unknown>>(
    `SELECT np.*, v.id as v_id, v.name as v_name, v.slug as v_slug,
            v.description as v_description, v.metadata as v_metadata,
            v.created_at as v_created_at, v.updated_at as v_updated_at
     FROM niche_profiles np
     LEFT JOIN verticals v ON v.id = np.vertical_id
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

  const vertical = row.v_id ? {
    id: String(row.v_id),
    name: String(row.v_name),
    slug: String(row.v_slug),
    description: row.v_description as string | null,
    metadata: (row.v_metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.v_created_at),
    updatedAt: String(row.v_updated_at),
  } : undefined;

  return {
    ...niche,
    icps: icpsResult.rows.map(mapIcp),
    icpCount: icpsResult.rows.length,
    vertical,
  };
}

// --- ICP -> Niche -> Vertical Resolution ---

export async function resolveTaxonomyChain(icpProfileId: string): Promise<TaxonomyChain> {
  const result = await query<Record<string, unknown>>(
    `SELECT
       ip.id as icp_id, ip.niche_id, ip.name as icp_name, ip.description as icp_desc,
       ip.is_active, ip.criteria, ip.weight_overrides, ip.created_at as icp_created,
       ip.updated_at as icp_updated,
       np.id as niche_id_val, np.vertical_id, np.name as niche_name, np.description as niche_desc,
       np.keywords, np.company_size_range, np.geo_focus, np.member_count,
       np.affordability, np.fitability, np.buildability, np.niche_score,
       np.created_at as niche_created, np.updated_at as niche_updated,
       v.id as v_id, v.name as v_name, v.slug as v_slug, v.description as v_description,
       v.metadata as v_metadata, v.created_at as v_created, v.updated_at as v_updated
     FROM icp_profiles ip
     LEFT JOIN niche_profiles np ON np.id = ip.niche_id
     LEFT JOIN verticals v ON v.id = np.vertical_id
     WHERE ip.id = $1`,
    [icpProfileId]
  );

  if (result.rows.length === 0) {
    return { vertical: null, niche: null, icp: null };
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
    verticalId: row.vertical_id as string | null,
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

  const vertical: TaxonomyChain['vertical'] = row.v_id ? {
    id: String(row.v_id),
    name: String(row.v_name),
    slug: String(row.v_slug),
    description: row.v_description as string | null,
    metadata: (row.v_metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.v_created),
    updatedAt: String(row.v_updated),
  } : null;

  return { vertical, niche, icp };
}

// --- Mappers ---

function mapVertical(row: Record<string, unknown>): Vertical {
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
    verticalId: row.vertical_id as string | null,
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
