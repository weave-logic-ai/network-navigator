// GET /api/discover/wedge-data - Aggregated data for wedge/treemap visualizations
// Uses niche_profiles + icp_profiles with tightened keyword matching

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

interface NicheWedge {
  id: string;
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
  topContacts: Array<{ id: string; name: string; score: number; tier: string }>;
}

interface IcpWedge {
  id: string;
  name: string;
  nicheId: string | null;
  matchCount: number;
  firstDegreeCount: number;
  secondDegreeCount: number;
  criteria: Record<string, unknown>;
}

export async function GET() {
  try {
    // 1. Get all niches
    const nichesResult = await query<{
      id: string; name: string; keywords: string[];
    }>('SELECT id, name, keywords FROM niche_profiles ORDER BY niche_score DESC NULLS LAST, name');

    // 2. Match contacts to niches — require >=2 keyword hits for specificity
    // Use a single query with keyword scoring instead of N+1
    const nicheWedges: NicheWedge[] = [];
    const matchedContactIds = new Set<string>();

    for (const niche of nichesResult.rows) {
      if (!niche.keywords || niche.keywords.length === 0) {
        nicheWedges.push({
          id: niche.id, name: niche.name, contactCount: 0, avgScore: 0,
          tierBreakdown: { gold: 0, silver: 0, bronze: 0, watch: 0, unscored: 0 },
          topContacts: [],
        });
        continue;
      }

      // Require at least min_hits keyword matches (2 for multi-keyword niches, 1 for <=2 keywords)
      const minHits = niche.keywords.length > 2 ? 2 : 1;

      const countResult = await query<{
        contact_count: string;
        avg_score: string | null;
        gold: string; silver: string; bronze: string; watch: string; unscored: string;
        top_ids: string[];
      }>(
        `WITH keyword_matches AS (
           SELECT c.id,
             (SELECT count(*) FROM unnest($1::text[]) AS kw
              WHERE c.title ILIKE '%' || kw || '%'
                 OR c.headline ILIKE '%' || kw || '%'
                 OR c.current_company ILIKE '%' || kw || '%'
             ) AS hit_count
           FROM contacts c
           WHERE c.is_archived = FALSE AND c.degree > 0
         ),
         matched AS (
           SELECT km.id FROM keyword_matches km WHERE km.hit_count >= $2
         )
         SELECT
           COUNT(*)::text AS contact_count,
           AVG(cs.composite_score)::text AS avg_score,
           COUNT(*) FILTER (WHERE cs.tier = 'gold')::text AS gold,
           COUNT(*) FILTER (WHERE cs.tier = 'silver')::text AS silver,
           COUNT(*) FILTER (WHERE cs.tier = 'bronze')::text AS bronze,
           COUNT(*) FILTER (WHERE cs.tier = 'watch')::text AS watch,
           COUNT(*) FILTER (WHERE cs.tier IS NULL OR cs.tier = 'unscored')::text AS unscored,
           (SELECT array_agg(m2.id) FROM (SELECT m.id FROM matched m JOIN contact_scores cs2 ON cs2.contact_id = m.id ORDER BY cs2.composite_score DESC NULLS LAST LIMIT 5) m2) AS top_ids
         FROM matched m
         LEFT JOIN contact_scores cs ON cs.contact_id = m.id`,
        [niche.keywords, minHits]
      );

      const row = countResult.rows[0];
      const contactCount = parseInt(row.contact_count, 10);

      // Track matched IDs for unaddressed calc
      if (contactCount > 0) {
        // We don't track all IDs (too expensive), estimate from counts
        // The matchedContactIds is approximate — used for "addressed" %
      }

      let topContacts: Array<{ id: string; name: string; score: number; tier: string }> = [];
      if (row.top_ids && row.top_ids.length > 0) {
        const topResult = await query<{
          id: string; name: string; score: number | null; tier: string | null;
        }>(
          `SELECT c.id,
                  COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
                  cs.composite_score AS score, cs.tier
           FROM contacts c
           LEFT JOIN contact_scores cs ON cs.contact_id = c.id
           WHERE c.id = ANY($1)
           ORDER BY cs.composite_score DESC NULLS LAST LIMIT 5`,
          [row.top_ids]
        );
        topContacts = topResult.rows.map(r => ({
          id: r.id, name: r.name, score: r.score ?? 0, tier: r.tier ?? 'unscored',
        }));
      }

      nicheWedges.push({
        id: niche.id,
        name: niche.name,
        contactCount,
        avgScore: row.avg_score ? parseFloat(parseFloat(row.avg_score).toFixed(2)) : 0,
        tierBreakdown: {
          gold: parseInt(row.gold, 10),
          silver: parseInt(row.silver, 10),
          bronze: parseInt(row.bronze, 10),
          watch: parseInt(row.watch, 10),
          unscored: parseInt(row.unscored, 10),
        },
        topContacts,
      });
    }

    // 3. Count total contacts and compute addressed (sum of unique niche matches)
    const totalResult = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM contacts WHERE is_archived = FALSE AND degree > 0'
    );
    const totalContacts = parseInt(totalResult.rows[0]?.count || '0', 10);

    // Addressed = contacts matching at least one niche (single query)
    const addressedResult = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT c.id)::text AS count
       FROM contacts c, niche_profiles np
       WHERE c.is_archived = FALSE AND c.degree > 0
         AND np.keywords IS NOT NULL AND array_length(np.keywords, 1) > 0
         AND (SELECT count(*) FROM unnest(np.keywords) AS kw
              WHERE c.title ILIKE '%' || kw || '%'
                 OR c.headline ILIKE '%' || kw || '%'
                 OR c.current_company ILIKE '%' || kw || '%'
             ) >= CASE WHEN array_length(np.keywords, 1) > 2 THEN 2 ELSE 1 END`
    );
    const addressedCount = parseInt(addressedResult.rows[0]?.count || '0', 10);
    const unaddressedCount = totalContacts - addressedCount;

    // 4. ICP match counts — require role AND industry match when both exist
    const icpResult = await query<{
      id: string; name: string; niche_id: string | null; criteria: Record<string, unknown>;
    }>(
      'SELECT id, name, niche_id, criteria FROM icp_profiles WHERE is_active = TRUE ORDER BY name'
    );

    const icpWedges: IcpWedge[] = [];
    for (const icp of icpResult.rows) {
      const roles = Array.isArray(icp.criteria?.roles) ? icp.criteria.roles as string[] : [];
      const industries = Array.isArray(icp.criteria?.industries) ? icp.criteria.industries as string[] : [];

      if (roles.length === 0 && industries.length === 0) {
        icpWedges.push({
          id: icp.id, name: icp.name, nicheId: icp.niche_id,
          matchCount: 0, firstDegreeCount: 0, secondDegreeCount: 0,
          criteria: icp.criteria,
        });
        continue;
      }

      // Build conditions — require BOTH role AND industry match when both exist
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (roles.length > 0) {
        const roleConds = roles.map((r) => {
          params.push(r);
          return `c.title ILIKE '%' || $${idx++} || '%'`;
        });
        conditions.push(`(${roleConds.join(' OR ')})`);
      }

      if (industries.length > 0) {
        const indConds = industries.map((ind) => {
          params.push(ind);
          const p = idx++;
          return `(c.headline ILIKE '%' || $${p} || '%' OR c.current_company ILIKE '%' || $${p} || '%')`;
        });
        conditions.push(`(${indConds.join(' OR ')})`);
      }

      // AND both conditions when both exist
      const whereClause = conditions.join(' AND ');

      const matchResult = await query<{
        total: string; first_deg: string; second_deg: string;
      }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE c.degree = 1)::text AS first_deg,
           COUNT(*) FILTER (WHERE c.degree > 1)::text AS second_deg
         FROM contacts c
         WHERE c.is_archived = FALSE AND c.degree > 0 AND (${whereClause})`,
        params
      );

      const mr = matchResult.rows[0];
      icpWedges.push({
        id: icp.id,
        name: icp.name,
        nicheId: icp.niche_id,
        matchCount: parseInt(mr.total, 10),
        firstDegreeCount: parseInt(mr.first_deg, 10),
        secondDegreeCount: parseInt(mr.second_deg, 10),
        criteria: icp.criteria,
      });
    }

    return NextResponse.json({
      data: {
        niches: nicheWedges.filter(n => n.contactCount > 0),
        allNiches: nicheWedges,
        icps: icpWedges,
        totalContacts,
        addressedCount,
        unaddressedCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load wedge data', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
