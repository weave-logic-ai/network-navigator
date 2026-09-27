#!/usr/bin/env node
// scripts/fixture-lint.ts
//
// Walks `data/parser-fixtures/` and verifies fixture hygiene:
//   1. every *.html has a sibling *.meta.json
//   2. every *.meta.json carries the required keys
//   3. the fixture's pageType matches the directory it lives in
//   4. no PII regex still matches inside the committed HTML
//   5. captured (non-synthetic) fixtures carry an explicit human review
//
// Exit code is 0 on pass, 1 on any violation (first failure collected, all
// remaining failures still reported).

import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { detectSurvivingPii, RULE_SET_VERSION } from './redaction.ts';

const DIR_TO_PAGE_TYPE: Record<string, string> = {
  profile: 'PROFILE',
  company: 'COMPANY',
  'search-people': 'SEARCH_PEOPLE',
  'search-content': 'SEARCH_CONTENT',
  feed: 'FEED',
  connections: 'CONNECTIONS',
  messages: 'MESSAGES',
};

const REQUIRED_META_KEYS = [
  'pageType',
  'scenario',
  'expectedFields',
  'timestamp',
  'ruleSetVersion',
];

interface Violation {
  file: string;
  kind: string;
  detail: string;
}

function findWorktreeRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '..');
}

async function walkHtml(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      const s = await stat(full);
      if (s.isDirectory()) {
        await visit(full);
      } else if (name.endsWith('.html')) {
        out.push(full);
      }
    }
  }
  await visit(root);
  return out;
}

async function main(): Promise<void> {
  const root = findWorktreeRoot();
  const fixturesRoot = path.join(root, 'data', 'parser-fixtures');

  const htmlFiles = await walkHtml(fixturesRoot);
  if (htmlFiles.length === 0) {
    process.stderr.write(`No fixtures found under ${fixturesRoot}\n`);
    process.exit(1);
  }

  const violations: Violation[] = [];
  let metaCount = 0;

  for (const html of htmlFiles) {
    const rel = path.relative(root, html);
    const metaPath = html.replace(/\.html$/, '.meta.json');

    // 1. meta sibling
    let metaRaw: string | null = null;
    try {
      metaRaw = await readFile(metaPath, 'utf8');
      metaCount++;
    } catch {
      violations.push({ file: rel, kind: 'missing-meta', detail: 'no sibling .meta.json' });
      continue;
    }

    // 2. meta required keys
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(metaRaw) as Record<string, unknown>;
    } catch (err) {
      violations.push({
        file: rel,
        kind: 'meta-json-parse',
        detail: (err as Error).message,
      });
      continue;
    }
    for (const key of REQUIRED_META_KEYS) {
      if (!(key in meta)) {
        violations.push({ file: rel, kind: 'meta-missing-key', detail: key });
      }
    }

    // 3. pageType matches directory
    const parentDir = path.basename(path.dirname(html));
    const expectedPageType = DIR_TO_PAGE_TYPE[parentDir];
    if (!expectedPageType) {
      violations.push({
        file: rel,
        kind: 'unknown-directory',
        detail: `parent "${parentDir}" is not a recognised page-type directory`,
      });
    } else if (meta.pageType !== expectedPageType) {
      violations.push({
        file: rel,
        kind: 'page-type-mismatch',
        detail: `meta.pageType="${String(meta.pageType)}" but directory is "${parentDir}" (expected ${expectedPageType})`,
      });
    }

    // 3b. ruleSetVersion sanity — warn (not fail) if mismatched against
    //     the current code.  We record the mismatch so a fresh commit of
    //     the ruleset can be traced.
    if (meta.ruleSetVersion !== RULE_SET_VERSION) {
      violations.push({
        file: rel,
        kind: 'stale-rule-set',
        detail: `fixture built with ruleSet=${String(meta.ruleSetVersion)}, code has ${RULE_SET_VERSION}`,
      });
    }

    if (meta.preRedactionSha256 !== 'synthetic-no-raw-input') {
      const review = meta.review as Record<string, unknown> | undefined;
      if (review?.status !== 'approved' ||
          typeof review.reviewedBy !== 'string' ||
          review.reviewedBy.trim().length === 0 ||
          !Array.isArray(meta.expectedFields) ||
          meta.expectedFields.length === 0) {
        violations.push({
          file: rel,
          kind: 'review-pending',
          detail: 'captured fixture needs review.status="approved", review.reviewedBy, and expectedFields',
        });
      }
    }

    // 4. PII residue scan
    const htmlBody = await readFile(html, 'utf8');
    const survivors = detectSurvivingPii(htmlBody);
    for (const s of survivors) {
      violations.push({
        file: rel,
        kind: `pii-residue:${s.rule}`,
        detail: s.sample,
      });
    }
  }

  if (violations.length === 0) {
    process.stdout.write(
      `fixture-lint: OK\n` +
        `  fixtures scanned: ${htmlFiles.length}\n` +
        `  meta files:       ${metaCount}\n` +
        `  rule-set version: ${RULE_SET_VERSION}\n`
    );
    process.exit(0);
  }

  process.stderr.write(`fixture-lint: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    process.stderr.write(`  [${v.kind}] ${v.file} — ${v.detail}\n`);
  }
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`fixture-lint crashed: ${(err as Error).stack ?? err}\n`);
  process.exit(2);
});
