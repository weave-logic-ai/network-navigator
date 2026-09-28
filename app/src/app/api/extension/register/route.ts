// POST /api/extension/register
// Extension sends its full token and receives its ID + settings.

import { NextRequest, NextResponse } from 'next/server';
import { validateDisplayToken } from '@/lib/auth/extension-auth';
import { DEFAULT_EXTENSION_SETTINGS } from '@/types/extension-auth';
import { isAllowedExtensionOrigin, trustedLocalOrigin } from '@/lib/auth/local-request-boundary';


export async function POST(req: NextRequest) {
  if (!trustedLocalOrigin(req) || !isAllowedExtensionOrigin(req.headers.get('origin') ?? '')) {
    return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 });
  }
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get('content-type') ?? '')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  try {
    const body = await req.json();
    const displayToken = body && typeof body === 'object' ? body.displayToken : undefined;

    if (!displayToken || typeof displayToken !== 'string') {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Full extension token is required' },
        { status: 400 }
      );
    }

    const result = await validateDisplayToken(displayToken);

    if (!result.valid || !result.extensionId) {
      return NextResponse.json(
        { error: 'INVALID_TOKEN', message: 'Invalid extension token' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      extensionId: result.extensionId,
      settings: DEFAULT_EXTENSION_SETTINGS,
    });
  } catch (error) {
    console.error('[Register] Error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Registration failed' },
      { status: 500 }
    );
  }
}
