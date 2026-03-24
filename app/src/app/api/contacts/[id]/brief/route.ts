// GET /api/contacts/[id]/brief - Lightweight contact summary for hover tooltips

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BriefRow {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  current_company: string | null;
  location: string | null;
  headline: string | null;
  degree: number;
  tags: string[];
  connections_count: number | null;
  composite_score: number | null;
  tier: string | null;
  total_messages: number | null;
  shared_connections: string;
  icp_names: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid contact ID format' }, { status: 400 });
  }

  try {
    const result = await query<BriefRow>(
      `SELECT
         c.id,
         c.full_name,
         c.first_name,
         c.last_name,
         c.title,
         c.current_company,
         c.location,
         c.headline,
         c.degree,
         c.tags,
         c.connections_count,
         cs.composite_score,
         cs.tier,
         ms.total_messages,
         (
           SELECT COUNT(*)::text FROM edges
           WHERE (source_contact_id = c.id OR target_contact_id = c.id)
             AND target_contact_id IS NOT NULL
         ) AS shared_connections,
         (
           SELECT string_agg(ip.name, ', ')
           FROM contact_icp_fits cif
           JOIN icp_profiles ip ON ip.id = cif.icp_profile_id
           WHERE cif.contact_id = c.id AND cif.fit_score > 0.3
         ) AS icp_names
       FROM contacts c
       LEFT JOIN contact_scores cs ON cs.contact_id = c.id
       LEFT JOIN message_stats ms ON ms.contact_id = c.id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const row = result.rows[0];
    const fullName = row.full_name ||
      [row.first_name, row.last_name].filter(Boolean).join(' ') ||
      'Unknown';

    return NextResponse.json({
      data: {
        id: row.id,
        fullName,
        title: row.title,
        company: row.current_company,
        location: row.location,
        headline: row.headline,
        degree: row.degree,
        skills: (row.tags || []).slice(0, 3),
        compositeScore: row.composite_score,
        tier: row.tier,
        totalMessages: row.total_messages ?? 0,
        sharedConnections: parseInt(row.shared_connections, 10) || 0,
        icpMatches: row.icp_names
          ? row.icp_names.split(', ').filter(Boolean)
          : [],
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to get contact brief',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
