// Waterfall enrichment engine - field-aware provider selection with cost optimization

import { EnrichmentContact, EnrichmentResult, CostEstimate, ProviderConfig } from './types';
import { PdlProvider } from './providers/pdl';
import { LushaProvider } from './providers/lusha';
import { TheirStackProvider } from './providers/theirstack';
import { ApolloProvider } from './providers/apollo';
import * as enrichmentQueries from '../db/queries/enrichment';

interface WaterfallOptions {
  targetFields?: string[];
  skipFilledFields?: boolean;
  budgetLimitCents?: number;
  quoteId?: string;
}

type ProviderInstance = PdlProvider | LushaProvider | TheirStackProvider | ApolloProvider;

function createProviderInstance(config: ProviderConfig): ProviderInstance | null {
  const providerConfig = {
    apiKey: config.config?.apiKey as string | undefined,
  };

  switch (config.name) {
    case 'pdl': return new PdlProvider(providerConfig);
    case 'lusha': return new LushaProvider(providerConfig);
    case 'theirstack': return new TheirStackProvider(providerConfig);
    case 'apollo': return new ApolloProvider(providerConfig);
    default: return null;
  }
}

function maximumLookupCost(config: ProviderConfig, instance: ProviderInstance): number {
  // A stale or lowered DB price must not under-reserve a fixed-price request.
  return Math.max(config.costPerLookupCents, instance.costPerLookupCents);
}

function eligible(config: ProviderConfig, targetFields?: string[], filledFields = new Set<string>()): boolean {
  return !targetFields?.length || config.capabilities.some(cap =>
    targetFields.some(field => !filledFields.has(field) && capabilityMatchesField(cap, field)));
}

const EMPTY_SENTINELS = new Set(['true', 'false', 'null', 'undefined', 'N/A', 'n/a', '']);
function hasRealValue(value: string | null): boolean {
  return value !== null && value !== undefined && !EMPTY_SENTINELS.has(value.trim());
}

export async function enrichContact(
  contact: EnrichmentContact,
  options: WaterfallOptions = {}
): Promise<EnrichmentResult[]> {
  const { targetFields, skipFilledFields = true, budgetLimitCents, quoteId } = options;

  // Get active providers sorted by priority (lowest = first)
  const providers = await enrichmentQueries.getActiveProviders();
  if (providers.length === 0) {
    return [];
  }

  // Check budget
  const budget = await enrichmentQueries.getActiveBudget();
  // A caller-supplied cap can only lower the configured budget, never replace it.
  const budgetLimit = Math.min(
    budget ? Math.max(0, budget.budgetCents - budget.spentCents) : 0,
    budgetLimitCents ?? Infinity
  );

  // Determine which fields we still need
  // Treat boolean-like strings ("true", "false") as empty — these come from bad imports
  const filledFields = new Set<string>();
  if (skipFilledFields) {
    if (hasRealValue(contact.email)) filledFields.add('email');
    if (hasRealValue(contact.fullName)) filledFields.add('full_name');
    if (hasRealValue(contact.title)) filledFields.add('title');
    if (hasRealValue(contact.currentCompany)) filledFields.add('current_company');
  }

  const results: EnrichmentResult[] = [];
  const claimed = new Set(await enrichmentQueries.listClaimedEnrichmentProviders(contact.id) ?? []);
  let totalSpent = 0;
  const stop = (provider: ProviderConfig, errorCode: NonNullable<EnrichmentResult['errorCode']>,
    error: string, reservedCents = 0) => results.push({
      providerId: provider.name, providerName: provider.displayName,
      success: false, fields: [], costCents: 0, errorCode, error, reservedCents,
    });

  for (const providerConfig of providers) {
    if (claimed.has(providerConfig.name)) continue;
    // Check if this provider can fill any needed fields
    if (!eligible(providerConfig, targetFields, filledFields)) continue;
    const instance = createProviderInstance(providerConfig);
    if (!instance) continue;
    const reservedCents = maximumLookupCost(providerConfig, instance);
    if (totalSpent + reservedCents > budgetLimit) {
      stop(providerConfig, 'budget_unavailable', 'Confirmed or configured budget is insufficient');
      break;
    }
    if (!quoteId || !budget || !await enrichmentQueries.reserveEnrichmentLookup(
      quoteId, contact.id, providerConfig.name, budget.id, reservedCents)) {
      stop(providerConfig, 'budget_unavailable', 'Budget reservation failed or another request used the remaining budget');
      break;
    }

    let result: EnrichmentResult;
    try { result = await instance.enrich(contact); }
    catch {
      stop(providerConfig, 'provider_unknown_charge', 'Provider request failed after reservation; charge is unknown', reservedCents);
      break;
    }
    if (result.errorCode === 'provider_unknown_charge') result.reservedCents = reservedCents;
    if (quoteId) {
      try {
        // Store only reviewable fields and gating metadata, not the provider's full PII payload.
        const gated = result.rawResponse?._gatedFields;
        await enrichmentQueries.saveEnrichmentResult(quoteId, contact.id, {
          ...result, rawResponse: Array.isArray(gated) ? { _gatedFields: gated } : undefined,
        });
      } catch {
        try { await enrichmentQueries.flagEnrichmentReconciliation(quoteId); } catch { /* pending remains locked */ }
        stop(providerConfig, 'ledger_failed', 'Provider returned but its result could not be persisted; reconcile before retry', reservedCents);
        break;
      }
    }
    results.push(result);
    if (result.errorCode === 'provider_unknown_charge') {
      if (quoteId) {
        try { await enrichmentQueries.flagEnrichmentReconciliation(quoteId); } catch { /* pending remains locked */ }
      }
      break;
    }
    if (!Number.isSafeInteger(result.costCents) || result.costCents < 0 || result.costCents > reservedCents) {
      if (quoteId) {
        try { await enrichmentQueries.flagEnrichmentReconciliation(quoteId); } catch { /* pending remains locked */ }
      }
      stop(providerConfig, 'cost_exceeded', 'Provider reported cost above its reserved maximum', reservedCents);
      break;
    }
    if (quoteId) {
      try { await enrichmentQueries.completeEnrichmentLookup(quoteId, {
        contactId: contact.id, provider: providerConfig.name, providerId: providerConfig.id,
        costCents: result.costCents, success: result.success,
        fieldsReturned: result.fields.map(field => field.field),
      }); }
      catch {
        try { await enrichmentQueries.flagEnrichmentReconciliation(quoteId); } catch { /* pending remains locked */ }
        stop(providerConfig, 'ledger_failed', 'Provider result is saved but atomic settlement failed', reservedCents);
        break;
      }
    }

    // Track spend
    totalSpent += result.costCents;

    // Update filled fields
    if (result.success) {
      for (const field of result.fields) {
        filledFields.add(field.field);
      }
    }

    // Check if we got all target fields
    if (targetFields && targetFields.every(f => filledFields.has(f))) {
      break;
    }
  }

  return results;
}

export async function estimateEnrichmentCost(
  contacts: EnrichmentContact[], targetFields?: string[]
): Promise<CostEstimate> {
  const providers = await enrichmentQueries.getActiveProviders();
  const budget = await enrichmentQueries.getActiveBudget();
  const budgetRemaining = budget ? Math.max(0, budget.budgetCents - budget.spentCents) : 0;

  const perProvider: CostEstimate['perProvider'] = [];
  let totalCostCents = 0;
  const claimedByContact = await Promise.all(contacts.map(async contact =>
    new Set(await enrichmentQueries.listClaimedEnrichmentProviders(contact.id) ?? [])));

  for (const provider of providers) {
    const instance = createProviderInstance(provider);
    if (!instance) continue;
    const contactCount = contacts.filter((contact, index) => {
      if (claimedByContact[index].has(provider.name)) return false;
      const filled = new Set<string>();
      if (hasRealValue(contact.email)) filled.add('email');
      if (hasRealValue(contact.title)) filled.add('title');
      if (hasRealValue(contact.currentCompany)) filled.add('current_company');
      if (hasRealValue(contact.fullName)) filled.add('full_name');
      return eligible(provider, targetFields, filled);
    }).length;
    if (contactCount === 0) continue;
    const costCents = contactCount * maximumLookupCost(provider, instance);
    totalCostCents += costCents;

    perProvider.push({
      providerId: provider.id,
      providerName: provider.displayName,
      contactCount,
      costCents,
    });
  }

  return {
    totalCostCents,
    perProvider,
    budgetRemaining,
    withinBudget: totalCostCents <= budgetRemaining,
  };
}

function capabilityMatchesField(capability: string, field: string): boolean {
  const mapping: Record<string, string[]> = {
    email: ['email'],
    phone: ['phone'],
    social: ['linkedin_url', 'twitter', 'location'],
    employment: ['title', 'current_company', 'headline'],
    education: ['education'],
    company: ['current_company', 'industry'],
    technographics: ['technographics'],
    profile: ['about', 'headline', 'location', 'connections_count', 'tags'],
    skills: ['tags'],
    connections: ['connections_count'],
    activity: [],
  };
  return (mapping[capability] || []).includes(field);
}
