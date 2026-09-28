import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireLocalOrigin } from '@/lib/auth/local-request-boundary';
import { createOperatorSession, OPERATOR_COOKIE, OPERATOR_SESSION_SECONDS, operatorSecret } from '@/lib/auth/operator-session';

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request, true);
  if (denied) return denied;

  const secret = operatorSecret();
  if (!secret) return NextResponse.json({ error: 'Operator secret is not configured' }, { status: 503 });
  if (Number(request.headers.get('content-length') ?? 0) > 4096) {
    return NextResponse.json({ error: 'Request is too large' }, { status: 413 });
  }

  let supplied: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: 'Secret is required' }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return NextResponse.json({ error: 'Request is too large' }, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(bytes);
    supplied = (JSON.parse(text) as { secret?: unknown }).secret;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof supplied !== 'string') {
    return NextResponse.json({ error: 'Secret is required' }, { status: 400 });
  }

  const expected = createHash('sha256').update(secret).digest();
  const actual = createHash('sha256').update(supplied).digest();
  if (!timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: 'Invalid operator secret' }, { status: 401 });
  }

  const session = await createOperatorSession();
  if (!session) return NextResponse.json({ error: 'Operator secret is not configured' }, { status: 503 });
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(OPERATOR_COOKIE, session, {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: OPERATOR_SESSION_SECONDS,
  });
  return response;
}
