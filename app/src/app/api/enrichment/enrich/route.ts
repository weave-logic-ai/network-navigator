// POST /api/enrichment/enrich - Enrich contact(s), return delta for review
// A signed quote authorizes a paid preview only. Applying requires a separate review action.

import { NextRequest, NextResponse } from 'next/server';
import { enrichContact } from '@/lib/enrichment/waterfall';
import { enrichContactWithChain } from '@/lib/ecc/exo-chain/enrichment-adapter';
import { ECC_FLAGS } from '@/lib/ecc/types';
import { getContactById } from '@/lib/db/queries/contacts';
import { isSelfContact } from '@/lib/contacts/identity';
import { FIELD_TO_COLUMN, FIELD_LABELS, isEffectivelyEmpty } from '@/lib/enrichment/field-map';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { readSignedEnrichmentQuote, verifyEnrichmentQuote } from '@/lib/enrichment/quote';
import { claimEnrichmentQuote, closeUnstartedEnrichmentQuote, getEnrichmentAttempt, hasUnreconciledEnrichmentAttempt, saveEnrichmentRecovery, saveEnrichmentResponse } from '@/lib/db/queries/enrichment';

interface EnrichmentDelta {
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  confidence: number;
  provider: string;
  selected: boolean; // pre-selected for apply
}

function buildDelta(
  contact: Record<string, unknown>,
  results: Array<{ success: boolean; providerName: string; fields: Array<{ field: string; value: string | number | boolean | null; confidence: number }> }>
): EnrichmentDelta[] {
  const deltas: EnrichmentDelta[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (!result.success) continue;
    for (const field of result.fields) {
      const column = FIELD_TO_COLUMN[field.field];
      if (!column || seen.has(field.field)) continue;
      seen.add(field.field);

      const oldRaw = contact[column];
      const oldValue = isEffectivelyEmpty(oldRaw) ? null : String(oldRaw);

      let newValue: string | null = null;
      if (field.field === 'tags' && typeof field.value === 'string') {
        const newTags = field.value.split(',').map(t => t.trim()).filter(Boolean);
        const existingTags = (contact['tags'] || []) as string[];
        const merged = [...new Set([...existingTags, ...newTags])];
        newValue = merged.join(', ');
      } else if (field.field === 'connections_count') {
        newValue = String(parseInt(String(field.value), 10) || '');
      } else {
        newValue = field.value !== null ? String(field.value) : null;
      }

      // Skip if new value is empty or identical to old
      if (!newValue) continue;
      const changed = oldValue !== newValue;

      deltas.push({
        field: field.field,
        label: FIELD_LABELS[field.field] || field.field,
        oldValue,
        newValue,
        confidence: field.confidence,
        provider: result.providerName,
        // Auto-select if the field was empty/sentinel, don't auto-select overwrites
        selected: changed && oldValue === null,
      });
    }
  }

  return deltas;
}

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const {
      contactId, contactIds, targetFields, fields,
      budgetLimitCents, dryRun = true, quote,
    } = body as {
      contactId?: string;
      contactIds?: string[];
      targetFields?: string[];
      fields?: string[];
      budgetLimitCents?: number;
      dryRun?: boolean;
      quote?: string;
    };
    const resolvedTargetFields = targetFields || fields;

    const ids = contactId ? [contactId] : contactIds || [];
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500
      || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
      || (resolvedTargetFields !== undefined && (!Array.isArray(resolvedTargetFields)
        || resolvedTargetFields.some(field => typeof field !== 'string' || field.length > 64)))
      || (budgetLimitCents !== undefined && (!Number.isSafeInteger(budgetLimitCents) || budgetLimitCents < 0))
      || typeof quote !== 'string' || dryRun !== true) {
      return NextResponse.json(
        { error: 'Valid contact IDs and a confirmed quote are required' },
        { status: 400 }
      );
    }

    const signed = readSignedEnrichmentQuote(quote);
    if (!signed || JSON.stringify(signed.contactIds) !== JSON.stringify(ids)
      || JSON.stringify(signed.targetFields) !== JSON.stringify(resolvedTargetFields || [])) {
      return NextResponse.json({ error: 'Invalid enrichment quote' }, { status: 409 });
    }
    let prior = await getEnrichmentAttempt(signed.id);
    if (prior) {
      if (prior.response) return NextResponse.json({ ...prior.response,
        reconciliationRequired: !!prior.pending,
        reservedBudgetCents: prior.pending?.reservedCents ?? 0,
        ...(prior.reconciled_cents === null ? {} : { reconciledCents: prior.reconciled_cents })
      }, { status: prior.response_status ?? 207 });
      if (prior.results.length === 0 && !prior.pending && await closeUnstartedEnrichmentQuote(signed.id)) {
        return NextResponse.json({ data: [], partial: false, noCharge: true, totalCostCents: 0 });
      }
      prior = await getEnrichmentAttempt(signed.id);
      if (!prior) return NextResponse.json({ error: 'Quote state unavailable' }, { status: 409 });
      if (prior.response) return NextResponse.json({ ...prior.response,
        reconciliationRequired: !!prior.pending }, { status: prior.response_status ?? 207 });
      if (prior.results.length === 0) return NextResponse.json({ running: true,
        reconciliationRequired: !!prior.pending && prior.reconciliation_required,
        reservedBudgetCents: prior.pending?.reservedCents ?? 0,
        message: prior.pending ? 'Provider request is pending. Recover this quote later; reconcile only if the charge remains uncertain.'
          : 'Quote is still starting. Recover this quote again shortly.' }, { status: 202 });
      const savedResults = prior.results;
      const savedContacts = await Promise.all(ids.map(id => getContactById(id)));
      const data = ids.map((id, index) => {
        const results = savedResults.filter(item => item.contactId === id).map(item => item.result);
        return { contactId: id, results, delta: buildDelta((savedContacts[index] || {}) as Record<string, unknown>, results),
          totalCostCents: results.reduce((sum, item) => sum + item.costCents, 0), partial: true };
      });
      const recovered = await saveEnrichmentRecovery(signed.id, { data, partial: true,
        stopReason: prior.pending ? 'reconciliation_required' : 'interrupted_preview',
        remainingContactIds: ids,
        totalCostCents: data.reduce((sum, item) => sum + item.totalCostCents, 0) });
      return NextResponse.json({ ...recovered.response,
        reconciliationRequired: !!recovered.pending,
        reservedBudgetCents: recovered.pending?.reservedCents ?? 0 },
      { status: recovered.status ?? 207 });
    }
    if (await hasUnreconciledEnrichmentAttempt(ids)) {
      return NextResponse.json({ error: 'A previous paid request for this contact needs charge reconciliation. Recover its original quote before another paid preview.',
        reconciliationRequired: true }, { status: 409 });
    }

    const contacts = await Promise.all(ids.map(id => getContactById(id)));
    if (contacts.some(contact => !contact)) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    // Refuse before claiming the quote: a paid lookup for these contacts
    // could never be applied, and self: URLs are not provider identities.
    if (contacts.some(contact => contact!.is_archived || isSelfContact({ linkedinUrl: contact!.linkedin_url }))) {
      return NextResponse.json({ error: 'Archived and owner contacts cannot be enriched' }, { status: 409 });
    }
    const snapshots = contacts.map(contact => ({
      id: contact!.id, linkedinUrl: contact!.linkedin_url,
      firstName: contact!.first_name, lastName: contact!.last_name,
      fullName: contact!.full_name, email: contact!.email,
      currentCompany: contact!.current_company, title: contact!.title,
    }));
    const confirmed = await verifyEnrichmentQuote(quote, snapshots, resolvedTargetFields);
    if (!confirmed) return NextResponse.json({ error: 'Enrichment quote expired or state changed. Review a fresh estimate.' }, { status: 409 });
    if (!await claimEnrichmentQuote(confirmed.id)) {
      return NextResponse.json({ error: 'Quote is already running. Retry this same quote to recover its saved result; do not request another paid quote.' }, { status: 409 });
    }

    const allResults = [];
    let chargedCents = 0;

    for (const [index, id] of ids.entries()) {
      const contact = contacts[index]!;
      const enrichmentContact = snapshots[index];
      const confirmedRemaining = Math.max(0, confirmed.maxCostCents - chargedCents);
      const executionCap = Math.min(confirmedRemaining,
        Math.max(0, (budgetLimitCents ?? Infinity) - chargedCents));

      let results;
      let chainId: string | undefined;
      if (ECC_FLAGS.exoChain) {
        const chainResult = await enrichContactWithChain(enrichmentContact, {
          targetFields: resolvedTargetFields,
          budgetLimitCents: executionCap,
          quoteId: confirmed.id,
        });
        results = chainResult.results;
        chainId = chainResult._chainId;
      } else {
        results = await enrichContact(enrichmentContact, {
          targetFields: resolvedTargetFields,
          budgetLimitCents: executionCap,
          quoteId: confirmed.id,
        });
      }

      // Build delta for review
      const contactRecord = contact as unknown as Record<string, unknown>;
      const delta = buildDelta(contactRecord, results);
      const stopResult = results.find(result => result.errorCode);
      const actualCost = results.reduce((sum, result) => sum +
        (Number.isSafeInteger(result.costCents) && result.costCents > 0 ? result.costCents : 0), 0);
      chargedCents += actualCost;

      {
        // Return delta without writing — frontend will call /apply
        const totalCost = actualCost;

        // Extract gated fields (PDL Starter tier returns true/false instead of values)
        const gatedFields: string[] = [];
        for (const result of results) {
          const raw = result.rawResponse as Record<string, unknown> | undefined;
          if (raw?._gatedFields && Array.isArray(raw._gatedFields)) {
            gatedFields.push(...(raw._gatedFields as string[]));
          }
        }

        allResults.push({
          contactId: id,
          delta,
          gatedFields: [...new Set(gatedFields)],
          totalCostCents: totalCost,
          reservedBudgetCents: stopResult?.reservedCents ?? 0,
          partial: !!stopResult,
          stopReason: stopResult?.errorCode,
          results,
          _chainId: chainId,
        });
      }
      if (stopResult) {
        const response = { data: allResults, partial: true, totalCostCents: chargedCents,
          reservedBudgetCents: stopResult.reservedCents ?? 0, stopReason: stopResult.errorCode,
          remainingContactIds: ids.slice(index),
          reconciliationRequired: !!(stopResult.reservedCents && stopResult.errorCode !== 'budget_unavailable') };
        await saveEnrichmentResponse(confirmed.id, response, 207);
        return NextResponse.json(response, { status: 207 });
      }
    }

    const response = { data: allResults, partial: false, totalCostCents: chargedCents };
    await saveEnrichmentResponse(confirmed.id, response, 200);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to enrich contact(s)', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
