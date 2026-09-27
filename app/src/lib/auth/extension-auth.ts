// Extension token generation, validation, and revocation
// Tokens are stored in the database (extension_tokens table)

import crypto from 'crypto';
import { query } from '@/lib/db/client';
import type {
  TokenGenerationResult,
  TokenValidationResult,
  ExtensionToken,
} from '@/types/extension-auth';

// Existing schema records creation time but has no expires_at column.
// A bounded lifetime prevents a copied token from remaining valid forever.
export const EXTENSION_TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Hash a token for secure storage. We never store raw tokens in the DB.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a new extension token.
 * Format: ext_<base64url(32 bytes)>
 */
export async function generateExtensionToken(): Promise<TokenGenerationResult> {
  const randomBytes = crypto.randomBytes(32);
  const token = `ext_${randomBytes.toString('base64url')}`;
  const extensionId = crypto.randomUUID();
  const displayToken = token.substring(0, 12);
  const tokenHash = hashToken(token);

  await query(
    `INSERT INTO extension_tokens (token_hash, extension_id, display_prefix)
     VALUES ($1, $2, $3)`,
    [tokenHash, extensionId, displayToken]
  );

  return { token, extensionId, displayToken };
}

/**
 * Validate an extension token.
 * Returns the validation result with extensionId if valid.
 */
export async function validateExtensionToken(
  token: string
): Promise<TokenValidationResult> {
  if (!/^ext_[A-Za-z0-9_-]{43}$/.test(token)) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const tokenHash = hashToken(token);
  const result = await query<{
    extension_id: string;
    is_revoked: boolean;
    token_hash: string;
    created_at: string | Date;
  }>(
    `SELECT extension_id, is_revoked, token_hash, created_at FROM extension_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  const row = result.rows[0];
  const expected = Buffer.from(tokenHash, 'hex');
  const stored = row && /^[0-9a-f]{64}$/i.test(row.token_hash)
    ? Buffer.from(row.token_hash, 'hex')
    : Buffer.alloc(expected.length);
  // Compare fixed-length digests even on a miss. A display prefix is never a
  // bearer credential, including for registration and WebSocket upgrades.
  if (!crypto.timingSafeEqual(expected, stored) || !row) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  if (row.is_revoked) {
    return { valid: false, error: 'REVOKED_TOKEN' };
  }
  const created = new Date(row.created_at).getTime();
  const now = Date.now();
  if (!Number.isFinite(created) || created > now || now - created >= EXTENSION_TOKEN_LIFETIME_MS) {
    return { valid: false, error: 'EXPIRED_TOKEN' };
  }

  return { valid: true, extensionId: row.extension_id,
    expiresAt: created + EXTENSION_TOKEN_LIFETIME_MS };
}

/**
 * Revoke an extension token by extensionId.
 */
export async function revokeExtensionToken(
  extensionId: string
): Promise<string | null> {
  const result = await query<{ token_hash: string }>(
    `UPDATE extension_tokens
     SET is_revoked = true, updated_at = now()
     WHERE extension_id = $1 AND is_revoked = false
     RETURNING token_hash`,
    [extensionId]
  );
  return result.rows[0]?.token_hash ?? null;
}

/**
 * List all extension tokens (with token values masked).
 */
export async function listExtensionTokens(): Promise<ExtensionToken[]> {
  const result = await query<{
    display_prefix: string;
    extension_id: string;
    created_at: string;
    last_used_at: string | null;
    user_agent: string | null;
    is_revoked: boolean;
  }>(
    `SELECT display_prefix, extension_id, created_at, last_used_at, user_agent, is_revoked
     FROM extension_tokens
     ORDER BY created_at DESC`
  );

  return result.rows.map((row) => ({
    token: `${row.display_prefix}...`, // Masked
    extensionId: row.extension_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    userAgent: row.user_agent,
    isRevoked: row.is_revoked,
  }));
}

/**
 * Validate a full token for the registration flow. Display prefixes identify
 * rows in operator listings but never authenticate.
 */
export async function validateDisplayToken(
  token: string
): Promise<{ valid: boolean; extensionId?: string; tokenHash?: string }> {
  const result = await validateExtensionToken(token);
  return result.valid
    ? { valid: true, extensionId: result.extensionId, tokenHash: hashToken(token) }
    : { valid: false };
}
