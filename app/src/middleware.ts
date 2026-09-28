import { NextRequest, NextResponse } from 'next/server';
import { isAllowedExtensionOrigin, isOriginlessExtensionRead, trustedLocalOrigin } from '@/lib/auth/local-request-boundary';
import { hasOperatorSession } from '@/lib/auth/operator-session';

const SECRET_PROTECTED_CRON_ROUTES = new Set([
  '/api/sources/cron/blog-discovery',
  '/api/sources/cron/edgar-backfill',
  '/api/sources/cron/google-news-refresh',
  '/api/sources/cron/news-sweep',
  '/api/sources/cron/parser-rollup',
  '/api/sources/cron/podcast-refresh',
  '/api/sources/cron/rss-poll',
  '/api/sources/cron/wayback-seed',
]);

function isTokenProtectedExtensionRoute(path: string): boolean {
  return /^\/api\/extension\/(?:capture|health|settings|message-render|snippet|tags|analytics|entity-diff)$/.test(path)
    || /^\/api\/extension\/(?:tasks|contact|company)(?:\/|$)/.test(path);
}

function isExtensionVisibilityParserRoute(path: string): boolean {
  return path === '/api/parser/flag-unmatched' || path === '/api/parser/regression-report';
}

function isExtensionOutreachRoute(request: NextRequest, path: string): boolean {
  const method = request.method === 'OPTIONS'
    ? request.headers.get('access-control-request-method')?.toUpperCase()
    : request.method;
  return (path === '/api/outreach/templates' && method === 'GET')
    || (path === '/api/claude/personalize' && method === 'POST');
}

function isTargetStateRoute(path: string): boolean {
  return path === '/api/targets/state' || path === '/api/targets/state/history'
    || /^\/api\/targets\/[^/]+\/lenses\/[^/]+\/activate$/.test(path);
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // These routes own their own shared-secret check, or are the health probe.
  if (path === '/api/health' || SECRET_PROTECTED_CRON_ROUTES.has(path)) return NextResponse.next();

  const localOrigin = trustedLocalOrigin(request);
  if (!localOrigin) {
    return NextResponse.json({ error: 'Untrusted host' }, { status: 403 });
  }

  const origin = request.headers.get('origin');
  const extensionOrigin = !!origin && origin.startsWith('chrome-extension://');
  const originlessExtensionRead = isOriginlessExtensionRead(request);
  if (origin === 'null' || (origin && origin !== localOrigin && !isAllowedExtensionOrigin(origin))) {
    return NextResponse.json({ error: 'Untrusted origin' }, { status: 403 });
  }
  if (extensionOrigin && path !== '/api/extension/register'
    && !isTokenProtectedExtensionRoute(path) && !isExtensionVisibilityParserRoute(path)
    && !isExtensionOutreachRoute(request, path)) {
    return NextResponse.json({ error: 'Extension route is not token protected' }, { status: 403 });
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (isTargetStateRoute(path) && !extensionOrigin && !origin && fetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'Origin required for target state' }, { status: 403 });
  }
  if (!extensionOrigin && fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return NextResponse.json({ error: 'Untrusted request site' }, { status: 403 });
  }

  if (request.method === 'OPTIONS') {
    if (!origin) return NextResponse.json({ error: 'Origin required' }, { status: 403 });
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  const isApi = path.startsWith('/api/');
  const extensionPrincipal = isApi && (path === '/api/extension/register'
    || isTokenProtectedExtensionRoute(path)
    || (extensionOrigin && (isExtensionVisibilityParserRoute(path)
      || isExtensionOutreachRoute(request, path)))
    || (originlessExtensionRead && isExtensionOutreachRoute(request, path)));
  if (path !== '/api/operator/unlock' && !extensionPrincipal && !await hasOperatorSession(request)) {
    if (!isApi) return NextResponse.redirect(new URL('/operator/unlock', localOrigin));
    return NextResponse.json({ error: 'Operator session required' }, { status: 401 });
  }

  if (isApi && request.body && !['GET', 'HEAD'].includes(request.method)) {
    const contentType = request.headers.get('content-type') ?? '';
    const expected = path === '/api/import/upload'
      ? /^multipart\/form-data(?:\s*;|\s*$)/i
      : /^application\/json(?:\s*;|\s*$)/i;
    if (!expected.test(contentType)) {
      return NextResponse.json({ error: 'Unsupported Content-Type' }, { status: 415 });
    }
  }

  const response = NextResponse.next();
  if (isTargetStateRoute(path)) response.headers.set('Cache-Control', 'private, no-store');
  if (origin) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      response.headers.set(key, value);
    }
  }
  return response;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Extension-Token, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export const config = {
  matcher: ['/api/:path*', '/((?!api/|_next/|operator/unlock(?:/|$)|favicon.ico$).*)'],
};
