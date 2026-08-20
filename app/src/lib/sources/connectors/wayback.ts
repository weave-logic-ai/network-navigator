// Wayback Machine connector.
//
// Flow:
//   1. Canonicalize the input URL.
//   2. Query the CDX API
//      `http://web.archive.org/cdx/search/cdx?url=<X>&output=json&fl=timestamp,original&limit=50`
//      Pick the most recent snapshot (last row — CDX is sorted ascending by
//      timestamp). If a `timestamp` hint was provided we pick the nearest.
//   3. Fetch the snapshot HTML via `https://web.archive.org/web/<ts>/<url>`.
//   4. Write a `source_records` row with source_type='wayback'.
//   5. If the target is LinkedIn (/in/*, /company/*), ALSO push the HTML into
//      `storePageCache()` so the main parser pipeline picks it up. This is
//      the high-value "director departed" path per §4 of 05-source-expansion.md.
//
// `per_item_multiplier` decays with snapshot age — newer snapshots are more
// trustworthy per the composite-weight model (ADR-030). This IS the ADR-030
// "recency modifier" signal (see `./recency-modifier.ts` for the general
// version other connectors use); Wayback has no engagement or citation data
// to compose it with, so recency alone is correct and complete here — an
// archived static page copy carries no view/share counts. The
// source_field_values write happens only for the LinkedIn-auto-reparse path
// (since we don't parse arbitrary HTML at fetch time).

import crypto from 'crypto';
import { gatedFetch, writeSourceRecord, SourceFetchError } from '../service';
import { canonicalizeUrl, linkedInPageType } from '../url-normalize';
import type { SourceConnector, WaybackInput, ConnectorContext, ConnectorResult } from '../types';
import { storePageCache } from '@/lib/capture/capture-store';

const CDX_ENDPOINT = 'http://web.archive.org/cdx/search/cdx';
const SNAPSHOT_BASE = 'https://web.archive.org/web';

// Age-decay curve for `per_item_multiplier`:
//   0 days old   → 1.0
//   30 days old  → ~0.97
//   365 days old → ~0.80
//   1825 days    → ~0.55 (floor at 0.5)
// We use simple exponential decay with half-life ~3 years.
const HALF_LIFE_MS = 3 * 365 * 24 * 60 * 60 * 1000;
const MULTIPLIER_FLOOR = 0.5;

export function ageDecayMultiplier(ageMs: number): number {
  if (ageMs <= 0) return 1.0;
  const decayed = Math.pow(0.5, ageMs / HALF_LIFE_MS);
  return Math.max(MULTIPLIER_FLOOR, decayed);
}

/**
 * Parse the CDX JSON response. Shape:
 *   [["timestamp", "original"], ["20200101000000", "https://..."], ...]
 * First row is the header. We filter out rows that don't look like
 * 14-digit timestamps (robustness against CDX API changes).
 */
export interface CdxSnapshot {
  timestamp: string;
  original: string;
}

export function parseCdxResponse(body: unknown): CdxSnapshot[] {
  if (!Array.isArray(body) || body.length < 2) return [];
  const header = body[0];
  if (!Array.isArray(header)) return [];
  const tsIdx = header.indexOf('timestamp');
  const origIdx = header.indexOf('original');
  if (tsIdx < 0 || origIdx < 0) return [];
  const out: CdxSnapshot[] = [];
  for (let i = 1; i < body.length; i++) {
    const row = body[i];
    if (!Array.isArray(row)) continue;
    const timestamp = String(row[tsIdx] ?? '');
    const original = String(row[origIdx] ?? '');
    if (!/^\d{14}$/.test(timestamp)) continue;
    if (!original) continue;
    out.push({ timestamp, original });
  }
  return out;
}

/** Parse a 14-digit CDX timestamp YYYYMMDDHHMMSS to a UTC Date. */
export function parseCdxTimestamp(ts: string): Date | null {
  if (!/^\d{14}$/.test(ts)) return null;
  const year = Number(ts.slice(0, 4));
  const month = Number(ts.slice(4, 6)) - 1;
  const day = Number(ts.slice(6, 8));
  const hour = Number(ts.slice(8, 10));
  const minute = Number(ts.slice(10, 12));
  const second = Number(ts.slice(12, 14));
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/** Pick the snapshot closest in time to `hint`, or the most recent if no hint. */
export function pickSnapshot(
  snapshots: CdxSnapshot[],
  hint?: string
): CdxSnapshot | null {
  if (snapshots.length === 0) return null;
  if (hint && /^\d{14}$/.test(hint)) {
    const hintDate = parseCdxTimestamp(hint);
    if (hintDate) {
      let best = snapshots[0];
      let bestDelta = Math.abs(
        (parseCdxTimestamp(best.timestamp)?.getTime() ?? 0) - hintDate.getTime()
      );
      for (const snap of snapshots) {
        const d = parseCdxTimestamp(snap.timestamp);
        if (!d) continue;
        const delta = Math.abs(d.getTime() - hintDate.getTime());
        if (delta < bestDelta) {
          best = snap;
          bestDelta = delta;
        }
      }
      return best;
    }
  }
  // Most recent is the last row in ascending-time order.
  return snapshots[snapshots.length - 1];
}

/**
 * Build the canonical Wayback viewer URL for a (timestamp, original) pair.
 */
export function snapshotUrl(timestamp: string, originalUrl: string): string {
  return `${SNAPSHOT_BASE}/${timestamp}/${originalUrl}`;
}

export const waybackConnector: SourceConnector<WaybackInput> = {
  sourceType: 'wayback',
  label: 'Wayback Machine',

  async invoke(input: WaybackInput, ctx: ConnectorContext): Promise<ConnectorResult> {
    const canonicalInput = canonicalizeUrl(input.url);
    const warnings: string[] = [];

    // 1. Query CDX for snapshots.
    const cdxUrl = `${CDX_ENDPOINT}?url=${encodeURIComponent(canonicalInput)}&output=json&fl=timestamp,original&limit=50`;
    const cdxResp = await gatedFetch(cdxUrl, {
      tenantId: ctx.tenantId,
      skipRobots: false,
      timeoutMs: 15_000,
      maxBytes: 1 * 1024 * 1024,
    });
    let snapshots: CdxSnapshot[] = [];
    try {
      const parsed = JSON.parse(cdxResp.bytes.toString('utf-8'));
      snapshots = parseCdxResponse(parsed);
    } catch {
      snapshots = [];
    }

    const picked = pickSnapshot(snapshots, input.timestamp);
    if (!picked) {
      return {
        sourceType: 'wayback',
        sourceRecordId: null,
        canonicalUrl: canonicalInput,
        isNew: false,
        bytes: 0,
        summary: `No Wayback snapshot found for ${canonicalInput}`,
        warnings,
      };
    }

    const snapUrl = snapshotUrl(picked.timestamp, picked.original);
    const capturedAt = parseCdxTimestamp(picked.timestamp);

    // 2. Fetch the snapshot HTML.
    let fetched: { bytes: Buffer; status: number; contentType: string; finalUrl: string };
    try {
      fetched = await gatedFetch(snapUrl, {
        tenantId: ctx.tenantId,
        timeoutMs: 20_000,
        maxBytes: 5 * 1024 * 1024,
      });
    } catch (err) {
      if (err instanceof SourceFetchError) {
        throw err;
      }
      throw err;
    }

    // 3. Compute per-item multiplier based on snapshot age.
    const ageMs =
      capturedAt ? Math.max(0, Date.now() - capturedAt.getTime()) : 0;
    const perItemMultiplier = ageDecayMultiplier(ageMs);

    // 4. Write the source_records row.
    const sourceId = `${picked.timestamp}:${canonicalInput}`;
    const metadata: Record<string, unknown> = {
      wayback: {
        timestamp: picked.timestamp,
        original: picked.original,
        snapshotUrl: snapUrl,
        capturedAt: capturedAt?.toISOString() ?? null,
        ageDays: capturedAt
          ? Math.floor(ageMs / (24 * 60 * 60 * 1000))
          : null,
        perItemMultiplier,
      },
    };

    const record = await writeSourceRecord({
      tenantId: ctx.tenantId,
      sourceType: 'wayback',
      sourceId,
      url: snapUrl,
      title: null,
      publishedAt: capturedAt ?? null,
      body: fetched.bytes,
      contentMime: fetched.contentType,
      metadata,
    });

    // 5. Wayback-of-LinkedIn auto-reparse. If the `original` URL is a
    //    LinkedIn profile or company page, pipe the HTML into page_cache so
    //    the normal parser pipeline treats it as a capture.
    let reparseStored = false;
    let reparseError: string | null = null;
    const lipt = input.skipLinkedInReparse ? null : linkedInPageType(picked.original);
    if (lipt) {
      try {
        const html = fetched.bytes.toString('utf-8');
        // Derive a deterministic capture id so re-invokes don't explode the
        // page_cache table. sha256(snapshotUrl) → hex → UUID-shape.
        const hash = crypto.createHash('sha256').update(snapUrl).digest('hex');
        const captureId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
        await storePageCache({
          url: picked.original,
          pageType: lipt,
          html,
          captureId,
          extensionVersion: 'wayback-connector',
          sessionId: `wayback:${picked.timestamp}`,
          scrollDepth: 0,
          viewportHeight: 0,
          documentHeight: 0,
          triggerMode: 'auto',
        });
        reparseStored = true;
        metadata.wayback = {
          ...(metadata.wayback as Record<string, unknown>),
          reparseStored: true,
          reparsePageType: lipt,
        };
      } catch (err) {
        reparseError = (err as Error).message;
        warnings.push(`LinkedIn reparse failed (non-fatal): ${reparseError}`);
      }
    }

    return {
      sourceType: 'wayback',
      sourceRecordId: record.id,
      canonicalUrl: canonicalizeUrl(snapUrl),
      isNew: record.isNew,
      bytes: record.bytes,
      summary: `Captured Wayback snapshot ${picked.timestamp} for ${canonicalInput}${reparseStored ? ' (LinkedIn page_cache written)' : ''}`,
      metadata: {
        timestamp: picked.timestamp,
        original: picked.original,
        snapshotUrl: snapUrl,
        capturedAt: capturedAt?.toISOString() ?? null,
        perItemMultiplier,
        reparseStored,
        reparseError,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};
