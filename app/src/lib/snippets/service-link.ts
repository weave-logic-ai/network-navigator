// Link snippet service — Phase 1.5 WS-3 closure.
//
// Round-trip for `kind='link'` snippets:
//   1. Run the `href` through `gatedFetch` (shared with WS-5 connectors —
//      rate-limited, robots-respecting, timeout + size capped).
//   2. On success, call `writeSourceRecord` with source_type='link' so the
//      bytes are persisted in `source_records` with a per-tenant dedup key.
//   3. Insert a `causal_nodes` row (entity_type='snippet', operation='captured')
//      whose `output.content` references the resulting `source_records.id`.
//   4. Chain append onto snippet:<kind>:<target_id> (best-effort, non-fatal).
//
// If the fetch fails we still persist the snippet so the user never loses the
// capture; `sourceRecordId` is null and a warning surfaces. This mirrors the
// "source of truth is causal_nodes" invariant from `03-snippet-editor.md` §8.1.
//
// Scope: This module deliberately does NOT perform content-type sniffing or
// HTML-body parsing. That belongs in WS-5 follow-up work. Here we just want
// the bytes captured plus a link between the snippet and the record.

import crypto from 'crypto';
import { query, withQuerySavepoint } from '../db/client';
import { createCausalNode, createCausalEdge } from '../ecc/causal-graph/service';
import { appendChainEntry } from '../ecc/exo-chain/service';
import {
  gatedFetch,
  writeSourceRecord,
  SourceFetchError,
} from '../sources/service';
import { canonicalizeUrl, hostOf } from '../sources/url-normalize';
import { snippetChainId, type SnippetTargetKind } from './chain';
import { filterKnownTagSlugs, resolveTargetNodeId } from './service';
import type { SnippetSaveResponse } from './types';

export interface SaveLinkSnippetInput {
  tenantId: string;
  targetKind: SnippetTargetKind;
  targetId: string;
  href: string;
  linkText?: string;
  sourceUrl: string;
  pageType?: string;
  tagSlugs?: string[];
  note?: string;
  sessionId?: string;
  /**
   * Optional override for the fetch layer (tests inject a no-op to avoid
   * hitting the network). Default: the shared WS-5 `gatedFetch`.
   */
  fetcher?: typeof gatedFetch;
  /** Optional override for the source_records writer. Tests only. */
  writer?: typeof writeSourceRecord;
}

const MAX_HREF_LENGTH = 2048;

function isHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * Derive a stable `source_id` from a canonicalised URL. We hash the canonical
 * form so two snippets of the same href collapse to one `source_records` row
 * per tenant (the unique constraint is on `(tenant_id, source_type, source_id)`).
 */
function deriveSourceId(canonicalHref: string): string {
  return crypto.createHash('sha256').update(canonicalHref).digest('hex');
}

/**
 * Save a link snippet. See module header for the flow.
 *
 * Contract:
 *   * On fetch success: returns `{ sourceRecordId: <uuid>, sourceRecordNew, ... }`.
 *   * On fetch failure: returns `{ sourceRecordId: null, warnings: [...] }`.
 *   * On invalid input (non-http href, missing href): throws synchronously.
 */
export async function saveLinkSnippet(
  input: SaveLinkSnippetInput
): Promise<SnippetSaveResponse> {
  const warnings: string[] = [];

  const href = String(input.href ?? '').trim();
  if (!href) {
    throw new Error('saveLinkSnippet: href must be a non-empty string');
  }
  if (href.length > MAX_HREF_LENGTH) {
    throw new Error(
      `saveLinkSnippet: href exceeds ${MAX_HREF_LENGTH}-char limit`
    );
  }
  if (!isHttpUrl(href)) {
    throw new Error('saveLinkSnippet: href must be an http(s) URL');
  }

  const canonicalHref = canonicalizeUrl(href);
  const origin = hostOf(canonicalHref) ?? 'unknown';

  const { valid: validTagSlugs, unknown: unknownTagSlugs } =
    await filterKnownTagSlugs(input.tenantId, input.tagSlugs ?? []);
  if (unknownTagSlugs.length > 0) {
    warnings.push(`Ignored unknown tag slugs: ${unknownTagSlugs.join(', ')}`);
  }

  // Fetch body through the shared gatedFetch — rate-limited + robots-aware.
  // Errors here are non-fatal: we continue with sourceRecordId=null so the
  // snippet still lands in causal_nodes.
  const fetcher = input.fetcher ?? gatedFetch;
  const writer = input.writer ?? writeSourceRecord;
  let sourceRecordId: string | null = null;
  let sourceRecordNew = false;
  try {
    await withQuerySavepoint('snippet_link', async () => {
    const fetched = await fetcher(canonicalHref, {
      tenantId: input.tenantId,
      timeoutMs: 15_000,
      maxBytes: 3 * 1024 * 1024,
    });
    const written = await writer({
      tenantId: input.tenantId,
      sourceType: 'link',
      sourceId: deriveSourceId(canonicalHref),
      url: canonicalHref,
      title: input.linkText ?? null,
      body: fetched.bytes,
      contentMime: fetched.contentType,
      metadata: {
        link: {
          origin,
          capturedFromUrl: input.sourceUrl,
          linkText: input.linkText ?? null,
          httpStatus: fetched.status,
          finalUrl: fetched.finalUrl,
        },
      },
      status: 'fetched',
    });
    sourceRecordId = written.id;
    sourceRecordNew = written.isNew;
    });
  } catch (err) {
    const code =
      err instanceof SourceFetchError ? err.code : 'HTTP_ERROR';
    warnings.push(
      `Link fetch failed (${code}): ${(err as Error).message ?? 'unknown'}`
    );
  }

  // Snippet node — always created, regardless of fetch outcome.
  const snippetId = crypto.randomUUID();
  const snippetNode = await createCausalNode(
    input.tenantId,
    'snippet',
    snippetId,
    'captured',
    {
      sourceUrl: input.sourceUrl,
      pageType: input.pageType ?? null,
      selectionMode: 'link',
      capturedAt: new Date().toISOString(),
      sourceRecordId,
    },
    {
      content: {
        kind: 'link',
        href: canonicalHref,
        linkText: input.linkText ?? null,
        origin,
        sourceRecordId,
      },
      tags: validTagSlugs,
      note: input.note ?? null,
    },
    input.sessionId
  );

  const targetNodeId = await resolveTargetNodeId(
    input.tenantId,
    input.targetKind,
    input.targetId
  );
  await createCausalEdge(snippetNode.id, targetNodeId, 'evidence_for');

  // If we resolved a source_records row, also cite it from the snippet node
  // per `03-snippet-editor.md` §3: snippets reference source records via a
  // `cited_from` edge. We model that on the causal_node directly because the
  // source_records row doesn't itself live in causal_nodes yet — a future
  // migration may promote it. Until then the `sourceRecordId` in the outputs
  // is the canonical pointer.
  void targetNodeId;

  const chainId = snippetChainId(input.targetKind, input.targetId);
  let chainSequence = -1;
  try {
    await withQuerySavepoint('snippet_chain', async () => {
    const seqRes = await query<{ max: string | number | null }>(
      `SELECT MAX(sequence) AS max FROM exo_chain_entries WHERE chain_id = $1`,
      [chainId]
    );
    const nextSeq =
      seqRes.rows[0] && seqRes.rows[0].max !== null
        ? Number(seqRes.rows[0].max) + 1
        : 0;
    let prevHash: string | null = null;
    if (nextSeq > 0) {
      const prev = await query<{ entry_hash: Buffer }>(
        `SELECT entry_hash FROM exo_chain_entries
         WHERE chain_id = $1 AND sequence = $2`,
        [chainId, nextSeq - 1]
      );
      if (prev.rows[0]) {
        prevHash = Buffer.from(prev.rows[0].entry_hash).toString('hex');
      }
    }
    const appended = await appendChainEntry(
      input.tenantId,
      chainId,
      nextSeq,
      prevHash,
      'snippet_captured',
      {
        snippetId,
        causalNodeId: snippetNode.id,
        targetKind: input.targetKind,
        targetId: input.targetId,
        sourceUrl: input.sourceUrl,
        kind: 'link',
        href: canonicalHref,
        origin,
        sourceRecordId,
        tags: validTagSlugs,
      },
      'extension'
    );
    chainSequence = appended.entry.sequence;
    });
  } catch (err) {
    warnings.push(
      `ExoChain append failed (non-fatal): ${
        (err as Error).message ?? 'unknown'
      }`
    );
  }

  return {
    snippetId,
    causalNodeId: snippetNode.id,
    chainId,
    chainSequence,
    warnings,
    sourceRecordId,
    sourceRecordNew,
  };
}
