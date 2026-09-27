// robots.txt parser + 24h cache.
//
// Fail-closed: if the remote `/robots.txt` returns an error (timeout, 5xx,
// malformed body), the cache entry is stored with `parsed_ok=false` and every
// subsequent lookup is treated as DISALLOW until the cache expires. This is
// the stance `05-source-expansion.md` §11 specifies ("honor directives; fail
// closed on parse errors").
//
// Parsing scope: we honor `User-agent` groups, `Allow`, and `Disallow`
// directives. We do NOT implement `Crawl-delay` (rate-limiter handles that),
// `Sitemap` (not relevant to Wayback/EDGAR), or wildcard path matching
// beyond prefix + `$` end-anchor. The WS-5 connectors access only stable
// SEC/Wayback URLs; our matcher deliberately stays simple.

import { query } from '../db/client';
import { hostOf } from './url-normalize';
import { safeHttpGet } from './safe-http';

export interface RobotsRuleGroup {
  userAgent: string;
  allow: string[];
  disallow: string[];
}

interface CacheRow {
  host: string;
  fetched_at: string;
  expires_at: string;
  parsed_ok: boolean;
  rules: unknown;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_ROBOTS_BYTES = 1024 * 1024;
const DEFAULT_USER_AGENT = 'NetworkNavigator';

/**
 * Parse the body of a robots.txt file into an array of rule groups. Only
 * directives we understand are retained; everything else (Crawl-delay,
 * Sitemap, comments) is discarded.
 */
export function parseRobotsTxt(body: string): RobotsRuleGroup[] {
  const groups: RobotsRuleGroup[] = [];
  let current: RobotsRuleGroup | null = null;

  const lines = body.split(/\r?\n/);
  for (const raw of lines) {
    // Strip inline comments + trim.
    const line = raw.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      // Start a new group when we see User-agent *after* having seen
      // rules — consecutive User-agents before any rule share one group.
      if (!current || current.allow.length > 0 || current.disallow.length > 0) {
        current = { userAgent: value, allow: [], disallow: [] };
        groups.push(current);
      } else {
        // Collapse consecutive user-agents — override to latest per spec.
        current.userAgent = value;
      }
    } else if (directive === 'allow' && current) {
      if (value) current.allow.push(value);
    } else if (directive === 'disallow' && current) {
      // Empty `Disallow:` means "allow everything" — we model it as no-op.
      if (value) current.disallow.push(value);
    }
  }
  return groups;
}

/**
 * Given parsed rule groups and a path, determine if the user-agent is allowed
 * to fetch the path. Algorithm per RFC 9309 §2.2 (simplified):
 *   1. Pick the matching group: exact UA match beats `*` wildcard.
 *   2. Among that group's Allow/Disallow rules, the longest matching prefix
 *      wins. Tie goes to Allow.
 *   3. If no rule matches, default Allow.
 */
export function isPathAllowed(
  groups: RobotsRuleGroup[],
  userAgent: string,
  path: string
): boolean {
  const ua = userAgent.toLowerCase();
  const specific = groups.find((g) => g.userAgent.toLowerCase() === ua);
  const wildcard = groups.find((g) => g.userAgent === '*');
  const group = specific ?? wildcard;
  if (!group) return true;

  let bestLen = -1;
  let bestAllow = true; // default allow
  for (const rule of group.allow) {
    if (pathMatches(rule, path) && rule.length > bestLen) {
      bestLen = rule.length;
      bestAllow = true;
    }
  }
  for (const rule of group.disallow) {
    if (pathMatches(rule, path) && rule.length > bestLen) {
      bestLen = rule.length;
      bestAllow = false;
    } else if (pathMatches(rule, path) && rule.length === bestLen) {
      // Tie → Allow wins (do nothing).
    }
  }
  return bestAllow;
}

function pathMatches(rule: string, path: string): boolean {
  if (rule.length === 0) return false;
  // Support `$` end-anchor only. Leading char must be `/`.
  if (rule.endsWith('$')) {
    const base = rule.slice(0, -1);
    return path === base;
  }
  return path.startsWith(rule);
}

/**
 * Return the cached robots info for a host, or null if no cache entry.
 */
async function readCache(host: string): Promise<CacheRow | null> {
  const res = await query<CacheRow>(
    `SELECT host, fetched_at, expires_at, parsed_ok, rules
     FROM source_robots_cache WHERE host = $1`,
    [host]
  );
  return res.rows[0] ?? null;
}

async function writeCache(
  host: string,
  rawBody: string | null,
  parsedOk: boolean,
  parseError: string | null,
  rules: RobotsRuleGroup[]
): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + CACHE_TTL_MS);
  await query(
    `INSERT INTO source_robots_cache
       (host, fetched_at, expires_at, raw_body, parsed_ok, parse_error, rules)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (host) DO UPDATE
       SET fetched_at = EXCLUDED.fetched_at,
           expires_at = EXCLUDED.expires_at,
           raw_body = EXCLUDED.raw_body,
           parsed_ok = EXCLUDED.parsed_ok,
           parse_error = EXCLUDED.parse_error,
           rules = EXCLUDED.rules`,
    [host, now.toISOString(), expires.toISOString(), rawBody, parsedOk, parseError, JSON.stringify(rules)]
  );
}

/**
 * Fetch `/robots.txt` with a 5s timeout. Returns `{ ok: true, body }` on a
 * 2xx, `{ ok: true, body: '' }` on 404 (meaning: implicit allow), or
 * `{ ok: false, error }` on any other outcome. Transport-level errors fail
 * closed on the caller.
 */
async function fetchRobots(host: string): Promise<{ ok: boolean; body: string; error?: string }> {
  const url = `https://${host}/robots.txt`;
  try {
    const res = await safeHttpGet(url, { maxBytes: MAX_ROBOTS_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
    if (res.status === 404) return { ok: true, body: '' };
    if (res.status < 200 || res.status >= 300) return { ok: false, body: '', error: `HTTP ${res.status}` };
    const body = res.bytes.toString('utf8');
    return { ok: true, body };
  } catch (err) {
    return { ok: false, body: '', error: (err as Error).message };
  }
}

/**
 * Check if `url` is allowed for `userAgent`. Uses the 24h cache; refreshes
 * on expiry. On fetch or parse error, returns `false` and sets the cache so
 * the host stays blocked for 24h (fail-closed).
 */
export async function isAllowed(
  url: string,
  userAgent: string = DEFAULT_USER_AGENT
): Promise<{ allowed: boolean; reason: string }> {
  const host = hostOf(url);
  if (!host) return { allowed: false, reason: 'invalid-url' };
  const path = new URL(url).pathname || '/';

  const cached = await readCache(host);
  const now = new Date();
  if (cached && new Date(cached.expires_at) > now) {
    if (!cached.parsed_ok) return { allowed: false, reason: 'cached-parse-error' };
    const rules = Array.isArray(cached.rules) ? (cached.rules as RobotsRuleGroup[]) : [];
    const allowed = isPathAllowed(rules, userAgent, path);
    return { allowed, reason: allowed ? 'cached-allow' : 'cached-disallow' };
  }

  const fetched = await fetchRobots(host);
  if (!fetched.ok) {
    // Fail-closed: cache the error so we stop retrying for 24h.
    await writeCache(host, null, false, fetched.error ?? 'fetch-failed', []);
    return { allowed: false, reason: `fetch-error:${fetched.error ?? 'unknown'}` };
  }
  try {
    const rules = parseRobotsTxt(fetched.body);
    await writeCache(host, fetched.body, true, null, rules);
    const allowed = isPathAllowed(rules, userAgent, path);
    return { allowed, reason: allowed ? 'allow' : 'disallow' };
  } catch (err) {
    await writeCache(host, fetched.body, false, (err as Error).message, []);
    return { allowed: false, reason: `parse-error:${(err as Error).message}` };
  }
}
