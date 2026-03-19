// GET /api/outreach/templates - list templates
// POST /api/outreach/templates - create template

import { NextRequest, NextResponse } from 'next/server';
import { listTemplates, createTemplate } from '@/lib/db/queries/outreach';

const VALID_CATEGORIES = [
  'initial_outreach', 'follow_up', 'meeting_request',
  'referral_ask', 'content_share', 'custom',
];

export async function GET() {
  try {
    const templates = await listTemplates();
    return NextResponse.json({ data: templates });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list templates', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!body.body_template || typeof body.body_template !== 'string') {
      return NextResponse.json({ error: 'body_template is required' }, { status: 400 });
    }

    const category = body.category || 'custom';
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }

    const template = await createTemplate({
      name: body.name,
      category,
      subject_template: body.subject_template,
      body_template: body.body_template,
      merge_variables: body.merge_variables,
      tone: body.tone,
    });

    return NextResponse.json({ data: template }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create template', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
