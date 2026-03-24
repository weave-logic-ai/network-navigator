import { enrichContact as originalEnrichContact } from '../../enrichment/waterfall';
import { appendChainEntry } from './service';
import { ECC_FLAGS } from '../types';
import type { EnrichmentContact, EnrichmentResult } from '../../enrichment/types';
import * as enrichmentQueries from '../../db/queries/enrichment';

const DEFAULT_TENANT_ID = 'default';

/**
 * Enrich a contact with ExoChain audit trail.
 * When ECC_EXO_CHAIN is disabled, falls through to the original waterfall.
 */
export async function enrichContactWithChain(
  contact: EnrichmentContact,
  options: { targetFields?: string[]; budgetLimitCents?: number } = {},
  tenantId: string = DEFAULT_TENANT_ID
): Promise<{ results: EnrichmentResult[]; _chainId?: string }> {
  const results = await originalEnrichContact(contact, options);

  if (!ECC_FLAGS.exoChain) {
    return { results };
  }

  // Create chain entries for the enrichment operation
  const chainId = crypto.randomUUID();
  let prevHash: string | null = null;
  let seq = 0;

  // Entry 1: Budget check
  try {
    const budget = await enrichmentQueries.getActiveBudget();
    const budgetData = budget
      ? { remaining: budget.budgetCents - budget.spentCents, canProceed: true }
      : { remaining: 0, canProceed: false };
    const r = await appendChainEntry(tenantId, chainId, seq++, prevHash, 'budget_check', budgetData);
    prevHash = r.entryHash;
  } catch {
    // Non-critical -- continue without chain
  }

  // Entry 2: Field check
  try {
    const filledFields = Object.entries(contact)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k]) => k);
    const r = await appendChainEntry(tenantId, chainId, seq++, prevHash, 'field_check', {
      existing: filledFields,
      needed: options.targetFields ?? [],
    });
    prevHash = r.entryHash;
  } catch {
    // Non-critical
  }

  // Entries 3+: Per-provider results
  for (const result of results) {
    try {
      const r1 = await appendChainEntry(tenantId, chainId, seq++, prevHash, 'provider_select', {
        provider: result.providerName,
        cost: result.costCents,
      });
      prevHash = r1.entryHash;

      const r2 = await appendChainEntry(tenantId, chainId, seq++, prevHash, 'enrich_result', {
        provider: result.providerName,
        fieldsReturned: result.fields?.map((f: { field: string }) => f.field) ?? [],
        status: result.success ? 'success' : 'failed',
      });
      prevHash = r2.entryHash;

      if (result.costCents > 0) {
        const r3 = await appendChainEntry(tenantId, chainId, seq++, prevHash, 'budget_debit', {
          provider: result.providerName,
          cost: result.costCents,
        });
        prevHash = r3.entryHash;
      }
    } catch {
      // Non-critical
    }
  }

  // Final entry: waterfall complete
  try {
    await appendChainEntry(tenantId, chainId, seq, prevHash, 'waterfall_complete', {
      totalProviders: results.length,
      totalCost: results.reduce((sum, r) => sum + (r.costCents || 0), 0),
    });
  } catch {
    // Non-critical
  }

  return { results, _chainId: chainId };
}
