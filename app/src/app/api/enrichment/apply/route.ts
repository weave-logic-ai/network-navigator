// POST /api/enrichment/apply - Apply user-reviewed enrichment fields to a contact

import { NextRequest, NextResponse } from 'next/server';
import { getContactById, updateContact } from '@/lib/db/queries/contacts';
import { FIELD_TO_COLUMN } from '@/lib/enrichment/field-map';

interface ApplyField {
  field: string;
  value: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactId, fields } = body as {
      contactId: string;
      fields: ApplyField[];
    };

    if (!contactId || !fields || fields.length === 0) {
      return NextResponse.json(
        { error: 'contactId and fields[] required' },
        { status: 400 }
      );
    }

    const contact = await getContactById(contactId);
    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {};
    const applied: string[] = [];

    for (const { field, value } of fields) {
      const column = FIELD_TO_COLUMN[field];
      if (!column) continue;
      if (!value && value !== '') continue;

      if (field === 'tags') {
        const newTags = value.split(',').map(t => t.trim()).filter(Boolean);
        updates['tags'] = newTags;
      } else if (field === 'connections_count') {
        updates[column] = parseInt(value, 10) || null;
      } else {
        updates[column] = value;
      }
      applied.push(field);
    }

    if (Object.keys(updates).length > 0) {
      await updateContact(contactId, updates);
    }

    return NextResponse.json({
      data: {
        contactId,
        fieldsApplied: applied.length,
        appliedFields: applied,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to apply enrichment', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
