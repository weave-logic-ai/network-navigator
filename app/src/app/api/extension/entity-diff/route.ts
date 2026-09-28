// GET /api/extension/entity-diff?kind=&id=&sinceCaptureId=
//
// WS-2 Phase 2 Track D. Per `08-phased-delivery.md` §4.1:
//   "For each captured entity, shows what changed vs the previous capture of
//    the same entity. Projections: added fields (green), changed (old → new),
//    disappeared (strike-through). Uses a new GET /api/extension/entity-diff
//    endpoint that assembles a canonical projection per entity type and
//    diffs."
//
// Gated on RESEARCH_FLAGS.parserTelemetry (same gate as the rest of WS-2
// visibility). Returns 404 when the flag is off so the sidebar degrades
// cleanly instead of crashing on a partial response.

import { NextResponse, type NextRequest } from 'next/server';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import {
  loadContactProjection,
  loadContactProjectionFromCapture,
} from '@/lib/projections/contact';
import {
  loadCompanyProjection,
  loadCompanyProjectionFromCapture,
} from '@/lib/projections/company';
import { buildProjectionDiff } from '@/lib/projections/diff';
import type { EntityKind } from '@/lib/projections/types';
import { query } from '@/lib/db/client';
import { requireVisibilityPrincipal } from '@/lib/auth/extension-visibility-boundary';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isEntityKind(s: string | null): s is EntityKind {
  return s === 'contact' || s === 'company';
}

export async function GET(request: NextRequest) {
  const denied = await requireVisibilityPrincipal(request);
  if (denied) return denied;
  if (!RESEARCH_FLAGS.parserTelemetry) {
    return NextResponse.json(
      { error: 'RESEARCH_PARSER_TELEMETRY is off' },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind');
  const id = searchParams.get('id');
  const sinceCaptureIdParam = searchParams.get('sinceCaptureId');

  if (!isEntityKind(kind)) {
    return NextResponse.json(
      { error: "kind must be 'contact' or 'company'" },
      { status: 400 }
    );
  }
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 });
  }
  if (sinceCaptureIdParam && !UUID_RE.test(sinceCaptureIdParam)) {
    return NextResponse.json(
      { error: 'sinceCaptureId must be a UUID when provided' },
      { status: 400 }
    );
  }

  // "After" = current projection of the entity.
  const after =
    kind === 'contact'
      ? await loadContactProjection(id)
      : await loadCompanyProjection(id);

  if (!after) {
    return NextResponse.json({ error: 'entity not found' }, { status: 404 });
  }

  // Resolve sinceCaptureId. If the caller did not provide one, look up the
  // most recent *previous* capture against the same URL (prior to the latest
  // one). When no prior capture exists, the diff reports everything as the
  // first capture — `before = null` and all current fields become "added".
  let sinceCaptureId: string | null = sinceCaptureIdParam;
  if (!sinceCaptureId) {
    try {
      const table = kind === 'contact' ? 'contacts' : 'companies';
      const col = 'linkedin_url';
      const r = await query<{ id: string }>(
        `SELECT pc.id
         FROM page_cache pc
         JOIN ${table} e ON pc.url LIKE '%' || COALESCE(e.${col}, '__never__') || '%'
         WHERE e.id = $1
         ORDER BY pc.created_at DESC
         OFFSET 1 LIMIT 1`,
        [id]
      );
      sinceCaptureId = r.rows[0]?.id ?? null;
    } catch {
      sinceCaptureId = null;
    }
  }

  const before =
    sinceCaptureId === null
      ? null
      : kind === 'contact'
      ? await loadContactProjectionFromCapture(sinceCaptureId)
      : await loadCompanyProjectionFromCapture(sinceCaptureId);

  // Find the *latest* capture id (the "to" side of the diff). We take the
  // most-recent page_cache for this entity. When we can't resolve one we
  // use the string "current" — the sidebar treats that as "today".
  let toCaptureId = 'current';
  try {
    const table = kind === 'contact' ? 'contacts' : 'companies';
    const r = await query<{ id: string }>(
      `SELECT pc.id FROM page_cache pc
       JOIN ${table} e ON pc.url LIKE '%' || COALESCE(e.linkedin_url, '__never__') || '%'
       WHERE e.id = $1
       ORDER BY pc.created_at DESC
       LIMIT 1`,
      [id]
    );
    toCaptureId = r.rows[0]?.id ?? 'current';
  } catch {
    // leave toCaptureId as 'current'
  }

  // TypeScript can't narrow a union based on `kind` across separate calls
  // without a helper; build the diff with a cast that's safe because the
  // `before` and `after` were both loaded via the same kind-guarded branch.
  const diff =
    kind === 'contact'
      ? buildProjectionDiff({
          entityKind: 'contact',
          entityId: id,
          fromCaptureId: sinceCaptureId,
          toCaptureId,
          before: before as import('@/lib/projections/types').ContactProjection | null,
          after: after as import('@/lib/projections/types').ContactProjection,
        })
      : buildProjectionDiff({
          entityKind: 'company',
          entityId: id,
          fromCaptureId: sinceCaptureId,
          toCaptureId,
          before: before as import('@/lib/projections/types').CompanyProjection | null,
          after: after as import('@/lib/projections/types').CompanyProjection,
        });

  return NextResponse.json(diff);
}
