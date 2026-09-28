import { NextRequest, NextResponse } from 'next/server';
import { getCrossRefsForContact } from '@/lib/ecc/cross-refs/service';
import type { CrossRefType } from '@/lib/ecc/types';
import { getDefaultTenantId } from '@/lib/targets/service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const relationType = searchParams.get('type') as CrossRefType | null;

    // Resolve tenant via the shared resolver (same one used by
    // ecc/causal-graph/scoring-adapter.ts and ecc/cognitive-tick/claude-adapter.ts)
    // instead of the hardcoded 'default' literal that was here before.
    const tenantId = await getDefaultTenantId();

    const relationships = await getCrossRefsForContact(
      tenantId,
      id,
      relationType ?? undefined
    );

    return NextResponse.json({
      data: {
        contactId: id,
        relationships,
        total: relationships.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get relationships', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
