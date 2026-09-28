// Snippet service — write side.
//
// One entry point, `saveTextSnippet`, performs:
//   1. causal_nodes INSERT (entity_type='snippet', operation='captured')
//   2. causal_edges INSERT (relation='evidence_for' target node, 'mentions' per linked contact)
//   3. exo_chain_entries APPEND on chain_id = snippet:<kind>:<target_id>
//
// Chain append is best-effort (parallel to DB writes): if the chain write
// fails, the snippet row is still the source of truth per `03-snippet-editor.md`
// §8.1 step 8 and `.planning/research-tools-sprint/06-evidence-and-provenance.md`
// §5. The response surfaces a warning rather than failing the API call.

import { query, withQuerySavepoint } from '../db/client';
import { createCausalNode, createCausalEdge } from '../ecc/causal-graph/service';
import { appendChainEntry } from '../ecc/exo-chain/service';
import { snippetChainId, type SnippetTargetKind } from './chain';
import { extractPersonMentionCandidates } from './mentions';
import { upsertBlob } from './blob-store';
import { detectAndScrubPii, type PiiKind } from './pii-scrubber';
import type { SnippetKind, SnippetSaveResponse } from './types';

interface SaveTextSnippetInput {
  tenantId: string;
  targetKind: SnippetTargetKind;
  targetId: string;
  text: string;
  sourceUrl: string;
  pageType?: string;
  tagSlugs?: string[];
  note?: string;
  mentionContactIds?: string[];
  sessionId?: string;
}

/**
 * Resolve the causal_nodes row id for a research target. We attach each
 * snippet's `evidence_for` edge to the target's most-recent causal node, or
 * lazily create a `target.primary_set` node if none exists yet.
 */
export async function resolveTargetNodeId(
  tenantId: string,
  targetKind: SnippetTargetKind,
  targetId: string
): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM causal_nodes
     WHERE tenant_id = $1 AND entity_type = 'target' AND entity_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, targetId]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  // Lazy-create a skeleton target node so the edge has something to point at.
  // This is consistent with `06-evidence-and-provenance.md` §3 operation matrix:
  // `target.created` is the "first time anyone writes about this target" event.
  const node = await createCausalNode(
    tenantId,
    'target',
    targetId,
    'created',
    { kind: targetKind },
    { lazyCreatedBySnippetService: true }
  );
  return node.id;
}

/**
 * Validate the claimed tag slugs exist in the tenant's taxonomy. Unknown slugs
 * are silently filtered (we surface a warning) so a stale extension build
 * cannot block a save.
 */
export async function filterKnownTagSlugs(
  tenantId: string,
  slugs: string[]
): Promise<{ valid: string[]; unknown: string[] }> {
  if (slugs.length === 0) return { valid: [], unknown: [] };
  const res = await query<{ slug: string }>(
    `SELECT slug FROM snippet_tags WHERE tenant_id = $1 AND slug = ANY($2::text[])`,
    [tenantId, slugs]
  );
  const found = new Set(res.rows.map((r) => r.slug));
  const valid: string[] = [];
  const unknown: string[] = [];
  for (const slug of slugs) {
    if (found.has(slug)) valid.push(slug);
    else unknown.push(slug);
  }
  return { valid, unknown };
}

/**
 * Look up the most-recent causal_node for each linked contact id so we can
 * point the `mentions` edge at something. If a contact has no existing node,
 * we create one on the fly (same lazy pattern as target nodes).
 */
async function resolveContactNodeIds(
  tenantId: string,
  contactIds: string[]
): Promise<{ id: string; nodeId: string }[]> {
  if (contactIds.length === 0) return [];
  const existing = await query<{ entity_id: string; id: string }>(
    `SELECT DISTINCT ON (entity_id) entity_id, id FROM causal_nodes
     WHERE tenant_id = $1 AND entity_type IN ('score', 'enrichment')
       AND entity_id = ANY($2::text[])
     ORDER BY entity_id, created_at DESC`,
    [tenantId, contactIds]
  );
  const resolved: { id: string; nodeId: string }[] = existing.rows.map((r) => ({
    id: r.entity_id,
    nodeId: r.id,
  }));
  const found = new Set(resolved.map((r) => r.id));
  for (const id of contactIds) {
    if (found.has(id)) continue;
    const node = await createCausalNode(
      tenantId,
      'enrichment',
      id,
      'snippet_mention_placeholder',
      { reason: 'created lazily so a snippet mentions edge has a target node' }
    );
    resolved.push({ id, nodeId: node.id });
  }
  return resolved;
}

export async function saveTextSnippet(
  input: SaveTextSnippetInput
): Promise<SnippetSaveResponse> {
  const warnings: string[] = [];

  const rawTrimmed = input.text?.trim() ?? '';
  if (!rawTrimmed) {
    throw new Error('saveTextSnippet: text must be a non-empty string');
  }

  // WS-3 Phase 6 §9: scrub obvious PII before we persist anything.
  // The returned `piiScrubbed` flag lives on `snippets.metadata` (stored on
  // `causal_nodes.output.meta.piiScrubbed`) so downstream consumers (share,
  // export, audit) can reason about sanitisation provenance.
  const piiPass = detectAndScrubPii(rawTrimmed);
  const trimmedText = piiPass.scrubbedText;
  if (piiPass.hit) {
    const kinds = (Object.keys(piiPass.hits) as PiiKind[]).filter(
      (k) => piiPass.hits[k] > 0
    );
    warnings.push(`PII scrubbed (${kinds.join(', ')})`);
  }

  const normalizedMentionIds = Array.from(
    new Set((input.mentionContactIds ?? []).filter((v) => !!v))
  );

  const { valid: validTagSlugs, unknown: unknownTagSlugs } =
    await filterKnownTagSlugs(input.tenantId, input.tagSlugs ?? []);
  if (unknownTagSlugs.length > 0) {
    warnings.push(`Ignored unknown tag slugs: ${unknownTagSlugs.join(', ')}`);
  }

  const snippetId = crypto.randomUUID();
  const extractedMentions = extractPersonMentionCandidates(trimmedText).map(
    (m) => m.text
  );

  const snippetNode = await createCausalNode(
    input.tenantId,
    'snippet',
    snippetId,
    'captured',
    {
      sourceUrl: input.sourceUrl,
      pageType: input.pageType ?? null,
      selectionMode: 'text',
      capturedAt: new Date().toISOString(),
    },
    {
      content: { kind: 'text', text: trimmedText },
      tags: validTagSlugs,
      note: input.note ?? null,
      extractedMentionCandidates: extractedMentions,
      linkedContactIds: normalizedMentionIds,
      meta: {
        piiScrubbed: piiPass.hit,
        piiHits: piiPass.hit ? piiPass.hits : undefined,
      },
    },
    input.sessionId
  );

  const targetNodeId = await resolveTargetNodeId(
    input.tenantId,
    input.targetKind,
    input.targetId
  );
  await createCausalEdge(snippetNode.id, targetNodeId, 'evidence_for');

  if (normalizedMentionIds.length > 0) {
    const mentionNodes = await resolveContactNodeIds(
      input.tenantId,
      normalizedMentionIds
    );
    for (const m of mentionNodes) {
      await createCausalEdge(snippetNode.id, m.nodeId, 'mentions');
    }
  }

  const chainId = snippetChainId(input.targetKind, input.targetId);
  let chainSequence = -1;
  try {
    await withQuerySavepoint('snippet_chain', async () => {
    // Look up the last sequence on this chain to maintain the Merkle link.
    const seqRes = await query<{ max: string | number | null; entry_hash: Buffer | null }>(
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
        textPreview: trimmedText.slice(0, 140),
        tags: validTagSlugs,
        mentionCount: normalizedMentionIds.length,
      },
      'extension'
    );
    chainSequence = appended.entry.sequence;
    });
  } catch (err) {
    // Per spec: chain append is best-effort. Source of truth stays causal_nodes.
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
  };
}

interface SaveImageSnippetInput {
  tenantId: string;
  targetKind: SnippetTargetKind;
  targetId: string;
  /** Decoded image bytes (after base64 decode + size/mime validation). */
  bytes: Buffer;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  sourceUrl: string;
  pageType?: string;
  tagSlugs?: string[];
  note?: string;
  sessionId?: string;
}

/**
 * Save an image snippet — Phase 1.5 round-trip.
 *
 * Flow mirrors `saveTextSnippet`:
 *   1. UPSERT `snippet_blobs` (dedup by sha256 per tenant).
 *   2. Insert `causal_nodes` row with `entity_type='snippet'`,
 *      `output.content = { kind: 'image', blobId, mimeType, ... }`.
 *   3. Insert `evidence_for` edge to the target node.
 *   4. Append `exo_chain_entries` on `snippet:<kind>:<target_id>`.
 *
 * Chain append remains best-effort (non-fatal) per the text path.
 */
export async function saveImageSnippet(
  input: SaveImageSnippetInput
): Promise<SnippetSaveResponse> {
  const warnings: string[] = [];

  if (!input.bytes || input.bytes.byteLength === 0) {
    throw new Error('saveImageSnippet: bytes must be a non-empty Buffer');
  }

  const { valid: validTagSlugs, unknown: unknownTagSlugs } =
    await filterKnownTagSlugs(input.tenantId, input.tagSlugs ?? []);
  if (unknownTagSlugs.length > 0) {
    warnings.push(`Ignored unknown tag slugs: ${unknownTagSlugs.join(', ')}`);
  }

  const blob = await upsertBlob({
    tenantId: input.tenantId,
    mimeType: input.mimeType,
    bytes: input.bytes,
    width: input.width ?? null,
    height: input.height ?? null,
  });

  const snippetId = crypto.randomUUID();
  const snippetNode = await createCausalNode(
    input.tenantId,
    'snippet',
    snippetId,
    'captured',
    {
      sourceUrl: input.sourceUrl,
      pageType: input.pageType ?? null,
      selectionMode: 'image',
      capturedAt: new Date().toISOString(),
    },
    {
      content: {
        kind: 'image',
        blobId: blob.id,
        mimeType: input.mimeType,
        byteLength: blob.byteLength,
        sha256: blob.sha256Hex,
        width: input.width ?? null,
        height: input.height ?? null,
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
        kind: 'image',
        mimeType: input.mimeType,
        blobId: blob.id,
        sha256: blob.sha256Hex,
        byteLength: blob.byteLength,
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
    blobId: blob.id,
    blobReused: blob.reused,
  };
}

/**
 * Read snippets attached to a given research target for the snippets panel.
 * Ordered by captured_at DESC.
 */
export async function listSnippetsForTarget(
  tenantId: string,
  targetKind: SnippetTargetKind,
  targetId: string,
  options: { tagSlug?: string; limit?: number } = {}
): Promise<
  Array<{
    snippetId: string;
    causalNodeId: string;
    kind: SnippetKind;
    text: string;
    blobId: string | null;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    sourceUrl: string;
    pageType: string | null;
    tagSlugs: string[];
    note: string | null;
    linkedContactIds: string[];
    createdAt: string;
  }>
> {
  const limit = Math.min(options.limit ?? 100, 500);
  // Resolve the target node (to filter snippets whose evidence_for points there).
  const targetRes = await query<{ id: string }>(
    `SELECT id FROM causal_nodes
     WHERE tenant_id = $1 AND entity_type = 'target' AND entity_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, targetId]
  );
  if (!targetRes.rows[0]) return [];
  const targetNodeId = targetRes.rows[0].id;

  const params: unknown[] = [tenantId, targetNodeId, limit];
  let tagFilterSql = '';
  if (options.tagSlug) {
    tagFilterSql = ` AND cn.output -> 'tags' @> $4::jsonb`;
    params.push(JSON.stringify([options.tagSlug]));
  }

  const res = await query<Record<string, unknown>>(
    `SELECT cn.id, cn.entity_id, cn.inputs, cn.output, cn.created_at
     FROM causal_nodes cn
     JOIN causal_edges ce ON ce.source_node_id = cn.id
     WHERE cn.tenant_id = $1
       AND cn.entity_type = 'snippet'
       AND cn.operation = 'captured'
       AND ce.target_node_id = $2
       AND ce.relation = 'evidence_for'
       ${tagFilterSql}
     ORDER BY cn.created_at DESC
     LIMIT $3`,
    params
  );

  void targetKind; // targetKind currently unused in the read path — reserved for future kind-scoped filters.
  return res.rows.map((row) => {
    const inputs = (row.inputs ?? {}) as Record<string, unknown>;
    const output = (row.output ?? {}) as Record<string, unknown>;
    const content = (output.content ?? {}) as Record<string, unknown>;
    const kind: SnippetKind = content.kind === 'image' ? 'image' : 'text';
    return {
      snippetId: String(row.entity_id),
      causalNodeId: String(row.id),
      kind,
      text: kind === 'text' ? String(content.text ?? '') : '',
      blobId:
        kind === 'image' && typeof content.blobId === 'string'
          ? (content.blobId as string)
          : null,
      mimeType:
        kind === 'image' && typeof content.mimeType === 'string'
          ? (content.mimeType as string)
          : null,
      width:
        kind === 'image' && typeof content.width === 'number'
          ? (content.width as number)
          : null,
      height:
        kind === 'image' && typeof content.height === 'number'
          ? (content.height as number)
          : null,
      sourceUrl: String(inputs.sourceUrl ?? ''),
      pageType: (inputs.pageType as string | null) ?? null,
      tagSlugs: Array.isArray(output.tags) ? (output.tags as string[]) : [],
      note: (output.note as string | null) ?? null,
      linkedContactIds: Array.isArray(output.linkedContactIds)
        ? (output.linkedContactIds as string[])
        : [],
      createdAt: String(row.created_at),
    };
  });
}
