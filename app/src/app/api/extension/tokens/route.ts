import { NextRequest, NextResponse } from 'next/server';
import { hasRequestBody, requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { generateExtensionToken, listExtensionTokens } from '@/lib/auth/extension-auth';

const privateHeaders = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  const tokens = await listExtensionTokens();
  return NextResponse.json({ data: tokens }, { headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  // The existing dashboard sends a bodyless POST. Minting needs only its
  // operator session, so no client-supplied token or secret enters this route.
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  if (hasRequestBody(request)) {
    return NextResponse.json({ error: 'Request body is not supported' }, { status: 400 });
  }
  const token = await generateExtensionToken();
  return NextResponse.json({ data: token }, { status: 201, headers: privateHeaders });
}
