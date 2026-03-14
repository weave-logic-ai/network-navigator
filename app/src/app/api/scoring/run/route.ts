// POST /api/scoring/run - Trigger scoring run (single or batch)

import { NextRequest, NextResponse } from 'next/server';
import { scoreContact, scoreBatch } from '@/lib/scoring/pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactId, contactIds, profileName } = body as {
      contactId?: string;
      contactIds?: string[];
      profileName?: string;
    };

    if (contactId) {
      const result = await scoreContact(contactId, profileName);
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
