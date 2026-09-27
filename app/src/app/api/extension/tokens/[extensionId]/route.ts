import { NextRequest, NextResponse } from 'next/server';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { revokeExtensionToken } from '@/lib/auth/extension-auth';
import { wsServer } from '@/lib/websocket/ws-server';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ extensionId: string }> }
) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  const { extensionId } = await params;
  // The column is TEXT: older locally provisioned IDs were not UUIDs.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(extensionId)) {
    return NextResponse.json({ error: 'Invalid extension ID' }, { status: 400 });
  }
  const tokenHash = await revokeExtensionToken(extensionId);
  if (!tokenHash) return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 });
  wsServer.disconnectExtension(extensionId, tokenHash);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
