// Regression harness: computes per-parser field yield against the fixture
// corpus and compares it against the committed baseline at
// tests/parser/__yield__/yield-baseline.json. A mismatch means parser yield
// behavior actually changed (better or worse) and the baseline needs review.
//
// Run with: npm test -- --testPathPattern=compute-yield
//
// To intentionally update the committed baseline after a verified yield
// change, run:
//   UPDATE_YIELD_BASELINE=1 npm test -- --testPathPattern=compute-yield
// That writes the new numbers to tests/parser/__yield__/yield-baseline.json;
// review the diff and commit it deliberately. Without the env var, the test
// only reads the baseline — it never touches the file — so `npm test` never
// dirties the working tree.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseHtml } from '@/lib/parser/parse-engine';
import type {
  SelectorConfig,
  LinkedInPageType,
} from '@/types/selector-config';
import selectorConfigsFixture from './fixtures/selector-configs.json';

const FIXTURES_ROOT = path.resolve(__dirname, '../../data/parser-fixtures');
const OUTPUT_DIR = path.resolve(__dirname, '__yield__');

const DIR_TO_PAGE_TYPE: Record<string, LinkedInPageType> = {
  profile: 'PROFILE',
  company: 'COMPANY',
  'search-people': 'SEARCH_PEOPLE',
  'search-content': 'SEARCH_CONTENT',
  feed: 'FEED',
  connections: 'CONNECTIONS',
  messages: 'MESSAGES',
};

function buildConfig(pt: LinkedInPageType): SelectorConfig {
  const raw = (selectorConfigsFixture as Record<string, unknown>)[pt] ?? {};
  const h =
    pt === 'PROFILE'
      ? ((selectorConfigsFixture as Record<string, unknown>).PROFILE_HEURISTICS as unknown[])
      : [];
  return {
    id: `t-${pt}`,
    pageType: pt,
    version: 1,
    selectors: raw as SelectorConfig['selectors'],
    heuristics: (h ?? []) as SelectorConfig['heuristics'],
    isActive: true,
    createdAt: '2026-04-17',
    updatedAt: '2026-04-17',
    createdBy: 'test',
    notes: null,
  };
}

interface YieldBaselineFile {
  rows: Array<{
    pageType: string;
    field: string;
    yield: number;
    nSamples: number;
    nPresent: number;
    avgConfidence: number;
    fallbackShareOfHits: number;
  }>;
}

describe('parser yield baseline', () => {
  it('matches the committed yield baseline (set UPDATE_YIELD_BASELINE=1 to refresh it)', () => {
    interface Row {
      pageType: string;
      field: string;
      present: number;
      total: number;
      yield: number;
      avgConfidence: number;
      fallbackHits: number;
    }
    const rows: Record<string, Row> = {};
    const bump = (pt: string, field: string, present: boolean, conf: number, usedFallback: boolean) => {
      const k = `${pt}::${field}`;
      const r =
        rows[k] ??
        (rows[k] = {
          pageType: pt,
          field,
          present: 0,
          total: 0,
          yield: 0,
          avgConfidence: 0,
          fallbackHits: 0,
        });
      r.total += 1;
      if (present) {
        r.present += 1;
        r.avgConfidence += conf;
        if (usedFallback) r.fallbackHits += 1;
      }
    };

    for (const dir of fs.readdirSync(FIXTURES_ROOT)) {
      const full = path.join(FIXTURES_ROOT, dir);
      if (!fs.statSync(full).isDirectory()) continue;
      const pt = DIR_TO_PAGE_TYPE[dir];
      if (!pt) continue;
      for (const entry of fs.readdirSync(full)) {
        if (!entry.endsWith('.html')) continue;
        const html = fs.readFileSync(path.join(full, entry), 'utf8');
        const metaPath = path.join(full, entry.replace('.html', '.meta.json'));
        if (!fs.existsSync(metaPath)) continue;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
          expectedFields: string[];
          sourceUrlRedacted: string | null;
        };
        const config = buildConfig(pt);
        const result = parseHtml(
          html,
          pt,
          config,
          meta.sourceUrlRedacted ?? `https://www.linkedin.com/test/${pt}/`,
          `baseline-${entry}`
        );
        // Per-expectedField yield: check if populated in result.fields or result.data.
        for (const ef of meta.expectedFields) {
          const arrMatch = ef.match(/^([a-zA-Z][\w]*)\[\]\.(.+)$/);
          let present = false;
          let conf = 0;
          let usedFallback = false;
          if (arrMatch) {
            const arrName = arrMatch[1];
            const inner = arrMatch[2];
            const data = result.data as unknown as Record<string, unknown>;
            const arr = (data?.[arrName] ?? []) as unknown[];
            if (Array.isArray(arr) && arr.length > 0) {
              const anyHas = arr.some((entry) => {
                const v = (entry as Record<string, unknown>)[inner];
                if (v === null || v === undefined || v === '') return false;
                if (Array.isArray(v)) return v.length > 0;
                return true;
              });
              present = anyHas;
              conf = present ? 0.7 : 0;
            }
          } else {
            const fld = result.fields.find((f) => f.field === ef);
            if (fld && fld.value !== null && fld.value !== '') {
              present = Array.isArray(fld.value) ? fld.value.length > 0 : true;
              conf = fld.confidence;
              if (fld.source === 'fallback') usedFallback = true;
            } else {
              const data = result.data as unknown as Record<string, unknown>;
              const dv = data?.[ef];
              if (dv !== null && dv !== undefined && dv !== '') {
                present = Array.isArray(dv) ? dv.length > 0 : true;
                conf = present ? 0.6 : 0;
              }
            }
          }
          bump(pt, ef, present, conf, usedFallback);
        }
      }
    }

    const out = Object.values(rows).map((r) => ({
      pageType: r.pageType,
      field: r.field,
      yield: r.total === 0 ? 0 : r.present / r.total,
      nSamples: r.total,
      nPresent: r.present,
      avgConfidence: r.present === 0 ? 0 : r.avgConfidence / r.present,
      fallbackShareOfHits: r.present === 0 ? 0 : r.fallbackHits / r.present,
    }));
    out.sort((a, b) => (a.pageType + a.field).localeCompare(b.pageType + b.field));

    expect(out.length).toBeGreaterThan(10);

    const baselinePath = path.join(OUTPUT_DIR, 'yield-baseline.json');

    if (process.env.UPDATE_YIELD_BASELINE === '1') {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(baselinePath, `${JSON.stringify({ rows: out }, null, 2)}\n`);
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as YieldBaselineFile;
    expect(out).toEqual(baseline.rows);
  });
});
