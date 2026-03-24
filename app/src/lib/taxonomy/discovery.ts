// Fixed ICP discovery with de-duplication
// Discovery no longer auto-saves. Returns suggestions only.
// saveDiscoveredIcp() checks name + criteria overlap before creating.

import { query } from '../db/client';
import type { DiscoveredIcp, SaveDiscoveryResult } from './types';

/**
 * Save a discovered ICP with de-duplication checks.
 * Checks: (1) name uniqueness within niche, (2) criteria overlap > 80%
 */
export async function saveDiscoveredIcp(
  discovery: DiscoveredIcp,
  nicheId: string
): Promise<SaveDiscoveryResult> {
  // Check 1: Name uniqueness within niche
  const nameCheck = await query<{ id: string }>(
    `SELECT id FROM icp_profiles WHERE niche_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [nicheId, discovery.suggestedName]
  );
  if (nameCheck.rows.length > 0) {
    return { action: 'skipped', existingId: nameCheck.rows[0].id, reason: 'duplicate_name' };
  }

  // Check 2: Criteria overlap with existing ICPs in this niche
  const existingIcps = await query<{ id: string; criteria: Record<string, unknown> }>(
    `SELECT id, criteria FROM icp_profiles WHERE niche_id = $1`,
    [nicheId]
  );

  for (const existing of existingIcps.rows) {
    const overlap = computeCriteriaOverlap(
      existing.criteria,
      {
        roles: discovery.criteria.titlePatterns,
        industries: discovery.criteria.industries,
        companySizeRanges: discovery.criteria.companySizes,
        locations: discovery.criteria.locations,
      }
    );
    if (overlap > 0.8) {
      return { action: 'skipped', existingId: existing.id, reason: 'criteria_overlap', overlap };
    }
  }

  // No duplicates -- create the ICP profile
  const result = await query<{ id: string }>(
    `INSERT INTO icp_profiles (name, description, criteria, niche_id, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id`,
    [
      discovery.suggestedName,
      discovery.description,
      JSON.stringify({
        roles: discovery.criteria.titlePatterns,
        companySizeRanges: discovery.criteria.companySizes,
        locations: discovery.criteria.locations,
        signals: [],
      }),
      nicheId,
    ]
  );

  return { action: 'created', id: result.rows[0].id };
}

/**
 * Compute criteria overlap between two ICP criteria objects.
 * Returns 0.0 - 1.0 where 1.0 = identical criteria.
 */
export function computeCriteriaOverlap(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): number {
  const fields = ['roles', 'industries', 'companySizeRanges', 'locations', 'signals'];
  let totalFields = 0;
  let overlapScore = 0;

  for (const field of fields) {
    const aValues = normalizeArray(a[field]);
    const bValues = normalizeArray(b[field]);

    if (aValues.length === 0 && bValues.length === 0) continue;
    totalFields++;

    if (aValues.length === 0 || bValues.length === 0) continue;

    const aSet = new Set(aValues.map(v => v.toLowerCase()));
    const bSet = new Set(bValues.map(v => v.toLowerCase()));
    const intersection = [...aSet].filter(v => bSet.has(v)).length;
    const union = new Set([...aSet, ...bSet]).size;

    if (union > 0) {
      overlapScore += intersection / union;
    }
  }

  return totalFields > 0 ? overlapScore / totalFields : 0;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}
