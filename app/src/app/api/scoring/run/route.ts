// POST /api/scoring/run - Trigger scoring run (single or batch)

import { NextRequest, NextResponse } from 'next/server';
import { scoreContact, scoreBatch } from '@/lib/scoring/pipeline';
import { scoreContactWithProvenance } from '@/lib/ecc/causal-graph/scoring-adapter';
import { ECC_FLAGS } from '@/lib/ecc/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactId, contactIds, profileName } = body as {
      contactId?: string;
      contactIds?: string[];
      profileName?: string;
    };

    if (contactId) {
      const result = ECC_FLAGS.causalGraph
        ? await scoreContactWithProvenance(contactId, profileName)
        : await scoreContact(contactId, profileName);
      return NextResponse.json({ data: result });
    }

    const results = await scoreBatch(contactIds, profileName);
    return NextResponse.json({
      data: {
        scored: results.length,
        results: results.slice(0, 100), // Limit response size
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to run scoring', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
