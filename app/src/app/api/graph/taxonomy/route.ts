// GET /api/graph/taxonomy - Taxonomy hierarchy: Vertical -> Niche -> ICP

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

interface TaxonomyIcp {
  id: string;
  name: string;
  type: 'icp';
  matchCount: number;
}

interface TaxonomyNiche {
  id: string;
  name: string;
  type: 'niche';
  contactCount: number;
  keywords: string[];
  children: TaxonomyIcp[];
}

interface TaxonomyIndustry {
  id: string;
  name: string;
  type: 'industry';
  children: TaxonomyNiche[];
}

export async function GET() {
  try {
    // Fetch full hierarchy with a single query using LEFT JOINs
    const result = await query<{
      v_id: string;
      v_name: string;
      n_id: string | null;
      n_name: string | null;
      n_keywords: string[] | null;
      n_member_count: number | null;
      i_id: string | null;
      i_name: string | null;
      i_is_active: boolean | null;
      icp_match_count: string | null;
    }>(
      `SELECT
         v.id AS v_id,
         v.name AS v_name,
         np.id AS n_id,
         np.name AS n_name,
         np.keywords AS n_keywords,
         np.member_count AS n_member_count,
         ip.id AS i_id,
         ip.name AS i_name,
         ip.is_active AS i_is_active,
         (
           SELECT COUNT(*)::text
           FROM contact_scores cs
           WHERE cs.icp_profile_id = ip.id
         ) AS icp_match_count
       FROM verticals v
       LEFT JOIN niche_profiles np ON np.vertical_id = v.id
       LEFT JOIN icp_profiles ip ON ip.niche_id = np.id
       ORDER BY v.name, np.name, ip.name`
    );

    // Build hierarchy from flat rows
    const industryMap = new Map<string, TaxonomyIndustry>();
    const nicheMap = new Map<string, TaxonomyNiche>();

    for (const row of result.rows) {
      // Ensure industry exists
      if (!industryMap.has(row.v_id)) {
        industryMap.set(row.v_id, {
          id: row.v_id,
          name: row.v_name,
          type: 'industry',
          children: [],
        });
      }
      const industry = industryMap.get(row.v_id)!;

      // Add niche if present
      if (row.n_id && !nicheMap.has(row.n_id)) {
        const niche: TaxonomyNiche = {
          id: row.n_id,
          name: row.n_name ?? '',
          type: 'niche',
          contactCount: row.n_member_count ?? 0,
          keywords: row.n_keywords ?? [],
          children: [],
        };
        nicheMap.set(row.n_id, niche);
        industry.children.push(niche);
      }

      // Add ICP if present
      if (row.n_id && row.i_id) {
        const niche = nicheMap.get(row.n_id);
        if (niche) {
          const alreadyAdded = niche.children.some((c) => c.id === row.i_id);
          if (!alreadyAdded) {
            niche.children.push({
              id: row.i_id,
              name: row.i_name ?? '',
              type: 'icp',
              matchCount: parseInt(row.icp_match_count ?? '0', 10),
            });
          }
        }
      }
    }

    // Also include niches without a vertical as an "Uncategorized" industry
    const orphanNiches = await query<{
      n_id: string;
      n_name: string;
      n_keywords: string[] | null;
      n_member_count: number | null;
      i_id: string | null;
      i_name: string | null;
      icp_match_count: string | null;
    }>(
      `SELECT
         np.id AS n_id,
         np.name AS n_name,
         np.keywords AS n_keywords,
         np.member_count AS n_member_count,
         ip.id AS i_id,
         ip.name AS i_name,
         (
           SELECT COUNT(*)::text
           FROM contact_scores cs
           WHERE cs.icp_profile_id = ip.id
         ) AS icp_match_count
       FROM niche_profiles np
       LEFT JOIN icp_profiles ip ON ip.niche_id = np.id
       WHERE np.vertical_id IS NULL
       ORDER BY np.name, ip.name`
    );

    if (orphanNiches.rows.length > 0) {
      const uncategorized: TaxonomyIndustry = {
        id: 'uncategorized',
        name: 'Uncategorized',
        type: 'industry',
        children: [],
      };
      const orphanNicheMap = new Map<string, TaxonomyNiche>();

      for (const row of orphanNiches.rows) {
        if (!orphanNicheMap.has(row.n_id)) {
          const niche: TaxonomyNiche = {
            id: row.n_id,
            name: row.n_name,
            type: 'niche',
            contactCount: row.n_member_count ?? 0,
            keywords: row.n_keywords ?? [],
            children: [],
          };
          orphanNicheMap.set(row.n_id, niche);
          uncategorized.children.push(niche);
        }

        if (row.i_id) {
          const niche = orphanNicheMap.get(row.n_id);
          if (niche) {
            niche.children.push({
              id: row.i_id,
              name: row.i_name ?? '',
              type: 'icp',
              matchCount: parseInt(row.icp_match_count ?? '0', 10),
            });
          }
        }
      }

      industryMap.set('uncategorized', uncategorized);
    }

    const data = Array.from(industryMap.values());

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load taxonomy data',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
