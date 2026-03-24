// GET /api/niches - list all niches (optionally filtered by verticalId)
// POST /api/niches - create a niche

import { NextRequest, NextResponse } from 'next/server';
import { listNiches, listNichesByVertical, createNiche } from '@/lib/db/queries/niches';

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const verticalId = searchParams.get('verticalId');

    const niches = verticalId
      ? await listNichesByVertical(verticalId)
      : await listNiches();

    return NextResponse.json({
      data: niches.map((row) => snakeToCamel(row as unknown as Record<string, unknown>)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list niches', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'name is required and must be a string' },
        { status: 400 }
      );
    }

    const niche = await createNiche({
      name: body.name,
      description: body.description,
      verticalId: body.verticalId,
      keywords: body.keywords,
      affordability: body.affordability,
      fitability: body.fitability,
      buildability: body.buildability,
    });

    return NextResponse.json(
      { data: snakeToCamel(niche as unknown as Record<string, unknown>) },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create niche', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
