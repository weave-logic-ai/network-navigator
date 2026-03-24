import { NextRequest, NextResponse } from 'next/server';
import { getLatestTraceForContact } from '@/lib/ecc/causal-graph/service';
import { counterfactualScore } from '@/lib/ecc/causal-graph/counterfactual';

const DEFAULT_TENANT_ID = 'default';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params;
    const trace = await getLatestTraceForContact(DEFAULT_TENANT_ID, contactId);
    if (!trace) {
      return NextResponse.json({ error: 'No causal trace found' }, { status: 404 });
    }
    return NextResponse.json({ data: trace });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get causal trace', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params;
    const body = await request.json();
    const { modifiedWeights } = body as { modifiedWeights: Record<string, number> };

    if (!modifiedWeights) {
      return NextResponse.json({ error: 'modifiedWeights required' }, { status: 400 });
    }

    const result = await counterfactualScore(DEFAULT_TENANT_ID, contactId, modifiedWeights);
    if (!result) {
      return NextResponse.json({ error: 'No scoring data found for counterfactual' }, { status: 404 });
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to compute counterfactual', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
