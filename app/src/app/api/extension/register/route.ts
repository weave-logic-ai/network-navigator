// POST /api/extension/register
// Token exchange: extension sends displayToken, receives full token + settings
// This endpoint does NOT require X-Extension-Token (it IS the exchange mechanism)

import { NextRequest, NextResponse } from 'next/server';
import { validateDisplayToken } from '@/lib/auth/extension-auth';
import { DEFAULT_EXTENSION_SETTINGS } from '@/types/extension-auth';


export async function POST(req: NextRequest) {
  // Registration is the bootstrap endpoint — allow any origin
  // (token validation provides the security, not origin)
  try {
    const body = await req.json();
    const { displayToken } = body;

    if (!displayToken || typeof displayToken !== 'string') {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'displayToken is required' },
        { status: 400 }
      );
    }

    const result = await validateDisplayToken(displayToken);

    if (!result.valid || !result.extensionId) {
      return NextResponse.json(
        { error: 'INVALID_TOKEN', message: 'Invalid display token' },
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
