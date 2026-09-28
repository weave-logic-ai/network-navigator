// Source ingestion orchestrator.
//
// Connectors (Wayback, EDGAR, ...) are pluggable: this module owns the common
// path of rate-limit → robots → fetch → persist. Each connector decides what
// to do with the fetched body (parse filing, reparse LinkedIn snapshot, etc.).
// The service also provides the shared `writeSourceRecord` helper so no
// connector has to re-implement dedup + content hashing.
//
// This file is deliberately small. The real fetch + parse logic lives in
// `connectors/*.ts`.

import crypto from 'crypto';
import { query } from '../db/client';
import { acquire, DEFAULT_BUCKETS, type BucketConfig } from './rate-limiter';
import { isAllowed } from './robots';
import { type PrivateIpReason } from './private-ip';
import { safeHttpGet, SafeHttpError } from './safe-http';
import { canonicalizeUrl, hostOf } from './url-normalize';

export interface FetchOptions {
  tenantId: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Skip robots.txt check (only for APIs documented as exempt, e.g. SEC). */
  skipRobots?: boolean;
  /** Custom bucket config — overrides DEFAULT_BUCKETS. */
  bucketConfig?: BucketConfig;
  maxBytes?: number;
  timeoutMs?: number;
  /** Inject a DNS lookup override (tests only). Returns all resolved IPs. */
  dnsLookup?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

export class SourceFetchError extends Error {
  /**
   * When `code === 'BLOCKED_IP'`, `reason` carries the classified range.
   * Consumers that surface structured errors read this field; existing
   * call-sites that only branch on `code` are unaffected.
   */
  public reason?: PrivateIpReason;

  constructor(
    message: string,
    public code:
      | 'ROBOTS_DISALLOW'
      | 'HTTP_ERROR'
      | 'TOO_LARGE'
      | 'TIMEOUT'
      | 'INVALID_URL'
      | 'BLOCKED_IP',
    public status?: number,
    reason?: PrivateIpReason
  ) {
    super(message);
    this.name = 'SourceFetchError';
    if (reason) this.reason = reason;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The core gated fetch. Applies rate limiter, robots.txt check (unless
 * skipped), then performs the HTTP request. Returns the raw body bytes and
 * response metadata.
 */
export async function gatedFetch(
  url: string,
  opts: FetchOptions
): Promise<{ bytes: Buffer; status: number; contentType: string; finalUrl: string }> {
  const host = hostOf(url);
  if (!host) throw new SourceFetchError(`Invalid URL: ${url}`, 'INVALID_URL');

  try {
    const res = await safeHttpGet(url, {
      method: opts.method,
      headers: opts.headers,
      dnsLookup: opts.dnsLookup,
      maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      beforeRequest: async (hopUrl) => {
        const hopHost = hostOf(hopUrl);
        if (!hopHost) throw new SourceFetchError(`Invalid URL: ${hopUrl}`, 'INVALID_URL');
        if (!opts.skipRobots) {
          const robots = await isAllowed(hopUrl);
          if (!robots.allowed) {
            throw new SourceFetchError(`robots.txt disallows ${hopUrl}: ${robots.reason}`, 'ROBOTS_DISALLOW');
          }
        }
        const bucketCfg = opts.bucketConfig ?? DEFAULT_BUCKETS[hopHost] ??
          ({ capacity: 20, refillPerMin: 20 } as BucketConfig);
        await acquire(hopHost, { tenantId: opts.tenantId, config: bucketCfg });
      },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new SourceFetchError(
        `HTTP ${res.status} for ${res.finalUrl}`,
        'HTTP_ERROR',
        res.status
      );
    }
    return {
      bytes: res.bytes,
      status: res.status,
      contentType: res.contentType,
      finalUrl: res.finalUrl,
    };
  } catch (err) {
    if (err instanceof SourceFetchError) throw err;
    if (err instanceof SafeHttpError) {
      throw new SourceFetchError(err.message, err.code, undefined, err.reason);
    }
    throw new SourceFetchError(
      `Fetch failed for ${url}: ${(err as Error).message}`,
      'HTTP_ERROR'
    );
  }
}

export interface WriteSourceRecordInput {
  tenantId: string;
  sourceType: string;
  sourceId: string;
  url: string;
  title?: string | null;
  publishedAt?: Date | string | null;
  fetchedAt?: Date;
  body: Buffer;
  contentMime?: string | null;
  metadata?: Record<string, unknown>;
  status?: 'fetched' | 'stored_partial' | 'failed' | 'stale' | 'pending';
}

/**
 * UPSERT a source_records row. Returns the row id and whether it was newly
 * inserted. Dedup is on (tenant_id, source_type, source_id) per the migration
 * unique constraint; on conflict, we update `fetched_at`, `content_hash`,
 * `content`, `status`, `title`, `published_at` — an idempotent re-fetch.
 */
export async function writeSourceRecord(
  input: WriteSourceRecordInput
): Promise<{ id: string; isNew: boolean; bytes: number }> {
  const canonicalUrl = canonicalizeUrl(input.url);
  const contentHash = crypto.createHash('sha256').update(input.body).digest();
  const publishedAt = input.publishedAt
    ? typeof input.publishedAt === 'string'
      ? input.publishedAt
      : input.publishedAt.toISOString()
    : null;

  const res = await query<{ id: string; inserted: boolean }>(
    `INSERT INTO source_records
       (tenant_id, source_type, source_id, canonical_url, title, published_at,
        fetched_at, content_hash, content_bytes, content, content_mime,
        metadata, status)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11::jsonb, $12)
     ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE
       SET fetched_at = NOW(),
           content_hash = EXCLUDED.content_hash,
           content_bytes = EXCLUDED.content_bytes,
           content = EXCLUDED.content,
           content_mime = EXCLUDED.content_mime,
           title = COALESCE(EXCLUDED.title, source_records.title),
           published_at = COALESCE(EXCLUDED.published_at, source_records.published_at),
           metadata = source_records.metadata || EXCLUDED.metadata,
           status = EXCLUDED.status
     RETURNING id, (xmax = 0) AS inserted`,
    [
      input.tenantId,
      input.sourceType,
      input.sourceId,
      canonicalUrl,
      input.title ?? null,
      publishedAt,
      contentHash,
      input.body.byteLength,
      input.body,
      input.contentMime ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.status ?? 'fetched',
    ]
  );
  return {
    id: res.rows[0].id,
    isNew: Boolean(res.rows[0].inserted),
    bytes: input.body.byteLength,
  };
}
