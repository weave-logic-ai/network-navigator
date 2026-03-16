// Selector-based field extraction engine
// Tries multiple CSS selectors in order, applying transforms

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { SelectorChain, HeuristicRule } from '@/types/selector-config';
import type { ExtractedField } from './types';

/**
 * Apply a transform to extracted text.
 */
function applyTransform(
  value: string,
  transform: string | undefined
): string | number {
  if (!transform) return value;

  switch (transform) {
    case 'trim':
      return value.trim();
    case 'parseInt': {
      const cleaned = value.replace(/[,.\s]/g, '');
      const num = parseInt(cleaned, 10);
      return isNaN(num) ? 0 : num;
    }
    case 'parseConnectionCount': {
      const match = value.match(/([\d,]+)\+?/);
      if (match) {
        const cleaned = match[1].replace(/,/g, '');
        const num = parseInt(cleaned, 10);
        return isNaN(num) ? 0 : num;
      }
      if (value.toLowerCase().includes('500+')) return 500;
      return 0;
    }
    case 'joinArray':
      return value.trim();
    default:
      return value.trim();
  }
}

/**
 * Extract a single field using a selector chain.
 * Tries each selector in order; first match wins.
 * Returns higher confidence for selectors earlier in the chain.
 */
export function extractField(
  $: CheerioAPI,
  chain: SelectorChain,
  fieldName: string
): ExtractedField {
  for (let i = 0; i < chain.selectors.length; i++) {
    const selector = chain.selectors[i];
    try {
      const elements: Cheerio<AnyNode> = $(selector);

      if (elements.length === 0) continue;

      if (chain.multiple) {
        const values: string[] = [];
        elements.each((_idx, el) => {
          const text = chain.attribute
            ? ($(el).attr(chain.attribute) ?? '')
            : $(el).text();
          const transformed = applyTransform(text, chain.transform);
          if (typeof transformed === 'string' && transformed) {
            values.push(transformed);
          } else if (typeof transformed === 'number') {
            values.push(String(transformed));
          }
        });

        if (values.length > 0) {
          // Confidence decreases with selector index
          const confidence = Math.max(0.5, 1.0 - i * 0.15);
          return {
            field: fieldName,
            value: values,
            confidence,
            selectorUsed: selector,
            selectorIndex: i,
            source: 'selector',
          };
        }
      } else {
        const el = elements.first();
        const rawValue = chain.attribute
          ? (el.attr(chain.attribute) ?? '')
          : el.text();

        if (rawValue) {
          const transformed = applyTransform(rawValue, chain.transform);
          const confidence = Math.max(0.5, 1.0 - i * 0.15);
          return {
            field: fieldName,
            value: transformed,
            confidence,
            selectorUsed: selector,
            selectorIndex: i,
            source: 'selector',
          };
        }
      }
    } catch {
      // Invalid selector or extraction error, try next
      continue;
    }
  }

  // No selector matched
  return {
    field: fieldName,
    value: null,
    confidence: 0,
    selectorUsed: '',
    selectorIndex: -1,
    source: 'selector',
  };
}

/**
 * Apply heuristic rules to already-extracted fields.
 * Heuristics use regex on extracted values to derive new fields.
 */
export function applyHeuristics(
  fields: ExtractedField[],
  heuristics: HeuristicRule[]
): ExtractedField[] {
  const derivedFields: ExtractedField[] = [];

  for (const rule of heuristics) {
    const sourceField = fields.find((f) => f.field === rule.sourceField);
    if (!sourceField || sourceField.value === null) continue;

    const sourceValue =
      typeof sourceField.value === 'string'
        ? sourceField.value
        : Array.isArray(sourceField.value)
          ? sourceField.value.join(' ')
          : String(sourceField.value);

    try {
      const regex = new RegExp(rule.pattern, rule.flags ?? '');
      const match = regex.exec(sourceValue);

      if (match) {
        const captureGroup = rule.captureGroup ?? 1;
        const extracted = match[captureGroup] ?? match[0];

        derivedFields.push({
          field: rule.field,
          value: extracted,
          confidence: 0.7, // Heuristic matches get moderate confidence
          selectorUsed: `heuristic:${rule.pattern}`,
          selectorIndex: 0,
          source: 'heuristic',
        });
      }
    } catch {
      // Invalid regex, skip
    }
  }

  return derivedFields;
}
