// Corporate blog discovery connector (Phase 3 Track F).
//
// Given a company domain, discover a blog feed and persist recent entries.
// Strategy (first-match-wins):
//   1. Probe candidate RSS/Atom paths: /feed, /feed/, /rss, /rss.xml,
//      /blog/feed, /atom.xml. First one that returns a parseable feed is used.
//   2. If no feed, fall back to /sitemap.xml and filter `<url>` entries whose
//      `<lastmod>` is within the last 90 days AND whose `<loc>` path matches
//      /blog/, /news/, or /press/.
//   3. Dedup against any feed already known for this domain — if a feed is
//      already tracked in source_subscriptions or source_feeds, we only mark
//      blog_discovered=TRUE on the company and skip.
//
// Robots: every probe is routed through gatedFetch which enforces robots.txt.
//
// Gate: `RESEARCH_FLAGS.sources` AND `RESEARCH_CONNECTOR_BLOG === 'true'`.

import { gatedFetch, writeSourceRecord, SourceFetchError } from '../service';
import { query } from '../../db/client';
import { canonicalizeUrl, hostOf } from '../url-normalize';
import { parseXml, normalizeRssItems, type XmlNode } from './rss';
import { applyRecencyModifier, RECENCY_PRESETS } from './recency-modifier';
import type {
  SourceConnector,
  CorporateBlogInput,
  ConnectorContext,
  ConnectorResult,
} from '../types';

export function isBlogConnectorEnabled(): boolean {
  return process.env.RESEARCH_CONNECTOR_BLOG === 'true';
}

export const DEFAULT_CANDIDATE_PATHS = [
  '/feed',
  '/feed/',
  '/rss',
  '/rss.xml',
  '/blog/feed',
  '/atom.xml',
];

const SITEMAP_PATH = '/sitemap.xml';
const LOOKBACK_DAYS = 90;
const BLOGGY_PATH = /\/(blog|news|press)\//i;

/** Normalize a raw domain string into `https://<host>`. Strips scheme + path. */
export function normalizeDomain(raw: string): string {
  let s = raw.trim();
  if (!s) throw new Error('domain must be non-empty');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const url = new URL(s);
  return `https://${url.hostname.toLowerCase()}`;
}

/**
 * Try each candidate path against the origin. Returns the first URL that
 * successfully parses as RSS/Atom with ≥ 1 item, or null.
 */
export async function discoverFeed(
  origin: string,
  ctx: ConnectorContext,
  candidatePaths: string[] = DEFAULT_CANDIDATE_PATHS
): Promise<{ feedUrl: string; items: ReturnType<typeof normalizeRssItems> } | null> {
  for (const path of candidatePaths) {
    const candidate = `${origin}${path}`;
    try {
      const resp = await gatedFetch(candidate, {
        tenantId: ctx.tenantId,
        headers: {
          Accept:
            'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5',
          'User-Agent': 'NetworkNavigator/1.0',
        },
        timeoutMs: 10_000,
        maxBytes: 2 * 1024 * 1024,
      });
      const tree = parseXml(resp.bytes.toString('utf-8'));
      const items = normalizeRssItems(tree);
      if (items.length > 0) {
        return { feedUrl: candidate, items };
      }
    } catch (err) {
      // 404 / 403 / robots-disallow is expected on most candidates. Only an
      // unexpected error type aborts discovery.
      if (!(err instanceof SourceFetchError)) {
        throw err;
      }
    }
  }
  return null;
}

/** Parse a /sitemap.xml response into (loc, lastmod?) tuples. */
export function parseSitemap(xml: string): Array<{ loc: string; lastmod: Date | null }> {
  const root = parseXml(xml);
  if (!root) return [];
  const urlset = findChildByName(root, 'urlset');
  if (!urlset) return [];
  const out: Array<{ loc: string; lastmod: Date | null }> = [];
  for (const child of urlset.children) {
    if (child.name !== 'url') continue;
    const loc = textOfChild(child, 'loc');
    if (!loc) continue;
    const lastmodRaw = textOfChild(child, 'lastmod');
    const lastmod = lastmodRaw ? parseLastmod(lastmodRaw) : null;
    out.push({ loc, lastmod });
  }
  return out;
}

function findChildByName(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) if (c.name === name) return c;
  return null;
}

function textOfChild(node: XmlNode, name: string): string {
  const child = findChildByName(node, name);
  if (!child) return '';
  if (child.text) return child.text.trim();
  return '';
}

function parseLastmod(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Check whether a feed URL is already tracked for this tenant, via either the
 * source_subscriptions table (Track F) or the source_feeds table (Track E).
 */
export async function isFeedAlreadyKnown(
  tenantId: string,
  feedUrl: string
): Promise<boolean> {
  const res = await query<{ found: number }>(
    `SELECT 1 AS found FROM source_subscriptions
       WHERE tenant_id = $1 AND feed_url = $2
     UNION ALL
     SELECT 1 AS found FROM source_feeds
       WHERE tenant_id = $1 AND feed_url = $2
     LIMIT 1`,
    [tenantId, feedUrl]
  );
  return res.rows.length > 0;
}

export const corporateBlogConnector: SourceConnector<CorporateBlogInput> = {
  sourceType: 'blog',
  label: 'Corporate Blog',

  async invoke(
    input: CorporateBlogInput,
    ctx: ConnectorContext
  ): Promise<ConnectorResult> {
    if (!isBlogConnectorEnabled()) {
      return {
        sourceType: 'blog',
        sourceRecordId: null,
        canonicalUrl: input.domain,
        isNew: false,
        bytes: 0,
        summary: 'blog connector disabled (RESEARCH_CONNECTOR_BLOG!=true)',
      };
    }

    const maxItems = Math.max(1, Math.min(input.maxItems ?? 30, 100));
    const origin = normalizeDomain(input.domain);
    const host = hostOf(origin);
    const warnings: string[] = [];

    // Steps 1 + 2 — discovery chain.
    const discovered = await discoverFeed(origin, ctx, input.candidatePaths);
    let feedUrl: string | null = null;
    let items: Array<{
      link: string;
      title: string | null;
      pubDate: Date | null;
      description: string | null;
      guid: string | null;
    }> = [];

    if (discovered) {
      feedUrl = discovered.feedUrl;
      items = discovered.items;
    } else {
      const sitemapUrl = `${origin}${SITEMAP_PATH}`;
      try {
        const resp = await gatedFetch(sitemapUrl, {
          tenantId: ctx.tenantId,
          headers: { Accept: 'application/xml, text/xml' },
          timeoutMs: 15_000,
          maxBytes: 5 * 1024 * 1024,
        });
        const entries = parseSitemap(resp.bytes.toString('utf-8'));
        const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
        items = entries
          .filter((e) => {
            if (!e.lastmod || e.lastmod.getTime() < cutoff) return false;
            try {
              const path = new URL(e.loc).pathname;
              return BLOGGY_PATH.test(path);
            } catch {
              return false;
            }
          })
          .slice(0, maxItems)
          .map((e) => ({
            link: e.loc,
            title: null,
            pubDate: e.lastmod,
            description: null,
            guid: null,
          }));
        feedUrl = sitemapUrl;
      } catch (err) {
        warnings.push(`sitemap fallback failed: ${(err as Error).message}`);
      }
    }

    if (!feedUrl || items.length === 0) {
      // Record that this domain was probed so the cron doesn't loop on it.
      await query(
        `UPDATE companies SET blog_discovered = TRUE WHERE id = $1`,
        [input.companyId]
      );
      return {
        sourceType: 'blog',
        sourceRecordId: null,
        canonicalUrl: origin,
        isNew: false,
        bytes: 0,
        summary: `No blog feed discovered for ${host}`,
        warnings,
      };
    }

    // Dedup: if the feed URL is already tracked, mark discovered and skip.
    const alreadyKnown = await isFeedAlreadyKnown(ctx.tenantId, feedUrl);
    if (alreadyKnown) {
      await query(
        `UPDATE companies SET blog_discovered = TRUE WHERE id = $1`,
        [input.companyId]
      );
      return {
        sourceType: 'blog',
        sourceRecordId: null,
        canonicalUrl: feedUrl,
        isNew: false,
        bytes: 0,
        summary: `Feed ${feedUrl} already tracked; skipped`,
        warnings,
      };
    }

    let lastRecordId: string | null = null;
    let newCount = 0;
    let totalBytes = 0;

    for (const item of items.slice(0, maxItems)) {
      if (!item.link) continue;
      let canonicalLink: string;
      try {
        canonicalLink = canonicalizeUrl(item.link);
      } catch {
        warnings.push(`invalid link "${item.link}" — skipped`);
        continue;
      }
      let pathPart = '/';
      try {
        pathPart = new URL(canonicalLink).pathname;
      } catch {
        // fall through
      }
      // Blog source_id shape per `05-source-expansion.md` §12: `<domain>:<path>`.
      const sourceId = `${host}:${pathPart}`;
      // ADR-030 per-item multiplier: corporate blogs expose no engagement
      // count (no view/share data in RSS or the sitemap fallback) and
      // citation count is unbuilt repo-wide, so recency (post age) is the
      // only signal available here — same rationale as podcast.ts.
      const perItemMultiplier = applyRecencyModifier(
        1.0,
        item.pubDate,
        RECENCY_PRESETS.blog
      );
      const metadata = {
        blog: {
          feedUrl,
          domain: host,
          companyId: input.companyId,
          guid: item.guid,
          description: item.description,
          pubDate: item.pubDate?.toISOString() ?? null,
          perItemMultiplier,
        },
      };

      const body = Buffer.from(
        JSON.stringify({
          title: item.title,
          link: canonicalLink,
          description: item.description,
          pubDate: item.pubDate?.toISOString() ?? null,
          guid: item.guid,
        }),
        'utf-8'
      );

      const record = await writeSourceRecord({
        tenantId: ctx.tenantId,
        sourceType: 'blog',
        sourceId,
        url: canonicalLink,
        title: item.title,
        publishedAt: item.pubDate,
        body,
        contentMime: 'application/json',
        metadata,
      });
      if (record.isNew) newCount += 1;
      lastRecordId = record.id;
      totalBytes += record.bytes;

      // Link item to the company at 0.70 confidence. Blog posts are
      // company-authored so 'issuer' is the correct role.
      await query(
        `INSERT INTO source_record_entities
           (source_record_id, entity_kind, entity_id, role, confidence, extracted_by)
         VALUES ($1, 'company', $2, 'issuer', 0.70, 'connector-rule')
         ON CONFLICT DO NOTHING`,
        [record.id, input.companyId]
      );
    }

    // Register the discovered feed as an RSS subscription so the RSS cron can
    // poll it forward. Insert-if-absent rather than ON CONFLICT to avoid
    // partial-index upsert syntax quirks between pg client versions.
    const existing = await query<{ id: string }>(
      `SELECT id FROM source_subscriptions
       WHERE tenant_id = $1 AND feed_url = $2`,
      [ctx.tenantId, feedUrl]
    );
    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO source_subscriptions (tenant_id, kind, feed_url, enabled)
         VALUES ($1, 'rss', $2, TRUE)`,
        [ctx.tenantId, feedUrl]
      );
    }
    await query(
      `UPDATE companies SET blog_discovered = TRUE WHERE id = $1`,
      [input.companyId]
    );

    return {
      sourceType: 'blog',
      sourceRecordId: lastRecordId,
      canonicalUrl: feedUrl,
      isNew: newCount > 0,
      bytes: totalBytes,
      summary: `Discovered blog feed ${feedUrl} for ${host}: ${items.length} items (${newCount} new)`,
      metadata: { feedUrl, itemCount: items.length, newCount },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};
