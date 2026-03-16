// GET /api/contacts/search?q=query - keyword search across contacts

import { NextRequest, NextResponse } from 'next/server';
import { searchContacts } from '@/lib/db/queries/contacts';

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

    return NextResponse.json({
      data: result.data.map((row) => ({
        ...snakeToCamel(row as unknown as Record<string, unknown>),
        // Command palette uses 'name' shorthand
        name: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unknown',
        company: row.current_company,
        tier: (row as unknown as Record<string, unknown>).tier ?? null,
      })),
      pagination: result.pagination,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
