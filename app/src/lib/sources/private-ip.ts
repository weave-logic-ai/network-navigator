// SSRF guard: block source fetches that resolve to private / loopback /
// link-local / multicast IP ranges.
//
// Per `05-source-expansion.md` §15 (Security concerns):
//   "SSRF risk: connectors fetch URLs chosen by users. Block private IP
//    ranges at the fetch layer (no 10.x.x.x, 172.16-31.x.x, 192.168.x.x,
//    127.x.x.x, 169.254.x.x). Reject redirects into those ranges."
//
// Implementation notes:
//   - Accept both literal IP URLs (e.g. `http://10.0.0.1/`) and hostnames
//     that resolve (via Node's built-in `dns.promises.lookup`) to private
//     ranges. Any resolved IP in the disallowed set blocks the fetch.
//   - IPv4 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
//     127.0.0.0/8 (loopback), 169.254.0.0/16 (link-local),
//     224.0.0.0/4 (multicast), 0.0.0.0/8 (unspecified / "this" net),
//     100.64.0.0/10 (CGNAT — treated as private for SSRF purposes).
//   - IPv6 ranges: ::1/128 (loopback), fc00::/7 (unique local),
//     fe80::/10 (link-local), ff00::/8 (multicast), ::/128 (unspecified).
//     IPv4-mapped IPv6 (::ffff:10.0.0.1) reuses the IPv4 table.
//   - Development convenience: set `SOURCES_ALLOW_LOCALHOST=true` to
//     permit `localhost` + 127.0.0.0/8 + ::1 ONLY. Everything else stays
//     blocked. This flag MUST default off in production and exists only
//     for local development (docker-compose, tests, etc.).

import dns from 'dns';
import net from 'net';

export type PrivateIpReason =
  | 'private_ip'
  | 'loopback'
  | 'link_local'
  | 'multicast'
  | 'unspecified'
  | 'cgnat'
  | 'invalid_host';

export interface PrivateIpCheckResult {
  blocked: boolean;
  reason?: PrivateIpReason;
  resolvedIp?: string;
  host?: string;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function localhostAllowed(): boolean {
  return process.env.SOURCES_ALLOW_LOCALHOST === 'true';
}

function octetsOf(ip: string): number[] | null {
  const m = IPV4_RE.exec(ip);
  if (!m) return null;
  const out = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (out.some((o) => !Number.isFinite(o) || o < 0 || o > 255)) return null;
  return out;
}

/**
 * Classify an IPv4 literal. Returns null if the IP is OK to fetch.
 */
export function classifyIPv4(ip: string): PrivateIpReason | null {
  const oct = octetsOf(ip);
  if (!oct) return 'invalid_host';
  const [a, b] = oct;
  // 0.0.0.0/8 — "this" network / unspecified.
  if (a === 0) return 'unspecified';
  // 127.0.0.0/8 — loopback.
  if (a === 127) return localhostAllowed() ? null : 'loopback';
  // 10.0.0.0/8
  if (a === 10) return 'private_ip';
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return 'private_ip';
  // 192.168.0.0/16
  if (a === 192 && b === 168) return 'private_ip';
  // 169.254.0.0/16 — link-local.
  if (a === 169 && b === 254) return 'link_local';
  // 100.64.0.0/10 — CGNAT. Treat as private for SSRF purposes.
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  // 224.0.0.0/4 — multicast. (224-239)
  if (a >= 224 && a <= 239) return 'multicast';
  // 240.0.0.0/4 — reserved / future use. Treat as unspecified.
  if (a >= 240) return 'unspecified';
  return null;
}

/**
 * Classify an IPv6 literal. Returns null if the IP is OK to fetch.
 * Parse hextets structurally because DNS results and literal URLs may use
 * either dotted or hexadecimal IPv4 tails.
 */
export function classifyIPv6(ip: string): PrivateIpReason | null {
  const words = expandIPv6(ip);
  if (!words) return 'invalid_host';
  if (words.every((word) => word === 0)) return 'unspecified';
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) {
    return localhostAllowed() ? null : 'loopback';
  }
  // IPv4-mapped addresses may be written with dotted or hexadecimal tails.
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return classifyIPv4(`${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`);
  }
  // Deprecated IPv4-compatible syntax is still accepted by some clients.
  if (words.slice(0, 6).every((word) => word === 0)) {
    return classifyIPv4(`${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`);
  }
  if ((words[0] & 0xff00) === 0xff00) return 'multicast';
  if ((words[0] & 0xffc0) === 0xfe80) return 'link_local';
  if ((words[0] & 0xfe00) === 0xfc00) return 'private_ip';
  return null;
}

function expandIPv6(input: string): number[] | null {
  if (net.isIP(input) !== 6 || input.includes('%')) return null;
  let ip = input.toLowerCase();
  const dottedTail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (dottedTail) {
    const octets = octetsOf(dottedTail[1]);
    if (!octets) return null;
    ip = ip.slice(0, -dottedTail[1].length)
      + ((octets[0] << 8) | octets[1]).toString(16)
      + ':' + ((octets[2] << 8) | octets[3]).toString(16);
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const omitted = 8 - left.length - right.length;
  if (omitted < 0 || (halves.length === 1 && omitted !== 0)) return null;
  return [...left, ...Array(omitted).fill('0'), ...right].map((part) => parseInt(part, 16));
}

/**
 * Classify any IP literal (IPv4 or IPv6).
 */
export function classifyIp(ip: string): PrivateIpReason | null {
  if (net.isIP(ip) === 4) return classifyIPv4(ip);
  if (net.isIP(ip) === 6) return classifyIPv6(ip);
  return 'invalid_host';
}

/**
 * Check whether a hostname (IP literal or DNS name) resolves to a disallowed
 * IP. Returns `{ blocked: true, reason }` when any resolved address is in a
 * forbidden range.
 *
 * DNS lookup uses Node's `dns.promises.lookup` with `all: true` so we see
 * every resolved address (IPv4 + IPv6) for hosts with multiple A/AAAA records.
 * A single bad IP blocks the fetch (fail-closed per ADR-ish SSRF treatment).
 */
export async function checkHostSafe(
  host: string,
  lookup: (h: string) => Promise<Array<{ address: string; family: number }>> = defaultLookup
): Promise<PrivateIpCheckResult> {
  if (!host || typeof host !== 'string') {
    return { blocked: true, reason: 'invalid_host', host };
  }
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();

  // Short-circuit "localhost" hostname.
  if (normalized === 'localhost' || normalized === 'localhost.localdomain') {
    if (localhostAllowed()) return { blocked: false, host: normalized, resolvedIp: '127.0.0.1' };
    return { blocked: true, reason: 'loopback', host: normalized };
  }

  // Literal IPv4.
  if (net.isIP(normalized) === 4) {
    const reason = classifyIPv4(normalized);
    return reason
      ? { blocked: true, reason, host: normalized, resolvedIp: normalized }
      : { blocked: false, host: normalized, resolvedIp: normalized };
  }

  // Literal IPv6 (URLs carry this in brackets which we stripped above).
  if (net.isIP(normalized) === 6) {
    const reason = classifyIPv6(normalized);
    return reason
      ? { blocked: true, reason, host: normalized, resolvedIp: normalized }
      : { blocked: false, host: normalized, resolvedIp: normalized };
  }
  if (normalized.includes(':')) {
    return { blocked: true, reason: 'invalid_host', host: normalized };
  }

  // DNS lookup.
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(normalized);
  } catch {
    // Unresolvable → let the fetch fail downstream. Do not block here —
    // a user may paste a URL whose DNS is temporarily down; the fetch
    // error will surface clearly. But return invalid_host so callers can
    // distinguish from a ranged block.
    return { blocked: true, reason: 'invalid_host', host: normalized };
  }
  if (records.length === 0) {
    return { blocked: true, reason: 'invalid_host', host: normalized };
  }
  for (const rec of records) {
    const reason = classifyIp(rec.address);
    if (reason) {
      return { blocked: true, reason, host: normalized, resolvedIp: rec.address };
    }
  }
  return { blocked: false, host: normalized, resolvedIp: records[0].address };
}

async function defaultLookup(
  host: string
): Promise<Array<{ address: string; family: number }>> {
  const res = await dns.promises.lookup(host, { all: true, verbatim: true });
  return res;
}

/**
 * Convenience wrapper: take a URL string, pull the host out, run checkHostSafe.
 */
export async function checkUrlSafe(
  url: string,
  lookup?: (h: string) => Promise<Array<{ address: string; family: number }>>
): Promise<PrivateIpCheckResult> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { blocked: true, reason: 'invalid_host' };
  }
  return checkHostSafe(host, lookup);
}
