// Enrichment system type definitions

export interface EnrichmentField {
  field: string;
  value: string | number | boolean | null;
  confidence: number;
}

export interface EnrichmentResult {
  providerId: string;
  providerName: string;
  success: boolean;
  fields: EnrichmentField[];
  costCents: number;
  rawResponse?: Record<string, unknown>;
  error?: string;
}

export interface EnrichmentProvider {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: string[];
  readonly costPerLookupCents: number;

  enrich(contact: EnrichmentContact): Promise<EnrichmentResult>;
  estimateCost(contacts: EnrichmentContact[]): number;
  checkBalance(): Promise<{ available: boolean; remaining?: number }>;
}

export interface EnrichmentContact {
  id: string;
  linkedinUrl: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  currentCompany: string | null;
  title: string | null;
}

export interface ProviderConfig {
  id: string;
  name: string;
  displayName: string;
  apiBaseUrl: string | null;
  costPerLookupCents: number;
  rateLimitPerMinute: number | null;
  isActive: boolean;
  capabilities: string[];
  priority: number;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetPeriod {
  id: string;
  periodType: 'daily' | 'weekly' | 'monthly' | 'yearly';
  periodStart: string;
  periodEnd: string;
  budgetCents: number;
  spentCents: number;
  lookupCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface EnrichmentTransaction {
  id: string;
  providerId: string;
  contactId: string | null;
  companyId: string | null;
  budgetPeriodId: string | null;
  costCents: number;
  status: 'success' | 'failed' | 'cached' | 'rate_limited';
  fieldsReturned: string[];
  createdAt: string;
}

export interface CostEstimate {
  totalCostCents: number;
  perProvider: Array<{
    providerId: string;
    providerName: string;
    contactCount: number;
    costCents: number;
  }>;
  budgetRemaining: number;
  withinBudget: boolean;
}

export interface WaterfallConfig {
  providers: ProviderConfig[];
  targetFields: string[];
  budgetLimitCents: number;
  skipFilledFields: boolean;
}
