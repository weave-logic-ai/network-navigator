// GET    /api/industries/[id] - Get industry with its niches
// PUT    /api/industries/[id] - Update an industry
// DELETE /api/industries/[id] - Delete an industry

import { NextRequest, NextResponse } from 'next/server';
import { getIndustryWithNiches, updateIndustry, deleteIndustry } from '@/lib/taxonomy/service';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const industry = await getIndustryWithNiches(id);
    if (!industry) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }
    return NextResponse.json({ data: industry });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get industry', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const industry = await updateIndustry(id, body);
    if (!industry) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }
    return NextResponse.json({ data: industry });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update industry', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await deleteIndustry(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete industry', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
