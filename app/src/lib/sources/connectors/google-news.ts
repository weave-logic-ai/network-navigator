// Google News RSS fallback connector (Phase 3 Track F).
//
// Given a target name (person or company), construct a Google News RSS query
// URL and pass the response through the core RSS parser. Items are written as
// source_type='news' (not 'rss') with `origin='google-news'` recorded in
// metadata so later reconciliation can distinguish editorially-curated news
// from raw feed items.
//
// Rate-limiting: news.google.com has a soft 30/min cap (see
// `05-source-expansion.md` §7.2 + §11). The shared rate-limiter bucket handles
// this via DEFAULT_BUCKETS['news.google.com'].
//
// Gate: `RESEARCH_FLAGS.sources` AND `RESEARCH_CONNECTOR_GOOGLE_NEWS === 'true'`.

import { gatedFetch, writeSourceRecord } from '../service';
import { query } from '../../db/client';
import { canonicalizeUrl } from '../url-normalize';
import { parseXml, normalizeRssItems, type RssItem } from './rss';
import { applyRecencyModifier, RECENCY_PRESETS } from './recency-modifier';
import type {
  SourceConnector,
  GoogleNewsInput,
  ConnectorContext,
  ConnectorResult,
} from '../types';

export function isGoogleNewsConnectorEnabled(): boolean {
  return process.env.RESEARCH_CONNECTOR_GOOGLE_NEWS === 'true';
}

/**
 * Build the Google News RSS search URL for a target. The name is wrapped in
 * double-quotes so Google News treats it as a near-exact phrase match. hl/gl
 * default to en-US/US per `05-source-expansion.md` §7.2.
 *
 * Example: buildGoogleNewsQuery("Acme Robotics") →
 *   https://news.google.com/rss/search?q=%22Acme%20Robotics%22&hl=en-US&gl=US
 */
export function buildGoogleNewsQuery(
  targetName: string,
  hl = 'en-US',
  gl = 'US'
): string {
  const trimmed = targetName.trim();
  if (!trimmed) throw new Error('targetName must be non-empty');
  const q = `"${trimmed}"`;
  return (
    'https://news.google.com/rss/search?' +
    `q=${encodeURIComponent(q)}` +
    `&hl=${encodeURIComponent(hl)}` +
    `&gl=${encodeURIComponent(gl)}`
  );
}

const NEWS_ACCEPT = 'application/rss+xml, application/xml;q=0.9, */*;q=0.5';

export const googleNewsConnector: SourceConnector<GoogleNewsInput> = {
  sourceType: 'news',
  label: 'Google News RSS',

  async invoke(
    input: GoogleNewsInput,
    ctx: ConnectorContext
  ): Promise<ConnectorResult> {
    if (!isGoogleNewsConnectorEnabled()) {
      return {
        sourceType: 'news',
        sourceRecordId: null,
        canonicalUrl: input.targetName,
        isNew: false,
        bytes: 0,
        summary:
          'google-news connector disabled (RESEARCH_CONNECTOR_GOOGLE_NEWS!=true)',
      };
    }

    const maxItems = Math.max(1, Math.min(input.maxItems ?? 30, 100));
    const queryUrl = buildGoogleNewsQuery(input.targetName, input.hl, input.gl);
    const warnings: string[] = [];

    const resp = await gatedFetch(queryUrl, {
      tenantId: ctx.tenantId,
      headers: { Accept: NEWS_ACCEPT, 'User-Agent': 'NetworkNavigator/1.0' },
      timeoutMs: 20_000,
      maxBytes: 5 * 1024 * 1024,
    });

    const tree = parseXml(resp.bytes.toString('utf-8'));
    const items: RssItem[] = normalizeRssItems(tree).slice(0, maxItems);

    if (items.length === 0) {
      return {
        sourceType: 'news',
        sourceRecordId: null,
        canonicalUrl: queryUrl,
        isNew: false,
        bytes: 0,
        summary: `Google News for "${input.targetName}" yielded 0 items`,
        warnings,
      };
    }

    let lastRecordId: string | null = null;
    let newCount = 0;
    let totalBytes = 0;

    for (const item of items) {
      if (!item.link) continue;
      let canonicalLink: string;
      try {
        canonicalLink = canonicalizeUrl(item.link);
      } catch {
        warnings.push(`invalid link "${item.link}" — skipped`);
        continue;
      }

      const sourceId = `${queryUrl}::${item.guid ?? canonicalLink}`;
      // ADR-030 per-item multiplier: this feed is Google's redirect/aggregator
      // XML, not the article itself, so no viewCount JSON-LD is available
      // (unlike `news/shared.ts`'s direct-fetch connectors) and citation
      // count is unbuilt repo-wide. Recency (item age) is the only signal
      // available here.
      const perItemMultiplier = applyRecencyModifier(
        1.0,
        item.pubDate,
        RECENCY_PRESETS.news
      );
      const metadata = {
        news: {
          origin: 'google-news',
          queryUrl,
          targetName: input.targetName,
          guid: item.guid,
          description: item.description,
          authorName: item.authorName,
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
          origin: 'google-news',
        }),
        'utf-8'
      );

      const record = await writeSourceRecord({
        tenantId: ctx.tenantId,
        sourceType: 'news',
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

      // Low-confidence "mentioned" link so the user can confirm in the snippet
      // UI later. Deliberately not "issuer" (that's for press releases).
      const entityId = input.contactId ?? input.companyId ?? null;
      const entityKind = input.contactId
        ? 'contact'
        : input.companyId
          ? 'company'
          : null;
      if (entityId && entityKind) {
        await query(
          `INSERT INTO source_record_entities
             (source_record_id, entity_kind, entity_id, role, confidence, extracted_by)
           VALUES ($1, $2, $3, 'mentioned', 0.60, 'connector-rule')
           ON CONFLICT DO NOTHING`,
          [record.id, entityKind, entityId]
        );
      }
    }

    return {
      sourceType: 'news',
      sourceRecordId: lastRecordId,
      canonicalUrl: queryUrl,
      isNew: newCount > 0,
      bytes: totalBytes,
      summary: `Google News for "${input.targetName}": ${items.length} items (${newCount} new)`,
      metadata: { itemCount: items.length, newCount, queryUrl },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};
