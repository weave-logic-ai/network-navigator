import { NextRequest, NextResponse } from 'next/server';
import { getChain, verifyChain } from '@/lib/ecc/exo-chain/service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ chainId: string }> }) {
  try {
    const { chainId } = await params;
    const { searchParams } = new URL(request.url);
    const verify = searchParams.get('verify') === 'true';

    const entries = await getChain(chainId);
    if (entries.length === 0) {
      return NextResponse.json({ error: 'Chain not found' }, { status: 404 });
    }

    const response: Record<string, unknown> = { data: { chainId, entries, totalEntries: entries.length } };

    if (verify) {
      const verification = await verifyChain(chainId);
      response.data = { ...(response.data as object), verification };
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get chain', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
