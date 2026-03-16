// Parser registry: manages page type parsers

import type { LinkedInPageType } from '@/types/selector-config';
import type { PageParser } from './types';

class ParserRegistry {
  private parsers: Map<LinkedInPageType, PageParser> = new Map();

  register(parser: PageParser): void {
    this.parsers.set(parser.pageType, parser);
  }

  get(pageType: LinkedInPageType): PageParser | undefined {
    return this.parsers.get(pageType);
  }

  has(pageType: LinkedInPageType): boolean {
    return this.parsers.has(pageType);
  }

  getRegisteredTypes(): LinkedInPageType[] {
    return Array.from(this.parsers.keys());
  }
}

export const parserRegistry = new ParserRegistry();
