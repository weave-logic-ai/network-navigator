import { NextRequest, NextResponse } from 'next/server';
import { getVerticalWithNiches, updateVertical, deleteVertical } from '@/lib/taxonomy/service';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const vertical = await getVerticalWithNiches(id);
    if (!vertical) {
      return NextResponse.json({ error: 'Vertical not found' }, { status: 404 });
    }
    return NextResponse.json({ data: vertical });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get vertical', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const vertical = await updateVertical(id, body);
    if (!vertical) {
      return NextResponse.json({ error: 'Vertical not found' }, { status: 404 });
    }
    return NextResponse.json({ data: vertical });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update vertical', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await deleteVertical(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Vertical not found' }, { status: 404 });
    }
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete vertical', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
