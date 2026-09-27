// POST /api/extension/snippet
//
// Snippet save endpoint. Phase 1 Track C shipped text-only; Phase 1.5 extends
// it to accept an image snippet with `kind='image'` + base64 `imageBytes`.
// The body is a discriminated union on `kind` — legacy Phase 1 bundles that
// omit `kind` are treated as text-kind (back-compat for the shipped Phase 1
// extension).
//
// Gated on `RESEARCH_FLAGS.snippets`. When the flag is off the route returns
// 404 so the extension widget treats the endpoint as absent.

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { transactionWithQueryContext } from '@/lib/db/client';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { getDefaultTenantId } from '@/lib/snippets/tenant';
import { saveTextSnippet, saveImageSnippet } from '@/lib/snippets/service';
import { saveLinkSnippet } from '@/lib/snippets/service-link';
import {
  decodeAndValidateImage,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
} from '@/lib/snippets/blob-store';
import type { SnippetSaveRequest, SnippetSaveResponse } from '@/lib/snippets/types';

type SaveResponse = { success: true } & SnippetSaveResponse;
type Receipt = {
  tenant_id: string;
  target_kind: string;
  target_id: string;
  request_hash: string;
  response: SaveResponse;
};

async function saveSnippet(body: SnippetSaveRequest, tenantId: string, imageBytes?: Buffer): Promise<SaveResponse> {
  if (body.kind === 'image') {
    const result = await saveImageSnippet({
      tenantId, targetKind: body.targetKind, targetId: body.targetId,
      bytes: imageBytes!, mimeType: body.mimeType, width: body.width ?? null,
      height: body.height ?? null, sourceUrl: body.sourceUrl, pageType: body.pageType,
      tagSlugs: body.tagSlugs, note: body.note, sessionId: body.sessionId,
    });
    return { success: true, ...result };
  }
  if (body.kind === 'link') {
    const result = await saveLinkSnippet({
      tenantId, targetKind: body.targetKind, targetId: body.targetId, href: body.href,
      linkText: body.linkText, sourceUrl: body.sourceUrl, pageType: body.pageType,
      tagSlugs: body.tagSlugs, note: body.note, sessionId: body.sessionId,
    });
    return { success: true, ...result };
  }
  const result = await saveTextSnippet({
    tenantId, targetKind: body.targetKind, targetId: body.targetId, text: body.text,
    sourceUrl: body.sourceUrl, pageType: body.pageType, tagSlugs: body.tagSlugs,
    note: body.note, mentionContactIds: body.mentionContactIds, sessionId: body.sessionId,
  });
  return { success: true, ...result };
}

async function saveSnippetOnce(extensionId: string, tenantId: string, body: SnippetSaveRequest, imageBytes?: Buffer): Promise<SaveResponse | null> {
  if (!body.requestId) return saveSnippet(body, tenantId, imageBytes); // Shipped legacy clients.
  const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return transactionWithQueryContext(async (client) => {
    // The unique insert waits for any in-flight request with this key. All
    // snippet graph writes use this transaction through the query context.
    const claim = await client.query(
      `INSERT INTO extension_snippet_receipts
       (extension_id, request_id, tenant_id, target_kind, target_id, request_hash, response)
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)
       ON CONFLICT (request_id) DO NOTHING RETURNING request_id`,
      [extensionId, body.requestId, tenantId, body.targetKind, body.targetId, requestHash]
    );
    if (claim.rowCount === 0) {
      const existing = await client.query<Receipt>(
        `SELECT tenant_id, target_kind, target_id, request_hash, response
         FROM extension_snippet_receipts WHERE request_id = $1`,
        [body.requestId]
      );
      const receipt = existing.rows[0];
      if (!receipt || receipt.tenant_id !== tenantId || receipt.target_kind !== body.targetKind ||
          receipt.target_id !== body.targetId || receipt.request_hash !== requestHash) return null;
      return receipt.response;
    }
    const response = await saveSnippet(body, tenantId, imageBytes);
    await client.query(
      `UPDATE extension_snippet_receipts SET response = $3::jsonb
       WHERE extension_id = $1 AND request_id = $2`,
      [extensionId, body.requestId, JSON.stringify(response)]
    );
    return response;
  });
}

export async function POST(req: NextRequest) {
  if (!RESEARCH_FLAGS.snippets) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  return withExtensionAuth(req, async (_req, extensionId) => {
    let body: SnippetSaveRequest;
    try {
      body = (await req.json()) as SnippetSaveRequest;
    } catch {
      return NextResponse.json(
        { error: 'INVALID_JSON', message: 'Body must be valid JSON' },
        { status: 400 }
      );
    }

    const validation = validateSnippetBody(body);
    if (!validation.ok) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: validation.message },
        { status: 400 }
      );
    }

    try {
      const tenantId = await getDefaultTenantId();
      const expectedTenant = req.headers?.get?.('x-snippet-tenant-id');
      if (expectedTenant && expectedTenant !== tenantId) {
        return NextResponse.json({ error: 'SNIPPET_TENANT_CHANGED' }, { status: 409 });
      }
      let imageBytes: Buffer | undefined;
      if (body.kind === 'image') {
        // Decode + validate size and mime type. The validator throws with a
        // user-facing message we propagate as a 400.
        try {
          imageBytes = decodeAndValidateImage(body.imageBytes, body.mimeType);
        } catch (err) {
          return NextResponse.json(
            {
              error: 'VALIDATION_ERROR',
              message: (err as Error).message,
            },
            { status: 400 }
          );
        }
      }
      const response = await saveSnippetOnce(extensionId, tenantId, body, imageBytes);
      return response
        ? NextResponse.json(response)
        : NextResponse.json({ error: 'SNIPPET_REQUEST_ID_CONFLICT' }, { status: 409 });
    } catch (err) {
      console.error('[Snippet] save failed:', err);
      return NextResponse.json(
        { error: 'INTERNAL_ERROR', message: (err as Error).message },
        { status: 500 }
      );
    }
  });
}

export async function GET(req: NextRequest) {
  if (!RESEARCH_FLAGS.snippets) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return withExtensionAuth(req, async () => {
    try {
      return NextResponse.json({ tenantId: await getDefaultTenantId() });
    } catch {
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    }
  });
}

function validateSnippetBody(
  body: unknown
): { ok: true } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'Body must be an object' };
  }
  const b = body as Record<string, unknown>;

  if (b.requestId !== undefined && (typeof b.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId))) {
    return { ok: false, message: 'requestId must be a UUID' };
  }

  // Common fields.
  if (b.targetKind !== 'self' && b.targetKind !== 'contact' && b.targetKind !== 'company') {
    return { ok: false, message: 'targetKind must be one of self | contact | company' };
  }
  if (typeof b.targetId !== 'string' || b.targetId.length === 0) {
    return { ok: false, message: 'targetId must be a non-empty string' };
  }
  if (typeof b.sourceUrl !== 'string' || !/^https?:\/\//.test(b.sourceUrl)) {
    return { ok: false, message: 'sourceUrl must be an http(s) URL' };
  }
  if (b.tagSlugs !== undefined && !Array.isArray(b.tagSlugs)) {
    return { ok: false, message: 'tagSlugs must be an array of strings' };
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') {
    return { ok: false, message: 'note must be a string or null' };
  }

  const kind = b.kind === undefined ? 'text' : b.kind;

  if (kind === 'image') {
    if (typeof b.imageBytes !== 'string' || b.imageBytes.length === 0) {
      return { ok: false, message: 'imageBytes must be a non-empty base64 string' };
    }
    // 5 MB base64 ≈ 6.67 MB string length. Reject very large strings early
    // rather than decoding first — saves CPU on the obvious-fail case.
    if (b.imageBytes.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 256) {
      return { ok: false, message: 'imageBytes exceeds 5 MB size limit' };
    }
    if (typeof b.mimeType !== 'string' || !ALLOWED_IMAGE_MIME_TYPES.has(b.mimeType)) {
      return {
        ok: false,
        message: `mimeType must be one of ${Array.from(ALLOWED_IMAGE_MIME_TYPES).join(', ')}`,
      };
    }
    if (b.width !== undefined && (typeof b.width !== 'number' || !Number.isFinite(b.width))) {
      return { ok: false, message: 'width must be a finite number' };
    }
    if (b.height !== undefined && (typeof b.height !== 'number' || !Number.isFinite(b.height))) {
      return { ok: false, message: 'height must be a finite number' };
    }
    return { ok: true };
  }

  if (kind === 'link') {
    if (typeof b.href !== 'string' || b.href.trim().length === 0) {
      return { ok: false, message: 'href must be a non-empty string' };
    }
    if (!/^https?:\/\//i.test(b.href)) {
      return { ok: false, message: 'href must be an http(s) URL' };
    }
    if (b.href.length > 2048) {
      return { ok: false, message: 'href exceeds 2048-char limit' };
    }
    if (b.linkText !== undefined && typeof b.linkText !== 'string') {
      return { ok: false, message: 'linkText must be a string when provided' };
    }
    return { ok: true };
  }

  if (kind !== 'text') {
    return { ok: false, message: 'kind must be one of text | image | link' };
  }

  // Text-kind validation (legacy shape).
  if (typeof b.text !== 'string' || b.text.trim().length === 0) {
    return { ok: false, message: 'text must be a non-empty string' };
  }
  if (b.text.length > 20000) {
    return { ok: false, message: 'text exceeds 20,000 character limit' };
  }
  if (b.mentionContactIds !== undefined && !Array.isArray(b.mentionContactIds)) {
    return { ok: false, message: 'mentionContactIds must be an array of strings' };
  }
  return { ok: true };
}
