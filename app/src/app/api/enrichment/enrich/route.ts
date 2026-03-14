// POST /api/enrichment/enrich - Enrich contact(s)

import { NextRequest, NextResponse } from 'next/server';
import { enrichContact } from '@/lib/enrichment/waterfall';
import { getContactById } from '@/lib/db/queries/contacts';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactId, contactIds, targetFields, budgetLimitCents } = body as {
      contactId?: string;
      contactIds?: string[];
      targetFields?: string[];
      budgetLimitCents?: number;
    };

    const ids = contactId ? [contactId] : contactIds || [];
    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'contactId or contactIds required' },
        { status: 400 }
      );
    }

    const allResults = [];

    for (const id of ids) {
      const contact = await getContactById(id);
      if (!contact) continue;

      const enrichmentContact = {
        id: contact.id,
        linkedinUrl: contact.linkedin_url,
        firstName: contact.first_name,
        lastName: contact.last_name,
        fullName: contact.full_name,
        email: contact.email,
        currentCompany: contact.current_company,
        title: contact.title,
      };

      const results = await enrichContact(enrichmentContact, {
        targetFields,
        budgetLimitCents,
      });

      allResults.push({
        contactId: id,
        results,
      });
    }

    return NextResponse.json({ data: allResults });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to enrich contact(s)', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
