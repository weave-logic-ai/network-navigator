// DELETE /api/extension/captures/:id - Delete a captured page

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid capture ID' }, { status: 400 });
  }

  try {
    const result = await query(
      'DELETE FROM page_cache WHERE id = $1',
      [id]
    );

    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Capture not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete capture', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
