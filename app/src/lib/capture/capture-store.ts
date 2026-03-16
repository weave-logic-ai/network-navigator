// HTML compression and page cache storage utilities

import zlib from 'zlib';
import crypto from 'crypto';
import { query } from '@/lib/db/client';

/**
 * Compress HTML using gzip.
 */
export function compressHtml(html: string): Buffer {
  return zlib.gzipSync(html, { level: 6 });
}

/**
 * Decompress gzipped HTML.
 */
export function decompressHtml(compressed: Buffer): string {
  return zlib.gunzipSync(compressed).toString('utf-8');
}

/**
 * Compute a content hash for deduplication.
 */
export function computeContentHash(html: string): string {
  return crypto.createHash('sha256').update(html).digest('hex').substring(0, 16);
}

/**
 * Store a captured page in the page_cache table.
 */
export async function storePageCache(params: {
  url: string;
  pageType: string;
  html: string;
  captureId: string;
  extensionVersion: string;
  sessionId: string;
  scrollDepth: number;
  viewportHeight: number;
  documentHeight: number;
  triggerMode: string;
}): Promise<{ id: string; storedBytes: number; compressionRatio: number }> {
  const contentHash = computeContentHash(params.html);
  const originalSize = Buffer.byteLength(params.html, 'utf-8');

  // Store the HTML content directly (the page_cache table uses TEXT, not BYTEA)
  // The rotation trigger will automatically keep only the 5 most recent per URL
  const result = await query<{ id: string }>(
    `INSERT INTO page_cache (
      url, page_type, html_content, compressed, content_hash, version,
      captured_by, parsed, capture_id, extension_version, session_id,
      scroll_depth, viewport_height, document_height, trigger_mode
    ) VALUES ($1, $2, $3, $4, $5, 1, 'extension', false, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id`,
    [
      params.url,
      params.pageType,
      params.html,
      false,
      contentHash,
      params.captureId,
      params.extensionVersion,
      params.sessionId,
      params.scrollDepth,
      params.viewportHeight,
      params.documentHeight,
      params.triggerMode,
    ]
  );

  const compressionRatio = 0; // Not using compression since column is TEXT

  return {
    id: result.rows[0].id,
    storedBytes: originalSize,
    compressionRatio,
  };
}
