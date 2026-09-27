import type { NextRequest } from 'next/server';

export const OPERATOR_COOKIE = 'nn_operator_session';
export const OPERATOR_SESSION_SECONDS = 8 * 60 * 60;

export function operatorSecret(): string | null {
  const secret = process.env.LOCAL_OPERATOR_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if (toBase64Url(bytes) !== value) return null;
    return bytes;
  } catch {
    return null;
  }
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createOperatorSession(): Promise<string | null> {
  const secret = operatorSecret();
  if (!secret) return null;
  const expires = Math.floor(Date.now() / 1000) + OPERATOR_SESSION_SECONDS;
  const payload = `v1.${expires}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function hasOperatorSession(request: NextRequest): Promise<boolean> {
  const secret = operatorSecret();
  const token = request.cookies.get(OPERATOR_COOKIE)?.value;
  if (!secret || !token) return false;
  const match = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  if (expires <= now || expires > now + OPERATOR_SESSION_SECONDS) return false;
  const signature = fromBase64Url(match[2]);
  if (!signature) return false;
  return crypto.subtle.verify('HMAC', await signingKey(secret), signature,
    new TextEncoder().encode(`v1.${match[1]}`));
}
