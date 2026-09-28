// Concrete fallback strategies per `01-parser-audit.md` §4.3.
//
// Each strategy returns a partial list of `ExtractedField` entries. The
// registry layer strips fields the primary path already filled, tags the
// survivors as `source: 'fallback'`, and flattens the result into the
// parser's final field list.

import type { CheerioAPI } from 'cheerio';
import type { ExtractedField } from '../types';
import {
  registerFallback,
  type FallbackStrategy,
} from './registry';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function titleTagName($: CheerioAPI): string | null {
  const title = $('title').first().text();
  const m = title.match(/^(.+?)\s*[|\-–—]\s*LinkedIn/);
  if (!m) return null;
  return m[1].trim().replace(/,\s*verified$/, '');
}

function absolutizeProfile(href: string): string {
  const stripped = href.split('?')[0];
  return stripped.startsWith('http')
    ? stripped
    : `https://www.linkedin.com${stripped}`;
}

// ---------------------------------------------------------------------------
// PROFILE: og-meta + title-tag
// ---------------------------------------------------------------------------

const profileOgMeta: FallbackStrategy = {
  name: 'og-meta',
  pageTypes: ['PROFILE', 'COMPANY'],
  apply($: CheerioAPI): ExtractedField[] {
    const out: ExtractedField[] = [];
    const pickMeta = (prop: string): string | null => {
      const v = $(`meta[property="og:${prop}"]`).attr('content') ?? null;
      if (!v || v === 'redacted') return null;
      return v.trim();
    };

    const image = pickMeta('image');
    if (image && image.startsWith('http')) {
      out.push({
        field: 'profileImageUrl',
        value: image,
        confidence: 0.7,
        source: 'fallback',
        selectorUsed: 'fallback:og-meta[og:image]',
      });
    }
    const description = pickMeta('description');
    if (description && description.length > 8) {
      out.push({
        field: 'headline',
        value: description,
        confidence: 0.55,
        source: 'fallback',
        selectorUsed: 'fallback:og-meta[og:description]',
      });
    }
    return out;
  },
};

const profileTitleTag: FallbackStrategy = {
  name: 'title-tag',
  pageTypes: ['PROFILE'],
  apply($: CheerioAPI): ExtractedField[] {
    const out: ExtractedField[] = [];
    const name = titleTagName($);
    if (name) {
      out.push({
        field: 'name',
        value: name,
        confidence: 0.85,
        source: 'fallback',
        selectorUsed: 'fallback:title-tag',
      });
    }
    // The page title can preserve a role after a top-card selector breaks.
    // It is weaker evidence than visible profile text, so keep its confidence
    // low and let the registry use it only when headline was not extracted.
    const title = $('title').first().text().trim();
    const role = title.match(/^.+?\s[-–—]\s(.+?)\s\|\sLinkedIn$/i)?.[1]?.trim();
    if (role) {
      out.push({
        field: 'headline',
        value: role,
        confidence: 0.3,
        source: 'fallback',
        selectorUsed: 'fallback:title-tag[headline]',
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// COMPANY: title-tag for company name
// ---------------------------------------------------------------------------

const companyTitleTag: FallbackStrategy = {
  name: 'title-tag',
  pageTypes: ['COMPANY'],
  apply($: CheerioAPI): ExtractedField[] {
    const name = titleTagName($);
    if (!name) return [];
    return [
      {
        field: 'companyName',
        value: name,
        confidence: 0.8,
        source: 'fallback',
        selectorUsed: 'fallback:title-tag',
      },
    ];
  },
};

// Phase 1.5: scan all anchors + dl entries for a "NNN associated members"-style
// string or a year-only dd under <dt>Founded</dt>. Robust to hashed classes —
// only cares about the stable text + /people/ href shape.
const companyDetailsHref: FallbackStrategy = {
  name: 'details-href',
  pageTypes: ['COMPANY'],
  apply($: CheerioAPI): ExtractedField[] {
    const out: ExtractedField[] = [];

    // employeesOnLinkedIn — look for anchors whose href points at the company
    // people roll-up OR text that reads "N associated members". Pick the
    // largest integer we see; LinkedIn never shows a second one.
    let best: number | null = null;
    $('a[href*="/people/"], a[href*="currentCompany"]').each((_idx, el) => {
      const text = $(el).text();
      const m = text.match(/([\d,]+)\s+associated\s+members/i) ?? text.match(/([\d,]+)/);
      if (!m) return;
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (!isNaN(n) && (best === null || n > best)) best = n;
    });
    if (best === null) {
      const bodyText = $('body').text();
      const bm = bodyText.match(/([\d,]+)\s+associated\s+members/i);
      if (bm) {
        const n = parseInt(bm[1].replace(/,/g, ''), 10);
        if (!isNaN(n)) best = n;
      }
    }
    if (best !== null) {
      out.push({
        field: 'employeesOnLinkedIn',
        value: best,
        confidence: 0.65,
        source: 'fallback',
        selectorUsed: 'fallback:details-href[associated-members]',
      });
    }

    // founded — scan every <dt> for text matching /^\s*Founded\s*$/ and pull
    // the next <dd>'s 4-digit year. Redundant with the primary dt:contains
    // selector, but the fallback fires when the selector chain misses (e.g.
    // obfuscated dl wrappers on live LinkedIn).
    let founded: string | null = null;
    $('dt').each((_idx, el) => {
      const label = $(el).text().trim().toLowerCase();
      if (label !== 'founded') return;
      const ddText = $(el).next('dd').text().trim();
      const ym = ddText.match(/\b(1[89]\d{2}|20\d{2}|21\d{2})\b/);
      if (ym) founded = ym[1];
    });
    if (founded) {
      out.push({
        field: 'founded',
        value: founded,
        confidence: 0.75,
        source: 'fallback',
        selectorUsed: 'fallback:details-href[founded-dd]',
      });
    }

    return out;
  },
};

// ---------------------------------------------------------------------------
// CONNECTIONS: href-pattern (generalised from search-parser §5.3 pattern)
// ---------------------------------------------------------------------------

interface HrefHit {
  name: string;
  headline: string | null;
  profileUrl: string;
}

function collectProfileHrefHits(
  $: CheerioAPI,
  scopeSelector: string | null
): HrefHit[] {
  const scope = scopeSelector ? $(scopeSelector).first() : $('body');
  const root = scope.length > 0 ? scope : $('body');
  const seen = new Set<string>();
  const hits: HrefHit[] = [];

  root.find('a[href*="/in/"]').each((_idx, el) => {
    const $a = $(el);
    const href = $a.attr('href') ?? '';
    const text = $a.text().trim();
    if (!text || text.length < 2 || text.length > 100) return;
    if (/^(view profile|connect|message|home|help)$/i.test(text)) return;

    const slugMatch = href.match(/\/in\/([^/?]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    if (seen.has(slug)) return;
    seen.add(slug);

    // Try to grab a headline from the closest list-item / container.
    let headline: string | null = null;
    const $container = $a.closest('li, [componentkey], .feed-shared-actor');
    if ($container.length) {
      const subtitle = $container.find('span').not($a.find('span')).first().text().trim();
      if (subtitle && subtitle !== text && subtitle.length > 2 && subtitle.length < 200) {
        // Clean up centre-dot prefixes commonly found in obfuscated markup.
        headline = subtitle.replace(/^[·\s]+/, '').trim();
        if (!headline || headline.length < 3) headline = null;
      }
    }

    hits.push({
      name: text,
      headline,
      profileUrl: absolutizeProfile(href),
    });
  });

  return hits;
}

const connectionsHrefPattern: FallbackStrategy = {
  name: 'href-pattern',
  pageTypes: ['CONNECTIONS'],
  apply($: CheerioAPI): ExtractedField[] {
    const hits = collectProfileHrefHits($, '.mn-connections, main');
    if (hits.length === 0) return [];
    return [
      {
        field: 'connections',
        value: hits.map((h) => h.name),
        confidence: 0.6,
        source: 'fallback',
        selectorUsed: 'fallback:href-pattern',
      },
      {
        field: 'connectionHrefHits',
        value: JSON.stringify(hits),
        confidence: 0.6,
        source: 'fallback',
        selectorUsed: 'fallback:href-pattern',
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// MESSAGES: href-pattern inside conversation rows
// ---------------------------------------------------------------------------

const messagesHrefPattern: FallbackStrategy = {
  name: 'href-pattern',
  pageTypes: ['MESSAGES'],
  apply($: CheerioAPI): ExtractedField[] {
    const profileLinks: { slug: string; url: string }[] = [];
    const seen = new Set<string>();

    $('.msg-conversation-listitem a[href*="/in/"], .msg-conversations-container a[href*="/in/"]').each(
      (_idx, el) => {
        const href = $(el).attr('href') ?? '';
        const m = href.match(/\/in\/([^/?]+)/);
        if (!m) return;
        if (seen.has(m[1])) return;
        seen.add(m[1]);
        profileLinks.push({ slug: m[1], url: absolutizeProfile(href) });
      }
    );

    if (profileLinks.length === 0) return [];
    return [
      {
        field: 'participantProfileUrls',
        value: profileLinks.map((p) => p.url),
        confidence: 0.6,
        source: 'fallback',
        selectorUsed: 'fallback:href-pattern',
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// FEED: data-urn anchored extraction (per §5.6)
// ---------------------------------------------------------------------------

const feedDataUrn: FallbackStrategy = {
  name: 'data-urn',
  pageTypes: ['FEED'],
  apply($: CheerioAPI): ExtractedField[] {
    const urns: string[] = [];
    const authors: { urn: string; url: string | null; name: string | null }[] = [];

    $('[data-urn^="urn:li:activity"]').each((_idx, el) => {
      const $post = $(el);
      const urn = $post.attr('data-urn') ?? '';
      if (!urn) return;
      urns.push(urn);

      const $authorLink = $post.find('a[href*="/in/"]').first();
      let url: string | null = null;
      let name: string | null = null;
      if ($authorLink.length) {
        const href = $authorLink.attr('href') ?? '';
        if (href.includes('/in/')) url = absolutizeProfile(href);
        const nameText = $authorLink.text().trim();
        if (nameText.length >= 2 && nameText.length <= 100) name = nameText;
      }
      authors.push({ urn, url, name });
    });

    if (urns.length === 0) return [];
    return [
      {
        field: 'postUrns',
        value: urns,
        confidence: 0.85,
        source: 'fallback',
        selectorUsed: 'fallback:data-urn',
      },
      {
        field: 'postAuthorHrefs',
        value: JSON.stringify(authors),
        confidence: 0.7,
        source: 'fallback',
        selectorUsed: 'fallback:data-urn',
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// SEARCH_PEOPLE: href-pattern (formalises the Strategy-2 path in search-parser)
// ---------------------------------------------------------------------------

const searchHrefPattern: FallbackStrategy = {
  name: 'href-pattern',
  pageTypes: ['SEARCH_PEOPLE'],
  apply($: CheerioAPI): ExtractedField[] {
    const hits = collectProfileHrefHits($, null);
    if (hits.length === 0) return [];
    return [
      {
        field: 'searchResultHrefHits',
        value: JSON.stringify(hits),
        confidence: 0.6,
        source: 'fallback',
        selectorUsed: 'fallback:href-pattern',
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// SEARCH_CONTENT: data-urn + href-pattern hybrid
// ---------------------------------------------------------------------------

const searchContentDataUrn: FallbackStrategy = {
  name: 'data-urn',
  pageTypes: ['SEARCH_CONTENT'],
  apply($: CheerioAPI): ExtractedField[] {
    const urns: string[] = [];
    $('[data-urn]').each((_idx, el) => {
      const urn = $(el).attr('data-urn') ?? '';
      if (urn.startsWith('urn:li:activity') || urn.startsWith('urn:li:article')) {
        urns.push(urn);
      }
    });
    if (urns.length === 0) return [];
    return [
      {
        field: 'contentUrns',
        value: urns,
        confidence: 0.8,
        source: 'fallback',
        selectorUsed: 'fallback:data-urn',
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// One-shot registration
// ---------------------------------------------------------------------------

let REGISTERED = false;

/** Register every built-in fallback once. Safe to call multiple times. */
export function registerDefaultFallbacks(): void {
  if (REGISTERED) return;
  REGISTERED = true;
  registerFallback(profileTitleTag);
  registerFallback(profileOgMeta);
  registerFallback(companyTitleTag);
  registerFallback(companyDetailsHref);
  registerFallback(connectionsHrefPattern);
  registerFallback(messagesHrefPattern);
  registerFallback(feedDataUrn);
  registerFallback(searchHrefPattern);
  registerFallback(searchContentDataUrn);
}

// Register on import. Parsers import this file at module load; tests that
// need a clean registry can call `_clearFallbackRegistryForTests` then
// `registerDefaultFallbacks` again.
registerDefaultFallbacks();
