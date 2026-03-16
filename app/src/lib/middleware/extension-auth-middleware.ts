// Auth middleware for extension API endpoints
// Validates X-Extension-Token header and origin

import { NextRequest, NextResponse } from 'next/server';
import { validateExtensionToken } from '@/lib/auth/extension-auth';
import { checkRateLimit } from './extension-rate-limiter';

/**
 * Middleware that validates extension requests.
 * Checks:
 *   1. X-Extension-Token header present and valid
 *   2. Origin header matches chrome-extension:// pattern (or dev localhost)
 *   3. Token is not revoked
 *
 * Returns 401 with JSON error body on failure.
 * Returns 429 if rate limit exceeded.
 */
export async function withExtensionAuth(
  req: NextRequest,
  handler: (req: NextRequest, extensionId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  // 1. Validate origin
  const origin = req.headers.get('origin');
  if (!validateOrigin(origin)) {
    return NextResponse.json(
      {
        error: 'INVALID_ORIGIN',
        message: 'Request origin is not allowed',
      },
      { status: 401 }
    );
  }

  // 2. Extract and validate token
  const token = req.headers.get('x-extension-token');
  if (!token) {
    return NextResponse.json(
      {
        error: 'MISSING_TOKEN',
        message: 'X-Extension-Token header is required',
      },
      { status: 401 }
    );
  }

  const validation = await validateExtensionToken(token);
  if (!validation.valid || !validation.extensionId) {
    return NextResponse.json(
      {
        error: validation.error ?? 'INVALID_TOKEN',
        message:
          validation.error === 'REVOKED_TOKEN'
            ? 'This extension token has been revoked'
            : 'Invalid extension token',
      },
      { status: 401 }
    );
  }

  // 3. Check rate limit
  const endpoint = new URL(req.url).pathname;
  const rateLimitResult = checkRateLimit(validation.extensionId, endpoint);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        retryAfter: rateLimitResult.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitResult.retryAfterSeconds),
        },
      }
    );
  }

  // 4. Execute handler with extensionId
  return handler(req, validation.extensionId);
}

/**
 * Validate Origin header for chrome-extension:// requests.
 * Also allows localhost origins for development.
 */
export function validateOrigin(origin: string | null): boolean {
  // Allow requests with no origin (e.g., server-to-server, curl testing)
  if (!origin) {
    return true;
  }

  // Allow chrome-extension:// origins
  if (origin.startsWith('chrome-extension://')) {
    return true;
  }

  // Allow localhost in development
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.ALLOW_DEV_ORIGIN === 'true'
  ) {
    if (
      origin.startsWith('http://localhost:') ||
      origin === 'http://localhost'
    ) {
      return true;
    }
  }

  return false;
}
