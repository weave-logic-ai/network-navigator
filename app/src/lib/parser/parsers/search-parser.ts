// Search results page parser
// Extracts list of search results (people)
// Uses selector-config first, then falls back to href-pattern extraction
// for obfuscated LinkedIn HTML (hashed CSS class names)

import type { CheerioAPI } from 'cheerio';
import type { SelectorConfig } from '@/types/selector-config';
import type {
  PageParser,
  ParseResult,
  SearchParseData,
  SearchResultEntry,
  ExtractedField,
} from '../types';
import { extractField } from '../selector-extractor';

export class SearchParser implements PageParser {
  readonly pageType = 'SEARCH_PEOPLE' as const;
  readonly version = '1.1.0';

  parse(
    $: CheerioAPI,
    config: SelectorConfig,
    url: string
  ): Omit<ParseResult, 'captureId' | 'parseTimeMs'> {
    const fields: ExtractedField[] = [];
    const errors: string[] = [];
    const selectors = config.selectors;

    const results: SearchResultEntry[] = [];

    // --- Strategy 1: Selector-based extraction (original approach) ---
    const resultItemChain = selectors['resultItem'];
    if (resultItemChain) {
      const resultElements = $(resultItemChain.selectors[0]);

      resultElements.each((_idx, el) => {
        const $el = $(el);

        let name = '';
        const nameChain = selectors['resultName'];
        if (nameChain) {
          for (const sel of nameChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) { name = text; break; }
          }
        }
        if (!name) return;

        let headline: string | null = null;
        const headlineChain = selectors['resultHeadline'];
        if (headlineChain) {
          for (const sel of headlineChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) { headline = text; break; }
          }
        }

        let profileUrl = '';
        const urlChain = selectors['resultProfileUrl'];
        if (urlChain) {
          for (const sel of urlChain.selectors) {
            const href = $el.find(sel).first().attr('href') ?? '';
            if (href && href.includes('/in/')) {
              profileUrl = href.split('?')[0];
              if (!profileUrl.startsWith('http')) profileUrl = `https://www.linkedin.com${profileUrl}`;
              break;
            }
          }
        }

        let location: string | null = null;
        const locationChain = selectors['resultLocation'];
        if (locationChain) {
          for (const sel of locationChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) { location = text; break; }
          }
        }

        results.push({ name, headline, profileUrl, location, connectionDegree: null, mutualConnections: null });
      });
    }

    // --- Strategy 2: Fallback href-pattern extraction ---
    // LinkedIn obfuscates CSS classes, but profile links still have /in/ slugs
    // Find all <a> tags linking to /in/ profiles and extract name from link text
    if (results.length === 0) {
      const seen = new Set<string>();

      $('a[href*="/in/"]').each((_idx, el) => {
        const $a = $(el);
        const href = $a.attr('href') ?? '';
        const name = $a.text().trim();

        // Must be a real profile link with a name (not just an icon or empty link)
        if (!name || name.length < 2 || name.length > 100) return;
        // Filter out navigation links, "View profile" buttons, etc.
        if (name.toLowerCase() === 'view profile' || name.toLowerCase() === 'connect') return;

        // Extract slug for dedup
        const slugMatch = href.match(/\/in\/([^/?]+)/);
        if (!slugMatch) return;
        const slug = slugMatch[1];

        // Skip duplicates (same person appears multiple times in search HTML)
        if (seen.has(slug)) return;
        seen.add(slug);

        let profileUrl = href.split('?')[0];
        if (!profileUrl.startsWith('http')) profileUrl = `https://www.linkedin.com${profileUrl}`;

        // Try to find headline: look for the next sibling text or nearby elements
        let headline: string | null = null;
        const $parent = $a.closest('[componentkey]');
        if ($parent.length) {
          // Find text nodes that aren't the name itself
          const allText = $parent.text().trim();
          const nameIdx = allText.indexOf(name);
          if (nameIdx >= 0) {
            const afterName = allText.substring(nameIdx + name.length).trim();
            // First meaningful chunk after the name is likely the headline
            const headlineMatch = afterName.match(/^[\s·]*(.{10,200}?)(?:\s*·|\s*\d+\s*mutual|\s*Connect|\s*Message|$)/);
            if (headlineMatch) {
              headline = headlineMatch[1].trim();
              // Clean up LinkedIn noise
              headline = headline.replace(/^\s*·\s*/, '').replace(/\s+/g, ' ').trim();
              if (headline.length < 5) headline = null;
            }
          }
        }

        // Try to find location from nearby text
        let location: string | null = null;
        if ($parent.length) {
          const fullText = $parent.text();
          // Location patterns: "City, State" or "City, Country" — often after the headline
          const locMatch = fullText.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Z][a-zA-Z\s]+)(?:\s*·|\s*\d+\s*mutual|\s*$)/);
          if (locMatch) {
            location = locMatch[1].trim();
            // Don't confuse company names or headlines for locations
            if (location.length > 50) location = null;
          }
        }

        // Try to detect connection degree
        let connectionDegree: string | null = null;
        if ($parent.length) {
          const text = $parent.text();
          if (text.includes('1st')) connectionDegree = '1st';
          else if (text.includes('2nd')) connectionDegree = '2nd';
          else if (text.includes('3rd')) connectionDegree = '3rd';
        }

        // Try to detect mutual connections
        let mutualConnections: number | null = null;
        if ($parent.length) {
          const mutualMatch = $parent.text().match(/(\d+)\s*mutual\s*connection/i);
          if (mutualMatch) {
            mutualConnections = parseInt(mutualMatch[1], 10);
          }
        }

        results.push({
          name,
          headline,
          profileUrl,
          location,
          connectionDegree,
          mutualConnections,
        });
      });

      if (results.length > 0) {
        errors.push(`Used fallback href-pattern extraction (${results.length} results)`);
      }
    }

    // Extract total results
    const totalField = extractField(
      $,
      selectors['totalResults'] ?? { name: 'Total Results', selectors: [] },
      'totalResults'
    );
    fields.push(totalField);

    let totalResultsEstimate: number | null = null;
    if (totalField.value && typeof totalField.value === 'string') {
      const match = totalField.value.match(/([\d,]+)/);
      if (match) totalResultsEstimate = parseInt(match[1].replace(/,/g, ''), 10);
    }

    // Fallback: try to find total from page text
    if (totalResultsEstimate === null) {
      const fullText = $('body').text();
      const totalMatch = fullText.match(/([\d,]+)\s*results/i);
      if (totalMatch) {
        totalResultsEstimate = parseInt(totalMatch[1].replace(/,/g, ''), 10);
      }
    }

    // Parse current page from URL
    let currentPage: number | null = null;
    try {
      const urlObj = new URL(url);
      const page = urlObj.searchParams.get('page');
      if (page) currentPage = parseInt(page, 10);
    } catch {
      // Ignore
    }

    const data: SearchParseData = {
      results,
      totalResultsEstimate,
      currentPage: currentPage ?? 1,
    };

    fields.push({
      field: 'results',
      value: results.map((r) => r.name),
      confidence: results.length > 0 ? 0.8 : 0,
      selectorUsed: results.length > 0 ? (resultItemChain?.selectors[0] ?? 'fallback:href-pattern') : '',
      selectorIndex: 0,
      source: 'selector',
    });

    return {
      success: results.length > 0,
      pageType: 'SEARCH_PEOPLE',
      url,
      fields,
      data,
      fieldsExtracted: results.length > 0 ? 1 : 0,
      fieldsAttempted: 1,
      overallConfidence: results.length > 0 ? 0.8 : 0,
      parserVersion: this.version,
      selectorConfigVersion: config.version,
      errors,
    };
  }
}
