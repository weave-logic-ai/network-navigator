// GET /api/extension/contact/:url
// Lookup contact by LinkedIn profile URL
// URL passed as catch-all: /api/extension/contact/https/www.linkedin.com/in/username

import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { query } from '@/lib/db/client';

/**
 * Normalize a LinkedIn URL for consistent matching.
 * Strips tracking params, ensures consistent format.
 */
function normalizeLinkedInUrl(urlParts: string[]): string {
  // Reconstruct URL from catch-all segments
  let url = urlParts.join('/');

  // Ensure it starts with https://
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }

  try {
    const parsed = new URL(url);
    // Remove tracking/query params
    parsed.search = '';
    parsed.hash = '';
    // Normalize to linkedin.com (not www.)
    let normalized = parsed.toString();
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    return normalized;
  } catch {
    return url;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ url: string[] }> }
) {
  return withExtensionAuth(req, async (_authReq, _extensionId) => {
    try {
      const { url: urlParts } = await params;

      if (!urlParts || urlParts.length === 0) {
        return NextResponse.json(
          { error: 'VALIDATION_ERROR', message: 'URL parameter is required' },
          { status: 400 }
        );
      }

      const normalizedUrl = normalizeLinkedInUrl(urlParts);

      // Look up contact by LinkedIn URL
      const result = await query<{
        id: string;
        full_name: string;
        headline: string | null;
        linkedin_url: string | null;
      }>(
        `SELECT c.id, c.full_name, c.headline, c.linkedin_url
         FROM contacts c
         WHERE c.linkedin_url LIKE $1
         LIMIT 1`,
        [`%${normalizedUrl.replace('https://', '').replace('http://', '')}%`]
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ found: false, contact: null });
      }

      const contact = result.rows[0];

      // Get score
      const scoreResult = await query<{
        composite_score: number;
        tier: string;
      }>(
        `SELECT composite_score, tier FROM contact_scores
         WHERE contact_id = $1
         ORDER BY scored_at DESC LIMIT 1`,
        [contact.id]
      );

      // Get pending task count
      const taskResult = await query<{ count: string }>(
        `SELECT count(*) FROM tasks
         WHERE contact_id = $1 AND status IN ('pending', 'in_progress')`,
        [contact.id]
      );

      // Get last capture timestamp
      const cacheResult = await query<{ created_at: string }>(
        `SELECT created_at FROM page_cache
         WHERE url LIKE $1
         ORDER BY created_at DESC LIMIT 1`,
        [`%${normalizedUrl.replace('https://', '').replace('http://', '')}%`]
      );

      const score = scoreResult.rows[0];
      const tasksPending = parseInt(taskResult.rows[0]?.count ?? '0', 10);
      const lastCapturedAt = cacheResult.rows[0]?.created_at ?? null;

      return NextResponse.json({
        found: true,
        contact: {
          id: contact.id,
          name: contact.full_name,
          headline: contact.headline ?? '',
          tier: score?.tier ?? 'unscored',
          goldScore: score?.composite_score ?? 0,
          lastCapturedAt,
          lastEnrichedAt: null,
          tasksPending,
        },
      });
    } catch (error) {
      console.error('[Contact Lookup] Error:', error);
      return NextResponse.json(
        { error: 'INTERNAL_ERROR', message: 'Failed to look up contact' },
        { status: 500 }
      );
    }
  });
}
