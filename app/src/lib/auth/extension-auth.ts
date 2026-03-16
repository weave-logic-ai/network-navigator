// Extension token generation, validation, and revocation
// Tokens are stored in the database (extension_tokens table)

import crypto from 'crypto';
import { query } from '@/lib/db/client';
import type {
  TokenGenerationResult,
  TokenValidationResult,
  ExtensionToken,
} from '@/types/extension-auth';

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
  if (!token) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  // Try hash lookup first (for ext_ prefixed tokens)
  const tokenHash = hashToken(token);
  let result = await query<{
    extension_id: string;
    is_revoked: boolean;
    token_hash: string;
  }>(
    `SELECT extension_id, is_revoked, token_hash FROM extension_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  // Fall back to display prefix match (for raw display tokens)
  if (result.rows.length === 0) {
    result = await query<{
      extension_id: string;
      is_revoked: boolean;
      token_hash: string;
    }>(
      `SELECT extension_id, is_revoked, token_hash FROM extension_tokens
       WHERE display_prefix = $1`,
      [token]
    );
  }

  if (result.rows.length === 0) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const row = result.rows[0];

  if (row.is_revoked) {
    return { valid: false, error: 'REVOKED_TOKEN' };
  }

  // Update last_used_at timestamp (fire and forget)
  query(
    `UPDATE extension_tokens SET last_used_at = now(), updated_at = now()
     WHERE token_hash = $1`,
    [row.token_hash]
  ).catch(() => {
    // Non-critical
  });

  return { valid: true, extensionId: row.extension_id };
}

/**
 * Revoke an extension token by extensionId.
 */
export async function revokeExtensionToken(
  extensionId: string
): Promise<boolean> {
  const result = await query(
    `UPDATE extension_tokens
     SET is_revoked = true, updated_at = now()
     WHERE extension_id = $1 AND is_revoked = false`,
    [extensionId]
  );
  return (result.rowCount ?? 0) > 0;
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
 * Validate a token for the registration flow.
 * Accepts either a full token (hashed for lookup) or a display prefix.
 */
export async function validateDisplayToken(
  token: string
): Promise<{ valid: boolean; extensionId?: string; tokenHash?: string }> {
  // Try full token hash lookup first
  const tokenHash = hashToken(token);
  let result = await query<{
    extension_id: string;
    token_hash: string;
    is_revoked: boolean;
  }>(
    `SELECT extension_id, token_hash, is_revoked FROM extension_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  // Fall back to display prefix match
  if (result.rows.length === 0) {
    result = await query<{
      extension_id: string;
      token_hash: string;
      is_revoked: boolean;
    }>(
      `SELECT extension_id, token_hash, is_revoked FROM extension_tokens
       WHERE display_prefix = $1`,
      [token]
    );
  }

  if (result.rows.length === 0) {
    return { valid: false };
  }

  const row = result.rows[0];
  if (row.is_revoked) {
    return { valid: false };
  }

  return { valid: true, extensionId: row.extension_id, tokenHash: row.token_hash };
}
