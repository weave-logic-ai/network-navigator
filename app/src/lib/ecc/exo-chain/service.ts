import { query } from '../../db/client';
import { computeEntryHash } from './hash';
import type { ExoChainEntry, ChainOperation } from '../types';

export async function appendChainEntry(
  tenantId: string,
  chainId: string,
  sequence: number,
  prevHash: string | null,
  operation: ChainOperation,
  data: Record<string, unknown>,
  actor: string = 'system'
): Promise<{ entry: ExoChainEntry; entryHash: string }> {
  const timestamp = new Date().toISOString();
  const entryHash = await computeEntryHash(prevHash, operation, data, timestamp);

  // Convert hex string to Buffer for BYTEA storage
  const prevHashBytes = prevHash ? Buffer.from(prevHash, 'hex') : null;
  const entryHashBytes = Buffer.from(entryHash, 'hex');

  const result = await query<Record<string, unknown>>(
    `INSERT INTO exo_chain_entries (tenant_id, chain_id, sequence, prev_hash, entry_hash, operation, data, actor, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [tenantId, chainId, sequence, prevHashBytes, entryHashBytes, operation, JSON.stringify(data), actor, timestamp]
  );

  return { entry: mapEntry(result.rows[0]), entryHash };
}

export async function getChain(chainId: string): Promise<ExoChainEntry[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM exo_chain_entries WHERE chain_id = $1 ORDER BY sequence`,
    [chainId]
  );
  return result.rows.map(mapEntry);
}

export async function verifyChain(chainId: string): Promise<{ valid: boolean; brokenAt?: number; totalEntries: number }> {
  const entries = await getChain(chainId);
  if (entries.length === 0) return { valid: true, totalEntries: 0 };

  const { verifyChainHashes } = await import('./hash');
  const result = await verifyChainHashes(entries.map(e => ({
    prevHash: e.prevHash,
    entryHash: e.entryHash,
    operation: e.operation,
    data: e.data,
    createdAt: e.createdAt,
  })));

  return { ...result, totalEntries: entries.length };
}

function mapEntry(row: Record<string, unknown>): ExoChainEntry {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    chainId: String(row.chain_id),
    sequence: Number(row.sequence),
    prevHash: row.prev_hash ? Buffer.from(row.prev_hash as Buffer).toString('hex') : null,
    entryHash: Buffer.from(row.entry_hash as Buffer).toString('hex'),
    operation: String(row.operation) as ExoChainEntry['operation'],
    data: (row.data ?? {}) as Record<string, unknown>,
    actor: String(row.actor),
    createdAt: String(row.created_at),
  };
}
