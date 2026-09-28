// GET /api/contacts/:id - get single contact
// PATCH /api/contacts/:id - update contact
// DELETE /api/contacts/:id - delete contact

import { NextRequest, NextResponse } from 'next/server';
import { getContactById, updateContact, deleteContact } from '@/lib/db/queries/contacts';
import { hasLinkedIdentity } from '@/lib/contacts/identity';

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateUuid(id)) {
    return NextResponse.json({ error: 'Invalid contact ID format' }, { status: 400 });
  }

  try {
    const contact = await getContactById(id);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json({ data: snakeToCamel(contact as unknown as Record<string, unknown>) });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get contact', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateUuid(id)) {
    return NextResponse.json({ error: 'Invalid contact ID format' }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Reject unknown fields
    const allowedFields = [
      'first_name', 'last_name', 'full_name', 'headline', 'title',
      'current_company', 'current_company_id', 'location', 'about',
      'email', 'phone', 'tags', 'notes', 'is_archived', 'linkedin_url',
    ];

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields.includes(key)) {
        sanitized[key] = value;
      }
    }

    if ('linkedin_url' in sanitized &&
      (typeof sanitized.linkedin_url !== 'string' ||
        !hasLinkedIdentity({ fullName: 'Verified Contact', linkedinUrl: sanitized.linkedin_url }))) {
      return NextResponse.json({ error: 'Enter a valid LinkedIn profile URL' }, { status: 400 });
    }

    const contact = await updateContact(id, sanitized);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json({ data: snakeToCamel(contact as unknown as Record<string, unknown>) });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'LinkedIn profile URL already belongs to another contact' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Failed to update contact', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateUuid(id)) {
    return NextResponse.json({ error: 'Invalid contact ID format' }, { status: 400 });
  }

  try {
    const deleted = await deleteContact(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete contact', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
