import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseHtml } from '@/lib/parser/parse-engine';
import type { SelectorConfig } from '@/types/selector-config';
import selectorConfigs from './fixtures/selector-configs.json';

const fixturePath = path.resolve(__dirname, '../../data/parser-fixtures/profile/01-basic.html');
const fixture = fs.readFileSync(fixturePath, 'utf8');
const config: SelectorConfig = {
  id: 'profile-regression-config',
  pageType: 'PROFILE',
  version: 1,
  selectors: selectorConfigs.PROFILE as SelectorConfig['selectors'],
  heuristics: selectorConfigs.PROFILE_HEURISTICS as SelectorConfig['heuristics'],
  isActive: true,
  createdAt: '2026-04-17T00:00:00Z',
  updatedAt: '2026-04-17T00:00:00Z',
  createdBy: 'test',
  notes: null,
};
const url = 'https://www.linkedin.com/in/redacted-slug/';

it('exposes a 0.9→0.3 headline drop and the unmatched changed card', () => {
  const baseline = parseHtml(fixture, 'PROFILE', config, url, 'baseline');
  expect(baseline.fields.find((field) => field.field === 'headline')?.source).toBe('selector');

  // A prior capture recorded 0.9; the existing redacted fixture supplies the
  // same title while its visible headline card moves outside the known selector.
  const priorHeadlineConfidence = 0.9;
  const original = '<p class="text-body-medium">Senior Product Manager at Example Co</p>';
  expect(fixture).toContain(original);
  const changed = fixture.replace(original, '').replace(
    '</main>',
    '<section class="ph5 pb5" aria-labelledby="new-headline">' +
      '<h2 id="new-headline">Profile headline</h2>' +
      '<p>Senior Product Manager at Example Co. This expanded card contains enough ' +
      'context to show the new profile layout while preserving a redacted example.</p>' +
    '</section></main>'
  );
  const current = parseHtml(changed, 'PROFILE', config, url, 'changed');
  const headline = current.fields.find((field) => field.field === 'headline');

  expect(headline).toMatchObject({
    value: 'Senior Product Manager',
    confidence: 0.3,
    source: 'fallback',
    selectorUsed: 'fallback:title-tag[headline]',
  });
  expect(current.data?.headline).toBe('Senior Product Manager');
  expect(priorHeadlineConfidence - (headline?.confidence ?? 0)).toBeCloseTo(0.6);
  expect(current.unmatched).toEqual(expect.arrayContaining([
    expect.objectContaining({ domPath: expect.stringContaining('section.ph5') }),
  ]));
});

it('keeps original capture content out of fixture dry-run output', () => {
  const script = path.resolve(__dirname, '../../scripts/capture-fixture.ts');
  const privateHtml = '<html><body><strong>Alice Example</strong><p>alice@example.com</p></body></html>';
  const run = spawnSync(process.execPath, [script, '--page-type', 'PROFILE', '--dry-run'], {
    input: privateHtml,
    encoding: 'utf8',
  });
  expect(run.status).toBe(0);
  expect(run.stdout).toContain('changed line numbers');
  expect(run.stdout).not.toContain('Alice Example');
  expect(run.stdout).not.toContain('alice@example.com');
  expect(run.stderr).toBe('');
});
