// GET /api/extension/captures - List captured pages
// POST /api/extension/captures - Trigger parsing on a capture

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { parseCachedPage } from '@/lib/parser/parse-engine';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '20', 10));
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const offset = (page - 1) * limit;

    const countResult = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM page_cache'
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await query<{
      id: string;
      url: string;
      page_type: string;
      content_length: string;
      parsed: boolean;
      parsed_at: string | null;
      parse_version: number | null;
      trigger_mode: string | null;
      scroll_depth: number | null;
      extension_version: string | null;
      created_at: string;
    }>(
      `SELECT id, url, page_type, length(html_content)::text AS content_length,
              parsed, parsed_at::text, parse_version, trigger_mode,
              scroll_depth, extension_version, created_at::text
       FROM page_cache
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return NextResponse.json({
      data: result.rows.map(r => ({
        id: r.id,
        url: r.url,
        pageType: r.page_type,
        contentLength: parseInt(r.content_length, 10),
        parsed: r.parsed,
        parsedAt: r.parsed_at,
        parseVersion: r.parse_version,
        triggerMode: r.trigger_mode,
        scrollDepth: r.scroll_depth,
        extensionVersion: r.extension_version,
        createdAt: r.created_at,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list captures', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { captureId } = body;

    if (!captureId || typeof captureId !== 'string') {
      return NextResponse.json(
        { error: 'captureId is required' },
        { status: 400 }
      );
    }

    const result = await parseCachedPage(captureId);

    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      { error: 'Parse failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
