// Generic CSV parser with 2-line preamble detection, BOM stripping, and header normalization

import { CsvParseOptions, CsvParseResult, CsvParseError } from './types';

const BOM = '\uFEFF';

function stripBom(content: string): string {
  return content.startsWith(BOM) ? content.slice(1) : content;
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function detectPreambleLines(lines: string[]): number {
  // LinkedIn CSVs often have preamble lines before the actual headers.
  // Heuristic: preamble lines typically have fewer commas than header lines.
  // We check if the first line looks like a header (has multiple comma-separated tokens)
  // or if it's a metadata/description line.
  if (lines.length < 2) return 0;

  const firstLineCommas = (lines[0].match(/,/g) || []).length;
  const secondLineCommas = (lines[1].match(/,/g) || []).length;

  // If line 2 has significantly more commas, line 0 is probably preamble.
  // Check up to 2 preamble lines.
  if (lines.length >= 3) {
    const thirdLineCommas = (lines[2].match(/,/g) || []).length;

    // If line 0 and line 1 both have fewer commas than line 2, both are preamble
    if (firstLineCommas < thirdLineCommas * 0.5 && secondLineCommas < thirdLineCommas * 0.5) {
      return 2;
    }
  }

  // Check single preamble line
  if (firstLineCommas < secondLineCommas * 0.5 && secondLineCommas > 1) {
    return 1;
  }

  return 0;
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

export function parseCsv(
  content: string,
  options: CsvParseOptions = {}
): CsvParseResult {
  const {
    delimiter = ',',
    preambleLines: forcedPreamble,
    stripBom: shouldStripBom = true,
  } = options;

  let text = content;
  if (shouldStripBom) {
    text = stripBom(text);
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], rowCount: 0, errorCount: 0, errors: [], headers: [] };
  }

  const preambleCount = forcedPreamble ?? detectPreambleLines(lines);
  const dataLines = lines.slice(preambleCount);

  if (dataLines.length === 0) {
    return { rows: [], rowCount: 0, errorCount: 0, errors: [], headers: [] };
  }

  const headerLine = dataLines[0];
  const headers = parseCSVLine(headerLine, delimiter).map(normalizeHeader);

  const rows: Record<string, string>[] = [];
  const errors: CsvParseError[] = [];

  for (let i = 1; i < dataLines.length; i++) {
    const line = dataLines[i];
    try {
      const values = parseCSVLine(line, delimiter);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j] ?? '';
      }
      rows.push(row);
    } catch (err) {
      errors.push({
        row: preambleCount + i + 1,
        message: err instanceof Error ? err.message : 'Parse error',
        raw: line,
      });
    }
  }

  return {
    rows,
    rowCount: rows.length,
    errorCount: errors.length,
    errors,
    headers,
  };
}

// Export for testing
export { stripBom, normalizeHeader, detectPreambleLines, parseCSVLine };
