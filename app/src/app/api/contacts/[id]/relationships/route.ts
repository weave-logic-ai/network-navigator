import { NextRequest, NextResponse } from 'next/server';
import { getCrossRefsForContact } from '@/lib/ecc/cross-refs/service';
import type { CrossRefType } from '@/lib/ecc/types';

const DEFAULT_TENANT_ID = 'default';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const relationType = searchParams.get('type') as CrossRefType | null;

    const relationships = await getCrossRefsForContact(
      DEFAULT_TENANT_ID,
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
