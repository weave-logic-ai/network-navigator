import { NextRequest, NextResponse } from 'next/server';
import { validateExtensionToken } from '@/lib/auth/extension-auth';
import { checkRateLimit } from '@/lib/middleware/extension-rate-limiter';
import { isAllowedExtensionOrigin, requireLocalDashboardRequest, trustedLocalOrigin } from './local-request-boundary';

/** Route-level guard for visibility endpoints used by both the local UI and extension. */
export async function requireVisibilityPrincipal(
  request: NextRequest, json = false, rateLimit = true
): Promise<NextResponse | null> {
  const origin = request.headers.get('origin');
  if (!origin?.startsWith('chrome-extension://')) {
    return requireLocalDashboardRequest(request, json);
  }

  if (!trustedLocalOrigin(request) || !isAllowedExtensionOrigin(origin)) {
    return NextResponse.json({ error: 'Untrusted extension origin' }, { status: 403 });
  }
  if (json && !/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  const token = request.headers.get('x-extension-token');
  // Display prefixes can be used only for registration, never API access.
  if (!token || !/^ext_[A-Za-z0-9_-]{43}$/.test(token)) {
    return NextResponse.json({ error: 'Full extension token required' }, { status: 401 });
  }

  try {
    const extension = await validateExtensionToken(token);
    if (!extension.valid || !extension.extensionId) {
      return NextResponse.json({ error: 'Invalid extension token' }, { status: 401 });
    }
    if (rateLimit) {
      const limit = checkRateLimit(extension.extensionId, request.nextUrl.pathname);
      if (!limit.allowed) {
        return NextResponse.json({ error: 'Extension rate limit exceeded' }, {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        });
      }
    }
    return null;
  } catch {
    return NextResponse.json({ error: 'Extension token validation unavailable' }, { status: 503 });
  }
}
