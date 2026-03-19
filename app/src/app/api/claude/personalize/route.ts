// POST /api/claude/personalize - Personalize a template for a contact

import { NextRequest, NextResponse } from 'next/server';
import { getContactById } from '@/lib/db/queries/contacts';
import { getTemplate } from '@/lib/db/queries/outreach';
import { personalizeTemplate } from '@/lib/claude/analyze';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { templateId, contactId } = body as {
      templateId: string;
      contactId: string;
    };

    if (!templateId || !contactId) {
      return NextResponse.json(
        { error: 'templateId and contactId required' },
        { status: 400 }
      );
    }

    const [template, contact] = await Promise.all([
      getTemplate(templateId),
      getContactById(contactId),
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
