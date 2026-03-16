// Feed page parser
// Extracts posts from the LinkedIn feed

import type { CheerioAPI } from 'cheerio';
import type { SelectorConfig } from '@/types/selector-config';
import type {
  PageParser,
  ParseResult,
  FeedParseData,
  FeedPostEntry,
  ExtractedField,
} from '../types';

export class FeedParser implements PageParser {
  readonly pageType = 'FEED' as const;
  readonly version = '1.0.0';

  parse(
    $: CheerioAPI,
    config: SelectorConfig,
    url: string
  ): Omit<ParseResult, 'captureId' | 'parseTimeMs'> {
    const fields: ExtractedField[] = [];
    const errors: string[] = [];
    const selectors = config.selectors;

    const posts: FeedPostEntry[] = [];
    const postItemChain = selectors['postItem'];

    if (postItemChain) {
      const postElements = $(postItemChain.selectors[0]);

      postElements.each((_idx, el) => {
        const $el = $(el);

        // Author name
        let authorName = '';
        const nameChain = selectors['authorName'];
        if (nameChain) {
          for (const sel of nameChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              authorName = text;
              break;
            }
          }
        }
        if (!authorName) return;

        // Author headline
        let authorHeadline: string | null = null;
        const headlineChain = selectors['authorHeadline'];
        if (headlineChain) {
          for (const sel of headlineChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              authorHeadline = text;
              break;
            }
          }
        }

        // Post content
        let content = '';
        const contentChain = selectors['postContent'];
        if (contentChain) {
          for (const sel of contentChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              content = text;
              break;
            }
          }
        }

        // Like count
        let likes: number | null = null;
        const likeChain = selectors['likeCount'];
        if (likeChain) {
          for (const sel of likeChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              const num = parseInt(text.replace(/[,\s]/g, ''), 10);
              if (!isNaN(num)) {
                likes = num;
                break;
              }
            }
          }
        }

        // Comment count
        let comments: number | null = null;
        const commentChain = selectors['commentCount'];
        if (commentChain) {
          for (const sel of commentChain.selectors) {
            const text = $el.find(sel).first().text().trim();
            if (text) {
              const num = parseInt(text.replace(/[,\s]/g, ''), 10);
              if (!isNaN(num)) {
                comments = num;
                break;
              }
            }
          }
        }

        posts.push({
          authorName,
          authorHeadline,
          authorProfileUrl: null,
          content,
          postUrl: null,
          likes,
          comments,
          reposts: null,
          postedTimeAgo: null,
          postType: 'unknown',
        });
      });
    }

    const data: FeedParseData = { posts };

    fields.push({
      field: 'posts',
      value: posts.map((p) => p.authorName),
      confidence: posts.length > 0 ? 0.75 : 0,
      selectorUsed: postItemChain?.selectors[0] ?? '',
      selectorIndex: 0,
      source: 'selector',
    });

    return {
      success: posts.length > 0,
      pageType: 'FEED',
      url,
      fields,
      data,
      fieldsExtracted: posts.length > 0 ? 1 : 0,
      fieldsAttempted: 1,
      overallConfidence: posts.length > 0 ? 0.75 : 0,
      parserVersion: this.version,
      selectorConfigVersion: config.version,
      errors,
    };
  }
}
