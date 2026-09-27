// Enrichment system DB queries

import { query, transaction } from '../client';
import {
  ProviderConfig,
  BudgetPeriod,
  EnrichmentTransaction,
  EnrichmentResult,
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

/** Create only the current monthly period; never replace an active spending policy. */
export async function createCurrentMonthlyBudget(budgetCents: number): Promise<BudgetPeriod | null> {
  try {
    const result = await query<{
      id: string; period_type: string; period_start: Date; period_end: Date;
      budget_cents: number; spent_cents: number; lookup_count: number;
      is_active: boolean; created_at: Date;
    }>(
      `INSERT INTO budget_periods (period_type, period_start, period_end, budget_cents)
       SELECT 'monthly', date_trunc('month', CURRENT_DATE)::date,
              (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date, $1
       WHERE NOT EXISTS (
         SELECT 1 FROM budget_periods WHERE is_active = TRUE
         AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
       )
       ON CONFLICT (period_type, period_start) DO NOTHING RETURNING *`,
      [budgetCents]
    );
    return result.rows[0] ? mapBudget(result.rows[0]) : null;
  } catch (error) {
    if ((error as { code?: string }).code === '23P01') return null;
    throw error;
  }
}

/** The conditional UPDATE is the spending lock across concurrent requests. */
export async function reserveBudgetSpend(budgetPeriodId: string, maxCostCents: number): Promise<boolean> {
  if (!Number.isSafeInteger(maxCostCents) || maxCostCents <= 0) return false;
  const result = await query(
    `UPDATE budget_periods SET spent_cents = spent_cents + $2, lookup_count = lookup_count + 1
     WHERE id = $1 AND is_active = TRUE AND period_start <= CURRENT_DATE
       AND period_end >= CURRENT_DATE AND spent_cents + $2 <= budget_cents
     RETURNING id`,
    [budgetPeriodId, maxCostCents]
  );
  return result.rowCount === 1;
}

/** Return unused reserved money after the provider finishes. */
export async function settleBudgetSpend(budgetPeriodId: string, reservedCents: number, actualCents: number): Promise<void> {
  if (!Number.isSafeInteger(actualCents) || actualCents < 0 || actualCents > reservedCents) {
    throw new Error('Provider cost exceeded reserved budget');
  }
  await query('UPDATE budget_periods SET spent_cents = spent_cents - $2 WHERE id = $1',
    [budgetPeriodId, reservedCents - actualCents]);
}

/** Consume a confirmed quote once, before any paid provider request. */
export async function claimEnrichmentQuote(quoteId: string): Promise<boolean> {
  const result = await query(
    'INSERT INTO enrichment_quote_uses (quote_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING quote_id',
    [quoteId]
  );
  return result.rowCount === 1;
}

export interface EnrichmentAttempt {
  pending: { contactId: string; provider: string; reservedCents: number } | null;
  results: Array<{ contactId: string; result: EnrichmentResult }>;
  response: Record<string, unknown> | null;
  response_status: number | null;
  reconciliation_required: boolean;
  reconciled_cents: number | null;
  execution_state: 'running' | 'partial' | 'completed' | 'no_charge';
}

export async function getEnrichmentAttempt(quoteId: string): Promise<EnrichmentAttempt | null> {
  const result = await query<EnrichmentAttempt>(
    'SELECT pending, results, response, response_status, reconciliation_required, reconciled_cents, execution_state FROM enrichment_quote_uses WHERE quote_id=$1', [quoteId]);
  return result.rows[0] ?? null;
}

/** Close a claimed quote only when no provider reservation, claim or saved result exists. */
export async function closeUnstartedEnrichmentQuote(quoteId: string): Promise<boolean> {
  return transaction(async client => {
    const row = await client.query<{ pending: unknown; results: unknown[]; execution_state: string }>(
      'SELECT pending, results, execution_state FROM enrichment_quote_uses WHERE quote_id=$1 FOR UPDATE', [quoteId]);
    if (!row.rows[0] || row.rows[0].execution_state !== 'running' || row.rows[0].pending
      || row.rows[0].results.length) return false;
    const claims = await client.query('SELECT 1 FROM enrichment_provider_claims WHERE quote_id=$1 LIMIT 1', [quoteId]);
    if (claims.rowCount) return false;
    await client.query(`UPDATE enrichment_quote_uses SET execution_state='no_charge',
      response='{"data":[],"partial":false,"noCharge":true,"totalCostCents":0}'::jsonb,
      response_status=200 WHERE quote_id=$1`, [quoteId]);
    return true;
  });
}

/** A new quote must not charge a contact whose earlier provider request is unresolved. */
export async function hasUnreconciledEnrichmentAttempt(contactIds: string[]): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM enrichment_quote_uses
     WHERE pending IS NOT NULL AND pending->>'contactId' = ANY($1::text[]) LIMIT 1`, [contactIds]);
  return (result.rowCount ?? 0) > 0;
}

export async function listClaimedEnrichmentProviders(contactId: string): Promise<string[]> {
  const result = await query<{ provider: string }>(
    'SELECT provider FROM enrichment_provider_claims WHERE contact_id=$1', [contactId]);
  return result.rows.map(row => row.provider);
}

/** The durable provider claim, pending marker and budget debit commit together. */
export async function reserveEnrichmentLookup(
  quoteId: string, contactId: string, provider: string,
  budgetPeriodId: string, reservedCents: number
): Promise<boolean> {
  if (!Number.isSafeInteger(reservedCents) || reservedCents <= 0) return false;
  const unavailable = new Error('Enrichment lookup unavailable');
  try {
    await transaction(async client => {
      const claim = await client.query(
        `INSERT INTO enrichment_provider_claims (contact_id, provider, quote_id)
         VALUES ($1,$2,$3) ON CONFLICT (contact_id, provider) DO NOTHING RETURNING contact_id`,
        [contactId, provider, quoteId]);
      if (claim.rowCount !== 1) throw unavailable;
      const intent = await client.query(
        `UPDATE enrichment_quote_uses SET pending=$2::jsonb
         WHERE quote_id=$1 AND pending IS NULL AND response_status IS NULL
           AND execution_state='running' RETURNING quote_id`,
        [quoteId, JSON.stringify({ contactId, provider, reservedCents, budgetPeriodId })]);
      if (intent.rowCount !== 1) throw unavailable;
      const debit = await client.query(
        `UPDATE budget_periods SET spent_cents=spent_cents+$2, lookup_count=lookup_count+1
         WHERE id=$1 AND is_active=TRUE AND period_start<=CURRENT_DATE AND period_end>=CURRENT_DATE
           AND spent_cents+$2<=budget_cents RETURNING id`,
        [budgetPeriodId, reservedCents]);
      if (debit.rowCount !== 1) throw unavailable;
    });
    return true;
  } catch (error) {
    if (error === unavailable || (error as { code?: string }).code === '23505') return false;
    throw error;
  }
}

/** Store returned fields before settlement, ledger writes or the HTTP response. */
export async function saveEnrichmentResult(quoteId: string, contactId: string, result: EnrichmentResult): Promise<void> {
  const written = await query(
    `UPDATE enrichment_quote_uses SET results=results || $2::jsonb
     WHERE quote_id=$1 AND execution_state='running'
       AND pending->>'contactId'=$3 AND pending->>'provider'=$4`,
    [quoteId, JSON.stringify([{ contactId, result }]), contactId, result.providerId]);
  if (written.rowCount !== 1) throw new Error('Cannot persist paid enrichment result');
}

export async function flagEnrichmentReconciliation(quoteId: string): Promise<void> {
  await query('UPDATE enrichment_quote_uses SET reconciliation_required=true WHERE quote_id=$1 AND pending IS NOT NULL', [quoteId]);
}

export async function finishEnrichmentProvider(quoteId: string, reconciliationRequired: boolean): Promise<void> {
  const written = await query(
    `UPDATE enrichment_quote_uses SET pending=NULL, reconciliation_required=$2
     WHERE quote_id=$1 AND pending IS NOT NULL`, [quoteId, reconciliationRequired]);
  if (written.rowCount !== 1) throw new Error('Cannot finalize paid enrichment attempt');
}

/** Settle a known response atomically so an interrupted ledger write cannot double-credit a reservation. */
export async function completeEnrichmentLookup(quoteId: string, data: {
  contactId: string; provider: string; providerId: string; costCents: number;
  success: boolean; fieldsReturned: string[];
}): Promise<void> {
  await transaction(async client => {
    const attempt = await client.query<{ pending: { contactId: string; provider: string; reservedCents: number; budgetPeriodId: string };
      results: Array<{ contactId: string; result: EnrichmentResult }> }>(
      'SELECT pending, results FROM enrichment_quote_uses WHERE quote_id=$1 FOR UPDATE', [quoteId]);
    const pending = attempt.rows[0]?.pending;
    const saved = attempt.rows[0]?.results.find(item => item.contactId === data.contactId
      && item.result.providerId === data.provider && item.result.costCents === data.costCents
      && item.result.success === data.success);
    if (!pending || pending.contactId !== data.contactId || pending.provider !== data.provider
      || !saved || saved.result.errorCode
      || !Number.isSafeInteger(data.costCents) || data.costCents < 0 || data.costCents > pending.reservedCents) {
      throw new Error('Invalid enrichment settlement');
    }
    await client.query('UPDATE budget_periods SET spent_cents=spent_cents-$2 WHERE id=$1',
      [pending.budgetPeriodId, pending.reservedCents - data.costCents]);
    await client.query(`INSERT INTO enrichment_transactions
      (provider_id, contact_id, budget_period_id, cost_cents, status, fields_returned)
      VALUES ($1,$2,$3,$4,$5,$6)`, [data.providerId, data.contactId, pending.budgetPeriodId,
      data.costCents, data.success ? 'success' : 'failed', data.fieldsReturned]);
    await client.query('UPDATE enrichment_quote_uses SET pending=NULL, reconciliation_required=false WHERE quote_id=$1', [quoteId]);
    if (!data.success && data.costCents === 0) {
      await client.query('DELETE FROM enrichment_provider_claims WHERE contact_id=$1 AND provider=$2 AND quote_id=$3',
        [data.contactId, data.provider, quoteId]);
    }
  });
}

export async function listPendingEnrichmentReconciliations(): Promise<Array<{
  quoteId: string; contactId: string; provider: string; reservedCents: number; createdAt: string;
}>> {
  const result = await query<{ quote_id: string; pending: { contactId: string; provider: string; reservedCents: number }; created_at: Date }>(
    `SELECT quote_id, pending, created_at FROM enrichment_quote_uses
     WHERE pending IS NOT NULL AND (reconciliation_required=true OR created_at < now()-interval '15 minutes')
     ORDER BY created_at ASC`);
  return result.rows.map(row => ({ quoteId: row.quote_id, contactId: row.pending.contactId,
    provider: row.pending.provider, reservedCents: row.pending.reservedCents,
    createdAt: row.created_at.toISOString() }));
}

/** Invoice-verified settlement retains the claim and quote receipt; it never calls a provider. */
export async function reconcileEnrichmentCharge(quoteId: string, billedCents: number,
  invoiceReference: string): Promise<boolean> {
  if (!Number.isSafeInteger(billedCents) || billedCents < 0 || invoiceReference.trim().length < 3) {
    throw new Error('Invalid invoice reconciliation');
  }
  return transaction(async client => {
    const result = await client.query<{ pending: { contactId: string; provider: string; reservedCents: number; budgetPeriodId: string } }>(
      `SELECT pending FROM enrichment_quote_uses WHERE quote_id=$1
       AND (reconciliation_required=true OR created_at < now()-interval '15 minutes') FOR UPDATE`, [quoteId]);
    const pending = result.rows[0]?.pending;
    if (!pending || billedCents > pending.reservedCents) return false;
    const provider = await client.query<{ id: string }>('SELECT id FROM enrichment_providers WHERE name=$1', [pending.provider]);
    if (!provider.rows[0]) throw new Error('Provider no longer exists; reconcile through the runbook');
    const saved = await client.query<{ results: Array<{ contactId: string; result: EnrichmentResult }> }>(
      'SELECT results FROM enrichment_quote_uses WHERE quote_id=$1', [quoteId]);
    const fields = saved.rows[0].results.filter(item => item.contactId === pending.contactId &&
      item.result.providerId === pending.provider).flatMap(item => item.result.fields.map(field => field.field));
    await client.query('UPDATE budget_periods SET spent_cents=spent_cents-$2 WHERE id=$1',
      [pending.budgetPeriodId, pending.reservedCents - billedCents]);
    await client.query(`INSERT INTO enrichment_transactions
      (provider_id, contact_id, budget_period_id, cost_cents, status, fields_returned)
      VALUES ($1,$2,$3,$4,'reconciled',$5)`,
      [provider.rows[0].id, pending.contactId, pending.budgetPeriodId, billedCents, fields]);
    await client.query(`UPDATE enrichment_quote_uses SET pending=NULL, reconciliation_required=false,
      reconciliation_reference=$2, reconciled_cents=$3, reconciled_at=now() WHERE quote_id=$1`,
      [quoteId, invoiceReference, billedCents]);
    return true;
  });
}

export async function saveEnrichmentResponse(quoteId: string, response: Record<string, unknown>, status: number): Promise<void> {
  const written = await query(
    `UPDATE enrichment_quote_uses SET response=$2::jsonb, response_status=$3,
       execution_state=CASE WHEN $3=207 THEN 'partial' ELSE 'completed' END
     WHERE quote_id=$1 AND response_status IS NULL AND execution_state='running'`,
    [quoteId, JSON.stringify(response), status]);
  if (written.rowCount !== 1) throw new Error('Cannot persist enrichment response');
}

/** Make saved provider fields reviewable after an interrupted request without freezing the final response. */
export async function saveEnrichmentRecovery(quoteId: string, response: Record<string, unknown>): Promise<{
  response: Record<string, unknown>; status: number | null; pending: EnrichmentAttempt['pending'];
}> {
  const written = await query<{ response: Record<string, unknown>; response_status: number | null;
    pending: EnrichmentAttempt['pending'] }>(
    `UPDATE enrichment_quote_uses SET response=$2::jsonb
     WHERE quote_id=$1 AND response IS NULL AND response_status IS NULL AND execution_state='running'
     RETURNING response, response_status, pending`, [quoteId, JSON.stringify(response)]);
  if (written.rows[0]) return { response: written.rows[0].response,
    status: written.rows[0].response_status, pending: written.rows[0].pending };
  const existing = await getEnrichmentAttempt(quoteId);
  if (!existing?.response) throw new Error('Cannot persist enrichment recovery');
  return { response: existing.response, status: existing.response_status, pending: existing.pending };
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
