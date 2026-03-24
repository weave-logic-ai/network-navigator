// GET /api/niches/:id - get single niche
// PUT /api/niches/:id - update niche
// DELETE /api/niches/:id - delete niche

import { NextRequest, NextResponse } from 'next/server';
import { getNiche, updateNiche, deleteNiche } from '@/lib/db/queries/niches';

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid niche ID format' }, { status: 400 });
  }

  try {
    const niche = await getNiche(id);
    if (!niche) {
      return NextResponse.json({ error: 'Niche not found' }, { status: 404 });
    }
    return NextResponse.json({ data: snakeToCamel(niche as unknown as Record<string, unknown>) });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get niche', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid niche ID format' }, { status: 400 });
  }

  try {
    const body = await request.json();
    // Map camelCase from frontend to snake_case for DB
    const dbPayload: Record<string, unknown> = {};
    if (body.name !== undefined) dbPayload.name = body.name;
    if (body.description !== undefined) dbPayload.description = body.description;
    if (body.industryId !== undefined) dbPayload.industry_id = body.industryId;
    if (body.industry_id !== undefined) dbPayload.industry_id = body.industry_id;
    if (body.keywords !== undefined) dbPayload.keywords = body.keywords;
    if (body.affordability !== undefined) dbPayload.affordability = body.affordability;
    if (body.fitability !== undefined) dbPayload.fitability = body.fitability;
    if (body.buildability !== undefined) dbPayload.buildability = body.buildability;
    const niche = await updateNiche(id, dbPayload);

    if (!niche) {
      return NextResponse.json({ error: 'Niche not found or no valid fields' }, { status: 404 });
    }

    return NextResponse.json({ data: snakeToCamel(niche as unknown as Record<string, unknown>) });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update niche', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid niche ID format' }, { status: 400 });
  }

  try {
    const deleted = await deleteNiche(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Niche not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete niche', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
