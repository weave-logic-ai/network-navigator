// Search results page parser
// Extracts list of search results (people)

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
  readonly version = '1.0.0';

  parse(
    $: CheerioAPI,
    config: SelectorConfig,
    url: string
  ): Omit<ParseResult, 'captureId' | 'parseTimeMs'> {
    const fields: ExtractedField[] = [];
    const errors: string[] = [];
    const selectors = config.selectors;

    // Extract result items
    const resultItemChain = selectors['resultItem'];
    const results: SearchResultEntry[] = [];

    if (resultItemChain) {
      const resultElements = $(resultItemChain.selectors[0]);

      resultElements.each((_idx, el) => {
        const $el = $(el);

        // Extract name
        let name = '';
        const nameChain = selectors['resultName'];
        if (nameChain) {
          for (const sel of nameChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              name = text;
              break;
            }
          }
        }

        if (!name) return; // Skip entries without a name

        // Extract headline
        let headline: string | null = null;
        const headlineChain = selectors['resultHeadline'];
        if (headlineChain) {
          for (const sel of headlineChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              headline = text;
              break;
            }
          }
        }

        // Extract profile URL
        let profileUrl = '';
        const urlChain = selectors['resultProfileUrl'];
        if (urlChain) {
          for (const sel of urlChain.selectors) {
            const href = $el.find(sel).first().attr('href') ?? '';
            if (href && href.includes('/in/')) {
              profileUrl = href.split('?')[0]; // Strip tracking params
              if (!profileUrl.startsWith('http')) {
                profileUrl = `https://www.linkedin.com${profileUrl}`;
              }
              break;
            }
          }
        }

        // Extract location
        let location: string | null = null;
        const locationChain = selectors['resultLocation'];
        if (locationChain) {
          for (const sel of locationChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              location = text;
              break;
            }
          }
        }

        results.push({
          name,
          headline,
          profileUrl,
          location,
          connectionDegree: null,
          mutualConnections: null,
        });
      });
    }

    // Extract total results
    const totalField = extractField(
      $,
      selectors['totalResults'] ?? {
        name: 'Total Results',
        selectors: [],
      },
      'totalResults'
    );
    fields.push(totalField);

    let totalResultsEstimate: number | null = null;
    if (totalField.value && typeof totalField.value === 'string') {
      const match = totalField.value.match(/([\d,]+)/);
      if (match) {
        totalResultsEstimate = parseInt(match[1].replace(/,/g, ''), 10);
      }
    }

    // Parse current page from URL
    let currentPage: number | null = null;
    try {
      const urlObj = new URL(url);
      const page = urlObj.searchParams.get('page');
      if (page) {
        currentPage = parseInt(page, 10);
      }
    } catch {
      // Ignore URL parse errors
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
      selectorUsed: resultItemChain?.selectors[0] ?? '',
      selectorIndex: 0,
      source: 'selector',
    });

    const fieldsExtracted = results.length > 0 ? 1 : 0;

    return {
      success: results.length > 0,
      pageType: 'SEARCH_PEOPLE',
      url,
      fields,
      data,
      fieldsExtracted,
      fieldsAttempted: 1,
      overallConfidence: results.length > 0 ? 0.8 : 0,
      parserVersion: this.version,
      selectorConfigVersion: config.version,
      errors,
    };
  }
}
