// Seed lenses helper — WS-4 Phase 1 Track B
//
// Creates three ICP-lens association rows keyed to the current owner's
// self-target. The three names come from the user's Q1 discussion (see
// `.planning/research-tools-sprint/10-decisions.md` Q1):
//
//   - "As consultant"
//   - "As board member"
//   - "As candidate"
//
// Each lens is stored as an `icp_profiles` row (is_active=true) joined to
// the self-target through `research_target_icps`. The helper is idempotent
// — re-invoking it will not duplicate rows.
//
// This is not a migration (per the sprint constraint "do not alter
// migrations 033-037"). Call it from a script, a one-off admin endpoint, or
// a test seed helper. It is safe to call from a server action once the
// research mode flag is flipped on.

import { query } from '../db/client';
import { getCurrentOwnerProfileId, getOrCreateSelfTarget } from './service';

const LENSES: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: 'As consultant',
    description: 'Network through the lens of consulting engagements and advisory relationships.',
  },
  {
    name: 'As board member',
    description: 'Network through the lens of board-level governance and oversight.',
  },
  {
    name: 'As candidate',
    description: 'Network through the lens of being evaluated for a role.',
  },
];

export interface SeedLensesResult {
  created: string[];
  existing: string[];
  selfTargetId: string | null;
}

export async function seedResearchLensesForCurrentOwner(): Promise<SeedLensesResult> {
  const ownerId = await getCurrentOwnerProfileId();
  if (!ownerId) {
    return { created: [], existing: [], selfTargetId: null };
  }
  const selfTarget = await getOrCreateSelfTarget(ownerId);
  if (!selfTarget) {
    return { created: [], existing: [], selfTargetId: null };
  }

  const created: string[] = [];
  const existing: string[] = [];

  for (const lens of LENSES) {
    // Upsert the icp_profile by name. We check existence first so we can
    // distinguish created-vs-existing for the idempotency test.
    const found = await query<{ id: string }>(
      `SELECT id FROM icp_profiles WHERE name = $1 LIMIT 1`,
      [lens.name]
    );
    let icpId = found.rows[0]?.id;
    if (!icpId) {
      const inserted = await query<{ id: string }>(
        `INSERT INTO icp_profiles (name, description, criteria, is_active)
         VALUES ($1, $2, '{}', TRUE)
         RETURNING id`,
        [lens.name, lens.description]
      );
      icpId = inserted.rows[0].id;
      created.push(lens.name);
    } else {
      existing.push(lens.name);
    }

    // Associate with the self-target as an unscoped legacy ICP. Scoped lens
    // associations (including soft-deleted lenses) remain untouched.
    await query(
      `INSERT INTO research_target_icps (target_id, icp_profile_id, lens_id, is_default)
       VALUES ($1, $2, NULL, FALSE)
       ON CONFLICT (target_id, icp_profile_id) WHERE lens_id IS NULL DO NOTHING`,
      [selfTarget.id, icpId]
    );
  }

  return { created, existing, selfTargetId: selfTarget.id };
}
