// Snippet types — shared by API route, service, and tests.
//
// Per `.planning/research-tools-sprint/03-snippet-editor.md` §3, snippets are
// stored as causal_nodes rows with `entity_type='snippet'` and `kind='evidence'`.
// The sidecar tables `snippet_blobs` + `snippet_tags` exist only for image
// payloads (deferred to Phase 1.5) and the tag taxonomy. Tag application is
// denormalized into `causal_nodes.output.tags` (§6.2).

import type { SnippetTargetKind } from './chain';

/**
 * Snippet content kind discriminator. Text landed in Phase 1 Track C;
 * image lands in Phase 1.5; link also lands in Phase 1.5 (closes WS-3
 * acceptance item §3 / Q9). The link flow fetches the `href` via the shared
 * `gatedFetch` helper, writes a `source_records` row with source_type='link',
 * and references it from `causal_nodes.output.content.sourceRecordId`.
 */
export type SnippetKind = 'text' | 'image' | 'link';

/**
 * Text-snippet request body. Historical shape — the route accepted a
 * bare-text payload before `kind` became a discriminator. When `kind` is
 * omitted it is treated as `'text'` for backward compatibility with the
 * shipped Phase 1 extension bundle.
 */
export interface SnippetSaveTextRequest {
  requestId?: string;
  kind?: 'text';
  targetKind: SnippetTargetKind;
  targetId: string;
  text: string;
  sourceUrl: string;
  pageType?: string;
  tagSlugs?: string[];
  note?: string;
  mentionContactIds?: string[];
  /** Optional research_session id — populated when active, else ignored. */
  sessionId?: string;
}

/**
 * Image-snippet request body. Phase 1.5 scope per
 * `.planning/research-tools-sprint/08-phased-delivery.md` §3.4.
 *
 * `imageBytes` is base64-encoded (optionally prefixed with `data:<mime>;base64,`).
 * Size cap: 5 MB. Mime type: image/png, image/jpeg, image/webp.
 */
export interface SnippetSaveImageRequest {
  requestId?: string;
  kind: 'image';
  targetKind: SnippetTargetKind;
  targetId: string;
  imageBytes: string;
  mimeType: string;
  width?: number;
  height?: number;
  sourceUrl: string;
  pageType?: string;
  tagSlugs?: string[];
  note?: string;
  sessionId?: string;
}

/**
 * Link-snippet request body. Phase 1.5 scope closing WS-3 acceptance item §3.
 *
 * On save the server:
 *   1. `gatedFetch` pulls the `href` (rate-limited + robots-respecting).
 *   2. `writeSourceRecord` persists the body under `source_type='link'`.
 *   3. `causal_nodes.output.content` references the record id alongside the
 *      `href` + `linkText` so the widget can show a preview without an extra
 *      round trip.
 *
 * If the fetch fails (robots, HTTP error, timeout) the snippet still saves —
 * `sourceRecordId` is null and a warning is surfaced. Callers can retry by
 * saving again with the same href; the service deduplicates at the
 * `source_records` layer.
 */
export interface SnippetSaveLinkRequest {
  requestId?: string;
  kind: 'link';
  targetKind: SnippetTargetKind;
  targetId: string;
  href: string;
  linkText?: string;
  sourceUrl: string;
  pageType?: string;
  tagSlugs?: string[];
  note?: string;
  sessionId?: string;
}

export type SnippetSaveRequest =
  | SnippetSaveTextRequest
  | SnippetSaveImageRequest
  | SnippetSaveLinkRequest;

export interface SnippetSaveResponse {
  snippetId: string;
  causalNodeId: string;
  chainId: string;
  /** Sequence of the appended chain entry; -1 if chain append failed. */
  chainSequence: number;
  /** Human-readable warnings (non-fatal). */
  warnings: string[];
  /** For image snippets: the blob id referenced by the snippet node. */
  blobId?: string;
  /** For image snippets: whether the blob was deduped against an existing row. */
  blobReused?: boolean;
  /** For link snippets: the `source_records.id` created by the fetch, or null
   * when the fetch failed (robots disallow, HTTP error, etc.). */
  sourceRecordId?: string | null;
  /** For link snippets: whether the source record was newly fetched (false
   * means the canonical href was already stored for this tenant). */
  sourceRecordNew?: boolean;
}

/**
 * Row shape surfaced by the snippets panel API. All fields derive from one
 * `causal_nodes` row plus its edges.
 */
export interface SnippetListItem {
  snippetId: string;
  causalNodeId: string;
  targetKind: SnippetTargetKind;
  targetId: string;
  kind: SnippetKind;
  text: string;
  /** Image-only: blob id for fetching bytes via GET /api/snippets/blob/:id. */
  blobId?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  sourceUrl: string;
  pageType: string | null;
  tagSlugs: string[];
  note: string | null;
  mentionContactIds: string[];
  createdAt: string;
}

export interface SnippetTagRow {
  slug: string;
  label: string;
  parentSlug: string | null;
  isSeeded: boolean;
}
