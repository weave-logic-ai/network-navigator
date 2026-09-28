// POST /api/graph/compute - Trigger graph computation

import { NextResponse } from 'next/server';
import { computeGraphSnapshot, GraphComputeBusyError, GraphComputePublicationUncertainError } from '@/lib/graph/compute-snapshot';
import { GraphSchemaUpgradeRequiredError } from '@/lib/graph/schema-gate';

export async function POST() {
  try {
    const result = await computeGraphSnapshot();
    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof GraphSchemaUpgradeRequiredError) {
      return NextResponse.json({ error: error.message, retryable: true }, { status: 503 });
    }
    if (error instanceof GraphComputeBusyError) {
      return NextResponse.json({ error: error.message, retryable: true }, { status: 409 });
    }
    if (error instanceof GraphComputePublicationUncertainError) {
      return NextResponse.json({ error: error.message, outcome: 'uncertain', retryable: true }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'Failed to compute graph. Prior results were retained.', details: error instanceof Error ? error.message : undefined, retryable: true },
      { status: 500 }
    );
  }
}
