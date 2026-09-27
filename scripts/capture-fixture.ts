#!/usr/bin/env node
// scripts/capture-fixture.ts
//
// Standalone capture-fixture harness for Phase 0 of the Network Navigator
// research-tools sprint.  Reads raw LinkedIn-capture HTML (produced by the
// browser extension or pulled from page_cache), runs a redaction pass, and
// writes a PII-scrubbed fixture plus a sibling .meta.json to
// `data/parser-fixtures/<pageType>/<iso>-<short-hash>.html`.
//
// Usage: see --help.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { redact, detectSurvivingPii, RULE_SET_VERSION } from './redaction.ts';

type PageType =
  | 'PROFILE'
  | 'COMPANY'
  | 'SEARCH_PEOPLE'
  | 'SEARCH_CONTENT'
  | 'FEED'
  | 'CONNECTIONS'
  | 'MESSAGES';

const PAGE_TYPES: ReadonlyArray<PageType> = [
  'PROFILE',
  'COMPANY',
  'SEARCH_PEOPLE',
  'SEARCH_CONTENT',
  'FEED',
  'CONNECTIONS',
  'MESSAGES',
];

const PAGE_TYPE_TO_DIR: Record<PageType, string> = {
  PROFILE: 'profile',
  COMPANY: 'company',
  SEARCH_PEOPLE: 'search-people',
  SEARCH_CONTENT: 'search-content',
  FEED: 'feed',
  CONNECTIONS: 'connections',
  MESSAGES: 'messages',
};

interface CliArgs {
  input: string | null;
  pageType: PageType | null;
  dryRun: boolean;
  url: string | null;
  scenario: string | null;
  outputName: string | null;
  help: boolean;
}

function usage(): string {
  return [
    'capture-fixture.ts — redact and store a LinkedIn capture as a parser fixture.',
    '',
    'Usage:',
    '  node scripts/capture-fixture.ts --page-type <TYPE> [options]',
    '  cat capture.html | node scripts/capture-fixture.ts --page-type PROFILE',
    '',
    'Required:',
    '  --page-type <TYPE>   One of: PROFILE | COMPANY | SEARCH_PEOPLE |',
    '                       SEARCH_CONTENT | FEED | CONNECTIONS | MESSAGES',
    '',
    'Input (one of):',
    '  --input <path>       Read HTML from a file instead of stdin',
    '  <stdin>              Default: read HTML from standard input',
    '',
    'Metadata (optional):',
    '  --url <url>          Original capture URL (will be slug-obfuscated',
    '                       in the stored .meta.json)',
    '  --scenario <text>    Short description of the capture scenario',
    '  --output-name <n>    Override filename stem (default: iso-shorthash)',
    '',
    'Modes:',
    '  --dry-run            Print redaction hit counts + changed line numbers;',
    '                       do not print capture content or write files',
    '  --help               Show this message',
    '',
    'Output:',
    '  data/parser-fixtures/<dir>/<stem>.html',
    '  data/parser-fixtures/<dir>/<stem>.meta.json',
    '',
    `Redaction ruleset version: ${RULE_SET_VERSION}`,
  ].join('\n');
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args: CliArgs = {
    input: null,
    pageType: null,
    dryRun: false,
    url: null,
    scenario: null,
    outputName: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--input':
        args.input = argv[++i] ?? null;
        break;
      case '--page-type': {
        const v = (argv[++i] ?? '').toUpperCase();
        if (!PAGE_TYPES.includes(v as PageType)) {
          throw new Error(`Invalid --page-type "${v}". Must be one of: ${PAGE_TYPES.join(', ')}`);
        }
        args.pageType = v as PageType;
        break;
      }
      case '--url':
        args.url = argv[++i] ?? null;
        break;
      case '--scenario':
        args.scenario = argv[++i] ?? null;
        break;
      case '--output-name':
        args.outputName = argv[++i] ?? null;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

async function readInput(inputPath: string | null): Promise<string> {
  if (inputPath) {
    return await readFile(inputPath, 'utf8');
  }
  if (process.stdin.isTTY) {
    throw new Error('No --input provided and stdin is a TTY. Pipe HTML or pass --input.');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function redactUrl(raw: string): string {
  // Obfuscate /in/<slug> and /company/<slug> so we don't leak identity
  // via the meta file, but keep the host + path shape so parser tests
  // that depend on URL parsing still see realistic input.
  return raw
    .replace(/(\/in\/)([^/?#]+)/g, '$1redacted-slug')
    .replace(/(\/company\/)([^/?#]+)/g, '$1redacted-slug')
    .replace(/([?&](?:firstName|lastName|fullName|name|keywords)=)([^&#]+)/gi, '$1redacted');
}

function diffPreview(before: string, after: string, maxLines = 40): string {
  // Even a partly redacted line may contain private content elsewhere on it.
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const max = Math.max(beforeLines.length, afterLines.length);
  const out: string[] = [];
  let shown = 0;
  for (let i = 0; i < max && shown < maxLines; i++) {
    const bl = beforeLines[i] ?? '';
    const al = afterLines[i] ?? '';
    if (bl !== al) {
      out.push(String(i + 1));
      shown++;
    }
  }
  return out.join('\n');
}

function isoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function findWorktreeRoot(): string {
  // The script lives in <root>/scripts/ — walk up one level.
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '..');
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${usage()}\n`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (!args.pageType) {
    process.stderr.write(`Missing --page-type.\n\n${usage()}\n`);
    process.exit(2);
  }

  const raw = await readInput(args.input);
  if (!raw || raw.trim().length === 0) {
    process.stderr.write('Input is empty.\n');
    process.exit(1);
  }

  const preHash = sha256(raw);
  const { output, hits } = redact(raw);
  const totalHits = Object.values(hits).reduce((a, b) => a + b, 0);
  const survivors = detectSurvivingPii(output);
  if (survivors.length > 0) {
    throw new Error(`Redaction left ${survivors.length} possible PII match(es); review source privately before capturing`);
  }

  if (args.dryRun) {
    process.stdout.write(
      `[dry-run] rule-set=${RULE_SET_VERSION} page-type=${args.pageType}\n` +
        `[dry-run] pre-redaction sha256=${preHash}\n` +
        `[dry-run] total substitutions=${totalHits}\n` +
        `[dry-run] per-rule hits=${JSON.stringify(hits)}\n` +
        `[dry-run] byte delta: ${raw.length} -> ${output.length}\n` +
        `changed line numbers (first 40):\n` +
        `${diffPreview(raw, output)}\n`
    );
    return;
  }

  const root = findWorktreeRoot();
  const dir = path.join(root, 'data', 'parser-fixtures', PAGE_TYPE_TO_DIR[args.pageType]);
  await mkdir(dir, { recursive: true });

  const shortHash = preHash.slice(0, 10);
  const stem = args.outputName ?? `${isoStamp()}-${shortHash}`;
  const htmlPath = path.join(dir, `${stem}.html`);
  const metaPath = path.join(dir, `${stem}.meta.json`);

  const meta = {
    pageType: args.pageType,
    scenario: args.scenario ?? 'captured fixture',
    sourceUrlRedacted: args.url ? redactUrl(args.url) : null,
    ruleSetVersion: RULE_SET_VERSION,
    timestamp: new Date().toISOString(),
    preRedactionSha256: preHash,
    redactionHits: hits,
    redactionTotal: totalHits,
    expectedFields: [],
    review: { status: 'pending' },
  };

  await writeFile(htmlPath, output, 'utf8');
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `wrote ${path.relative(root, htmlPath)}\n` +
      `wrote ${path.relative(root, metaPath)}\n` +
      `rule-set=${RULE_SET_VERSION} hits=${totalHits}\n` +
      'Pending review: inspect HTML and metadata, set expectedFields, then record review.status="approved" and review.reviewedBy before tracking.\n'
  );
}

main().catch((err) => {
  process.stderr.write(`capture-fixture failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
