// Recency modifier — the ADR-030 per_item_multiplier signal this module
// implements.
//
// ADR-030 (`docs/adr/ADR-030-source-trust-composite-weight.md`) names four
// signals for `per_item_multiplier`: engagement score, citation count,
// recency modifier, manual override. As of the 2026-08-19 audit only a
// per-connector engagement proxy existed (news viewCount, RSS republication
// count) plus wayback's own bespoke age-decay. Citation count has no data
// source anywhere in the schema (`source_record_entities` records "this
// source mentions entity X", not "source A is cited by source B") — it is
// NOT implemented here, and should not be faked. Manual override is
// deliberately kept OUT of the multiplier; see the comment in each
// connector's call site for why.
//
// This module provides the one general signal that genuinely is available
// everywhere: every connector already carries a publish/capture date
// (`publishedAt`, `pubDate`, `filingDate`, snapshot timestamp, ...). This is
// DISTINCT from `referenced_date` temporal resolution (`05-source-expansion.md`
// §13.1), which ADR-030 explicitly scopes out — that field answers "when did
// this fact become true"; this modifier answers "how stale is this specific
// extraction, all else equal" and only ever demotes (ceiling 1.0), never
// promotes, matching the schema comment's "1.0 = no boost; >1.0 = promote;
// <1.0 = demote" semantics. A same-day filing isn't worth MORE than baseline
// just for being fresh; a five-year-old one is worth less.
//
// Tenant configurability: ADR-030 calls the recency modifier "optional,
// tenant-configurable, defaults off." There is no per-tenant settings row for
// this yet (would require a `data/db/init` migration — out of scope for
// `lib/sources/connectors/**`). Until that exists, `isRecencyModifierEnabled`
// is a process-level stand-in using the same `RESEARCH_CONNECTOR_*` env-flag
// convention as `app/src/lib/config/research-flags.ts`, defaulting to off per
// the ADR.

/** Process-level stand-in for ADR-030's "tenant-configurable, defaults off." */
export function isRecencyModifierEnabled(): boolean {
  return process.env.RESEARCH_RECENCY_MODIFIER === 'true';
}

export interface RecencyModifierOptions {
  /** Exponential half-life in days. Smaller = faster decay. */
  halfLifeDays: number;
  /** Multiplier never decays below this. */
  floor: number;
}

/**
 * Exponential decay of a per-item multiplier by content age. Returns 1.0
 * (neutral) when `referenceDate` is missing/unparseable — an unknown date is
 * not evidence of staleness. Never exceeds 1.0.
 */
export function recencyModifier(
  referenceDate: Date | string | null | undefined,
  opts: RecencyModifierOptions,
  now: Date = new Date()
): number {
  if (referenceDate == null) return 1.0;
  const d = typeof referenceDate === 'string' ? new Date(referenceDate) : referenceDate;
  if (Number.isNaN(d.getTime())) return 1.0;

  const ageMs = now.getTime() - d.getTime();
  if (ageMs <= 0) return 1.0; // future-dated or same-instant: no penalty
  const halfLifeMs = opts.halfLifeDays * 24 * 60 * 60 * 1000;
  const decayed = Math.pow(0.5, ageMs / halfLifeMs);
  return Math.max(opts.floor, decayed);
}

/**
 * Combine an already-computed base multiplier (engagement, republication,
 * etc.) with the recency modifier via multiplication, gated on
 * `isRecencyModifierEnabled()`. When the flag is off this is a no-op
 * (`base * 1.0`), preserving prior behavior exactly.
 */
export function applyRecencyModifier(
  baseMultiplier: number,
  referenceDate: Date | string | null | undefined,
  opts: RecencyModifierOptions,
  now: Date = new Date()
): number {
  if (!isRecencyModifierEnabled()) return baseMultiplier;
  return baseMultiplier * recencyModifier(referenceDate, opts, now);
}

// Per-source-type decay presets. Half-life reflects how fast a fact sourced
// from that channel typically goes stale for the kinds of fields this ADR's
// composite weight resolves (contact/company projection fields, not the
// article content itself).
export const RECENCY_PRESETS = {
  /** News articles: relevance to "current role/title" facts fades in weeks. */
  news: { halfLifeDays: 45, floor: 0.7 },
  /** RSS/blog items: similar decay to news, slightly slower. */
  rss: { halfLifeDays: 60, floor: 0.75 },
  /** Corporate blog posts: announcements stay relevant longer than news. */
  blog: { halfLifeDays: 120, floor: 0.7 },
  /** Podcast episodes: interview content ages slower than spot news. */
  podcast: { halfLifeDays: 180, floor: 0.75 },
  /**
   * EDGAR filings: "current officers"/"risk factors" extracted from a 10-K
   * meaningfully stale after ~1 filing cycle. Floor kept well above 0 because
   * even a stale 10-K still legally attests to what it says — it's just less
   * likely to reflect the CURRENT state.
   */
  edgar: { halfLifeDays: 365, floor: 0.6 },
} as const satisfies Record<string, RecencyModifierOptions>;
