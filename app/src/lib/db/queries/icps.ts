// ICP profiles DB queries

import { query } from '../client';

export interface IcpRow {
  id: string;
  niche_id: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  criteria: Record<string, unknown>;
  weight_overrides: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export async function listIcps(): Promise<IcpRow[]> {
  const result = await query<IcpRow>(
    `SELECT id, niche_id, name, description, is_active, criteria, weight_overrides,
            created_at, updated_at
     FROM icp_profiles
     ORDER BY name`
  );
  return result.rows;
}

export async function getIcp(id: string): Promise<IcpRow | null> {
  const result = await query<IcpRow>(
    `SELECT id, niche_id, name, description, is_active, criteria, weight_overrides,
            created_at, updated_at
     FROM icp_profiles
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createIcp(data: {
  name: string;
  description?: string;
  criteria: Record<string, unknown>;
  is_active?: boolean;
  niche_id?: string;
}): Promise<IcpRow> {
  const result = await query<IcpRow>(
    `INSERT INTO icp_profiles (name, description, criteria, is_active, niche_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.name,
      data.description ?? null,
      JSON.stringify(data.criteria),
      data.is_active ?? true,
      data.niche_id ?? null,
    ]
  );
  return result.rows[0];
}

export async function updateIcp(
  id: string,
  data: Record<string, unknown>
): Promise<IcpRow | null> {
  const allowedKeys = ['name', 'description', 'criteria', 'is_active', 'weight_overrides', 'niche_id'];
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (allowedKeys.includes(key)) {
      setClauses.push(`${key} = $${idx++}`);
      // Stringify JSON fields
      if (key === 'criteria' || key === 'weight_overrides') {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
    }
  }

  if (setClauses.length === 0) return null;

  values.push(id);
  const result = await query<IcpRow>(
    `UPDATE icp_profiles SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteIcp(id: string): Promise<boolean> {
  const result = await query('DELETE FROM icp_profiles WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

export async function listIcpsByNiche(nicheId: string): Promise<IcpRow[]> {
  const result = await query<IcpRow>(
    `SELECT id, niche_id, name, description, is_active, criteria, weight_overrides,
            created_at, updated_at
     FROM icp_profiles
     WHERE niche_id = $1
     ORDER BY name`,
    [nicheId]
  );
  return result.rows;
}

export async function findIcpByNicheAndName(nicheId: string, name: string): Promise<IcpRow | null> {
  const result = await query<IcpRow>(
    `SELECT id, niche_id, name, description, is_active, criteria, weight_overrides,
            created_at, updated_at
     FROM icp_profiles
     WHERE niche_id = $1 AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [nicheId, name]
  );
  return result.rows[0] ?? null;
}
