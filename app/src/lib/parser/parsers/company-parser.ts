// Company page parser
// Extracts company name, industry, size, about, etc.

import type { CheerioAPI } from 'cheerio';
import type { SelectorConfig } from '@/types/selector-config';
import type {
  PageParser,
  ParseResult,
  CompanyParseData,
  ExtractedField,
} from '../types';
import { extractField } from '../selector-extractor';

export class CompanyParser implements PageParser {
  readonly pageType = 'COMPANY' as const;
  readonly version = '1.0.0';

  parse(
    $: CheerioAPI,
    config: SelectorConfig,
    url: string
  ): Omit<ParseResult, 'captureId' | 'parseTimeMs'> {
    const fields: ExtractedField[] = [];
    const errors: string[] = [];
    const selectors = config.selectors;

    // Extract all company fields
    const fieldNames = [
      'companyName',
      'industry',
      'companySize',
      'headquarters',
      'about',
      'website',
      'followerCount',
      'specialties',
    ];

    for (const fieldName of fieldNames) {
      const chain = selectors[fieldName];
      if (chain) {
        fields.push(extractField($, chain, fieldName));
      }
    }

    const getValue = (fieldName: string): string | null => {
      const field = fields.find((f) => f.field === fieldName);
      if (!field || field.value === null) return null;
      return typeof field.value === 'string' ? field.value : null;
    };

    const getNumValue = (fieldName: string): number | null => {
      const field = fields.find((f) => f.field === fieldName);
      if (!field || field.value === null) return null;
      if (typeof field.value === 'number') return field.value;
      if (typeof field.value === 'string') {
        const n = parseInt(field.value.replace(/[,\s]/g, ''), 10);
        return isNaN(n) ? null : n;
      }
      return null;
    };

    const getArrayValue = (fieldName: string): string[] => {
      const field = fields.find((f) => f.field === fieldName);
      if (!field || field.value === null) return [];
      if (Array.isArray(field.value)) return field.value;
      if (typeof field.value === 'string') {
        return field.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return [];
    };

    const data: CompanyParseData = {
      name: getValue('companyName'),
      industry: getValue('industry'),
      companySize: getValue('companySize'),
      headquarters: getValue('headquarters'),
      founded: null,
      specialties: getArrayValue('specialties'),
      about: getValue('about'),
      website: getValue('website'),
      followerCount: getNumValue('followerCount'),
      employeesOnLinkedIn: null,
    };

    const fieldsExtracted = fields.filter(
      (f) => f.value !== null && f.confidence > 0
    ).length;
    const fieldsAttempted = fields.length;
    const confidences = fields
      .filter((f) => f.confidence > 0)
      .map((f) => f.confidence);
    const overallConfidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;

    return {
      success: fieldsExtracted > 0,
      pageType: 'COMPANY',
      url,
      fields,
      data,
      fieldsExtracted,
      fieldsAttempted,
      overallConfidence: Math.round(overallConfidence * 100) / 100,
      parserVersion: this.version,
      selectorConfigVersion: config.version,
      errors,
    };
  }
}
