import { NextRequest, NextResponse } from 'next/server';
import { listVerticals, createVertical } from '@/lib/taxonomy/service';

export async function GET() {
  try {
    const verticals = await listVerticals();
    return NextResponse.json({ data: verticals });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list verticals', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const vertical = await createVertical({
      name: body.name,
      description: body.description,
      metadata: body.metadata,
    });
    return NextResponse.json({ data: vertical }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create vertical', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
