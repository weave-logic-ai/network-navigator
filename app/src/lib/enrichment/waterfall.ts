// Waterfall enrichment engine - field-aware provider selection with cost optimization

import { EnrichmentContact, EnrichmentResult, CostEstimate, ProviderConfig } from './types';
import { PdlProvider } from './providers/pdl';
import { LushaProvider } from './providers/lusha';
import { TheirStackProvider } from './providers/theirstack';
import * as enrichmentQueries from '../db/queries/enrichment';

interface WaterfallOptions {
  targetFields?: string[];
  skipFilledFields?: boolean;
  budgetLimitCents?: number;
}

type ProviderInstance = PdlProvider | LushaProvider | TheirStackProvider;

function createProviderInstance(config: ProviderConfig): ProviderInstance | null {
  const providerConfig = {
    apiKey: config.config?.apiKey as string | undefined,
    baseUrl: config.apiBaseUrl || undefined,
  };

  switch (config.name) {
    case 'pdl': return new PdlProvider(providerConfig);
    case 'lusha': return new LushaProvider(providerConfig);
    case 'theirstack': return new TheirStackProvider(providerConfig);
    default: return null;
  }
}

export async function enrichContact(
  contact: EnrichmentContact,
  options: WaterfallOptions = {}
): Promise<EnrichmentResult[]> {
  const { targetFields, skipFilledFields = true, budgetLimitCents } = options;

  // Get active providers sorted by priority (lowest = first)
  const providers = await enrichmentQueries.getActiveProviders();
  if (providers.length === 0) {
    return [];
  }

  // Check budget
  const budget = await enrichmentQueries.getActiveBudget();
  const budgetLimit = budgetLimitCents ?? (budget ? budget.budgetCents - budget.spentCents : Infinity);

  // Determine which fields we still need
  const filledFields = new Set<string>();
  if (skipFilledFields) {
    if (contact.email) filledFields.add('email');
    if (contact.fullName) filledFields.add('full_name');
    if (contact.title) filledFields.add('title');
    if (contact.currentCompany) filledFields.add('current_company');
  }

  const results: EnrichmentResult[] = [];
  let totalSpent = 0;

  for (const providerConfig of providers) {
    // Check if this provider can fill any needed fields
    if (targetFields && targetFields.length > 0) {
      const canFill = providerConfig.capabilities.some(cap => {
        return targetFields.some(f => !filledFields.has(f) && capabilityMatchesField(cap, f));
      });
      if (!canFill) continue;
    }

    // Check budget
    if (totalSpent + providerConfig.costPerLookupCents > budgetLimit) {
      break;
    }

    const instance = createProviderInstance(providerConfig);
    if (!instance) continue;

    const result = await instance.enrich(contact);
    results.push(result);

    // Track spend
    totalSpent += result.costCents;

    // Record transaction
    await enrichmentQueries.recordTransaction({
      providerId: providerConfig.id,
      contactId: contact.id,
      budgetPeriodId: budget?.id,
      costCents: result.costCents,
      status: result.success ? 'success' : 'failed',
      fieldsReturned: result.fields.map(f => f.field),
    });

    // Update budget spend
    if (budget && result.costCents > 0) {
      await enrichmentQueries.updateBudgetSpend(budget.id, result.costCents);
    }

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
  contacts: EnrichmentContact[]
): Promise<CostEstimate> {
  const providers = await enrichmentQueries.getActiveProviders();
  const budget = await enrichmentQueries.getActiveBudget();
  const budgetRemaining = budget ? budget.budgetCents - budget.spentCents : 0;

  const perProvider: CostEstimate['perProvider'] = [];
  let totalCostCents = 0;

  for (const provider of providers) {
    // Each contact would go through this provider in the waterfall
    const contactCount = contacts.length;
    const costCents = contactCount * provider.costPerLookupCents;
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
    social: ['linkedin_url', 'twitter'],
    employment: ['title', 'current_company'],
    education: ['education'],
    company: ['current_company', 'industry'],
    technographics: ['technographics'],
  };
  return (mapping[capability] || []).includes(field);
}
