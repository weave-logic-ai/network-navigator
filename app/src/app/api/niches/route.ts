// GET /api/niches - list all niches (optionally filtered by industryId)
// POST /api/niches - create a niche

import { NextRequest, NextResponse } from 'next/server';
import { listNiches, listNichesByIndustry, createNiche } from '@/lib/db/queries/niches';

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
    const industryId = searchParams.get('industryId');

    const niches = industryId
      ? await listNichesByIndustry(industryId)
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
      industryId: body.industryId,
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
