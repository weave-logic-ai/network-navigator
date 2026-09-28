// Preview and enroll a bounded audience in a draft campaign. No messages are sent.
import { NextRequest, NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db/client';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };
type Audience = { tier: string | null; limit: number };

function audience(request: NextRequest): Audience | null {
  const tier = request.nextUrl.searchParams.get('tier');
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  if (tier && !['gold', 'silver', 'bronze', 'watch'].includes(tier)) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return null;
  return { tier, limit };
}

const MATCHES = `SELECT c.id, c.full_name, cs.tier FROM contacts c
  JOIN contact_scores cs ON cs.contact_id = c.id
  WHERE c.is_archived = FALSE AND c.degree > 0
    AND ($2::text IS NULL OR cs.tier = $2)
    AND NOT EXISTS (SELECT 1 FROM outreach_states os
      WHERE os.contact_id = c.id AND os.campaign_id = $1)
  ORDER BY cs.composite_score DESC NULLS LAST, c.id LIMIT $3`;

class AudienceConflict extends Error {}

async function handle(request: NextRequest, context: Context, enroll: boolean) {
  const denied = await requireLocalDashboardRequest(request, enroll);
  if (denied) return denied;
  const { id } = await context.params;
  const selection = audience(request);
  if (!UUID.test(id) || !selection) return NextResponse.json({ error: 'Invalid audience request' }, { status: 400 });
  try {
    if (!enroll) {
      const campaign = await query<{ status: string }>('SELECT status FROM outreach_campaigns WHERE id = $1', [id]);
      if (!campaign.rows[0]) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
      const matches = await query<{ id: string; full_name: string | null; tier: string }>(MATCHES, [id, selection.tier, selection.limit]);
      return NextResponse.json({ data: matches.rows, count: matches.rows.length, limit: selection.limit });
    }
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const ids = typeof body === 'object' && body !== null && 'contact_ids' in body
      ? (body as { contact_ids: unknown }).contact_ids : undefined;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > selection.limit ||
        !ids.every((value): value is string => typeof value === 'string' && UUID.test(value)) ||
        new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: 'Valid preview contact_ids are required' }, { status: 400 });
    }
    const result = await transaction(async client => {
      const campaign = await client.query<{ status: string }>('SELECT status FROM outreach_campaigns WHERE id = $1 FOR UPDATE', [id]);
      if (!campaign.rows[0]) return null;
      if (campaign.rows[0].status !== 'draft') return 'not_draft';
      const matches = await client.query<{ id: string }>(MATCHES, [id, selection.tier, selection.limit]);
      // A preview is an exact, ordered set. A changed score, archive status,
      // enrollment, or newly ranked contact requires a fresh review.
      if (matches.rows.length !== ids.length ||
          matches.rows.some((row, index) => row.id !== ids[index])) return 'changed';
      let added = 0;
      for (const contactId of ids) {
        const inserted = await client.query(
          `INSERT INTO outreach_states (contact_id, campaign_id, state)
           VALUES ($1, $2, 'queued') ON CONFLICT (contact_id, campaign_id) DO NOTHING`,
          [contactId, id]);
        added += inserted.rowCount ?? 0;
      }
      // A concurrent winner may appear after the preview comparison. Throw
      // inside the transaction so even earlier successful inserts roll back.
      if (added !== ids.length) throw new AudienceConflict();
      return added;
    });
    if (result === null) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    if (result === 'not_draft') return NextResponse.json({ error: 'Only draft campaigns can enroll contacts' }, { status: 409 });
    if (result === 'changed') return NextResponse.json({ error: 'Audience changed. Preview again before enrolling.' }, { status: 409 });
    return NextResponse.json({ added: result });
  } catch (error) {
    if (error instanceof AudienceConflict) {
      return NextResponse.json({ error: 'Audience changed. Preview again before enrolling.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Audience operation failed' }, { status: 500 });
  }
}

export const GET = (request: NextRequest, context: Context) => handle(request, context, false);
export const POST = (request: NextRequest, context: Context) => handle(request, context, true);
