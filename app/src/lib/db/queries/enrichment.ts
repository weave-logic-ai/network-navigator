// Enrichment system DB queries

import { query } from '../client';
import {
  ProviderConfig,
  BudgetPeriod,
  EnrichmentTransaction,
} from '../../enrichment/types';

// Provider queries

export async function listProviders(): Promise<ProviderConfig[]> {
  const result = await query<{
    id: string; name: string; display_name: string; api_base_url: string | null;
    cost_per_lookup_cents: number; rate_limit_per_minute: number | null;
    is_active: boolean; capabilities: string[]; priority: number;
    config: Record<string, unknown>; created_at: Date; updated_at: Date;
  }>(
    'SELECT * FROM enrichment_providers ORDER BY priority'
  );
  return result.rows.map(mapProvider);
}

export async function getActiveProviders(): Promise<ProviderConfig[]> {
  const result = await query<{
    id: string; name: string; display_name: string; api_base_url: string | null;
    cost_per_lookup_cents: number; rate_limit_per_minute: number | null;
    is_active: boolean; capabilities: string[]; priority: number;
    config: Record<string, unknown>; created_at: Date; updated_at: Date;
  }>(
    'SELECT * FROM enrichment_providers WHERE is_active = TRUE ORDER BY priority'
  );
  return result.rows.map(mapProvider);
}

export async function getProviderById(id: string): Promise<ProviderConfig | null> {
  const result = await query<{
    id: string; name: string; display_name: string; api_base_url: string | null;
    cost_per_lookup_cents: number; rate_limit_per_minute: number | null;
    is_active: boolean; capabilities: string[]; priority: number;
    config: Record<string, unknown>; created_at: Date; updated_at: Date;
  }>(
    'SELECT * FROM enrichment_providers WHERE id = $1',
    [id]
  );
  return result.rows[0] ? mapProvider(result.rows[0]) : null;
}

export async function updateProvider(
  id: string,
  data: Partial<{
    apiBaseUrl: string;
    isActive: boolean;
    config: Record<string, unknown>;
    rateLimitPerMinute: number;
  }>
): Promise<ProviderConfig | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.apiBaseUrl !== undefined) {
    setClauses.push(`api_base_url = $${idx++}`);
    values.push(data.apiBaseUrl);
  }
  if (data.isActive !== undefined) {
    setClauses.push(`is_active = $${idx++}`);
    values.push(data.isActive);
  }
  if (data.config !== undefined) {
    setClauses.push(`config = $${idx++}`);
    values.push(JSON.stringify(data.config));
  }
  if (data.rateLimitPerMinute !== undefined) {
    setClauses.push(`rate_limit_per_minute = $${idx++}`);
    values.push(data.rateLimitPerMinute);
  }

  if (setClauses.length === 0) return getProviderById(id);

  values.push(id);
  const result = await query<{
    id: string; name: string; display_name: string; api_base_url: string | null;
    cost_per_lookup_cents: number; rate_limit_per_minute: number | null;
    is_active: boolean; capabilities: string[]; priority: number;
    config: Record<string, unknown>; created_at: Date; updated_at: Date;
  }>(
    `UPDATE enrichment_providers SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ? mapProvider(result.rows[0]) : null;
}

// Budget queries

export async function getActiveBudget(): Promise<BudgetPeriod | null> {
  const result = await query<{
    id: string; period_type: string; period_start: Date; period_end: Date;
    budget_cents: number; spent_cents: number; lookup_count: number;
    is_active: boolean; created_at: Date;
  }>(
    `SELECT * FROM budget_periods
     WHERE is_active = TRUE AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
     ORDER BY period_start DESC LIMIT 1`
  );
  return result.rows[0] ? mapBudget(result.rows[0]) : null;
}

export async function listBudgetPeriods(limit: number = 12): Promise<BudgetPeriod[]> {
  const result = await query<{
    id: string; period_type: string; period_start: Date; period_end: Date;
    budget_cents: number; spent_cents: number; lookup_count: number;
    is_active: boolean; created_at: Date;
  }>(
    'SELECT * FROM budget_periods ORDER BY period_start DESC LIMIT $1',
    [limit]
  );
  return result.rows.map(mapBudget);
}

export async function createBudgetPeriod(data: {
  periodType: string;
  periodStart: string;
  periodEnd: string;
  budgetCents: number;
}): Promise<BudgetPeriod> {
  const result = await query<{
    id: string; period_type: string; period_start: Date; period_end: Date;
    budget_cents: number; spent_cents: number; lookup_count: number;
    is_active: boolean; created_at: Date;
  }>(
    `INSERT INTO budget_periods (period_type, period_start, period_end, budget_cents)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.periodType, data.periodStart, data.periodEnd, data.budgetCents]
  );
  return mapBudget(result.rows[0]);
}

export async function updateBudgetSpend(
  budgetPeriodId: string,
  costCents: number
): Promise<void> {
  await query(
    `UPDATE budget_periods
     SET spent_cents = spent_cents + $1, lookup_count = lookup_count + 1
     WHERE id = $2`,
    [costCents, budgetPeriodId]
  );
}

// Transaction queries

export async function recordTransaction(data: {
  providerId: string;
  contactId?: string;
  companyId?: string;
  budgetPeriodId?: string;
  costCents: number;
  status: string;
  fieldsReturned: string[];
}): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO enrichment_transactions
       (provider_id, contact_id, company_id, budget_period_id, cost_cents, status, fields_returned)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      data.providerId,
      data.contactId ?? null,
      data.companyId ?? null,
      data.budgetPeriodId ?? null,
      data.costCents,
      data.status,
      data.fieldsReturned,
    ]
  );
  return result.rows[0].id;
}

export async function listTransactions(
  page: number = 1,
  limit: number = 50
): Promise<{
  data: EnrichmentTransaction[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM enrichment_transactions'
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query<{
    id: string; provider_id: string; contact_id: string | null;
    company_id: string | null; budget_period_id: string | null;
    cost_cents: number; status: string; fields_returned: string[];
    created_at: Date;
  }>(
    `SELECT * FROM enrichment_transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    data: result.rows.map(mapTransaction),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getEnrichmentStatus(contactId: string): Promise<{
  lastEnriched: string | null;
  providers: Array<{ provider: string; enrichedAt: string; fieldsCount: number }>;
}> {
  const result = await query<{
    provider: string; enriched_at: Date; field_count: string;
  }>(
    `SELECT pe.provider, pe.enriched_at, array_length(pe.enriched_fields, 1)::text AS field_count
     FROM person_enrichments pe
     WHERE pe.contact_id = $1
     ORDER BY pe.enriched_at DESC`,
    [contactId]
  );

  return {
    lastEnriched: result.rows[0]?.enriched_at?.toISOString() ?? null,
    providers: result.rows.map(r => ({
      provider: r.provider,
      enrichedAt: r.enriched_at.toISOString(),
      fieldsCount: parseInt(r.field_count || '0', 10),
    })),
  };
}

// Helpers

function mapProvider(row: {
  id: string; name: string; display_name: string; api_base_url: string | null;
  cost_per_lookup_cents: number; rate_limit_per_minute: number | null;
  is_active: boolean; capabilities: string[]; priority: number;
  config: Record<string, unknown>; created_at: Date; updated_at: Date;
}): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    apiBaseUrl: row.api_base_url,
    costPerLookupCents: row.cost_per_lookup_cents,
    rateLimitPerMinute: row.rate_limit_per_minute,
    isActive: row.is_active,
    capabilities: row.capabilities,
    priority: row.priority,
    config: row.config,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapBudget(row: {
  id: string; period_type: string; period_start: Date; period_end: Date;
  budget_cents: number; spent_cents: number; lookup_count: number;
  is_active: boolean; created_at: Date;
}): BudgetPeriod {
  return {
    id: row.id,
    periodType: row.period_type as BudgetPeriod['periodType'],
    periodStart: row.period_start.toISOString().split('T')[0],
    periodEnd: row.period_end.toISOString().split('T')[0],
    budgetCents: row.budget_cents,
    spentCents: row.spent_cents,
    lookupCount: row.lookup_count,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  };
}

function mapTransaction(row: {
  id: string; provider_id: string; contact_id: string | null;
  company_id: string | null; budget_period_id: string | null;
  cost_cents: number; status: string; fields_returned: string[];
  created_at: Date;
}): EnrichmentTransaction {
  return {
    id: row.id,
    providerId: row.provider_id,
    contactId: row.contact_id,
    companyId: row.company_id,
    budgetPeriodId: row.budget_period_id,
    costCents: row.cost_cents,
    status: row.status as EnrichmentTransaction['status'],
    fieldsReturned: row.fields_returned,
    createdAt: row.created_at.toISOString(),
  };
}
