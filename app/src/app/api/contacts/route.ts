// GET /api/contacts - list contacts with pagination/filtering
// POST /api/contacts - create a new contact

import { NextRequest, NextResponse } from 'next/server';
import { listContacts, createContact } from '@/lib/db/queries/contacts';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const sort = searchParams.get('sort') || 'created_at';
    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
    const tier = searchParams.get('tier') || undefined;
    const company = searchParams.get('company') || undefined;
    const search = searchParams.get('search') || undefined;
    const tagsParam = searchParams.get('tags');
    const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()) : undefined;

    const result = await listContacts({
      page,
      limit,
      sort,
      order: order as 'asc' | 'desc',
      tier,
      company,
      tags,
      search,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list contacts', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.linkedin_url || typeof body.linkedin_url !== 'string') {
      return NextResponse.json(
        { error: 'linkedin_url is required and must be a string' },
        { status: 400 }
      );
    }

    // Sanitize: only allow known fields
    const allowedFields = [
      'linkedin_url', 'first_name', 'last_name', 'full_name', 'headline',
      'title', 'current_company', 'current_company_id', 'location', 'about',
      'email', 'phone', 'tags',
    ];
    const sanitized: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        sanitized[field] = body[field];
      }
    }

    const contact = await createContact(sanitized as Parameters<typeof createContact>[0]);

    return NextResponse.json({ data: contact }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('unique')) {
      return NextResponse.json(
        { error: 'Contact with this LinkedIn URL already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to create contact', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
