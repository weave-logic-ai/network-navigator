// Connections list parser
// Extracts list of connections from the connections page

import type { CheerioAPI } from 'cheerio';
import type { SelectorConfig } from '@/types/selector-config';
import type {
  PageParser,
  ParseResult,
  ConnectionsParseData,
  ConnectionEntry,
  ExtractedField,
} from '../types';

export class ConnectionsParser implements PageParser {
  readonly pageType = 'CONNECTIONS' as const;
  readonly version = '1.0.0';

  parse(
    $: CheerioAPI,
    config: SelectorConfig,
    url: string
  ): Omit<ParseResult, 'captureId' | 'parseTimeMs'> {
    const fields: ExtractedField[] = [];
    const errors: string[] = [];
    const selectors = config.selectors;

    const connections: ConnectionEntry[] = [];
    const itemChain = selectors['connectionItem'];

    if (itemChain) {
      const elements = $(itemChain.selectors[0]);

      elements.each((_idx, el) => {
        const $el = $(el);

        let name = '';
        const nameChain = selectors['connectionName'];
        if (nameChain) {
          for (const sel of nameChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              name = text;
              break;
            }
          }
        }
        if (!name) return;

        let headline: string | null = null;
        const headlineChain = selectors['connectionHeadline'];
        if (headlineChain) {
          for (const sel of headlineChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              headline = text;
              break;
            }
          }
        }

        let profileUrl = '';
        const urlChain = selectors['connectionProfileUrl'];
        if (urlChain) {
          for (const sel of urlChain.selectors) {
            const href = $el.find(sel).first().attr('href') ?? '';
            if (href) {
              profileUrl = href.split('?')[0];
              if (!profileUrl.startsWith('http')) {
                profileUrl = `https://www.linkedin.com${profileUrl}`;
              }
              break;
            }
          }
        }

        let connectedDate: string | null = null;
        const dateChain = selectors['connectedDate'];
        if (dateChain) {
          for (const sel of dateChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              connectedDate = text;
              break;
            }
          }
        }

        connections.push({ name, headline, profileUrl, connectedDate });
      });
    }

    const data: ConnectionsParseData = { connections };

    fields.push({
      field: 'connections',
      value: connections.map((c) => c.name),
      confidence: connections.length > 0 ? 0.8 : 0,
      selectorUsed: itemChain?.selectors[0] ?? '',
      selectorIndex: 0,
      source: 'selector',
    });

    return {
      success: connections.length > 0,
      pageType: 'CONNECTIONS',
      url,
      fields,
      data,
      fieldsExtracted: connections.length > 0 ? 1 : 0,
      fieldsAttempted: 1,
      overallConfidence: connections.length > 0 ? 0.8 : 0,
      parserVersion: this.version,
      selectorConfigVersion: config.version,
      errors,
    };
  }
}
