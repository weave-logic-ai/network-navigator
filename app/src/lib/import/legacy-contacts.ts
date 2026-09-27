import type { PoolClient } from 'pg';
import { reconcileContactIdentity } from '../contacts/identity-lifecycle';
import type { ContactIdentityRow } from '../contacts/identity';

interface LegacyContactIdentityInput {
  name: string;
  enrichedName?: string;
  companyId?: string;
  headline?: string;
  currentRole?: string;
  title?: string;
  currentCompany?: string;
  enrichedLocation?: string;
  location?: string;
  about?: string;
  mutualConnections?: number;
  degree: number;
  discoveredVia?: string[];
  tags?: string[];
}

export async function importLegacyContacts(
  client: PoolClient,
  contacts: Record<string, LegacyContactIdentityInput>,
  companyMap: Map<string, string>
): Promise<{ urlToUuid: Map<string, string>; importedIds: string[] }> {
  const urlToUuid = new Map<string, string>();
  const importedIds: string[] = [];

  for (const [url, contact] of Object.entries(contacts)) {
    const fullName = (contact.enrichedName || contact.name || '').trim();
    const parts = fullName.split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ');
    const companyUuid = contact.companyId ? companyMap.get(contact.companyId) : null;

    const prior = await client.query<ContactIdentityRow>(
      `SELECT full_name, first_name, last_name, linkedin_url, degree, is_archived
       FROM contacts WHERE linkedin_url = $1`, [url]
    );

    const result = await client.query<ContactIdentityRow & { id: string }>(
      `INSERT INTO contacts (
        linkedin_url, first_name, last_name, full_name,
        headline, title, current_company, current_company_id,
        location, about, connections_count, degree,
        discovered_via, tags, is_archived
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (linkedin_url) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name,''), contacts.full_name),
        first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
        last_name = COALESCE(NULLIF(EXCLUDED.last_name,''), contacts.last_name),
        headline = COALESCE(NULLIF(EXCLUDED.headline,''), contacts.headline),
        title = COALESCE(NULLIF(EXCLUDED.title,''), contacts.title),
        current_company = COALESCE(NULLIF(EXCLUDED.current_company,''), contacts.current_company),
        current_company_id = COALESCE(EXCLUDED.current_company_id, contacts.current_company_id),
        location = COALESCE(NULLIF(EXCLUDED.location,''), contacts.location),
        about = COALESCE(NULLIF(EXCLUDED.about,''), contacts.about),
        connections_count = COALESCE(EXCLUDED.connections_count, contacts.connections_count),
        degree = EXCLUDED.degree,
        discovered_via = EXCLUDED.discovered_via,
        tags = EXCLUDED.tags
      RETURNING id, full_name, first_name, last_name, linkedin_url, degree, is_archived`,
      [
        url, firstName, lastName, fullName,
        contact.headline || contact.currentRole || null,
        contact.title || contact.currentRole || null,
        contact.currentCompany || null, companyUuid || null,
        contact.enrichedLocation || contact.location || null,
        contact.about || null, contact.mutualConnections || null,
        contact.degree || 1, contact.discoveredVia || [], contact.tags || [], false,
      ]
    );

    const contactId = result.rows[0].id;
    const previous = prior.rows[0];
    const current = result.rows[0];
    if (previous && ['full_name', 'first_name', 'last_name', 'degree', 'is_archived']
      .some((field) => previous[field as keyof ContactIdentityRow] !== current[field as keyof ContactIdentityRow])) {
      await reconcileContactIdentity(client, contactId, current);
    }
    urlToUuid.set(url, contactId);
    importedIds.push(contactId);
  }

  return { urlToUuid, importedIds };
}
