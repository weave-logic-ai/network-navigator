// GET /api/contacts/search?q=query - keyword search across contacts

import { NextRequest, NextResponse } from 'next/server';
import { searchContacts } from '@/lib/db/queries/contacts';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    if (!q || q.trim().length === 0) {
      return NextResponse.json(
        { error: 'Search query parameter "q" is required' },
        { status: 400 }
      );
    }

    if (q.length > 200) {
      return NextResponse.json(
        { error: 'Search query too long (max 200 characters)' },
        { status: 400 }
      );
    }

    const result = await searchContacts(q.trim(), page, limit);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
