import { NextRequest } from '../../app/node_modules/next/server';
import { POST } from '@/app/api/enrichment/enrich/route';
import { POST as apply } from '@/app/api/enrichment/apply/route';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { readSignedEnrichmentQuote, verifyEnrichmentQuote } from '@/lib/enrichment/quote';
import { claimEnrichmentQuote, closeUnstartedEnrichmentQuote, getEnrichmentAttempt, hasUnreconciledEnrichmentAttempt, saveEnrichmentRecovery, saveEnrichmentResponse } from '@/lib/db/queries/enrichment';
import { applyReviewedEnrichment } from '@/lib/db/queries/enrichment-apply';
import { getContactById, updateContact } from '@/lib/db/queries/contacts';
import { enrichContact } from '@/lib/enrichment/waterfall';
import { remainingBulkContactIds } from '@/components/discover/people-panel';
import { GET as listPending, POST as reconcile } from '@/app/api/enrichment/reconcile/route';
import { listPendingEnrichmentReconciliations, reconcileEnrichmentCharge } from '@/lib/db/queries/enrichment';

jest.mock('@/lib/auth/local-request-boundary', () => ({ requireLocalDashboardRequest: jest.fn() }));
jest.mock('@/lib/enrichment/quote', () => ({ verifyEnrichmentQuote: jest.fn(), readSignedEnrichmentQuote: jest.fn() }));
jest.mock('@/lib/db/queries/enrichment', () => ({ claimEnrichmentQuote: jest.fn(), closeUnstartedEnrichmentQuote: jest.fn(), getEnrichmentAttempt: jest.fn(), hasUnreconciledEnrichmentAttempt: jest.fn(), saveEnrichmentRecovery: jest.fn(), saveEnrichmentResponse: jest.fn(), listPendingEnrichmentReconciliations: jest.fn(), reconcileEnrichmentCharge: jest.fn() }));
jest.mock('@/lib/db/queries/enrichment-apply', () => ({ applyReviewedEnrichment: jest.fn() }));
jest.mock('@/lib/db/queries/contacts', () => ({ getContactById: jest.fn(), updateContact: jest.fn() }));
jest.mock('@/lib/enrichment/waterfall', () => ({ enrichContact: jest.fn() }));
jest.mock('@/lib/ecc/exo-chain/enrichment-adapter', () => ({ enrichContactWithChain: jest.fn() }));
jest.mock('@/lib/ecc/types', () => ({ ECC_FLAGS: { exoChain: false, crossRefs: false } }));
jest.mock('@/lib/scoring/auto-score', () => ({ triggerAutoScore: jest.fn() }));

const id = '123e4567-e89b-42d3-a456-426614174000';
const request = (body: unknown) => new NextRequest('http://localhost/api/enrichment/enrich', {
  method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  jest.resetAllMocks();
  (requireLocalDashboardRequest as jest.Mock).mockResolvedValue(null);
  (getContactById as jest.Mock).mockResolvedValue({
    id, linkedin_url: 'https://linkedin.com/in/dummy', first_name: 'Test',
    last_name: 'Person', full_name: 'Test Person', email: null,
    current_company: null, title: null,
  });
  (verifyEnrichmentQuote as jest.Mock).mockResolvedValue({ id, maxCostCents: 10 });
  (readSignedEnrichmentQuote as jest.Mock).mockReturnValue({ id, mode: 'preview', contactIds: [id], targetFields: [] });
  (getEnrichmentAttempt as jest.Mock).mockResolvedValue(null);
  (hasUnreconciledEnrichmentAttempt as jest.Mock).mockResolvedValue(false);
  (claimEnrichmentQuote as jest.Mock).mockResolvedValue(true);
  (applyReviewedEnrichment as jest.Mock).mockResolvedValue({ state: 'applied', appliedFields: ['email'] });
});

it('blocks a new paid quote for a contact with an unresolved prior provider request', async () => {
  (hasUnreconciledEnrichmentAttempt as jest.Mock).mockResolvedValue(true);
  const response = await POST(request({ contactId: id, quote: 'new-confirmed-quote' }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ reconciliationRequired: true });
  expect(claimEnrichmentQuote).not.toHaveBeenCalled();
  expect(enrichContact).not.toHaveBeenCalled();
});

it.each([
  ['archived', { is_archived: true }],
  ['owner', { linkedin_url: 'self:owner' }],
])('refuses a paid preview for an %s contact before claiming the quote', async (_label, patch) => {
  (getContactById as jest.Mock).mockResolvedValue({
    id, linkedin_url: 'https://linkedin.com/in/dummy', first_name: 'Test',
    last_name: 'Person', full_name: 'Test Person', email: null,
    current_company: null, title: null, is_archived: false, ...patch,
  });
  const response = await POST(request({ contactId: id, quote: 'confirmed-quote', dryRun: true }));
  expect(response.status).toBe(409);
  expect(claimEnrichmentQuote).not.toHaveBeenCalled();
  expect(enrichContact).not.toHaveBeenCalled();
});

it('guards apply before reading or writing a contact', async () => {
  (requireLocalDashboardRequest as jest.Mock).mockResolvedValue(new Response('denied', { status: 401 }));
  const response = await apply(new NextRequest('http://localhost/api/enrichment/apply', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contactId: id, fields: [{ field: 'email', value: 'x@example.com' }] }),
  }));
  expect(response.status).toBe(401);
  expect(getContactById).not.toHaveBeenCalled();
  expect(updateContact).not.toHaveBeenCalled();
  expect(applyReviewedEnrichment).not.toHaveBeenCalled();
});

it('rejects auto-apply before a paid lookup, even with a confirmed preview quote', async () => {
  const response = await POST(request({ contactId: id, quote: 'confirmed', dryRun: false }));
  expect(response.status).toBe(400);
  expect(claimEnrichmentQuote).not.toHaveBeenCalled();
  expect(enrichContact).not.toHaveBeenCalled();
  expect(updateContact).not.toHaveBeenCalled();
});

it('delegates paid preview verification to the atomic apply operation', async () => {
  const applyRequest = (fields: unknown, quote = 'confirmed') => apply(new NextRequest('http://localhost/api/enrichment/apply', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contactId: id, quote, fields }),
  }));
  (applyReviewedEnrichment as jest.Mock).mockResolvedValueOnce({ state: 'conflict', error: 'Fields must exactly match' });
  expect((await applyRequest([{ field: 'email', value: 'forged@example.com' }])).status).toBe(409);
  expect((await applyRequest([{ field: 'email', value: 'saved@example.com' }])).status).toBe(200);
  expect(applyReviewedEnrichment).toHaveBeenCalledWith(id, id, [{ field: 'email', value: 'saved@example.com' }]);
  (readSignedEnrichmentQuote as jest.Mock).mockReturnValueOnce({ id, mode: 'preview', contactIds: [] });
  expect((await applyRequest([{ field: 'email', value: 'saved@example.com' }])).status).toBe(409);
});

it('reduces a bulk caller cap by spend from earlier contacts', async () => {
  const second = '223e4567-e89b-42d3-a456-426614174000';
  (readSignedEnrichmentQuote as jest.Mock).mockReturnValue({ id, mode: 'preview', contactIds: [id, second], targetFields: [] });
  (verifyEnrichmentQuote as jest.Mock).mockResolvedValue({ id, maxCostCents: 20 });
  (getContactById as jest.Mock).mockImplementation(async contactId => ({
    id: contactId, linkedin_url: null, first_name: 'Test', last_name: 'Person',
    full_name: 'Test Person', email: null, current_company: null, title: null,
  }));
  (enrichContact as jest.Mock).mockResolvedValue([{ providerId: 'pdl', providerName: 'PDL',
    success: true, fields: [], costCents: 7 }]);
  const response = await POST(request({ contactIds: [id, second], quote: 'confirmed', budgetLimitCents: 10 }));
  expect(response.status).toBe(200);
  expect((enrichContact as jest.Mock).mock.calls[0][1].budgetLimitCents).toBe(10);
  expect((enrichContact as jest.Mock).mock.calls[1][1].budgetLimitCents).toBe(3);
});

it('rejects a non-operator request before contact reads or paid calls', async () => {
  (requireLocalDashboardRequest as jest.Mock).mockResolvedValue(new Response('denied', { status: 401 }));
  const response = await POST(request({ contactId: id, quote: 'dummy' }));
  expect(response.status).toBe(401);
  expect(getContactById).not.toHaveBeenCalled();
  expect(enrichContact).not.toHaveBeenCalled();
});

it('rejects stale or already redeemed quotes before the waterfall', async () => {
  (verifyEnrichmentQuote as jest.Mock).mockResolvedValueOnce(null);
  expect((await POST(request({ contactId: id, quote: 'stale' }))).status).toBe(409);
  (claimEnrichmentQuote as jest.Mock).mockResolvedValueOnce(false);
  expect((await POST(request({ contactId: id, quote: 'used' }))).status).toBe(409);
  expect(enrichContact).not.toHaveBeenCalled();
});

it('returns paid fields, spend and a partial stop after a later ledger failure', async () => {
  (enrichContact as jest.Mock).mockResolvedValue([
    { providerId: 'pdl', providerName: 'People Data Labs', success: true,
      fields: [{ field: 'email', value: 'found@example.com', confidence: 1 }], costCents: 10 },
    { providerId: 'pdl', providerName: 'People Data Labs', success: false,
      fields: [], costCents: 0, errorCode: 'ledger_failed', reservedCents: 10 },
  ]);
  const response = await POST(request({ contactId: id, quote: 'confirmed' }));
  expect(response.status).toBe(207);
  const payload = await response.json();
  expect(payload).toMatchObject({ partial: true, stopReason: 'ledger_failed',
    totalCostCents: 10, reservedBudgetCents: 10 });
  expect(payload.data[0].delta[0].newValue).toBe('found@example.com');
  expect(saveEnrichmentResponse).toHaveBeenCalledWith(id, expect.objectContaining({ data: expect.any(Array) }), 207);
  expect(enrichContact).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({ budgetLimitCents: 10 }));
});

it('persists recovered paid fields so Apply can use the same quote without another provider call', async () => {
  const attempt = {
    pending: { contactId: id, provider: 'pdl', reservedCents: 10 },
    results: [{ contactId: id, result: { providerId: 'pdl', providerName: 'People Data Labs',
      success: true, fields: [{ field: 'email', value: 'saved@example.com', confidence: 1 }], costCents: 10 } }],
    response: null, response_status: null, reconciliation_required: false,
  } as { pending: { contactId: string; provider: string; reservedCents: number }; results: unknown[];
    response: null | Record<string, unknown>; response_status: number | null; reconciliation_required: boolean };
  (getEnrichmentAttempt as jest.Mock).mockImplementation(async () => attempt);
  (saveEnrichmentRecovery as jest.Mock).mockImplementation(async (_quoteId, response) => {
    attempt.response = response;
    return { response, status: null, pending: attempt.pending };
  });
  const response = await POST(request({ contactId: id, quote: 'confirmed' }));
  expect(response.status).toBe(207);
  expect(await response.json()).toMatchObject({ reconciliationRequired: true,
    data: [{ delta: [{ newValue: 'saved@example.com' }] }] });
  expect(saveEnrichmentRecovery).toHaveBeenCalledWith(id, expect.objectContaining({ data: expect.any(Array) }));
  const applied = await apply(new NextRequest('http://localhost/api/enrichment/apply', {
    method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify({ contactId: id, quote: 'confirmed',
      fields: [{ field: 'email', value: 'saved@example.com' }] }),
  }));
  expect(applied.status).toBe(200);
  expect(applyReviewedEnrichment).toHaveBeenCalledWith(id, id, [{ field: 'email', value: 'saved@example.com' }]);
  expect(verifyEnrichmentQuote).not.toHaveBeenCalled();
  expect(enrichContact).not.toHaveBeenCalled();
});

it('recovers a settled interruption without falsely requiring charge reconciliation', async () => {
  const result = { providerId: 'pdl', providerName: 'People Data Labs', success: true,
    fields: [{ field: 'email', value: 'saved@example.com', confidence: 1 }], costCents: 10 };
  (getEnrichmentAttempt as jest.Mock).mockResolvedValue({ pending: null,
    results: [{ contactId: id, result }], response: null, response_status: null,
    reconciliation_required: false, reconciled_cents: null });
  (saveEnrichmentRecovery as jest.Mock).mockImplementation(async (_quoteId, response) =>
    ({ response, status: null, pending: null }));
  const response = await POST(request({ contactId: id, quote: 'confirmed' }));
  expect(response.status).toBe(207);
  expect(await response.json()).toMatchObject({ reconciliationRequired: false,
    stopReason: 'interrupted_preview', reservedBudgetCents: 0,
    data: [{ delta: [{ newValue: 'saved@example.com' }] }] });
  expect(saveEnrichmentRecovery).toHaveBeenCalledTimes(1);
  expect(enrichContact).not.toHaveBeenCalled();
});

it('replays a persisted provisional review without another paid call', async () => {
  (getEnrichmentAttempt as jest.Mock).mockResolvedValue({ pending: null,
    results: [], response: { data: [{ contactId: id, delta: [{ field: 'email', newValue: 'saved@example.com' }] }],
      partial: true, stopReason: 'interrupted_preview' }, response_status: null,
    reconciled_cents: null });
  const response = await POST(request({ contactId: id, quote: 'confirmed' }));
  expect(response.status).toBe(207);
  expect(await response.json()).toMatchObject({ reconciliationRequired: false,
    data: [{ delta: [{ newValue: 'saved@example.com' }] }] });
  expect(saveEnrichmentRecovery).not.toHaveBeenCalled();
  expect(enrichContact).not.toHaveBeenCalled();
});

it('closes an interrupted post-claim quote with no provider intent as no-charge', async () => {
  (getEnrichmentAttempt as jest.Mock).mockResolvedValueOnce({ pending: null, results: [], response: null,
    response_status: null, execution_state: 'running' });
  (closeUnstartedEnrichmentQuote as jest.Mock).mockResolvedValue(true);
  const response = await POST(request({ contactId: id, quote: 'confirmed' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ noCharge: true, data: [], totalCostCents: 0 });
  expect(enrichContact).not.toHaveBeenCalled();
  expect(saveEnrichmentRecovery).not.toHaveBeenCalled();
});

it('keeps an interrupted paid call running without an empty provisional preview', async () => {
  const running = { pending: { contactId: id, provider: 'pdl', reservedCents: 10 },
    results: [], response: null, response_status: null, reconciliation_required: false,
    execution_state: 'running' };
  (getEnrichmentAttempt as jest.Mock).mockResolvedValue(running);
  const response = await POST(request({ contactId: id, quote: 'confirmed' }));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ running: true, reconciliationRequired: false,
    reservedBudgetCents: 10 });
  expect(closeUnstartedEnrichmentQuote).not.toHaveBeenCalled();
  expect(saveEnrichmentRecovery).not.toHaveBeenCalled();
  expect(enrichContact).not.toHaveBeenCalled();
});

it('makes a zero-result budget race visible to Discover', async () => {
  (enrichContact as jest.Mock).mockResolvedValue([{
    providerId: 'pdl', providerName: 'People Data Labs', success: false,
    fields: [], costCents: 0, errorCode: 'budget_unavailable', reservedCents: 0,
  }]);
  const response = await POST(request({ contactIds: [id], quote: 'confirmed' }));
  expect(response.status).toBe(207);
  expect(await response.json()).toMatchObject({ partial: true,
    stopReason: 'budget_unavailable', totalCostCents: 0 });
});

it('returns the stopped contact and untouched tail for explicit bulk resume', async () => {
  const second = '223e4567-e89b-42d3-a456-426614174000';
  const third = '323e4567-e89b-42d3-a456-426614174000';
  (readSignedEnrichmentQuote as jest.Mock).mockReturnValue({ id, mode: 'preview', contactIds: [id, second, third], targetFields: [] });
  (verifyEnrichmentQuote as jest.Mock).mockResolvedValue({ id, maxCostCents: 30 });
  (getContactById as jest.Mock).mockImplementation(async contactId => ({ id: contactId,
    first_name: 'Test', last_name: 'Person', full_name: 'Test Person', email: null }));
  (enrichContact as jest.Mock).mockResolvedValueOnce([{ providerId: 'pdl', providerName: 'PDL',
    success: true, fields: [], costCents: 10 }]).mockResolvedValueOnce([{
    providerId: 'pdl', providerName: 'PDL', success: false, fields: [], costCents: 0,
    errorCode: 'budget_unavailable', reservedCents: 0,
  }]);
  const response = await POST(request({ contactIds: [id, second, third], quote: 'confirmed' }));
  const payload = await response.json();
  expect(response.status).toBe(207);
  expect(payload.remainingContactIds).toEqual([second, third]);
  expect(remainingBulkContactIds([id, second, third], payload.data)).toEqual([second, third]);
  expect(enrichContact).toHaveBeenCalledTimes(2);
});

it('requires an authorized operator and verified charge evidence for reconciliation', async () => {
  const reconcileRequest = (body: unknown) => new NextRequest('http://localhost/api/enrichment/reconcile', {
    method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  (requireLocalDashboardRequest as jest.Mock).mockResolvedValueOnce(new Response('denied', { status: 401 }));
  expect((await listPending(new NextRequest('http://localhost/api/enrichment/reconcile'))).status).toBe(401);
  expect(listPendingEnrichmentReconciliations).not.toHaveBeenCalled();
  expect((await reconcile(reconcileRequest({ quoteId: id, billedCents: 4 }))).status).toBe(400);
  expect(reconcileEnrichmentCharge).not.toHaveBeenCalled();
  (reconcileEnrichmentCharge as jest.Mock).mockResolvedValue(true);
  expect((await reconcile(reconcileRequest({ quoteId: id, billedCents: 4, invoiceReference: 'invoice-123' }))).status).toBe(200);
  expect(reconcileEnrichmentCharge).toHaveBeenCalledWith(id, 4, 'invoice-123');
  expect(enrichContact).not.toHaveBeenCalled();
});
