// GET /api/graph/path - Find path between contacts

import { NextRequest, NextResponse } from 'next/server';
import { findPath } from '@/lib/graph/paths';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const target = searchParams.get('target');
    const maxDepth = parseInt(searchParams.get('maxDepth') || '4', 10);

    if (!source || !target) {
      return NextResponse.json(
        { error: 'source and target query parameters required' },
        { status: 400 }
      );
    }

    const path = await findPath(source, target, maxDepth);
    if (!path) {
      return NextResponse.json(
        { data: null, message: 'No path found between these contacts' }
      );
    }

    return NextResponse.json({ data: path });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to find path', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
