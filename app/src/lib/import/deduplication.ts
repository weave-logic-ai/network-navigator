// Deduplication engine: SHA-256 hash, field-level diff, job change detection, never-delete

import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { DedupResult, FieldChange } from './types';

export function computeDedupHash(
  linkedinUrl: string,
  fullName: string,
  title: string,
  companyName: string
): string {
  const input = [linkedinUrl, fullName, title, companyName]
    .map((s) => (s || '').toLowerCase().trim())
    .join('|');
  return createHash('sha256').update(input).digest('hex');
}

interface IncomingContact {
  linkedinUrl: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  title?: string;
  currentCompany?: string;
  currentCompanyId?: string;
  location?: string;
  about?: string;
  email?: string;
  phone?: string;
  tags?: string[];
}

interface ExistingContact {
  id: string;
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  headline: string | null;
  title: string | null;
  current_company: string | null;
  current_company_id: string | null;
  location: string | null;
  about: string | null;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  dedup_hash: string | null;
}

const FIELD_MAP: Record<string, keyof IncomingContact> = {
  first_name: 'firstName',
  last_name: 'lastName',
  full_name: 'fullName',
  headline: 'headline',
  title: 'title',
  current_company: 'currentCompany',
  current_company_id: 'currentCompanyId',
  location: 'location',
  about: 'about',
  email: 'email',
  phone: 'phone',
};

function computeFieldDiff(
  existing: ExistingContact,
  incoming: IncomingContact
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [dbField, tsField] of Object.entries(FIELD_MAP)) {
    const oldVal = existing[dbField as keyof ExistingContact];
    const newVal = incoming[tsField];

    // Only overwrite if incoming value is non-null/non-empty
    if (newVal !== undefined && newVal !== null && newVal !== '' && newVal !== oldVal) {
      changes.push({ field: dbField, oldValue: oldVal, newValue: newVal });
    }
  }

  return changes;
}

function isJobChange(changes: FieldChange[]): boolean {
  return changes.some(
    (c) => c.field === 'title' || c.field === 'current_company'
  );
}

export async function deduplicateContact(
  client: PoolClient,
  incoming: IncomingContact
): Promise<DedupResult> {
  // Check existing contacts by linkedin_url (primary dedup key)
  const existingResult = await client.query<ExistingContact>(
    `SELECT id, linkedin_url, first_name, last_name, full_name, headline, title,
            current_company, current_company_id, location, about, email, phone,
            tags, dedup_hash
     FROM contacts WHERE linkedin_url = $1`,
    [incoming.linkedinUrl]
  );

  const dedupHash = computeDedupHash(
    incoming.linkedinUrl,
    incoming.fullName || '',
    incoming.title || '',
    incoming.currentCompany || ''
  );

  if (existingResult.rows.length === 0) {
    // New contact: insert
    const insertResult = await client.query(
      `INSERT INTO contacts (
        linkedin_url, first_name, last_name, full_name, headline, title,
        current_company, current_company_id, location, about, email, phone,
        tags, dedup_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id`,
      [
        incoming.linkedinUrl,
        incoming.firstName || null,
        incoming.lastName || null,
        incoming.fullName || null,
        incoming.headline || null,
        incoming.title || null,
        incoming.currentCompany || null,
        incoming.currentCompanyId || null,
        incoming.location || null,
        incoming.about || null,
        incoming.email || null,
        incoming.phone || null,
        incoming.tags || [],
        dedupHash,
      ]
    );

    return {
      action: 'created',
      contactId: insertResult.rows[0].id,
      changes: [],
      isJobChange: false,
    };
  }

  const existing = existingResult.rows[0];

  // Check if the dedup hash is the same (no changes)
  if (existing.dedup_hash === dedupHash) {
    return {
      action: 'skipped',
      contactId: existing.id,
      changes: [],
      isJobChange: false,
    };
  }

  // Compute field-level diff
  const changes = computeFieldDiff(existing, incoming);

  if (changes.length === 0) {
    // Hash changed but no meaningful field changes (e.g., normalization difference)
    // Update hash only
    await client.query(
      'UPDATE contacts SET dedup_hash = $1 WHERE id = $2',
      [dedupHash, existing.id]
    );
    return {
      action: 'skipped',
      contactId: existing.id,
      changes: [],
      isJobChange: false,
    };
  }

  // Apply updates: only non-null incoming fields overwrite
  const setClauses: string[] = ['dedup_hash = $1'];
  const values: unknown[] = [dedupHash];
  let paramIdx = 2;

  for (const change of changes) {
    setClauses.push(`${change.field} = $${paramIdx}`);
    values.push(change.newValue);
    paramIdx++;
  }

  values.push(existing.id);
  await client.query(
    `UPDATE contacts SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
    values
  );

  // Merge tags (append, don't replace)
  if (incoming.tags && incoming.tags.length > 0) {
    await client.query(
      `UPDATE contacts SET tags = (
        SELECT array_agg(DISTINCT t) FROM unnest(tags || $1::text[]) t
      ) WHERE id = $2`,
      [incoming.tags, existing.id]
    );
  }

  return {
    action: 'updated',
    contactId: existing.id,
    changes,
    isJobChange: isJobChange(changes),
  };
}

// Export for testing
export { computeFieldDiff, isJobChange };
