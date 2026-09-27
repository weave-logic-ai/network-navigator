import { NextRequest } from '../../app/node_modules/next/server';
import { GET as listProviders } from '@/app/api/enrichment/providers/route';
import { PUT as updateProvider } from '@/app/api/enrichment/providers/[id]/route';
import { POST as createBudget } from '@/app/api/enrichment/budget/route';
import { enrichContact, estimateEnrichmentCost } from '@/lib/enrichment/waterfall';
import { PdlProvider } from '@/lib/enrichment/providers/pdl';
import { LushaProvider } from '@/lib/enrichment/providers/lusha';
import { TheirStackProvider } from '@/lib/enrichment/providers/theirstack';
import { ApolloProvider } from '@/lib/enrichment/providers/apollo';
import * as queries from '@/lib/db/queries/enrichment';
import type { ProviderConfig } from '@/lib/enrichment/types';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { createEnrichmentQuote, readSignedEnrichmentQuote, verifyEnrichmentQuote } from '@/lib/enrichment/quote';

jest.mock('@/lib/auth/local-request-boundary', () => ({
  requireLocalDashboardRequest: jest.fn(async () => null),
}));
jest.mock('@/lib/auth/operator-session', () => ({ operatorSecret: () => 'dummy-test-secret-with-at-least-32-characters' }));
jest.mock('@/lib/db/queries/enrichment', () => ({
  listProviders: jest.fn(), getProviderById: jest.fn(), updateProvider: jest.fn(),
  createCurrentMonthlyBudget: jest.fn(), getActiveBudget: jest.fn(),
  getActiveProviders: jest.fn(), recordTransaction: jest.fn(),
  reserveEnrichmentLookup: jest.fn(), settleBudgetSpend: jest.fn(), claimEnrichmentQuote: jest.fn(),
  saveEnrichmentResult: jest.fn(), finishEnrichmentProvider: jest.fn(),
  flagEnrichmentReconciliation: jest.fn(), completeEnrichmentLookup: jest.fn(),
  listClaimedEnrichmentProviders: jest.fn(),
}));

const id = '123e4567-e89b-42d3-a456-426614174000';
const provider: ProviderConfig = {
  id, name: 'pdl', displayName: 'People Data Labs', apiBaseUrl: null,
  costPerLookupCents: 10, rateLimitPerMinute: null, isActive: false,
  capabilities: ['email'], priority: 1, config: { apiKey: 'dummy-secret-key' },
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
};
const request = (path: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { origin: 'http://localhost', 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(() => {
  jest.resetAllMocks();
  (queries.reserveEnrichmentLookup as jest.Mock).mockResolvedValue(true);
  (queries.listClaimedEnrichmentProviders as jest.Mock).mockResolvedValue([]);
  (queries.getProviderById as jest.Mock).mockResolvedValue(provider);
  (queries.updateProvider as jest.Mock).mockResolvedValue(provider);
});

it('redacts provider credentials in the listing', async () => {
  (queries.listProviders as jest.Mock).mockResolvedValue([provider]);
  const response = await listProviders(request('/api/enrichment/providers'));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.data[0].credentialConfigured).toBe(true);
  expect(JSON.stringify(payload)).not.toContain('dummy-secret-key');
  expect(payload.data[0]).not.toHaveProperty('config');
});

it('rejects untrusted provider configuration and never echoes a saved key', async () => {
  const context = { params: Promise.resolve({ id }) };
  const invalid = await updateProvider(request(`/api/enrichment/providers/${id}`, 'PUT', {
    apiBaseUrl: 'http://localhost:9999/private',
  }), context);
  expect(invalid.status).toBe(400);
  expect(queries.updateProvider).not.toHaveBeenCalled();

  const saved = await updateProvider(request(`/api/enrichment/providers/${id}`, 'PUT', {
    apiKey: 'dummy-new-secret',
  }), context);
  expect(saved.status).toBe(200);
  expect(JSON.stringify(await saved.json())).not.toContain('dummy-secret-key');
  expect(queries.updateProvider).toHaveBeenCalledWith(id, {
    config: { apiKey: 'dummy-new-secret' },
  });
});

it('validates the budget amount and reports an existing period', async () => {
  expect((await createBudget(request('/api/enrichment/budget', 'POST', { budgetCents: -1 }))).status).toBe(400);
  expect(queries.createCurrentMonthlyBudget).not.toHaveBeenCalled();
  (queries.createCurrentMonthlyBudget as jest.Mock).mockResolvedValue(null);
  expect((await createBudget(request('/api/enrichment/budget', 'POST', { budgetCents: 2500 }))).status).toBe(409);
});

it('rejects an unauthenticated budget write before touching storage', async () => {
  (requireLocalDashboardRequest as jest.Mock).mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'Operator session required' }), { status: 401 })
  );
  const response = await createBudget(request('/api/enrichment/budget', 'POST', { budgetCents: 2500 }));
  expect(response.status).toBe(401);
  expect(queries.createCurrentMonthlyBudget).not.toHaveBeenCalled();
});

it('makes no paid provider request without an active budget, even with a caller cap', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue(null);
  const paid = jest.spyOn(PdlProvider.prototype, 'enrich');
  const result = await enrichContact({
    id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null,
    currentCompany: null, title: null,
  }, { budgetLimitCents: 10000, quoteId: id });
  expect(result[0].errorCode).toBe('budget_unavailable');
  expect(paid).not.toHaveBeenCalled();
  expect(queries.recordTransaction).not.toHaveBeenCalled();
  paid.mockRestore();
});

it('makes no paid request when atomic reservation loses the budget race', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({
    id, budgetCents: 10, spentCents: 0,
  });
  (queries.reserveEnrichmentLookup as jest.Mock).mockResolvedValue(false);
  const paid = jest.spyOn(PdlProvider.prototype, 'enrich');
  const result = await enrichContact({
    id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null,
    currentCompany: null, title: null,
  }, { quoteId: id });
  expect(result[0].errorCode).toBe('budget_unavailable');
  expect(queries.reserveEnrichmentLookup).toHaveBeenCalledWith(id, id, 'pdl', id, 10);
  expect(paid).not.toHaveBeenCalled();
  paid.mockRestore();
});

it('surfaces a provider cost above the reserved bound without refunding it', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({ id, budgetCents: 10, spentCents: 0 });
  (queries.reserveEnrichmentLookup as jest.Mock).mockResolvedValue(true);
  const paid = jest.spyOn(PdlProvider.prototype, 'enrich').mockResolvedValue({
    providerId: 'pdl', providerName: 'People Data Labs', success: true,
    fields: [], costCents: 11,
  });
  const result = await enrichContact({
    id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null,
    currentCompany: null, title: null,
  }, { quoteId: id });
  expect(result.map(item => item.errorCode)).toEqual([undefined, 'cost_exceeded']);
  expect(result[1].reservedCents).toBe(10);
  expect(queries.settleBudgetSpend).not.toHaveBeenCalled();
  expect(queries.recordTransaction).not.toHaveBeenCalled();
  paid.mockRestore();
});

it('estimates the fixed provider maximum and applies the same target-field filter', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{
    ...provider, isActive: true, costPerLookupCents: 1,
  }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({ budgetCents: 10, spentCents: 0 });
  const contact = {
    id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: 'known@example.com',
    currentCompany: null, title: null,
  };
  expect((await estimateEnrichmentCost([contact], ['email'])).totalCostCents).toBe(0);
  expect((await estimateEnrichmentCost([contact])).totalCostCents).toBe(10);
  expect((await estimateEnrichmentCost([{ ...contact, email: 'true' }], ['email'])).totalCostCents).toBe(10);
});

it('returns paid fields and explicit reserved exposure when the ledger fails', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({ id, budgetCents: 10, spentCents: 0 });
  (queries.reserveEnrichmentLookup as jest.Mock).mockResolvedValue(true);
  (queries.completeEnrichmentLookup as jest.Mock).mockRejectedValue(new Error('ledger unavailable'));
  const paid = jest.spyOn(PdlProvider.prototype, 'enrich').mockResolvedValue({
    providerId: 'pdl', providerName: 'People Data Labs', success: true,
    fields: [{ field: 'email', value: 'found@example.com', confidence: 1 }], costCents: 10,
  });
  const result = await enrichContact({
    id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null,
    currentCompany: null, title: null,
  }, { quoteId: id });
  expect(result[0].fields[0].value).toBe('found@example.com');
  expect(result[1]).toMatchObject({ errorCode: 'ledger_failed', reservedCents: 10 });
  paid.mockRestore();
});

it('keeps paid fields and the full reservation when settlement fails', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({ id, budgetCents: 10, spentCents: 0 });
  (queries.reserveEnrichmentLookup as jest.Mock).mockResolvedValue(true);
  (queries.completeEnrichmentLookup as jest.Mock).mockRejectedValue(new Error('settlement unavailable'));
  const paid = jest.spyOn(PdlProvider.prototype, 'enrich').mockResolvedValue({
    providerId: 'pdl', providerName: 'People Data Labs', success: true,
    fields: [{ field: 'email', value: 'found@example.com', confidence: 1 }], costCents: 10,
  });
  const result = await enrichContact({
    id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null,
    currentCompany: null, title: null,
  }, { quoteId: id });
  expect(result[0].fields[0].value).toBe('found@example.com');
  expect(result[1]).toMatchObject({ errorCode: 'ledger_failed', reservedCents: 10 });
  expect(queries.recordTransaction).not.toHaveBeenCalled();
  paid.mockRestore();
});

it('never follows credentialed provider redirects with dummy keys', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, {
    status: 302, headers: { location: 'http://127.0.0.1/private' },
  }));
  const contact = {
    id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null,
    currentCompany: 'Example', title: null,
  };
  try {
    for (const paid of [new PdlProvider({ apiKey: 'dummy-key' }),
      new LushaProvider({ apiKey: 'dummy-key' }),
      new TheirStackProvider({ apiKey: 'dummy-key' }),
      new ApolloProvider({ apiKey: 'dummy-key' })]) {
      const result = await paid.enrich(contact);
      expect(result.success).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options?.redirect).toBe('manual');
    }
  } finally { fetchMock.mockRestore(); }
});

it('treats transport and parse failures after send as an unknown charge for all credentialed adapters', async () => {
  const contact = { id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null, currentCompany: 'Example', title: null };
  const paid = [new PdlProvider({ apiKey: 'dummy-key' }), new LushaProvider({ apiKey: 'dummy-key' }),
    new TheirStackProvider({ apiKey: 'dummy-key' }), new ApolloProvider({ apiKey: 'dummy-key' })];
  const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('dummy transport error'));
  try {
    for (const adapter of paid) {
      expect(await adapter.enrich(contact)).toMatchObject({ errorCode: 'provider_unknown_charge', costCents: 0 });
    }
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new Error('invalid JSON'); } } as Response);
    for (const adapter of paid) {
      expect(await adapter.enrich(contact)).toMatchObject({ errorCode: 'provider_unknown_charge', costCents: 0 });
    }
    expect(fetchMock).toHaveBeenCalledTimes(8);
  } finally { fetchMock.mockRestore(); }
});

it('treats provider 500 as an unknown charge in every paid adapter', async () => {
  const contact = { id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null, currentCompany: 'Example', title: null };
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
  try {
    for (const adapter of [new PdlProvider({ apiKey: 'dummy-key' }),
      new LushaProvider({ apiKey: 'dummy-key' }), new TheirStackProvider({ apiKey: 'dummy-key' }),
      new ApolloProvider({ apiKey: 'dummy-key' })]) {
      expect(await adapter.enrich(contact)).toMatchObject({
        errorCode: 'provider_unknown_charge', costCents: 0,
      });
    }
  } finally { fetchMock.mockRestore(); }
});

it('keeps reservation and stops waterfall after an unknown charge, with intent and result persisted', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({ id, budgetCents: 10, spentCents: 0 });
  (queries.reserveEnrichmentLookup as jest.Mock).mockResolvedValue(true);
  const paid = jest.spyOn(PdlProvider.prototype, 'enrich').mockResolvedValue({
    providerId: 'pdl', providerName: 'People Data Labs', success: false,
    fields: [], costCents: 0, errorCode: 'provider_unknown_charge',
  });
  try {
    const result = await enrichContact({ id, linkedinUrl: 'https://linkedin.com/in/dummy',
      firstName: 'Test', lastName: 'Person', fullName: 'Test Person', email: null,
      currentCompany: null, title: null }, { quoteId: id });
    expect(result[0].errorCode).toBe('provider_unknown_charge');
    expect((queries.reserveEnrichmentLookup as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(paid.mock.invocationCallOrder[0]);
    expect(queries.saveEnrichmentResult).toHaveBeenCalled();
    expect(queries.flagEnrichmentReconciliation).toHaveBeenCalledWith(id);
    expect(queries.settleBudgetSpend).not.toHaveBeenCalled();
    expect(queries.recordTransaction).not.toHaveBeenCalled();
    expect(queries.finishEnrichmentProvider).not.toHaveBeenCalled();
  } finally { paid.mockRestore(); }
});

it('skips a completed paid provider on a fresh quote and leaves it out of the estimate', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({ id, budgetCents: 100, spentCents: 0 });
  (queries.listClaimedEnrichmentProviders as jest.Mock).mockResolvedValue(['pdl']);
  const paid = jest.spyOn(PdlProvider.prototype, 'enrich');
  const contact = { id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null, currentCompany: null, title: null };
  try {
    expect((await estimateEnrichmentCost([contact], ['email'])).totalCostCents).toBe(0);
    expect(await enrichContact(contact, { quoteId: id, targetFields: ['email'] })).toEqual([]);
    expect(paid).not.toHaveBeenCalled();
    expect(queries.reserveEnrichmentLookup).not.toHaveBeenCalled();
  } finally { paid.mockRestore(); }
});

it('binds a signed quote to the contact, target fields, provider state and maximum cost', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({ budgetCents: 100, spentCents: 0 });
  const contact = {
    id, linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test',
    lastName: 'Person', fullName: 'Test Person', email: null,
    currentCompany: null, title: null,
  };
  const estimate = await createEnrichmentQuote([contact], ['email']);
  expect(estimate.totalCostCents).toBe(10);
  expect(readSignedEnrichmentQuote(estimate.quote)).toMatchObject({ mode: 'preview', contactIds: [id] });
  expect(await verifyEnrichmentQuote(estimate.quote, [contact], ['email'])).toMatchObject({ maxCostCents: 10 });
  expect(await verifyEnrichmentQuote(estimate.quote, [contact], ['phone'])).toBeNull();
  expect(await verifyEnrichmentQuote(estimate.quote, [{ ...contact, title: 'Changed' }], ['email'])).toBeNull();
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true, costPerLookupCents: 20 }]);
  expect(await verifyEnrichmentQuote(estimate.quote, [contact], ['email'])).toBeNull();
});

it('verifies a signed quote for the maximum Discover bulk size', async () => {
  (queries.getActiveProviders as jest.Mock).mockResolvedValue([{ ...provider, isActive: true }]);
  (queries.getActiveBudget as jest.Mock).mockResolvedValue({ budgetCents: 10000, spentCents: 0 });
  const contacts = Array.from({ length: 500 }, (_, index) => ({
    id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
    linkedinUrl: 'https://linkedin.com/in/dummy', firstName: 'Test', lastName: 'Person',
    fullName: 'Test Person', email: null, currentCompany: null, title: null,
  }));
  const estimate = await createEnrichmentQuote(contacts);
  expect(estimate.quote.length).toBeGreaterThan(8192);
  expect(await verifyEnrichmentQuote(estimate.quote, contacts)).toMatchObject({ maxCostCents: 5000 });
});
