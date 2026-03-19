// GET /api/contacts/[id]/network - Network data for a contact

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NetworkContact {
  id: string;
  fullName: string | null;
  headline: string | null;
  currentCompany: string | null;
  profileImageUrl: string | null;
  linkedinUrl: string;
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
    // Get edge count for this contact
    const edgeResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM edges
       WHERE (source_contact_id = $1 OR target_contact_id = $1)
         AND target_contact_id IS NOT NULL`,
      [id]
    );
    const edgeCount = parseInt(edgeResult.rows[0].count, 10);

    // Find mutual connections: contacts who share edges with this contact.
    // A mutual connection is a contact C where both this contact and C
    // are connected to at least one common contact.
    const mutualResult = await query<{
      id: string; full_name: string | null; headline: string | null;
      current_company: string | null; profile_image_url: string | null;
      linkedin_url: string;
    }>(
      `WITH my_neighbors AS (
         SELECT CASE
           WHEN source_contact_id = $1 THEN target_contact_id
           ELSE source_contact_id
         END AS neighbor_id
         FROM edges
         WHERE (source_contact_id = $1 OR target_contact_id = $1)
           AND target_contact_id IS NOT NULL
       )
       SELECT DISTINCT c.id, c.full_name, c.headline, c.current_company,
              c.profile_image_url, c.linkedin_url
       FROM my_neighbors mn
       JOIN edges e ON (
         (e.source_contact_id = mn.neighbor_id AND e.target_contact_id IS NOT NULL AND e.target_contact_id != $1)
         OR
         (e.target_contact_id = mn.neighbor_id AND e.source_contact_id != $1)
       )
       JOIN contacts c ON c.id = CASE
         WHEN e.source_contact_id = mn.neighbor_id THEN e.target_contact_id
         ELSE e.source_contact_id
       END
       WHERE c.id != $1 AND c.is_archived = FALSE AND c.degree > 0
       LIMIT 20`,
      [id]
    );

    // Find same-company contacts
    const companyResult = await query<{
      id: string; full_name: string | null; headline: string | null;
      current_company: string | null; profile_image_url: string | null;
      linkedin_url: string;
    }>(
      `SELECT c2.id, c2.full_name, c2.headline, c2.current_company,
              c2.profile_image_url, c2.linkedin_url
       FROM contacts c1
       JOIN contacts c2 ON c2.current_company = c1.current_company
         AND c2.id != c1.id
         AND c2.is_archived = FALSE
         AND c2.degree > 0
       WHERE c1.id = $1
         AND c1.current_company IS NOT NULL
         AND c1.current_company != ''
       ORDER BY c2.full_name
       LIMIT 20`,
      [id]
    );

    const mapContact = (row: {
      id: string; full_name: string | null; headline: string | null;
      current_company: string | null; profile_image_url: string | null;
      linkedin_url: string;
    }): NetworkContact => ({
      id: row.id,
      fullName: row.full_name,
      headline: row.headline,
      currentCompany: row.current_company,
      profileImageUrl: row.profile_image_url,
      linkedinUrl: row.linkedin_url,
    });

    return NextResponse.json({
      data: {
        mutualConnections: mutualResult.rows.map(mapContact),
        sameCompany: companyResult.rows.map(mapContact),
        edgeCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get network data', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
