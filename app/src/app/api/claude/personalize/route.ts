// POST /api/claude/personalize - Personalize a template for a contact

import { NextRequest, NextResponse } from 'next/server';
import { getContactById } from '@/lib/db/queries/contacts';
import { getTemplate } from '@/lib/db/queries/outreach';
import { personalizeTemplate } from '@/lib/claude/analyze';
import { requireVisibilityPrincipal } from '@/lib/auth/extension-visibility-boundary';
import { query } from '@/lib/db/client';

function profileCandidates(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname)
      || !/^\/in\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
    const path = url.pathname.replace(/\/$/, '');
    return ['linkedin.com', 'www.linkedin.com']
      .flatMap((host) => [`https://${host}${path}`, `https://${host}${path}/`]);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireVisibilityPrincipal(request, true);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { templateId, contactId, contactUrl } = body as {
      templateId?: unknown;
      contactId?: unknown;
      contactUrl?: unknown;
    };

    if (typeof templateId !== 'string' || !templateId
      || (typeof contactId !== 'string' && contactUrl === undefined)) {
      return NextResponse.json(
        { error: 'templateId and contactId or contactUrl required' },
        { status: 400 }
      );
    }

    let resolvedContactId = contactId;
    if (contactUrl !== undefined) {
      const candidates = profileCandidates(contactUrl);
      if (!candidates) return NextResponse.json({ error: 'Invalid contactUrl' }, { status: 400 });
      const matches = await query<{ id: string }>(
        `SELECT id FROM contacts
         WHERE split_part(split_part(linkedin_url, '?', 1), '#', 1) = ANY($1::text[])
         LIMIT 2`,
        [candidates]
      );
      if (matches.rows.length === 0) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
      if (matches.rows.length > 1) {
        return NextResponse.json({ error: 'Ambiguous contact URL' }, { status: 409 });
      }
      resolvedContactId = matches.rows[0].id;
    }

    const [template, contact] = await Promise.all([
      getTemplate(templateId),
      getContactById(resolvedContactId as string),
    ]);

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 404 }
      );
    }

    const result = await personalizeTemplate(
      template.body_template,
      contact,
      {
        subject: template.subject_template ?? undefined,
        tone: template.tone ?? undefined,
      }
    );

    return NextResponse.json({
      data: {
        personalizedContent: result.personalizedContent,
        mergeFields: result.mergeFields,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to personalize template',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
