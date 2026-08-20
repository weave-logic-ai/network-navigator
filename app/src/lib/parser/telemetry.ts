// Parser telemetry — writes `parse_field_outcomes` per `01-parser-audit.md` §4.2.
//
// All writes are best-effort (`scoring-adapter.ts` pattern): a DB failure must
// never block a parse. Gated on `RESEARCH_FLAGS.parserTelemetry`; when the
// flag is off every public helper becomes a no-op.

import { query } from '@/lib/db/client';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import type { ExtractedField, ParseResult } from './types';
import type { LinkedInPageType } from '@/types/selector-config';

export interface TelemetryWriteResult {
  /** Did the telemetry code attempt a DB write at all? */
  attempted: boolean;
  /** How many rows successfully landed (0 on skip or on failure). */
  rowsWritten: number;
  /** Shortform reason when no write happened. */
  reason?: 'flag-off' | 'no-capture-id' | 'no-fields' | 'db-error';
}

/**
 * Resolve the tenant_id this parse belongs to. The DB's RLS helper falls back
 * to the default tenant when `app.current_tenant_id` isn't set, so we lean on
 * that for local / single-tenant setups. Returns null if even the helper
 * can't find a tenant (e.g. migration 020 wasn't run).
 */
async function resolveTenantId(): Promise<string | null> {
  try {
    const r = await query<{ tid: string | null }>(
      `SELECT get_current_tenant_id()::text AS tid`
    );
    return r.rows[0]?.tid ?? null;
  } catch {
    return null;
  }
}

/**
 * Record the outcome of every extracted field for one parse call.
 *
 * The fields array is the same one the parser returned; we flatten each
 * entry into a `parse_field_outcomes` row. Writes are batched into a single
 * multi-values INSERT for throughput.
 */
export async function recordFieldOutcomes(args: {
  captureId: string;
  pageType: LinkedInPageType;
  parserVersion: string;
  selectorConfigVersion: number;
  fields: ExtractedField[];
}): Promise<TelemetryWriteResult> {
  if (!RESEARCH_FLAGS.parserTelemetry) {
    return { attempted: false, rowsWritten: 0, reason: 'flag-off' };
  }
  if (!args.captureId) {
    return { attempted: false, rowsWritten: 0, reason: 'no-capture-id' };
  }
  if (args.fields.length === 0) {
    return { attempted: false, rowsWritten: 0, reason: 'no-fields' };
  }

  const tenantId = await resolveTenantId();
  if (!tenantId) {
    return { attempted: true, rowsWritten: 0, reason: 'db-error' };
  }

  // Build the multi-row insert. 8 params per row: tenant, capture, page_type,
  // parser_version, selector_config_version, field_name, value_present,
  // confidence, source, selector_used, selector_index => 10 cols.
  const COLS_PER_ROW = 10;
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let p = 1;
  for (const f of args.fields) {
    const rowPlaceholders: string[] = [];
    for (let i = 0; i < COLS_PER_ROW; i++) rowPlaceholders.push(`$${p++}`);
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
    values.push(
      tenantId,
      args.captureId,
      args.pageType,
      args.parserVersion,
      args.selectorConfigVersion,
      f.field,
      f.value !== null && f.value !== undefined && f.value !== '',
      f.confidence,
      f.source,
      f.selectorUsed || null
    );
  }

  // selector_index is optional; splice it in per row via a separate column ordering
  // that matches the SQL below.
  const sql = `
    INSERT INTO parse_field_outcomes (
      tenant_id, capture_id, page_type, parser_version,
      selector_config_version, field_name, value_present, confidence,
      source, selector_used
    ) VALUES ${placeholders.join(', ')}
  `;

  try {
    await query(sql, values);
    return { attempted: true, rowsWritten: args.fields.length };
  } catch (err) {
    // Log at warn level via stderr — we deliberately don't pull in the
    // logger module here to keep this file boot-cost low.
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[parser-telemetry] insert failed; swallowing:', (err as Error).message);
    }
    return { attempted: true, rowsWritten: 0, reason: 'db-error' };
  }
}

/** Convenience wrapper used by `parse-engine.ts` — never throws. */
export async function recordParseResult(
  result: ParseResult
): Promise<TelemetryWriteResult> {
  try {
    return await recordFieldOutcomes({
      captureId: result.captureId,
      pageType: result.pageType,
      parserVersion: result.parserVersion,
      selectorConfigVersion: result.selectorConfigVersion,
      fields: result.fields,
    });
  } catch {
    return { attempted: true, rowsWritten: 0, reason: 'db-error' };
  }
}

/**
 * Yield-report read path: aggregate rows for the admin /admin/parsers view.
 * Reads from the daily aggregate first (populated by the nightly roll-up at
 * `/api/sources/cron/parser-rollup`, see `rollup.ts`) and only falls back to
 * scanning the raw table when the aggregate has no rows for the window —
 * e.g. telemetry just turned on and the roll-up hasn't run yet, or the
 * roll-up cron missed a day. This keeps the common case cheap, which is the
 * whole point of the two-table design in ADR-031.
 *
 * Returns `null` when the telemetry flag is off — the admin surface is
 * expected to render an "enable RESEARCH_PARSER_TELEMETRY" banner in that
 * case, not show stale data.
 */
export interface YieldRow {
  pageType: string;
  fieldName: string;
  nSamples: number;
  nPresent: number;
  yield: number;
  avgConfidence: number | null;
}

export async function readYieldReport(args: {
  windowDays?: number;
} = {}): Promise<YieldRow[] | null> {
  if (!RESEARCH_FLAGS.parserTelemetry) return null;

  const windowDays = args.windowDays ?? 7;

  // Prefer daily aggregate; fall through to raw on empty.
  try {
    const aggregate = await query<{
      page_type: string;
      field_name: string;
      n_samples: string;
      n_present: string;
      avg_confidence: number | null;
    }>(
      `SELECT page_type, field_name,
              SUM(n_samples)::bigint AS n_samples,
              SUM(n_present)::bigint AS n_present,
              AVG(avg_confidence) AS avg_confidence
       FROM parse_field_outcomes_daily
       WHERE day >= (CURRENT_DATE - ($1::int || ' days')::interval)::date
       GROUP BY page_type, field_name
       ORDER BY page_type, field_name`,
      [windowDays]
    );
    if (aggregate.rows.length > 0) {
      return aggregate.rows.map((r) => {
        const n = Number(r.n_samples);
        const p = Number(r.n_present);
        return {
          pageType: r.page_type,
          fieldName: r.field_name,
          nSamples: n,
          nPresent: p,
          yield: n === 0 ? 0 : p / n,
          avgConfidence: r.avg_confidence ?? null,
        };
      });
    }
  } catch {
    // fall through to raw
  }

  try {
    const raw = await query<{
      page_type: string;
      field_name: string;
      n_samples: string;
      n_present: string;
      avg_confidence: number | null;
    }>(
      `SELECT page_type, field_name,
              COUNT(*)::bigint AS n_samples,
              SUM(CASE WHEN value_present THEN 1 ELSE 0 END)::bigint AS n_present,
              AVG(confidence) AS avg_confidence
       FROM parse_field_outcomes
       WHERE created_at >= NOW() - ($1::int || ' days')::interval
       GROUP BY page_type, field_name
       ORDER BY page_type, field_name`,
      [windowDays]
    );
    return raw.rows.map((r) => {
      const n = Number(r.n_samples);
      const p = Number(r.n_present);
      return {
        pageType: r.page_type,
        fieldName: r.field_name,
        nSamples: n,
        nPresent: p,
        yield: n === 0 ? 0 : p / n,
        avgConfidence: r.avg_confidence ?? null,
      };
    });
  } catch {
    return [];
  }
}
