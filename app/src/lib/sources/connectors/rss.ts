// RSS core connector (Phase 3 Track F).
//
// Handles RSS 2.0 and Atom 1.0 feeds. The fetch path is the shared gatedFetch
// (rate-limit + robots). Parsing runs on a tiny self-contained XML walker so
// we don't take a new dependency — both feed shapes are structurally simple
// and the user's brief explicitly forbids new external deps.
//
// Per-item processing:
//   1. Fetch the feed.
//   2. Parse into a normalized array of items {link, title, description,
//      pubDate, guid, categories[], authorName?}.
//   3. For each item, form a stable source_id = `<feed_url>::<guid-or-link>`
//      and write a source_records row with source_type='rss'.
//   4. Compute per_item_multiplier: 1.0 default; bump to 1.2 when the item's
//      canonicalized link has been seen in ≥ 2 other feeds in the last 30
//      days (cross-feed republication signal per ADR-030), composed with the
//      recency modifier (item age; see `./recency-modifier.ts`).
//
// Gated on `RESEARCH_FLAGS.sources` AND the per-connector
// `RESEARCH_CONNECTOR_RSS === 'true'` env flag.

import { gatedFetch, writeSourceRecord } from '../service';
import { query } from '../../db/client';
import { canonicalizeUrl } from '../url-normalize';
import { applyRecencyModifier, RECENCY_PRESETS } from './recency-modifier';
import type {
  SourceConnector,
  RssInput,
  ConnectorContext,
  ConnectorResult,
} from '../types';

export function isRssConnectorEnabled(): boolean {
  return process.env.RESEARCH_CONNECTOR_RSS === 'true';
}

/** Normalized feed item after parse. */
export interface RssItem {
  link: string;
  title: string | null;
  description: string | null;
  pubDate: Date | null;
  guid: string | null;
  categories: string[];
  authorName: string | null;
}

// ---------------------------------------------------------------------------
// Tiny XML → DOM-ish parser
// ---------------------------------------------------------------------------
// Node has no native DOMParser. We write a minimal parser that extracts
// element nodes + text children. Enough for RSS/Atom which are shallow and
// typically well-formed. Security: no external entity resolution; only the
// five named entities + numeric entities are decoded. DOCTYPE / ENTITY decls
// are ignored.

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const code = parseInt(ent.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (ent.startsWith('#')) {
      const code = parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const lower = ent.toLowerCase();
    return NAMED_ENTITIES[lower] ?? match;
  });
}

/**
 * Parse a subset of XML into XmlNode trees. Not a full XML parser — only
 * element tags, attributes, CDATA sections, and text. Comments, PIs, and
 * DOCTYPE declarations are dropped. Unclosed tags degrade to "best effort".
 */
export function parseXml(xml: string): XmlNode | null {
  const cleaned = xml
    .replace(/<\?[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');

  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tagRe =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<\/\s*([A-Za-z_][\w:-]*)\s*>|<([A-Za-z_][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;

  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(cleaned)) !== null) {
    const current = stack[stack.length - 1];
    if (m[1] !== undefined) {
      current.text = (current.text ?? '') + m[1];
    } else if (m[2] !== undefined) {
      // close tag — pop the matching open.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[2]) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const node: XmlNode = {
        name: m[3],
        attrs: parseAttrs(m[4] ?? ''),
        children: [],
        text: '',
      };
      current.children.push(node);
      if (m[5] !== '/') {
        stack.push(node);
      }
    } else if (m[6] !== undefined) {
      const txt = decodeEntities(m[6]).trim();
      if (txt.length > 0) {
        current.text = (current.text ? current.text + ' ' : '') + txt;
      }
    }
  }
  return root;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(s)) !== null) {
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out[m[1]] = decodeEntities(value);
  }
  return out;
}

function findChild(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) {
    if (c.name === name) return c;
  }
  return null;
}

function findChildren(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

function textOf(node: XmlNode | null): string {
  if (!node) return '';
  if (node.text) return node.text.trim();
  // Deep collect — some RSS puts text inside nested elements.
  let buf = '';
  for (const c of node.children) {
    const sub = textOf(c);
    if (sub) buf += (buf ? ' ' : '') + sub;
  }
  return buf.trim();
}

// ---------------------------------------------------------------------------
// Feed normalization
// ---------------------------------------------------------------------------

export function normalizeRssItems(root: XmlNode | null): RssItem[] {
  if (!root) return [];
  const rss = findChild(root, 'rss');
  if (rss) {
    const channel = findChild(rss, 'channel');
    if (!channel) return [];
    return findChildren(channel, 'item').map(rss2Item);
  }
  const feed = findChild(root, 'feed');
  if (feed) {
    return findChildren(feed, 'entry').map(atomEntry);
  }
  return [];
}

function rss2Item(node: XmlNode): RssItem {
  const link = textOf(findChild(node, 'link')) || '';
  const title = textOf(findChild(node, 'title')) || null;
  const description =
    textOf(findChild(node, 'description')) ||
    textOf(findChild(node, 'content:encoded')) ||
    null;
  const pubDate = parseDate(textOf(findChild(node, 'pubDate')));
  const guid = textOf(findChild(node, 'guid')) || null;
  const categories = findChildren(node, 'category').map(textOf).filter(Boolean);
  const authorName =
    textOf(findChild(node, 'dc:creator')) ||
    textOf(findChild(node, 'author')) ||
    null;
  return { link, title, description, pubDate, guid, categories, authorName };
}

function atomEntry(node: XmlNode): RssItem {
  let link = '';
  const linkNode = findChild(node, 'link');
  if (linkNode) {
    link = linkNode.attrs.href ?? textOf(linkNode);
  }
  const title = textOf(findChild(node, 'title')) || null;
  const description =
    textOf(findChild(node, 'summary')) ||
    textOf(findChild(node, 'content')) ||
    null;
  const pubDate =
    parseDate(textOf(findChild(node, 'published'))) ??
    parseDate(textOf(findChild(node, 'updated')));
  const guid = textOf(findChild(node, 'id')) || null;
  const categories = findChildren(node, 'category')
    .map((c) => c.attrs.term ?? textOf(c))
    .filter(Boolean);
  const authorNode = findChild(node, 'author');
  const authorName = authorNode ? textOf(findChild(authorNode, 'name')) || null : null;
  return { link, title, description, pubDate, guid, categories, authorName };
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Per-item multiplier — republication signal
// ---------------------------------------------------------------------------

/**
 * How many OTHER feeds in the last 30 days produced a source_records row for
 * `canonicalizedLink`? ≥ 2 → cross-feed republication → per_item_multiplier
 * boosted to 1.2. Matches ADR-030's per-item multiplier model.
 */
export async function computeRepublicationMultiplier(
  tenantId: string,
  canonicalizedLink: string,
  currentFeedUrl: string
): Promise<number> {
  const res = await query<{ distinct_feeds: string }>(
    `SELECT COUNT(DISTINCT metadata->'rss'->>'feedUrl')::text AS distinct_feeds
     FROM source_records
     WHERE tenant_id = $1
       AND source_type = 'rss'
       AND canonical_url = $2
       AND fetched_at > NOW() - INTERVAL '30 days'
       AND (metadata->'rss'->>'feedUrl') IS NOT NULL
       AND (metadata->'rss'->>'feedUrl') <> $3`,
    [tenantId, canonicalizedLink, currentFeedUrl]
  );
  const distinct = Number(res.rows[0]?.distinct_feeds ?? 0);
  return distinct >= 2 ? 1.2 : 1.0;
}

// ---------------------------------------------------------------------------
// Connector entry
// ---------------------------------------------------------------------------

const RSS_ACCEPT =
  'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';

export const rssConnector: SourceConnector<RssInput> = {
  sourceType: 'rss',
  label: 'RSS / Atom Feed',

  async invoke(input: RssInput, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (!isRssConnectorEnabled()) {
      return {
        sourceType: 'rss',
        sourceRecordId: null,
        canonicalUrl: input.feedUrl,
        isNew: false,
        bytes: 0,
        summary: 'rss connector disabled (RESEARCH_CONNECTOR_RSS!=true)',
      };
    }

    const feedUrl = input.feedUrl;
    const maxItems = Math.max(1, Math.min(input.maxItems ?? 50, 200));
    const warnings: string[] = [];

    const resp = await gatedFetch(feedUrl, {
      tenantId: ctx.tenantId,
      headers: { Accept: RSS_ACCEPT, 'User-Agent': 'NetworkNavigator/1.0' },
      timeoutMs: 20_000,
      maxBytes: 5 * 1024 * 1024,
    });

    const xml = resp.bytes.toString('utf-8');
    const tree = parseXml(xml);
    const items = normalizeRssItems(tree).slice(0, maxItems);

    if (items.length === 0) {
      return {
        sourceType: 'rss',
        sourceRecordId: null,
        canonicalUrl: feedUrl,
        isNew: false,
        bytes: 0,
        summary: `Feed ${feedUrl} yielded 0 items`,
        warnings,
      };
    }

    let lastRecordId: string | null = null;
    let newCount = 0;
    let totalBytes = 0;

    for (const item of items) {
      if (!item.link) {
        warnings.push('item missing link — skipped');
        continue;
      }
      let canonicalLink: string;
      try {
        canonicalLink = canonicalizeUrl(item.link);
      } catch {
        warnings.push(`invalid link "${item.link}" — skipped`);
        continue;
      }
      const sourceId = `${feedUrl}::${item.guid ?? canonicalLink}`;
      // ADR-030 per-item multiplier: cross-feed republication (engagement
      // proxy) composed with the recency modifier (item age). No citation
      // count (unbuilt) or manual override (handled by ADR-032, not here).
      const perItemMultiplier = applyRecencyModifier(
        await computeRepublicationMultiplier(ctx.tenantId, canonicalLink, feedUrl),
        item.pubDate,
        RECENCY_PRESETS.rss
      );

      const metadata = {
        rss: {
          feedUrl,
          feedKind: input.feedKind ?? null,
          guid: item.guid,
          categories: item.categories,
          authorName: item.authorName,
          description: item.description,
          perItemMultiplier,
        },
      };

      // The marker body is the feed item itself. A per-item dereference
      // upgrade can replace this later.
      const body = Buffer.from(
        JSON.stringify({
          title: item.title,
          link: canonicalLink,
          description: item.description,
          authorName: item.authorName,
          categories: item.categories,
          pubDate: item.pubDate?.toISOString() ?? null,
          guid: item.guid,
        }),
        'utf-8'
      );

      const record = await writeSourceRecord({
        tenantId: ctx.tenantId,
        sourceType: 'rss',
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
    }

    return {
      sourceType: 'rss',
      sourceRecordId: lastRecordId,
      canonicalUrl: feedUrl,
      isNew: newCount > 0,
      bytes: totalBytes,
      summary: `Polled ${items.length} items from ${feedUrl} (${newCount} new)`,
      metadata: { itemCount: items.length, newCount, feedKind: input.feedKind ?? null },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};
