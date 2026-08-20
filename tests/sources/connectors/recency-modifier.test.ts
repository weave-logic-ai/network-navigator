// ADR-030 recency modifier — the general per_item_multiplier signal shared
// across connectors that have no bespoke engagement/republication proxy.

import {
  recencyModifier,
  applyRecencyModifier,
  isRecencyModifierEnabled,
  RECENCY_PRESETS,
} from '@/lib/sources/connectors/recency-modifier';

const NOW = new Date('2026-08-20T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('recencyModifier', () => {
  it('returns 1.0 (neutral) for a missing date', () => {
    expect(recencyModifier(null, RECENCY_PRESETS.news, NOW)).toBe(1.0);
    expect(recencyModifier(undefined, RECENCY_PRESETS.news, NOW)).toBe(1.0);
  });

  it('returns 1.0 for an unparseable date string', () => {
    expect(recencyModifier('not-a-date', RECENCY_PRESETS.news, NOW)).toBe(1.0);
  });

  it('returns 1.0 for a same-instant or future-dated reference', () => {
    expect(recencyModifier(NOW, RECENCY_PRESETS.news, NOW)).toBe(1.0);
    const future = new Date(NOW.getTime() + DAY_MS);
    expect(recencyModifier(future, RECENCY_PRESETS.news, NOW)).toBe(1.0);
  });

  it('decays to exactly 0.5 * ceiling at one half-life', () => {
    const { halfLifeDays, floor } = RECENCY_PRESETS.rss;
    const oneHalfLifeAgo = new Date(NOW.getTime() - halfLifeDays * DAY_MS);
    const result = recencyModifier(oneHalfLifeAgo, RECENCY_PRESETS.rss, NOW);
    expect(result).toBeCloseTo(Math.max(floor, 0.5), 10);
  });

  it('never decays below the configured floor', () => {
    const veryOld = new Date(NOW.getTime() - 50 * 365 * DAY_MS);
    for (const preset of Object.values(RECENCY_PRESETS)) {
      expect(recencyModifier(veryOld, preset, NOW)).toBe(preset.floor);
    }
  });

  it('never exceeds 1.0 (decay-only, no promotion for freshness)', () => {
    const justNow = new Date(NOW.getTime() - 1);
    for (const preset of Object.values(RECENCY_PRESETS)) {
      expect(recencyModifier(justNow, preset, NOW)).toBeLessThanOrEqual(1.0);
    }
  });

  it('accepts an ISO date string as well as a Date', () => {
    const asString = new Date(NOW.getTime() - 10 * DAY_MS).toISOString();
    const asDate = new Date(NOW.getTime() - 10 * DAY_MS);
    expect(recencyModifier(asString, RECENCY_PRESETS.news, NOW)).toBe(
      recencyModifier(asDate, RECENCY_PRESETS.news, NOW)
    );
  });

  it('presets order fastest-to-slowest decay: news < rss < blog < podcast < edgar', () => {
    expect(RECENCY_PRESETS.news.halfLifeDays).toBeLessThan(RECENCY_PRESETS.rss.halfLifeDays);
    expect(RECENCY_PRESETS.rss.halfLifeDays).toBeLessThan(RECENCY_PRESETS.blog.halfLifeDays);
    expect(RECENCY_PRESETS.blog.halfLifeDays).toBeLessThan(RECENCY_PRESETS.podcast.halfLifeDays);
    expect(RECENCY_PRESETS.podcast.halfLifeDays).toBeLessThan(RECENCY_PRESETS.edgar.halfLifeDays);
  });
});

describe('isRecencyModifierEnabled', () => {
  const original = process.env.RESEARCH_RECENCY_MODIFIER;
  afterEach(() => {
    if (original === undefined) delete process.env.RESEARCH_RECENCY_MODIFIER;
    else process.env.RESEARCH_RECENCY_MODIFIER = original;
  });

  it('defaults to disabled (ADR-030: "tenant-configurable, defaults off")', () => {
    delete process.env.RESEARCH_RECENCY_MODIFIER;
    expect(isRecencyModifierEnabled()).toBe(false);
  });

  it('enables only on the literal string "true"', () => {
    process.env.RESEARCH_RECENCY_MODIFIER = 'true';
    expect(isRecencyModifierEnabled()).toBe(true);
    process.env.RESEARCH_RECENCY_MODIFIER = 'yes';
    expect(isRecencyModifierEnabled()).toBe(false);
  });
});

describe('applyRecencyModifier', () => {
  const original = process.env.RESEARCH_RECENCY_MODIFIER;
  afterEach(() => {
    if (original === undefined) delete process.env.RESEARCH_RECENCY_MODIFIER;
    else process.env.RESEARCH_RECENCY_MODIFIER = original;
  });

  it('is a no-op (returns base unchanged) when the flag is off', () => {
    delete process.env.RESEARCH_RECENCY_MODIFIER;
    const veryOld = new Date(NOW.getTime() - 50 * 365 * DAY_MS);
    expect(applyRecencyModifier(1.2, veryOld, RECENCY_PRESETS.news, NOW)).toBe(1.2);
  });

  it('multiplies base by the recency factor when the flag is on', () => {
    process.env.RESEARCH_RECENCY_MODIFIER = 'true';
    const veryOld = new Date(NOW.getTime() - 50 * 365 * DAY_MS);
    expect(applyRecencyModifier(1.2, veryOld, RECENCY_PRESETS.news, NOW)).toBeCloseTo(
      1.2 * RECENCY_PRESETS.news.floor,
      10
    );
  });

  it('preserves a base of 1.0 for a fresh item even when enabled', () => {
    process.env.RESEARCH_RECENCY_MODIFIER = 'true';
    expect(applyRecencyModifier(1.0, NOW, RECENCY_PRESETS.edgar, NOW)).toBe(1.0);
  });
});
