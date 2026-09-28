// POST /api/parser/regression-report — WS-1 acceptance §3.1.
//
// Accepts { pageType, rawHtml, captureId? }, runs the parser in-memory, and
// returns { extracted, unmatched, telemetryRecorded }. Used by the admin
// /admin/parsers page and by the fixture test harness. No DB writes beyond
// the best-effort telemetry hop in parse-engine.

import { NextResponse, type NextRequest } from 'next/server';
import * as cheerio from 'cheerio';
import { parserRegistry } from '@/lib/parser/parser-registry';
import { ProfileParser } from '@/lib/parser/parsers/profile-parser';
import { SearchParser } from '@/lib/parser/parsers/search-parser';
import { FeedParser } from '@/lib/parser/parsers/feed-parser';
import { CompanyParser } from '@/lib/parser/parsers/company-parser';
import { ConnectionsParser } from '@/lib/parser/parsers/connections-parser';
import { MessagesParser } from '@/lib/parser/parsers/messages-parser';
import { populateUnmatchedDom } from '@/lib/parser/unmatched-dom';
import { recordFieldOutcomes } from '@/lib/parser/telemetry';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { recordEvent } from '@/lib/analytics/events';
import { query } from '@/lib/db/client';
import { requireVisibilityPrincipal } from '@/lib/auth/extension-visibility-boundary';
import { toSelectorConfig } from '@/types/selector-config';
import type {
  SelectorConfig,
  SelectorConfigRow,
  LinkedInPageType,
} from '@/types/selector-config';

// Ensure every parser is registered — imports cause side-effectful registration.
[ProfileParser, SearchParser, FeedParser, CompanyParser, ConnectionsParser, MessagesParser]
  .forEach((Ctor) => {
    try {
      parserRegistry.register(new Ctor());
    } catch {
      // Already registered; idempotent.
    }
  });

const VALID_PAGE_TYPES: ReadonlyArray<LinkedInPageType> = [
  'PROFILE',
  'COMPANY',
  'SEARCH_PEOPLE',
  'SEARCH_CONTENT',
  'FEED',
  'CONNECTIONS',
  'MESSAGES',
];

interface RegressionReportBody {
  pageType: LinkedInPageType;
  rawHtml: string;
  captureId?: string;
  url?: string;
  /** Optional user-supplied note describing what they think is wrong. */
  userNote?: string;
}

async function loadConfig(pageType: LinkedInPageType): Promise<SelectorConfig | null> {
  try {
    const r = await query<SelectorConfigRow>(
      `SELECT id, page_type, selector_name, css_selector, fallback_selectors,
              extraction_method, attribute_name, regex_pattern, is_active,
              version, selectors_json, heuristics, notes, created_by,
              created_at::text, updated_at::text
       FROM selector_configs
       WHERE page_type = $1 AND is_active = true AND selector_name = 'full_config'
       ORDER BY version DESC
       LIMIT 1`,
      [pageType]
    );
    if (r.rows.length === 0) return null;
    return toSelectorConfig(r.rows[0]);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireVisibilityPrincipal(request, true);
  if (denied) return denied;
  let body: RegressionReportBody;
  try {
    body = (await request.json()) as RegressionReportBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.pageType || !VALID_PAGE_TYPES.includes(body.pageType)) {
    return NextResponse.json(
      { error: `pageType must be one of ${VALID_PAGE_TYPES.join(', ')}` },
      { status: 400 }
    );
  }
  if (!body.rawHtml || typeof body.rawHtml !== 'string') {
    return NextResponse.json({ error: 'rawHtml is required' }, { status: 400 });
  }
  if (body.rawHtml.length > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'rawHtml exceeds 5MB cap' }, { status: 413 });
  }

  const captureId = body.captureId ?? `regression-${Date.now()}`;
  const url = body.url ?? `https://www.linkedin.com/test/${body.pageType}/`;

  const parser = parserRegistry.get(body.pageType);
  if (!parser) {
    return NextResponse.json(
      { error: `No parser registered for page type ${body.pageType}` },
      { status: 400 }
    );
  }

  // Prefer DB-backed config; fall back to an empty config so the parser still
  // runs via content-heuristics + fallback registry when the DB is absent.
  const config: SelectorConfig =
    (await loadConfig(body.pageType)) ?? {
      id: 'inline-empty',
      pageType: body.pageType,
      version: 0,
      selectors: {},
      heuristics: [],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'regression-endpoint',
      notes: null,
    };

  const $ = cheerio.load(body.rawHtml);
  let parseResult;
  try {
    parseResult = parser.parse($, config, url);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Parser threw',
        message: (err as Error).message,
        pageType: body.pageType,
      },
      { status: 500 }
    );
  }

  populateUnmatchedDom($, parseResult);

  const extracted = {
    success: parseResult.success,
    fieldsExtracted: parseResult.fieldsExtracted,
    fieldsAttempted: parseResult.fieldsAttempted,
    overallConfidence: parseResult.overallConfidence,
    parserVersion: parseResult.parserVersion,
    selectorConfigVersion: parseResult.selectorConfigVersion,
    fields: parseResult.fields.map((f) => ({
      field: f.field,
      value: Array.isArray(f.value) ? f.value : f.value,
      confidence: f.confidence,
      source: f.source,
      selectorUsed: f.selectorUsed,
    })),
    data: parseResult.data,
    errors: parseResult.errors,
  };

  const telemetryResult = await recordFieldOutcomes({
    captureId,
    pageType: body.pageType,
    parserVersion: parseResult.parserVersion,
    selectorConfigVersion: parseResult.selectorConfigVersion,
    fields: parseResult.fields,
  });

  // WS-2 analytics — fired once per regression-report run. Best-effort.
  await recordEvent({
    event: 'regression_run',
    properties: {
      captureId,
      pageType: body.pageType,
      fieldsExtracted: parseResult.fieldsExtracted,
      fieldsAttempted: parseResult.fieldsAttempted,
    },
  });

  return NextResponse.json({
    extracted,
    unmatched: parseResult.unmatched ?? [],
    telemetryRecorded: telemetryResult.rowsWritten > 0,
    telemetry: {
      attempted: telemetryResult.attempted,
      rowsWritten: telemetryResult.rowsWritten,
      reason: telemetryResult.reason ?? null,
      flagEnabled: RESEARCH_FLAGS.parserTelemetry,
    },
    captureId,
  });
}
