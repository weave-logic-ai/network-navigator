import { NextRequest, NextResponse } from 'next/server';
import { hasOperatorSession } from './operator-session';

/** Verify browser provenance before inspecting the signed operator session. */
export async function requireLocalDashboardRequest(request: NextRequest, json = false): Promise<NextResponse | null> {
  const denied = requireLocalOrigin(request, json);
  if (denied) return denied;
  if (!await hasOperatorSession(request)) {
    return NextResponse.json({ error: 'Operator session required' }, { status: 401 });
  }
  return null;
}

export function requireLocalOrigin(request: NextRequest, json = false): NextResponse | null {
  const localOrigin = trustedLocalOrigin(request);
  if (!localOrigin) {
    return NextResponse.json({ error: 'Untrusted host' }, { status: 403 });
  }

  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  // Browser GET fetches commonly omit Origin. Require browser same-origin
  // metadata in that case; null and cross-site origins always fail.
  if (origin ? origin !== localOrigin : fetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'Untrusted origin' }, { status: 403 });
  }
  if (fetchSite && fetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'Untrusted request site' }, { status: 403 });
  }

  if (json && !/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  return null;
}

/** HTTP framing, not `request.body`: the served runtime exposes an empty stream
 * for bodyless POST/DELETE, while a real body always has Content-Length or
 * Transfer-Encoding. A malformed length is treated as a body. */
export function hasRequestBody(request: NextRequest): boolean {
  if (request.headers.has('transfer-encoding')) return true;
  const length = request.headers.get('content-length');
  return length !== null && length.trim() !== '0';
}

export function trustedLocalOrigin(request: NextRequest): string | null {
  return trustedLoopbackHost(request.headers.get('host'));
}

export function trustedLoopbackHost(host: string | null | undefined): string | null {
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return null;
  try {
    return new URL(`http://${host}`).origin;
  } catch {
    return null;
  }
}

export function isAllowedExtensionOrigin(origin: string): boolean {
  // Pin the installed Chrome extension ID explicitly; an arbitrary valid ID
  // is not a trusted principal.
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return false;
  const allowlist = process.env.EXTENSION_ALLOWED_ORIGINS;
  return !!allowlist && allowlist.split(',').map(value => value.trim()).includes(origin);
}

/** MV3 host-permission GETs omit Origin in Chromium. Only the token-authenticated
 * extension read paths may use this shape; dashboard requests keep their own
 * same-origin and operator-session checks. */
export function isOriginlessExtensionRead(request: NextRequest): boolean {
  return request.method === 'GET'
    && request.headers.get('origin') === null
    && (request.headers.get('sec-fetch-site') === null || request.headers.get('sec-fetch-site') === 'none')
    && /^ext_[A-Za-z0-9_-]{43}$/.test(request.headers.get('x-extension-token') ?? '');
}
