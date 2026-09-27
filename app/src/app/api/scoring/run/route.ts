// POST /api/scoring/run - Trigger scoring run (single or batch)
// Persisted scores are owner baseline only.

import { NextRequest, NextResponse } from 'next/server';
import { scoreContact, scoreBatch } from '@/lib/scoring/pipeline';
import { scoreContactWithProvenance } from '@/lib/ecc/causal-graph/scoring-adapter';
import { ECC_FLAGS } from '@/lib/ecc/types';

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 });
    }
    if (searchParams.has('targetId') || Object.hasOwn(body, 'targetId')) {
      return NextResponse.json({ error: 'targetId is only supported by the read-only scoring context preview' }, { status: 422 });
    }
    const { contactId, contactIds, profileName } = body as {
      contactId?: string;
      contactIds?: string[];
      profileName?: string;
    };
    if (Object.keys(body).some(key => !['contactId', 'contactIds', 'profileName'].includes(key)) ||
        (contactId !== undefined && (typeof contactId !== 'string' || contactId.length === 0)) ||
        (contactIds !== undefined && (!Array.isArray(contactIds) || contactIds.some(id => typeof id !== 'string' || id.length === 0))) ||
        (profileName !== undefined && (typeof profileName !== 'string' || profileName.length === 0)) ||
        (contactId !== undefined && contactIds !== undefined)) {
      return NextResponse.json({ error: 'Invalid scoring request body' }, { status: 400 });
    }

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
