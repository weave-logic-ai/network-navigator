// POST /api/enrichment/estimate - Estimate enrichment cost

import { NextRequest, NextResponse } from 'next/server';
import { createEnrichmentQuote } from '@/lib/enrichment/quote';
import { getContactById } from '@/lib/db/queries/contacts';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const { contactIds, targetFields } = body as { contactIds: string[]; targetFields?: string[] };

    if (!Array.isArray(contactIds) || contactIds.length === 0 || contactIds.length > 500
      || new Set(contactIds).size !== contactIds.length
      || contactIds.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
      || (targetFields !== undefined && (!Array.isArray(targetFields)
        || targetFields.some(field => typeof field !== 'string' || field.length > 64)))) {
      return NextResponse.json(
        { error: 'contactIds required' },
        { status: 400 }
      );
    }

    const contacts = [];
    for (const id of contactIds) {
      const contact = await getContactById(id);
      if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
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

    const estimate = await createEnrichmentQuote(contacts, targetFields);
    return NextResponse.json({ data: estimate });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to estimate cost', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
