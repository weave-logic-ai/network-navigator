import { transaction } from '../client';
import { FIELD_TO_COLUMN, isEffectivelyEmpty } from '../../enrichment/field-map';
import { reconcileContactIdentity } from '../../contacts/identity-lifecycle';
import type { ContactIdentityRow } from '../../contacts/identity';

export interface ReviewedEnrichmentField { field: string; value: string }
export type ApplyEnrichmentResult =
  | { state: 'applied' | 'replayed'; appliedFields: string[] }
  | { state: 'conflict'; error: string }
  | { state: 'missing'; error: string };

/** Lock quote and contact, compare reviewed old values, then write one durable receipt. */
export async function applyReviewedEnrichment(quoteId: string, contactId: string,
  fields: ReviewedEnrichmentField[]): Promise<ApplyEnrichmentResult> {
  const selected = [...fields].sort((a, b) => a.field.localeCompare(b.field));
  return transaction(async client => {
    const quote = await client.query<{ response: { data?: unknown } | null }>(
      'SELECT response FROM enrichment_quote_uses WHERE quote_id=$1 FOR UPDATE', [quoteId]);
    if (!quote.rows[0]) return { state: 'missing', error: 'Quote not found' };
    const receipt = await client.query<{ fields: ReviewedEnrichmentField[] }>(
      'SELECT fields FROM enrichment_apply_receipts WHERE quote_id=$1 AND contact_id=$2', [quoteId, contactId]);
    if (receipt.rows[0]) return JSON.stringify(receipt.rows[0].fields) === JSON.stringify(selected)
      ? { state: 'replayed', appliedFields: selected.map(item => item.field) }
      : { state: 'conflict', error: 'This preview was already applied with a different field selection' };

    const data = quote.rows[0].response?.data;
    const saved = Array.isArray(data) ? data.find(item => item?.contactId === contactId) : null;
    if (!saved || !Array.isArray(saved.delta)) {
      return { state: 'conflict', error: 'No saved paid preview exists for this contact' };
    }
    const review = new Map<string, { oldValue: string | null; newValue: string }>();
    for (const item of saved.delta) {
      if (typeof item?.field === 'string' && Object.hasOwn(FIELD_TO_COLUMN, item.field)
        && (item.oldValue === null || typeof item.oldValue === 'string')
        && typeof item.newValue === 'string') {
        review.set(item.field, { oldValue: item.oldValue, newValue: item.newValue });
      }
    }
    if (selected.some(item => review.get(item.field)?.newValue !== item.value)) {
      return { state: 'conflict', error: 'Fields must exactly match the saved paid preview' };
    }

    const contact = await client.query<ContactIdentityRow & Record<string, unknown>>(
      'SELECT * FROM contacts WHERE id=$1 FOR UPDATE', [contactId]);
    const current = contact.rows[0];
    if (!current) return { state: 'missing', error: 'Contact not found' };
    if (current.is_archived || (selected.some(item => item.field === 'linkedin_url') && typeof current.linkedin_url === 'string'
      && /^self:/i.test(current.linkedin_url))) {
      return { state: 'conflict', error: 'Contact is no longer eligible for enrichment apply' };
    }
    for (const item of selected) {
      const column = FIELD_TO_COLUMN[item.field];
      const raw = current[column];
      const observed = isEffectivelyEmpty(raw) ? null : String(raw);
      if (observed !== review.get(item.field)?.oldValue) {
        return { state: 'conflict', error: `Contact ${item.field} changed since preview; review a new preview` };
      }
    }

    const clauses: string[] = [];
    const values: unknown[] = [];
    for (const item of selected) {
      const column = FIELD_TO_COLUMN[item.field];
      let value: unknown = item.value;
      if (item.field === 'tags') value = item.value.split(',').map(tag => tag.trim()).filter(Boolean);
      if (item.field === 'connections_count') {
        const parsed = Number(item.value);
        if (!Number.isSafeInteger(parsed) || parsed < 0) {
          return { state: 'conflict', error: 'Invalid saved connections count' };
        }
        value = parsed;
      }
      values.push(value);
      clauses.push(`${column}=$${values.length}`);
    }
    values.push(contactId);
    const updated = await client.query<ContactIdentityRow>(
      `UPDATE contacts SET ${clauses.join(', ')} WHERE id=$${values.length} AND is_archived=FALSE RETURNING *`, values);
    if (!updated.rows[0]) return { state: 'conflict', error: 'Contact is no longer eligible for enrichment apply' };
    if (selected.some(item => item.field === 'linkedin_url')) {
      await reconcileContactIdentity(client, contactId, updated.rows[0]);
    }
    await client.query(`INSERT INTO enrichment_apply_receipts (quote_id, contact_id, fields)
      VALUES ($1,$2,$3::jsonb)`, [quoteId, contactId, JSON.stringify(selected)]);
    return { state: 'applied', appliedFields: selected.map(item => item.field) };
  });
}
