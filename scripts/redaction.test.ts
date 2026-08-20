// Tests for the fixture PII redaction ruleset (scripts/redaction.ts).
//
// This is the highest-risk logic in scripts/: `capture-fixture.ts` runs
// `redact()` before writing captured LinkedIn HTML to the repo, and
// `fixture-lint.ts` runs `detectSurvivingPii()` as a CI-style gate on
// already-committed fixtures. A regression here means real PII (emails,
// phone numbers, profile slugs) lands in git history. These tests exercise
// the real regex rules and the real Luhn-free redaction pipeline, not a
// reimplementation of them.
//
// Run: `node --test redaction.test.ts` (from scripts/).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, detectSurvivingPii, RULE_SET_VERSION, RULES } from './redaction.ts';

test('RULE_SET_VERSION is a non-empty semver-shaped string', () => {
  assert.match(RULE_SET_VERSION, /^\d+\.\d+\.\d+$/);
});

test('redact() strips email addresses', () => {
  const { output, hits } = redact('Contact: jane.doe@example.com for details.');
  assert.equal(output, 'Contact: redacted@example.invalid for details.');
  assert.equal(hits.email, 1);
});

test('redact() strips phone numbers', () => {
  const { output, hits } = redact('Call +1 (555) 123-4567 anytime.');
  assert.equal(output, 'Call +1-555-000-0000 anytime.');
  assert.equal(hits.phone, 1);
});

test('redact() obfuscates LinkedIn profile slugs deterministically', () => {
  const html =
    '<a href="/in/jane-doe-12345">Jane</a> also see /in/jane-doe-12345 again.';
  const { output, hits } = redact(html);
  assert.equal(hits['linkedin-profile-slug'], 2);
  // Extract both redacted slugs and confirm they're identical (same input
  // slug -> same short hash) and neither leaks the original.
  const matches = [...output.matchAll(/\/in\/(redacted-[a-f0-9]{6})/g)];
  assert.equal(matches.length, 2);
  assert.equal(matches[0][1], matches[1][1]);
  assert.ok(!output.includes('jane-doe-12345'));
});

test('redact() obfuscates LinkedIn company slugs', () => {
  const { output, hits } = redact('/company/acme-corp-inc');
  assert.match(output, /^\/company\/redacted-[a-f0-9]{6}$/);
  assert.equal(hits['linkedin-company-slug'], 1);
});

test('redact() drops <script> and <style> bodies but preserves attributes', () => {
  const html =
    '<script type="application/ld+json">{"name":"Jane Doe"}</script>' +
    '<style class="x">.a{color:red}</style>';
  const { output, hits } = redact(html);
  assert.equal(
    output,
    '<script type="application/ld+json">/* redacted */</script>' +
      '<style class="x">/* redacted */</style>'
  );
  assert.equal(hits['script-body'], 1);
  assert.equal(hits['style-body'], 1);
});

test('redact() replaces img src/srcset but keeps alt text', () => {
  const html = '<img src="https://media.licdn.com/x.jpg" srcset="https://media.licdn.com/x.jpg 1x" alt="profile picture">';
  const { output } = redact(html);
  // img-src / img-srcset rules run before the media-licdn rule reaches the
  // (already-replaced) src, so the final src/srcset point at the generic
  // placeholder host, and alt is untouched.
  assert.match(output, /src="https:\/\/example\.invalid\/placeholder\.png"/);
  assert.match(output, /srcset="https:\/\/example\.invalid\/placeholder\.png 1x"/);
  assert.match(output, /alt="profile picture"/);
});

test('redact() redacts api-key-style headers', () => {
  const { output, hits } = redact('x-rapidapi-key: sk_live_abc123XYZ');
  assert.equal(output, 'x-rapidapi-key: REDACTED');
  assert.equal(hits['api-key-header'], 1);
});

test('redact() blanks name query-string args but keeps the key', () => {
  const { output } = redact('/search?firstName=Jane&lastName=Doe&keywords=engineer');
  assert.equal(output, '/search?firstName=redacted&lastName=redacted&keywords=engineer');
});

test('redact() redacts og:meta content values', () => {
  const html = '<meta property="og:title" content="Jane Doe - LinkedIn">';
  const { output, hits } = redact(html);
  assert.equal(output, '<meta property="og:title" content="redacted">');
  assert.equal(hits['og-meta'], 1);
});

test('redact() replaces base64 data URIs', () => {
  const { output } = redact('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  assert.equal(output, 'data:image/png;base64,REDACTED');
});

test('redact() rewrites bare media.licdn.com URLs', () => {
  const { output } = redact(
    'background-image: url(https://media.licdn.com/dms/image/abc123)'
  );
  assert.ok(output.includes('https://example.invalid/licdn-redacted.png'));
  assert.ok(!output.includes('media.licdn.com'));
});

test('redact() leaves text with no PII untouched (zero hits)', () => {
  const { output, hits } = redact('<div class="card">Nothing sensitive here</div>');
  assert.equal(output, '<div class="card">Nothing sensitive here</div>');
  assert.deepEqual(hits, {});
});

test('detectSurvivingPii() finds nothing in output that already went through redact()', () => {
  const html =
    '<a href="/in/jane-doe-12345">Jane</a> jane@example.com +1 (555) 123-4567';
  const { output } = redact(html);
  const survivors = detectSurvivingPii(output);
  assert.deepEqual(survivors, []);
});

test('detectSurvivingPii() flags an email that was never redacted', () => {
  const survivors = detectSurvivingPii('Reach out at jane@example.com please.');
  assert.ok(survivors.some((s) => s.rule === 'email'));
});

test('detectSurvivingPii() does not flag the redaction pipeline\'s own placeholders', () => {
  // The phone placeholder itself ("+1-555-000-0000") matches the phone
  // regex shape; looksRedacted() must recognize it as an artefact, not a
  // real surviving phone number.
  const survivors = detectSurvivingPii('Call +1-555-000-0000 anytime.');
  assert.ok(!survivors.some((s) => s.rule === 'phone'));
});

test('detectSurvivingPii() skips structural rules (script-body, style-body, og-meta)', () => {
  const survivors = detectSurvivingPii(
    '<script>raw unredacted content</script><style>raw css</style>'
  );
  assert.ok(!survivors.some((s) => s.rule === 'script-body'));
  assert.ok(!survivors.some((s) => s.rule === 'style-body'));
  assert.ok(!survivors.some((s) => s.rule === 'og-meta'));
});

test('every rule name in RULES is unique', () => {
  const names = RULES.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
});
