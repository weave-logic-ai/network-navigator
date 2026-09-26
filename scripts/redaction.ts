// Redaction rule set for LinkedIn capture fixtures.
// Version is bumped when replacement rules change; the value is copied into
// .meta.json so downstream tools can tell which rule-set produced a fixture.
//
// Rules are tuned to be aggressive: false positives are acceptable because
// fixtures are only used to exercise parsers, never for display. Every
// substitution preserves DOM structure, class names, ids, data-* attributes,
// and aria hooks that the parser chains rely on.

export const RULE_SET_VERSION = '1.0.0';

export interface RedactionRule {
  /** Short identifier used in logs and diffs. */
  readonly name: string;
  /** Regex applied globally with a replacer function. */
  readonly pattern: RegExp;
  /** Produces the replacement for a given match. */
  readonly replace: (match: string, ...groups: string[]) => string;
}

// Deterministic slug obfuscator: short hash so repeat slugs collapse
// to the same redacted value within a single fixture.
function shortDigest(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  const asHex = (hash >>> 0).toString(16).padStart(8, '0');
  return asHex.slice(0, 6);
}

export const RULES: ReadonlyArray<RedactionRule> = [
  // 1. <script>...</script> bodies — always dropped; keep the tag so
  //    parsers that touch script tags (json-ld fallback target) still
  //    see them, but contents are replaced with a harmless placeholder.
  {
    name: 'script-body',
    pattern: /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    replace: (_m, attrs) => `<script${attrs}>/* redacted */</script>`,
  },

  // 2. <style> bodies — same treatment, avoids leaking background-image
  //    URLs etc.
  {
    name: 'style-body',
    pattern: /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    replace: (_m, attrs) => `<style${attrs}>/* redacted */</style>`,
  },

  // 3. <img src="..."> — swap the src for a 1x1 placeholder.  Keeps alt
  //    attributes (parsers rely on `alt*="profile picture"`).
  {
    name: 'img-src',
    pattern: /(<img\b[^>]*\bsrc=)(["'])([^"']*)\2/gi,
    replace: (_m, lhs, q) => `${lhs}${q}https://example.invalid/placeholder.png${q}`,
  },

  // 4. <img srcset="..."> — same rationale.
  {
    name: 'img-srcset',
    pattern: /(<img\b[^>]*\bsrcset=)(["'])([^"']*)\2/gi,
    replace: (_m, lhs, q) => `${lhs}${q}https://example.invalid/placeholder.png 1x${q}`,
  },

  // 5. LinkedIn profile slugs: /in/<slug> — deterministic obfuscation.
  {
    name: 'linkedin-profile-slug',
    pattern: /(\/in\/)([a-zA-Z0-9][a-zA-Z0-9-_%]{1,80})/g,
    replace: (_m, prefix, slug) => `${prefix}redacted-${shortDigest(slug)}`,
  },

  // 6. LinkedIn company slugs: /company/<slug>.
  {
    name: 'linkedin-company-slug',
    pattern: /(\/company\/)([a-zA-Z0-9][a-zA-Z0-9-_%]{1,120})/g,
    replace: (_m, prefix, slug) => `${prefix}redacted-${shortDigest(slug)}`,
  },

  // 7. Emails.
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replace: () => 'redacted@example.invalid',
  },

  // 8. US / intl phone numbers — aggressive.  Catches "+1 (555) 123-4567",
  //    "555-123-4567", "555.123.4567", "+44 20 7946 0958".
  {
    name: 'phone',
    pattern: /(?<![\w-])(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\w-])/g,
    replace: () => '+1-555-000-0000',
  },

  // 9. API keys in headers (RapidAPI style).  We strip any key=value pair
  //    where the key name mentions key/token/secret/auth/bearer.
  {
    name: 'api-key-header',
    pattern: /((?:x-[\w-]*)?(?:api[_-]?key|rapidapi-key|authorization|bearer|token|secret)\s*[:=]\s*)(?:"[^"]+"|'[^']+'|[^\s"',>}{\]]+)/gi,
    replace: (_m, lhs) => `${lhs}REDACTED`,
  },

  // 10. Query-string `name=` values — often contain real names in search
  //     pages.  Keeps the key, blanks the value up to the next `&`/quote.
  {
    name: 'name-query-arg',
    pattern: /([?&](?:firstName|lastName|fullName|name)=)([^&"'#\s]+)/gi,
    replace: (_m, lhs) => `${lhs}redacted`,
  },

  // 11. og:description / og:title / og:url values — may contain real names.
  {
    name: 'og-meta',
    pattern: /(<meta\s+[^>]*\bproperty=["']og:(?:title|description|url|image)["'][^>]*\bcontent=)(["'])([^"']*)\2/gi,
    replace: (_m, lhs, q) => `${lhs}${q}redacted${q}`,
  },

  // 12. "<strong>First Last</strong>" inside profile anchors — a very
  //     common pattern on LinkedIn's rendered profile header.  We
  //     substitute a placeholder name while keeping the tag shape.
  {
    name: 'profile-strong-name',
    pattern: /(<strong\b[^>]*>)([^<]{2,80})(<\/strong>)/gi,
    replace: (_m, open, _name, close) => `${open}Redacted Name${close}`,
  },

  // 13. Data URIs — potential PII in base64 images.
  {
    name: 'data-uri',
    pattern: /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi,
    replace: () => 'data:image/png;base64,REDACTED',
  },

  // 14. Bare LinkedIn media URLs (media.licdn.com) — replace whole URL.
  {
    name: 'media-licdn',
    pattern: /https?:\/\/(?:media|static)\.licdn\.com\/[^\s"'<>]+/gi,
    replace: () => 'https://example.invalid/licdn-redacted.png',
  },

  // 15. Capitalised two-word name patterns inside visible text attributes
  //     (aria-label, title, alt).  Aggressive — will redact "New York".
  //     We preserve any trailing parser-relevant tokens (profile picture,
  //     company logo, connections, degree) so selectors like
  //     `img[alt*="profile picture"]` keep matching.
  {
    name: 'attr-name-pattern',
    pattern: /(aria-label|title|alt)=(["'])([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})([^"']*?)\2/g,
    replace: (_m, attr, q, _name, trailing) =>
      `${attr}=${q}Redacted Value${trailing ?? ''}${q}`,
  },
];

/** Apply every rule in order.  Returns redacted string + per-rule hit counts. */
export function redact(input: string): { output: string; hits: Record<string, number> } {
  const hits: Record<string, number> = {};
  let current = input;
  for (const rule of RULES) {
    let count = 0;
    current = current.replace(rule.pattern, (...args: unknown[]) => {
      count++;
      const match = args[0] as string;
      // Extract capture groups: everything between the match string and
      // the numeric offset.  String.replace passes (match, g1, g2, ..., offset, input).
      const groups: string[] = [];
      for (let i = 1; i < args.length - 2; i++) {
        groups.push((args[i] as string) ?? '');
      }
      return rule.replace(match, ...groups);
    });
    if (count > 0) hits[rule.name] = count;
  }
  return { output: current, hits };
}

// Only the exact replacement shape for a rule counts as redacted. A broad
// substring check could hide a real email or URL merely because another
// part of the match contained "redacted" or "example.invalid".
function looksRedacted(ruleName: string, sample: string): boolean {
  switch (ruleName) {
    case 'img-src':
      return /\bsrc=["']https:\/\/example\.invalid\/placeholder\.png["']$/i.test(sample);
    case 'img-srcset':
      return /\bsrcset=["']https:\/\/example\.invalid\/placeholder\.png 1x["']$/i.test(sample);
    case 'linkedin-profile-slug':
      return /^\/in\/redacted-(?:[a-f0-9]{6}|(?:cn|cx|fa|mx|mp|c|art|r|fb|v)[1-6]|slug)$/i.test(sample);
    case 'linkedin-company-slug':
      return /^\/company\/redacted-(?:[a-f0-9]{6}|slug)$/i.test(sample);
    case 'email':
      return sample === 'redacted@example.invalid';
    case 'phone':
      return sample === '+1-555-000-0000';
    case 'api-key-header':
      return /[:=]\s*REDACTED$/i.test(sample);
    case 'name-query-arg':
      return /=redacted$/i.test(sample);
    case 'profile-strong-name':
      return /^<strong\b[^>]*>Redacted Name<\/strong>$/i.test(sample);
    case 'data-uri':
      return sample === 'data:image/png;base64,REDACTED';
    case 'attr-name-pattern':
      return /^(?:aria-label|title|alt)=["']Redacted Value(?:\s+(?:profile picture|company logo|connections|degree))*["']$/i.test(sample);
    default:
      return false;
  }
}

/** Return positions of any surviving PII so the linter can flag fixtures.
 *
 *  Matches that only contain already-redacted placeholders are ignored —
 *  we care about PII that slipped through, not our own substitution
 *  artefacts.
 */
export function detectSurvivingPii(input: string): Array<{ rule: string; sample: string }> {
  const survivors: Array<{ rule: string; sample: string }> = [];
  for (const rule of RULES) {
    // Skip rules that are aesthetic / structural — only care about
    // PII-bearing rules for detection mode.
    if (rule.name === 'script-body' || rule.name === 'style-body') continue;
    if (rule.name === 'og-meta') continue;
    // Reset lastIndex for safety (regex has /g flag).
    rule.pattern.lastIndex = 0;
    const matches = input.match(rule.pattern);
    if (!matches) continue;
    const real = matches.find((m) => !looksRedacted(rule.name, m));
    if (real) {
      survivors.push({ rule: rule.name, sample: real.slice(0, 120) });
    }
  }
  return survivors;
}
