// Shared helpers for the Phase 3 Track G targeted news scrapers.
//
// Each per-site connector (wsj, bloomberg, reuters, techcrunch, cnbc) is a
// thin shell that plugs site-specific bits into `runNewsConnector`:
//
//   - `buildSearchUrl`  — site's search URL builder for an entity
//   - `parseSearchLinks` — cheerio selectors to pull article URLs off the SERP
//   - `parseArticle`    — cheerio selectors to pull {title, publishedAt,
//                          author, body, canonicalUrl} from an article
//   - `detectPaywall`   — boolean heuristic on the article HTML/headers
//
// The shell handles: canonical URL normalization, dedup (by
// `<origin>:<canonical_url>`), rate-limiter / robots gating (both inherited
// from `gatedFetch`), paywall graceful degradation (writes a minimal
// source_records row with `behind_paywall: true` in metadata), and per-item
// multiplier derivation from article view-count metadata (when present)
// composed with the ADR-030 recency modifier (see `../recency-modifier.ts`).
//
// Interface contract lives in `../../types.ts` (SourceConnector /
// ConnectorContext / ConnectorResult). This file does not touch the DB
// directly — `writeSourceRecord` does all of that.

import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import {
  gatedFetch,
  writeSourceRecord,
  SourceFetchError,
} from '../../service';
import { canonicalizeUrl, hostOf } from '../../url-normalize';
import type {
  ConnectorContext,
  ConnectorResult,
  SourceType,
} from '../../types';
import { isNewsSiteEnabled } from '@/lib/config/research-flags';
import { applyRecencyModifier, RECENCY_PRESETS } from '../recency-modifier';

export type NewsOrigin = 'wsj' | 'bloomberg' | 'reuters' | 'techcrunch' | 'cnbc';

/** Shape of the entity the user is researching. */
export interface NewsTargetEntity {
  /** 'person' for contacts (search by name). 'company' includes domain. */
  kind: 'person' | 'company';
  /** Display name (e.g. "Jane Doe" or "Stripe"). Required. */
  name: string;
  /**
   * Company domain (e.g. "stripe.com"). Required for 'company', optional for
   * 'person' — helps narrow the site-internal search.
   */
  domain?: string;
}

/** Input shape accepted by every news connector. */
export interface NewsConnectorInput {
  entity: NewsTargetEntity;
  /**
   * Maximum articles to fetch in this invocation. Falls back to the per-site
   * `defaultMaxArticles`. Bounded above by the per-site cap.
   */
  maxArticles?: number;
}

/** Parsed article — the canonical payload we store into source_records. */
export interface ParsedArticle {
  title: string | null;
  publishedAt: string | null; // ISO 8601
  author: string | null;
  body: string | null;
  canonicalUrl: string;
  /** Optional engagement signal — drives the per_item_multiplier. */
  viewCount?: number | null;
}

/** Light result from the search-page scrape step. */
export interface SearchHit {
  url: string;
  /** Optional preview title from the SERP — used for logging only. */
  title?: string | null;
}

/** Per-site plugin implementing the site's scrape details. */
export interface NewsSiteAdapter {
  readonly origin: NewsOrigin;
  readonly label: string;
  /** Site host as it appears in canonical URLs (for dedup + host binding). */
  readonly host: string;
  /** Per-connector cap on articles per invoke. */
  readonly defaultMaxArticles: number;
  /** Hard ceiling (same as default; kept separate so tests can import both). */
  readonly articleCap: number;

  /**
   * Build the search URL for an entity. Sites that have a first-party search
   * page use it; sites that don't return a Google News `site:` query URL.
   */
  buildSearchUrl(entity: NewsTargetEntity): string;

  /**
   * Parse list-page HTML into an array of article URLs. May return fewer than
   * `maxArticles`; the shell clips from the top.
   */
  parseSearchLinks($: CheerioAPI, baseUrl: string): SearchHit[];

  /** Parse a single article's HTML into the canonical payload. */
  parseArticle($: CheerioAPI, articleUrl: string): ParsedArticle;

  /** Return true if the HTML/status indicates a paywall. */
  detectPaywall(
    $: CheerioAPI,
    html: string,
    status: number
  ): boolean;
}

/**
 * Run one full news-scrape invocation for a given site adapter. Returns the
 * connector-standard ConnectorResult summarizing counts. This is the function
 * every per-site connector calls from its `invoke`.
 */
export async function runNewsConnector(
  adapter: NewsSiteAdapter,
  input: NewsConnectorInput,
  ctx: ConnectorContext
): Promise<ConnectorResult> {
  if (!isNewsSiteEnabled(adapter.origin)) {
    return {
      sourceType: 'news',
      sourceRecordId: null,
      canonicalUrl: '',
      isNew: false,
      bytes: 0,
      summary: `${adapter.label} connector disabled by feature flag`,
      warnings: [`RESEARCH_CONNECTOR_NEWS_${adapter.origin.toUpperCase()}=false`],
    };
  }

  const warnings: string[] = [];
  const searchUrl = adapter.buildSearchUrl(input.entity);

  // 1. Pull the search page.
  let searchBytes: Buffer;
  try {
    const resp = await gatedFetch(searchUrl, {
      tenantId: ctx.tenantId,
      headers: DEFAULT_HEADERS,
      timeoutMs: 20_000,
      maxBytes: 5 * 1024 * 1024,
    });
    searchBytes = resp.bytes;
  } catch (err) {
    if (err instanceof SourceFetchError) {
      return {
        sourceType: 'news',
        sourceRecordId: null,
        canonicalUrl: searchUrl,
        isNew: false,
        bytes: 0,
        summary: `${adapter.label} search fetch failed: ${err.code}`,
        warnings: [err.message],
      };
    }
    throw err;
  }

  const $search = cheerio.load(searchBytes.toString('utf-8'));
  const hits = adapter
    .parseSearchLinks($search, searchUrl)
    .slice(
      0,
      Math.max(
        1,
        Math.min(
          input.maxArticles ?? adapter.defaultMaxArticles,
          adapter.articleCap
        )
      )
    );

  if (hits.length === 0) {
    return {
      sourceType: 'news',
      sourceRecordId: null,
      canonicalUrl: searchUrl,
      isNew: false,
      bytes: 0,
      summary: `${adapter.label} search returned 0 hits for "${input.entity.name}"`,
    };
  }

  // 2. Per-article loop.
  let lastRecordId: string | null = null;
  let newCount = 0;
  let totalBytes = 0;

  for (const hit of hits) {
    let articleUrl: string;
    try {
      articleUrl = canonicalizeUrl(hit.url);
    } catch (err) {
      warnings.push(`Skipped invalid URL ${hit.url}: ${(err as Error).message}`);
      continue;
    }

    // Skip links that point off-host (SERPs sometimes have trackers).
    if (hostOf(articleUrl) !== adapter.host) {
      warnings.push(`Skipped off-host ${articleUrl} (expected ${adapter.host})`);
      continue;
    }

    const sourceId = `${adapter.origin}:${articleUrl}`;
    try {
      const resp = await gatedFetch(articleUrl, {
        tenantId: ctx.tenantId,
        headers: DEFAULT_HEADERS,
        timeoutMs: 25_000,
        maxBytes: 5 * 1024 * 1024,
      });
      const html = resp.bytes.toString('utf-8');
      const $article = cheerio.load(html);

      if (adapter.detectPaywall($article, html, resp.status)) {
        // Graceful degradation: record the URL + title only.
        const title = extractTitleFallback($article);
        const record = await writeSourceRecord({
          tenantId: ctx.tenantId,
          sourceType: 'news',
          sourceId,
          url: articleUrl,
          title,
          publishedAt: null,
          body: Buffer.from('', 'utf-8'),
          contentMime: 'text/html',
          metadata: {
            origin: adapter.origin,
            behind_paywall: true,
            entity: input.entity,
          },
          status: 'stored_partial',
        });
        if (record.isNew) newCount += 1;
        lastRecordId = record.id;
        totalBytes += record.bytes;
        warnings.push(`Paywall: ${articleUrl}`);
        continue;
      }

      const parsed = adapter.parseArticle($article, articleUrl);
      // ADR-030 per-item multiplier: engagement (viewCount, when the site
      // exposes it) composed with the recency modifier (article age). No
      // citation-count signal exists (unbuilt repo-wide); manual override is
      // deliberately excluded — it's handled entirely by ADR-032's
      // source_field_overrides at display time, not by this formula.
      const perItemMultiplier = applyRecencyModifier(
        deriveMultiplier(parsed.viewCount ?? null),
        parsed.publishedAt,
        RECENCY_PRESETS.news
      );

      const metadata: Record<string, unknown> = {
        origin: adapter.origin,
        entity: input.entity,
        title: parsed.title,
        author: parsed.author,
        publishedAt: parsed.publishedAt,
        canonicalUrl: parsed.canonicalUrl,
        bodyLength: parsed.body?.length ?? 0,
        viewCount: parsed.viewCount ?? null,
        perItemMultiplier,
      };

      const record = await writeSourceRecord({
        tenantId: ctx.tenantId,
        sourceType: 'news',
        sourceId,
        url: parsed.canonicalUrl,
        title: parsed.title,
        publishedAt: parsed.publishedAt,
        body: resp.bytes,
        contentMime: resp.contentType,
        metadata,
      });
      if (record.isNew) newCount += 1;
      lastRecordId = record.id;
      totalBytes += record.bytes;
    } catch (err) {
      if (err instanceof SourceFetchError && err.code === 'HTTP_ERROR') {
        // Paywall-at-HTTP-layer: 402 and 403 are common for gated sites.
        if (err.status === 402 || err.status === 403) {
          try {
            const record = await writeSourceRecord({
              tenantId: ctx.tenantId,
              sourceType: 'news',
              sourceId,
              url: articleUrl,
              title: hit.title ?? null,
              publishedAt: null,
              body: Buffer.from('', 'utf-8'),
              contentMime: 'text/html',
              metadata: {
                origin: adapter.origin,
                behind_paywall: true,
                entity: input.entity,
                httpStatus: err.status,
              },
              status: 'stored_partial',
            });
            if (record.isNew) newCount += 1;
            lastRecordId = record.id;
            totalBytes += record.bytes;
            warnings.push(`Paywall HTTP ${err.status}: ${articleUrl}`);
            continue;
          } catch (innerErr) {
            warnings.push(
              `Failed to record paywalled ${articleUrl}: ${(innerErr as Error).message}`
            );
            continue;
          }
        }
      }
      warnings.push(
        `Failed to fetch ${articleUrl}: ${(err as Error).message}`
      );
    }
  }

  return {
    sourceType: 'news',
    sourceRecordId: lastRecordId,
    canonicalUrl: searchUrl,
    isNew: newCount > 0,
    bytes: totalBytes,
    summary: `${adapter.label}: ${hits.length} article(s) attempted (${newCount} new) for "${input.entity.name}"`,
    metadata: {
      origin: adapter.origin,
      attempted: hits.length,
      newCount,
      entity: input.entity,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// -----------------------------------------------------------------------------
// Helpers used by per-site adapters + shell
// -----------------------------------------------------------------------------

export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'NetworkNavigator-Research/1.0 (contact: research@weavelogic.ai)',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

/**
 * Map a raw article view-count to the per-item multiplier for ADR-030's
 * composite weight. Per the operator brief: ≥ 1000 views → 1.2, else 1.0.
 */
export function deriveMultiplier(viewCount: number | null): number {
  if (viewCount == null || Number.isNaN(viewCount)) return 1.0;
  if (viewCount >= 1000) return 1.2;
  return 1.0;
}

/**
 * Build a Google News RSS `site:` query for sites whose first-party search
 * pages require JavaScript. We keep this as a helper because WSJ/Bloomberg/
 * CNBC may fall back to it per §7.2.
 */
export function googleNewsSiteQuery(
  siteHost: string,
  entity: NewsTargetEntity
): string {
  const quotedName = `"${entity.name.replace(/"/g, '')}"`;
  const domainClause = entity.domain ? ` "${entity.domain}"` : '';
  const q = encodeURIComponent(`site:${siteHost} ${quotedName}${domainClause}`);
  // `/rss/search` is the canonical Google News RSS endpoint.
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

/** Extract a title from `<title>` or `<h1>` as a last-ditch fallback. */
export function extractTitleFallback($: CheerioAPI): string | null {
  const t = $('meta[property="og:title"]').attr('content') ?? $('title').first().text();
  const cleaned = (t ?? '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Grab a <meta> tag's content. Returns null when missing or empty. */
export function metaContent(
  $: CheerioAPI,
  selector: string
): string | null {
  const raw = $(selector).first().attr('content');
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Concatenate article paragraph text under a container selector. Returns null
 * when no paragraphs matched.
 */
export function collectBody(
  $: CheerioAPI,
  containerSelector: string
): string | null {
  const root: Cheerio<AnyNode> = $(containerSelector);
  if (root.length === 0) return null;
  const parts: string[] = [];
  root.find('p').each((_i, el) => {
    const text = $(el).text().trim();
    if (text.length > 0) parts.push(text);
  });
  const body = parts.join('\n\n');
  return body.length > 0 ? body : null;
}

/**
 * Parse a view-count from a Schema.org JSON-LD block on the page. Returns
 * null if the block is missing, invalid JSON, or lacks a recognized field.
 * Handles both `InteractionCounter` and ad-hoc `viewCount` fields that
 * outlet-specific scripts surface.
 */
export function parseViewCountFromJsonLd($: CheerioAPI): number | null {
  const nodes = $('script[type="application/ld+json"]');
  for (let i = 0; i < nodes.length; i++) {
    const raw = $(nodes[i]).contents().first().data() ?? $(nodes[i]).text();
    const text = typeof raw === 'string' ? raw : '';
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const found = findViewCount(parsed);
    if (found != null) return found;
  }
  return null;
}

function findViewCount(node: unknown): number | null {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const v = findViewCount(item);
      if (v != null) return v;
    }
    return null;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    // InteractionCounter shape: {interactionType: ".../ReadAction", userInteractionCount: 1234}
    if (
      typeof obj.interactionType === 'string' &&
      typeof obj.userInteractionCount === 'number' &&
      /ReadAction|ViewAction/i.test(String(obj.interactionType))
    ) {
      return obj.userInteractionCount;
    }
    if (typeof obj.viewCount === 'number') return obj.viewCount;
    for (const key of Object.keys(obj)) {
      const v = findViewCount(obj[key]);
      if (v != null) return v;
    }
  }
  return null;
}

/** Extract a publishedAt ISO string from common meta tags. */
export function metaPublishedAt($: CheerioAPI): string | null {
  const candidates = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const sel of candidates) {
    const v = metaContent($, sel);
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** Extract the canonical URL from the <link rel="canonical"> or og:url. */
export function metaCanonicalUrl(
  $: CheerioAPI,
  fallback: string
): string {
  const link = $('link[rel="canonical"]').first().attr('href');
  const og = metaContent($, 'meta[property="og:url"]');
  const candidate = (link ?? og ?? '').trim();
  if (!candidate) return fallback;
  try {
    return canonicalizeUrl(candidate);
  } catch {
    return fallback;
  }
}

/** Common author parsing: try <meta name="author">, then byline selectors. */
export function metaAuthor(
  $: CheerioAPI,
  bylineSelectors: string[] = []
): string | null {
  const meta =
    metaContent($, 'meta[name="author"]') ??
    metaContent($, 'meta[property="article:author"]');
  if (meta) return meta;
  for (const sel of bylineSelectors) {
    const text = $(sel).first().text().trim();
    if (text.length > 0) return text;
  }
  return null;
}

/** Sentinel — so the type system reminds us that 'news' is the only type. */
export const NEWS_SOURCE_TYPE: SourceType = 'news';

/**
 * Test-accessible wrapper over `cheerio.load`. Exposed here so tests can
 * build a CheerioAPI through the `@/` alias without resolving the `cheerio`
 * package from the tests/ directory (tests/ is outside `app/node_modules`).
 * Runtime code imports cheerio directly.
 */
export function loadHtml(html: string, opts?: { xmlMode?: boolean }): CheerioAPI {
  if (opts?.xmlMode) return cheerio.load(html, { xmlMode: true });
  return cheerio.load(html);
}
