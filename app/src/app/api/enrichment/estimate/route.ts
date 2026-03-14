// POST /api/enrichment/estimate - Estimate enrichment cost

import { NextRequest, NextResponse } from 'next/server';
import { estimateEnrichmentCost } from '@/lib/enrichment/waterfall';
import { getContactById } from '@/lib/db/queries/contacts';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactIds } = body as { contactIds: string[] };

    if (!contactIds || contactIds.length === 0) {
      return NextResponse.json(
        { error: 'contactIds required' },
        { status: 400 }
      );
    }

    const contacts = [];
    for (const id of contactIds) {
      const contact = await getContactById(id);
      if (contact) {
        contacts.push({
          id: contact.id,
          linkedinUrl: contact.linkedin_url,
          firstName: contact.first_name,
          lastName: contact.last_name,
          fullName: contact.full_name,
          email: contact.email,
          currentCompany: contact.current_company,
          title: contact.title,
        });
      }
    }

    const estimate = await estimateEnrichmentCost(contacts);
    return NextResponse.json({ data: estimate });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to estimate cost', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
