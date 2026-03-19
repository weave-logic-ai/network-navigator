// POST /api/claude/suggestions - Generate goal/task suggestions

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { getContactById } from '@/lib/db/queries/contacts';
import { getContactScoreBreakdown } from '@/lib/db/queries/scoring';
import { generateGoalsForNetwork } from '@/lib/claude/analyze';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scope, contactId } = body as {
      scope: 'network' | 'contact';
      contactId?: string;
    };

    if (!scope || !['network', 'contact'].includes(scope)) {
      return NextResponse.json(
        { error: 'scope must be "network" or "contact"' },
        { status: 400 }
      );
    }

    if (scope === 'contact' && !contactId) {
      return NextResponse.json(
        { error: 'contactId required when scope is "contact"' },
        { status: 400 }
      );
    }

    if (scope === 'contact') {
      const contact = await getContactById(contactId!);
      if (!contact) {
        return NextResponse.json(
          { error: 'Contact not found' },
          { status: 404 }
        );
      }

      const scores = await getContactScoreBreakdown(contactId!);
      const scoreMap = new Map<
        string,
        {
          compositeScore?: number;
          tier?: string;
          persona?: string | null;
        }
      >();
      if (scores) {
        scoreMap.set(contactId!, {
          compositeScore: scores.compositeScore,
          tier: scores.tier,
          persona: scores.persona,
        });
      }

      const suggestions = await generateGoalsForNetwork([contact], scoreMap);
      return NextResponse.json({ data: { suggestions } });
    }

    // Network scope: load top 20 scored contacts
    const topContacts = await query<{
      id: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      headline: string | null;
      title: string | null;
      current_company: string | null;
      location: string | null;
      about: string | null;
      tags: string[];
      connections_count: number | null;
      composite_score: number | null;
      tier: string | null;
      persona: string | null;
    }>(
      `SELECT c.id, c.full_name, c.first_name, c.last_name, c.headline,
              c.title, c.current_company, c.location, c.about, c.tags,
              c.connections_count,
              cs.composite_score, cs.tier, cs.persona
       FROM contacts c
       LEFT JOIN contact_scores cs ON cs.contact_id = c.id
       WHERE c.is_archived = FALSE AND c.degree > 0
       ORDER BY cs.composite_score DESC NULLS LAST
       LIMIT 20`
    );

    const scoreMap = new Map<
      string,
      {
        compositeScore?: number;
        tier?: string;
        persona?: string | null;
      }
    >();
    for (const row of topContacts.rows) {
      if (row.composite_score != null) {
        scoreMap.set(row.id, {
          compositeScore: row.composite_score,
          tier: row.tier ?? undefined,
          persona: row.persona,
        });
      }
    }

    const suggestions = await generateGoalsForNetwork(
      topContacts.rows,
      scoreMap
    );

    return NextResponse.json({ data: { suggestions } });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to generate suggestions',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
