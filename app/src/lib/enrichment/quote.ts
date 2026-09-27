import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { operatorSecret } from '@/lib/auth/operator-session';
import { getActiveProviders } from '@/lib/db/queries/enrichment';
import { estimateEnrichmentCost } from './waterfall';
import type { CostEstimate, EnrichmentContact } from './types';

interface QuotePayload {
  id: string;
  mode: 'preview';
  expires: number;
  contactIds: string[];
  targetFields: string[];
  maxCostCents: number;
  stateHash: string;
}

async function stateHash(contacts: EnrichmentContact[]): Promise<string> {
  const providers = (await getActiveProviders()).map(provider => ({
    id: provider.id, name: provider.name, priority: provider.priority,
    cost: provider.costPerLookupCents, capabilities: provider.capabilities,
    config: provider.config,
  }));
  return createHash('sha256').update(JSON.stringify({ contacts, providers })).digest('hex');
}

function sign(payload: string): string {
  const secret = operatorSecret();
  if (!secret) throw new Error('Operator signing secret is not configured');
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export async function createEnrichmentQuote(
  contacts: EnrichmentContact[], targetFields?: string[]
): Promise<CostEstimate & { quote: string }> {
  const estimate = await estimateEnrichmentCost(contacts, targetFields);
  const payload: QuotePayload = {
    id: randomUUID(), mode: 'preview', expires: Date.now() + 5 * 60_000,
    contactIds: contacts.map(contact => contact.id), targetFields: targetFields || [],
    maxCostCents: estimate.totalCostCents, stateHash: await stateHash(contacts),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { ...estimate, quote: `${encoded}.${sign(encoded)}` };
}

export async function verifyEnrichmentQuote(
  token: string, contacts: EnrichmentContact[], targetFields?: string[]
): Promise<{ id: string; maxCostCents: number } | null> {
  const payload = readSignedEnrichmentQuote(token);
  if (!payload) return null;
  if (payload.mode !== 'preview' || !Number.isSafeInteger(payload.maxCostCents)
    || payload.expires <= Date.now() || !Array.isArray(payload.contactIds)
    || JSON.stringify(payload.contactIds) !== JSON.stringify(contacts.map(contact => contact.id))
    || JSON.stringify(payload.targetFields) !== JSON.stringify(targetFields || [])) return null;
  if (payload.stateHash !== await stateHash(contacts)) return null;
  const current = await estimateEnrichmentCost(contacts, targetFields);
  if (current.totalCostCents !== payload.maxCostCents || !current.withinBudget) return null;
  return { id: payload.id, maxCostCents: payload.maxCostCents };
}

/** Signature-only read allows recovery of a consumed quote after budget/state/expiry changed. */
export function readSignedEnrichmentQuote(token: string): QuotePayload | null {
  const [encoded, supplied] = token.split('.');
  if (!encoded || !supplied || token.split('.').length !== 2 || encoded.length > 65536) return null;
  const expected = Buffer.from(sign(encoded), 'base64url');
  const received = Buffer.from(supplied, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  let payload: QuotePayload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as QuotePayload; }
  catch { return null; }
  if (!/^[0-9a-f-]{36}$/i.test(payload.id) || payload.mode !== 'preview'
    || !Array.isArray(payload.contactIds)) return null;
  return payload;
}
