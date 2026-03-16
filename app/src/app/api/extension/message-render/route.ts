// POST /api/extension/message-render
// Render a message template with contact data for clipboard copy

import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { query } from '@/lib/db/client';

interface MessageRenderRequest {
  contactUrl: string;
  templateId?: string;
  templateType?: 'initial' | 'followup' | 'meeting_request';
}

// Simple template variable substitution
function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return rendered;
}

// Default templates (Phase 5 will have a full template engine)
const DEFAULT_TEMPLATES: Record<
  string,
  { id: string; name: string; body: string }
> = {
  initial: {
    id: 'default-initial',
    name: 'Initial Outreach',
    body: 'Hi {{name}}, I noticed your work as {{headline}} and would love to connect. I think there could be some great synergies between what we do.',
  },
  followup: {
    id: 'default-followup',
    name: 'Follow Up',
    body: 'Hi {{name}}, I wanted to follow up on my earlier message. Would you be open to a brief conversation about how we might collaborate?',
  },
  meeting_request: {
    id: 'default-meeting',
    name: 'Meeting Request',
    body: 'Hi {{name}}, I have been following your work at {{company}} and would love to schedule a brief call. Would you have 15 minutes this week?',
  },
};

export async function POST(req: NextRequest) {
  return withExtensionAuth(req, async () => {
    try {
      const body = (await req.json()) as MessageRenderRequest;

      if (!body.contactUrl) {
        return NextResponse.json(
          {
            error: 'VALIDATION_ERROR',
            message: 'contactUrl is required',
          },
          { status: 400 }
        );
      }

      // Normalize URL for lookup
      const urlForLookup = body.contactUrl
        .replace('https://', '')
        .replace('http://', '')
        .replace(/\/$/, '');

      // Lookup contact
      const contactResult = await query<{
        id: string;
        full_name: string;
        headline: string | null;
        company: string | null;
      }>(
        `SELECT c.id, c.full_name, c.headline, c.company
         FROM contacts c
         WHERE c.linkedin_url LIKE $1
         LIMIT 1`,
        [`%${urlForLookup}%`]
      );

      if (contactResult.rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'NOT_FOUND', message: 'Contact not found' },
          { status: 404 }
        );
      }

      const contact = contactResult.rows[0];

      // Select template
      const templateType = body.templateType ?? 'initial';
      if (body.templateId) {
        // Look for specific template in DB
        const templateResult = await query<{
          id: string;
          name: string;
          body: string;
        }>(
          'SELECT id, name, body FROM outreach_templates WHERE id = $1',
          [body.templateId]
        );
        if (templateResult.rows.length > 0) {
          const dbTemplate = templateResult.rows[0];
          const variables: Record<string, string> = {
            name: contact.full_name.split(' ')[0],
            fullName: contact.full_name,
            headline: contact.headline ?? '',
            company: contact.company ?? '',
          };

          return NextResponse.json({
            success: true,
            message: renderTemplate(dbTemplate.body, variables),
            templateId: dbTemplate.id,
            templateName: dbTemplate.name,
            variables,
            nextTemplateId: null,
          });
        }
      }

      // Use default template
      const template =
        DEFAULT_TEMPLATES[templateType] ?? DEFAULT_TEMPLATES.initial;
      const variables: Record<string, string> = {
        name: contact.full_name.split(' ')[0],
        fullName: contact.full_name,
        headline: contact.headline ?? '',
        company: contact.company ?? '',
      };

      // Determine next template in sequence
      const templateOrder = ['initial', 'followup', 'meeting_request'];
      const currentIdx = templateOrder.indexOf(templateType);
      const nextType =
        currentIdx < templateOrder.length - 1
          ? templateOrder[currentIdx + 1]
          : null;

      return NextResponse.json({
        success: true,
        message: renderTemplate(template.body, variables),
        templateId: template.id,
        templateName: template.name,
        variables,
        nextTemplateId: nextType
          ? DEFAULT_TEMPLATES[nextType]?.id ?? null
          : null,
      });
    } catch (error) {
      console.error('[MessageRender] Error:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'INTERNAL_ERROR',
          message: 'Failed to render message',
        },
        { status: 500 }
      );
    }
  });
}
