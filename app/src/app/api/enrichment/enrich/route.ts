// POST /api/enrichment/enrich - Enrich contact(s), return delta for review
// Supports dryRun (default true) to return results without writing,
// or dryRun=false to auto-apply (legacy behavior).

import { NextRequest, NextResponse } from 'next/server';
import { enrichContact } from '@/lib/enrichment/waterfall';
import { enrichContactWithChain } from '@/lib/ecc/exo-chain/enrichment-adapter';
import { ECC_FLAGS } from '@/lib/ecc/types';
import { getContactById, updateContact } from '@/lib/db/queries/contacts';
import { FIELD_TO_COLUMN, FIELD_LABELS, isEffectivelyEmpty } from '@/lib/enrichment/field-map';
import { triggerAutoScore } from '@/lib/scoring/auto-score';

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
  try {
    const body = await request.json();
    const {
      contactId, contactIds, targetFields, fields,
      budgetLimitCents, dryRun = true,
    } = body as {
      contactId?: string;
      contactIds?: string[];
      targetFields?: string[];
      fields?: string[];
      budgetLimitCents?: number;
      dryRun?: boolean;
    };
    const resolvedTargetFields = targetFields || fields;

    const ids = contactId ? [contactId] : contactIds || [];
    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'contactId or contactIds required' },
        { status: 400 }
      );
    }

    const allResults = [];

    for (const id of ids) {
      const contact = await getContactById(id);
      if (!contact) continue;

      const enrichmentContact = {
        id: contact.id,
        linkedinUrl: contact.linkedin_url,
        firstName: contact.first_name,
        lastName: contact.last_name,
        fullName: contact.full_name,
        email: contact.email,
        currentCompany: contact.current_company,
        title: contact.title,
      };

      let results;
      let chainId: string | undefined;
      if (ECC_FLAGS.exoChain) {
        const chainResult = await enrichContactWithChain(enrichmentContact, {
          targetFields: resolvedTargetFields,
          budgetLimitCents,
        });
        results = chainResult.results;
        chainId = chainResult._chainId;
      } else {
        results = await enrichContact(enrichmentContact, {
          targetFields: resolvedTargetFields,
          budgetLimitCents,
        });
      }

      // Build delta for review
      const contactRecord = contact as unknown as Record<string, unknown>;
      const delta = buildDelta(contactRecord, results);

      if (dryRun) {
        // Return delta without writing — frontend will call /apply
        const totalCost = results.reduce((sum, r) => sum + (r.costCents || 0), 0);

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
          results,
          _chainId: chainId,
        });
      } else {
        // Legacy: auto-apply all fields that are selected in the delta
        let fieldsUpdated = 0;
        const updates: Record<string, unknown> = {};

        for (const d of delta) {
          if (!d.selected || !d.newValue) continue;
          const column = FIELD_TO_COLUMN[d.field];
          if (!column) continue;

          if (d.field === 'tags') {
            updates['tags'] = d.newValue.split(',').map(t => t.trim()).filter(Boolean);
          } else if (d.field === 'connections_count') {
            updates[column] = parseInt(d.newValue, 10) || null;
          } else {
            updates[column] = d.newValue;
          }
          fieldsUpdated++;
        }

        if (Object.keys(updates).length > 0) {
          await updateContact(id, updates);
          // Trigger auto-scoring after enrichment auto-apply
          triggerAutoScore(id);
        }

        allResults.push({
          contactId: id,
          fieldsUpdated,
          updatedFields: Object.keys(updates),
          delta,
          results,
          scoringTriggered: Object.keys(updates).length > 0,
          _chainId: chainId,
        });
      }
    }

    return NextResponse.json({ data: allResults });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to enrich contact(s)', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
