// POST /api/claude/analyze - Analyze a contact or batch of contacts

import { NextRequest, NextResponse } from 'next/server';
import { getContactById } from '@/lib/db/queries/contacts';
import { getContactScoreBreakdown } from '@/lib/db/queries/scoring';
import { getGraphMetrics } from '@/lib/db/queries/graph';
import { analyzeContact } from '@/lib/claude/analyze';
import { analyzeWithSession } from '@/lib/ecc/cognitive-tick/claude-adapter';
import { ECC_FLAGS } from '@/lib/ecc/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactId, contactIds, sessionId } = body as {
      contactId?: string;
      contactIds?: string[];
      sessionId?: string;
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

        const scoreData = scores
          ? {
              compositeScore: scores.compositeScore,
              tier: scores.tier,
              persona: scores.persona,
              behavioralPersona: scores.behavioralPersona,
              dimensions: scores.dimensions,
            }
          : null;

        const metricsData = metrics
          ? {
              pagerank: metrics.pagerank,
              betweennessCentrality: metrics.betweennessCentrality,
              degreeCentrality: metrics.degreeCentrality,
            }
          : null;

        // Session-aware analysis for single contact when ECC flag is on
        if (ECC_FLAGS.cognitiveTick && !contactIds) {
          const contactSummary = buildContactSummaryForSession(contact as unknown as Record<string, unknown>, scoreData, metricsData);
          const { response, sessionId: sid } = await analyzeWithSession(
            'default', 'api-user', id, 'Analyze this contact', contactSummary, sessionId
          );
          return { contactId: id, analysis: response, _sessionId: sid };
        }

        const analysis = await analyzeContact(contact, scoreData, metricsData);

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

/**
 * Build a text summary of a contact for session context.
 * Mirrors the logic in lib/claude/analyze.ts buildContactSummary.
 */
function buildContactSummaryForSession(
  contact: Record<string, unknown>,
  scores: Record<string, unknown> | null,
  graphMetrics: Record<string, unknown> | null
): string {
  const name = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';
  const parts: string[] = [`Name: ${name}`];

  if (contact.headline) parts.push(`Headline: ${contact.headline}`);
  if (contact.title) parts.push(`Title: ${contact.title}`);
  if (contact.current_company) parts.push(`Company: ${contact.current_company}`);
  if (contact.location) parts.push(`Location: ${contact.location}`);
  if (contact.about) parts.push(`About: ${String(contact.about).slice(0, 300)}`);

  if (scores) {
    parts.push(`Score: ${scores.compositeScore ?? 'N/A'}, Tier: ${scores.tier ?? 'N/A'}`);
    if (scores.persona) parts.push(`Persona: ${scores.persona}`);
  }

  if (graphMetrics) {
    const gm: string[] = [];
    if (graphMetrics.pagerank != null) gm.push(`PageRank: ${Number(graphMetrics.pagerank).toFixed(4)}`);
    if (graphMetrics.betweennessCentrality != null) gm.push(`Betweenness: ${Number(graphMetrics.betweennessCentrality).toFixed(4)}`);
    if (graphMetrics.degreeCentrality != null) gm.push(`Degree: ${Number(graphMetrics.degreeCentrality).toFixed(4)}`);
    if (gm.length > 0) parts.push(`Graph metrics: ${gm.join(', ')}`);
  }

  return parts.join('\n');
}
