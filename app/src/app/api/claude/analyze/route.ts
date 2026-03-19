// POST /api/claude/analyze - Analyze a contact or batch of contacts

import { NextRequest, NextResponse } from 'next/server';
import { getContactById } from '@/lib/db/queries/contacts';
import { getContactScoreBreakdown } from '@/lib/db/queries/scoring';
import { getGraphMetrics } from '@/lib/db/queries/graph';
import { analyzeContact } from '@/lib/claude/analyze';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactId, contactIds } = body as {
      contactId?: string;
      contactIds?: string[];
    };

    const ids: string[] = contactIds ?? (contactId ? [contactId] : []);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'contactId or contactIds required' },
        { status: 400 }
      );
    }

    if (ids.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 contacts per batch' },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      ids.map(async (id) => {
        const contact = await getContactById(id);
        if (!contact) {
          return { contactId: id, analysis: null, error: 'Contact not found' };
        }

        const [scores, metrics] = await Promise.all([
          getContactScoreBreakdown(id),
          getGraphMetrics(id),
        ]);

        const analysis = await analyzeContact(
          contact,
          scores
            ? {
                compositeScore: scores.compositeScore,
                tier: scores.tier,
                persona: scores.persona,
                behavioralPersona: scores.behavioralPersona,
                dimensions: scores.dimensions,
              }
            : null,
          metrics
            ? {
                pagerank: metrics.pagerank,
                betweennessCentrality: metrics.betweennessCentrality,
                degreeCentrality: metrics.degreeCentrality,
              }
            : null
        );

        return { contactId: id, analysis };
      })
    );

    // Single contact: return flat object; batch: return array
    if (contactId && !contactIds) {
      return NextResponse.json({ data: results[0] });
    }

    return NextResponse.json({ data: results });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to analyze contact',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
