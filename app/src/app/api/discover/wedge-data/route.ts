// GET /api/discover/wedge-data - Aggregated data for wedge/treemap visualizations

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

interface NicheData {
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
  topContacts: Array<{ id: string; name: string; score: number; tier: string }>;
}

interface IcpData {
  id: string;
  name: string;
  matchCount: number;
  firstDegreeCount: number;
  secondDegreeCount: number;
  criteria: Record<string, unknown>;
}

export async function GET() {
  try {
    // 1. Get niche clusters with scores and tier breakdowns
    const nicheResult = await query<{
      niche_name: string;
      contact_count: string;
      avg_score: string | null;
      gold_count: string;
      silver_count: string;
      bronze_count: string;
      watch_count: string;
      unscored_count: string;
    }>(
      `SELECT
        CASE
          WHEN c.title ILIKE '%CEO%' OR c.title ILIKE '%founder%' THEN 'Executive/Founder'
          WHEN c.title ILIKE '%VP%' OR c.title ILIKE '%director%' THEN 'VP/Director'
          WHEN c.title ILIKE '%manager%' OR c.title ILIKE '%lead%' THEN 'Manager/Lead'
          WHEN c.title ILIKE '%engineer%' OR c.title ILIKE '%developer%' THEN 'Engineer/Developer'
          WHEN c.title ILIKE '%sales%' OR c.title ILIKE '%account%' THEN 'Sales/Account'
          WHEN c.title ILIKE '%marketing%' OR c.title ILIKE '%growth%' THEN 'Marketing/Growth'
          WHEN c.title ILIKE '%consult%' OR c.title ILIKE '%advisor%' THEN 'Consultant/Advisor'
          WHEN c.title ILIKE '%design%' OR c.title ILIKE '%creative%' THEN 'Design/Creative'
          ELSE 'Other'
        END AS niche_name,
        COUNT(*)::text AS contact_count,
        AVG(cs.composite_score)::text AS avg_score,
        COUNT(*) FILTER (WHERE cs.tier = 'gold')::text AS gold_count,
        COUNT(*) FILTER (WHERE cs.tier = 'silver')::text AS silver_count,
        COUNT(*) FILTER (WHERE cs.tier = 'bronze')::text AS bronze_count,
        COUNT(*) FILTER (WHERE cs.tier = 'watch')::text AS watch_count,
        COUNT(*) FILTER (WHERE cs.tier IS NULL OR cs.tier = 'unscored')::text AS unscored_count
      FROM contacts c
      LEFT JOIN contact_scores cs ON cs.contact_id = c.id
      WHERE c.is_archived = FALSE
      GROUP BY niche_name
      HAVING COUNT(*) >= 1
      ORDER BY COUNT(*) DESC
      LIMIT 12`
    );

    // 2. Get top contacts per niche
    const topContactsResult = await query<{
      niche_name: string;
      contact_id: string;
      contact_name: string;
      composite_score: number | null;
      tier: string | null;
    }>(
      `SELECT sub.niche_name, sub.contact_id, sub.contact_name, sub.composite_score, sub.tier
       FROM (
         SELECT
           CASE
             WHEN c.title ILIKE '%CEO%' OR c.title ILIKE '%founder%' THEN 'Executive/Founder'
             WHEN c.title ILIKE '%VP%' OR c.title ILIKE '%director%' THEN 'VP/Director'
             WHEN c.title ILIKE '%manager%' OR c.title ILIKE '%lead%' THEN 'Manager/Lead'
             WHEN c.title ILIKE '%engineer%' OR c.title ILIKE '%developer%' THEN 'Engineer/Developer'
             WHEN c.title ILIKE '%sales%' OR c.title ILIKE '%account%' THEN 'Sales/Account'
             WHEN c.title ILIKE '%marketing%' OR c.title ILIKE '%growth%' THEN 'Marketing/Growth'
             WHEN c.title ILIKE '%consult%' OR c.title ILIKE '%advisor%' THEN 'Consultant/Advisor'
             WHEN c.title ILIKE '%design%' OR c.title ILIKE '%creative%' THEN 'Design/Creative'
             ELSE 'Other'
           END AS niche_name,
           c.id AS contact_id,
           COALESCE(c.first_name || ' ' || c.last_name, c.first_name, 'Unknown') AS contact_name,
           cs.composite_score,
           cs.tier,
           ROW_NUMBER() OVER (
             PARTITION BY
               CASE
                 WHEN c.title ILIKE '%CEO%' OR c.title ILIKE '%founder%' THEN 'Executive/Founder'
                 WHEN c.title ILIKE '%VP%' OR c.title ILIKE '%director%' THEN 'VP/Director'
                 WHEN c.title ILIKE '%manager%' OR c.title ILIKE '%lead%' THEN 'Manager/Lead'
                 WHEN c.title ILIKE '%engineer%' OR c.title ILIKE '%developer%' THEN 'Engineer/Developer'
                 WHEN c.title ILIKE '%sales%' OR c.title ILIKE '%account%' THEN 'Sales/Account'
                 WHEN c.title ILIKE '%marketing%' OR c.title ILIKE '%growth%' THEN 'Marketing/Growth'
                 WHEN c.title ILIKE '%consult%' OR c.title ILIKE '%advisor%' THEN 'Consultant/Advisor'
                 WHEN c.title ILIKE '%design%' OR c.title ILIKE '%creative%' THEN 'Design/Creative'
                 ELSE 'Other'
               END
             ORDER BY cs.composite_score DESC NULLS LAST
           ) AS rn
         FROM contacts c
         LEFT JOIN contact_scores cs ON cs.contact_id = c.id
         WHERE c.is_archived = FALSE
       ) sub
       WHERE sub.rn <= 5`
    );

    // Build top contacts map
    const topContactsByNiche = new Map<string, Array<{ id: string; name: string; score: number; tier: string }>>();
    for (const row of topContactsResult.rows) {
      const list = topContactsByNiche.get(row.niche_name) || [];
      list.push({
        id: row.contact_id,
        name: row.contact_name,
        score: row.composite_score ?? 0,
        tier: row.tier ?? 'unscored',
      });
      topContactsByNiche.set(row.niche_name, list);
    }

    const niches: NicheData[] = nicheResult.rows.map(r => ({
      name: r.niche_name,
      contactCount: parseInt(r.contact_count, 10),
      avgScore: r.avg_score ? parseFloat(parseFloat(r.avg_score).toFixed(2)) : 0,
      tierBreakdown: {
        gold: parseInt(r.gold_count, 10),
        silver: parseInt(r.silver_count, 10),
        bronze: parseInt(r.bronze_count, 10),
        watch: parseInt(r.watch_count, 10),
        unscored: parseInt(r.unscored_count, 10),
      },
      topContacts: topContactsByNiche.get(r.niche_name) || [],
    }));

    // 3. Get ICP profiles with match counts
    const icpResult = await query<{
      id: string;
      name: string;
      criteria: Record<string, unknown>;
      match_count: string;
      first_degree_count: string;
      second_degree_count: string;
    }>(
      `SELECT
        ip.id,
        ip.name,
        ip.criteria,
        COALESCE(fits.match_count, 0)::text AS match_count,
        COALESCE(fits.first_deg, 0)::text AS first_degree_count,
        COALESCE(fits.second_deg, 0)::text AS second_degree_count
      FROM icp_profiles ip
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::bigint AS match_count,
          COUNT(*) FILTER (WHERE c.degree = 1)::bigint AS first_deg,
          COUNT(*) FILTER (WHERE c.degree > 1)::bigint AS second_deg
        FROM contact_icp_fits cif
        JOIN contacts c ON c.id = cif.contact_id AND c.is_archived = FALSE
        WHERE cif.icp_profile_id = ip.id AND cif.fit_score >= 0.3
      ) fits ON TRUE
      WHERE ip.is_active = TRUE
      ORDER BY ip.name`
    );

    const icps: IcpData[] = icpResult.rows.map(r => ({
      id: r.id,
      name: r.name,
      matchCount: parseInt(r.match_count, 10),
      firstDegreeCount: parseInt(r.first_degree_count, 10),
      secondDegreeCount: parseInt(r.second_degree_count, 10),
      criteria: r.criteria,
    }));

    // 4. Total contacts
    const totalResult = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM contacts WHERE is_archived = FALSE'
    );
    const totalContacts = parseInt(totalResult.rows[0]?.count || '0', 10);

    return NextResponse.json({
      data: { niches, icps, totalContacts },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load wedge data', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
