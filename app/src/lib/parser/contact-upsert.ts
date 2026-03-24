// Contact upsert from parsed profile and search data
// Inserts or updates contacts based on LinkedIn URL matching

import { query, transaction } from '@/lib/db/client';
import { triggerAutoScore } from '@/lib/scoring/auto-score';
import type { ProfileParseData, SearchResultEntry } from './types';

interface UpsertResult {
  contactId: string;
  isNew: boolean;
  fieldsUpdated: string[];
}

/**
 * Upsert a contact from parsed profile data.
 * If the contact exists (matched by LinkedIn URL), updates fields where
 * the new data has higher confidence or fills in missing fields.
 */
export async function upsertContactFromProfile(
  profileData: ProfileParseData,
  linkedinUrl: string,
  confidence: number
): Promise<UpsertResult> {
  const normalizedUrl = linkedinUrl
    .replace(/\?.*$/, '')
    .replace(/\/$/, '');

  const result = await transaction(async (client) => {
    const existing = await client.query<{
      id: string;
      full_name: string;
      headline: string | null;
      location: string | null;
      current_company: string | null;
      about: string | null;
    }>(
      `SELECT id, full_name, headline, location, current_company, about
       FROM contacts
       WHERE linkedin_url LIKE $1
       LIMIT 1`,
      [`%${normalizedUrl.replace('https://', '').replace('http://', '')}%`]
    );

    if (existing.rows.length > 0) {
      const contact = existing.rows[0];
      const fieldsUpdated: string[] = [];
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (profileData.name && (!contact.full_name || confidence > 0.7)) {
        updates.push(`full_name = $${paramIdx++}`);
        values.push(profileData.name);
        fieldsUpdated.push('full_name');
      }

      if (profileData.headline && (!contact.headline || confidence > 0.7)) {
        updates.push(`headline = $${paramIdx++}`);
        values.push(profileData.headline);
        fieldsUpdated.push('headline');
      }

      if (profileData.location && (!contact.location || confidence > 0.7)) {
        updates.push(`location = $${paramIdx++}`);
        values.push(profileData.location);
        fieldsUpdated.push('location');
      }

      if (profileData.about && (!contact.about || confidence > 0.7)) {
        updates.push(`about = $${paramIdx++}`);
        values.push(profileData.about);
        fieldsUpdated.push('about');
      }

      const currentJob = profileData.experience.find((e) => e.isCurrent);
      if (currentJob && (!contact.current_company || confidence > 0.7)) {
        updates.push(`current_company = $${paramIdx++}`);
        values.push(currentJob.company);
        fieldsUpdated.push('current_company');

        updates.push(`title = $${paramIdx++}`);
        values.push(currentJob.title);
        fieldsUpdated.push('title');
      }

      // Add discovered_via if not already present
      updates.push(`discovered_via = array_cat(COALESCE(discovered_via, '{}'), $${paramIdx++})`);
      values.push(['extension_profile']);

      if (updates.length > 0) {
        updates.push(`updated_at = now()`);
        values.push(contact.id);

        await client.query(
          `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          values
        );
      }

      // Upsert work history
      for (const exp of profileData.experience) {
        await client.query(
          `INSERT INTO work_history (contact_id, company_name, title, start_date, end_date, is_current, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (contact_id, company_name, title) DO UPDATE
           SET start_date = COALESCE(EXCLUDED.start_date, work_history.start_date),
               end_date = COALESCE(EXCLUDED.end_date, work_history.end_date),
               is_current = EXCLUDED.is_current,
               description = COALESCE(EXCLUDED.description, work_history.description),
               updated_at = now()`,
          [contact.id, exp.company, exp.title, exp.startDate, exp.endDate, exp.isCurrent, exp.description]
        );
      }

      // Upsert education
      for (const edu of profileData.education) {
        await client.query(
          `INSERT INTO education (contact_id, school, degree, field_of_study, start_year, end_year)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (contact_id, school) DO UPDATE
           SET degree = COALESCE(EXCLUDED.degree, education.degree),
               field_of_study = COALESCE(EXCLUDED.field_of_study, education.field_of_study),
               updated_at = now()`,
          [contact.id, edu.school, edu.degree, edu.fieldOfStudy, edu.startYear, edu.endYear]
        );
      }

      return { contactId: contact.id, isNew: false, fieldsUpdated };
    } else {
      // Insert new contact
      const currentJob = profileData.experience.find((e) => e.isCurrent);

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO contacts (
          full_name, headline, location, current_company, title, about,
          linkedin_url, degree, discovered_via
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 2, ARRAY['extension_profile'])
        RETURNING id`,
        [
          profileData.name ?? 'Unknown',
          profileData.headline,
          profileData.location,
          currentJob?.company ?? null,
          currentJob?.title ?? null,
          profileData.about,
          normalizedUrl,
        ]
      );

      const contactId = insertResult.rows[0].id;

      for (const exp of profileData.experience) {
        await client.query(
          `INSERT INTO work_history (contact_id, company_name, title, start_date, end_date, is_current, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING`,
          [contactId, exp.company, exp.title, exp.startDate, exp.endDate, exp.isCurrent, exp.description]
        );
      }

      for (const edu of profileData.education) {
        await client.query(
          `INSERT INTO education (contact_id, school, degree, field_of_study, start_year, end_year)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [contactId, edu.school, edu.degree, edu.fieldOfStudy, edu.startYear, edu.endYear]
        );
      }

      return {
        contactId,
        isNew: true,
        fieldsUpdated: ['full_name', 'headline', 'location', 'current_company', 'title', 'about', 'linkedin_url'],
      };
    }
  });

  triggerAutoScore(result.contactId);
  return result;
}

/**
 * Upsert contacts from parsed search results.
 * Creates new contacts or updates existing ones matched by LinkedIn URL.
 * Returns count of created and updated contacts.
 */
export async function upsertContactsFromSearch(
  results: SearchResultEntry[],
  sourceUrl: string
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of results) {
    if (!entry.profileUrl) {
      skipped++;
      continue;
    }

    // Normalize LinkedIn profile URL
    const normalizedUrl = entry.profileUrl
      .replace(/\?.*$/, '')
      .replace(/\/$/, '');

    // Extract the /in/slug part for matching
    const slugMatch = normalizedUrl.match(/\/in\/([^/]+)/);
    if (!slugMatch) {
      skipped++;
      continue;
    }

    const slug = slugMatch[1];

    try {
      // Check if contact already exists
      const existing = await query<{ id: string; full_name: string | null }>(
        `SELECT id, full_name FROM contacts WHERE linkedin_url LIKE $1 LIMIT 1`,
        [`%/in/${slug}%`]
      );

      if (existing.rows.length > 0) {
        // Update with any new info from search results
        const contact = existing.rows[0];
        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (entry.name && !contact.full_name) {
          updates.push(`full_name = $${idx++}`);
          values.push(entry.name);
        }

        if (entry.headline) {
          updates.push(`headline = COALESCE(headline, $${idx++})`);
          values.push(entry.headline);
        }

        if (entry.location) {
          updates.push(`location = COALESCE(location, $${idx++})`);
          values.push(entry.location);
        }

        // Ensure discovered_via includes extension_search
        updates.push(`discovered_via = CASE WHEN NOT (discovered_via @> ARRAY['extension_search']) THEN array_append(COALESCE(discovered_via, '{}'), 'extension_search') ELSE discovered_via END`);

        if (updates.length > 0) {
          values.push(contact.id);
          await query(
            `UPDATE contacts SET ${updates.join(', ')}, updated_at = now() WHERE id = $${idx}`,
            values
          );
        }
        updated++;
      } else {
        // Parse name into first/last
        const nameParts = (entry.name || 'Unknown').split(' ');
        const firstName = nameParts[0] || null;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

        // Determine degree from search result
        const degree = entry.connectionDegree === '1st' ? 1
          : entry.connectionDegree === '2nd' ? 2
          : entry.connectionDegree === '3rd' ? 3
          : 2; // Default to 2nd degree for search results

        await query(
          `INSERT INTO contacts (
            linkedin_url, full_name, first_name, last_name,
            headline, location, degree, discovered_via
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, ARRAY['extension_search'])
          ON CONFLICT (linkedin_url) DO NOTHING`,
          [
            `https://www.linkedin.com/in/${slug}`,
            entry.name || 'Unknown',
            firstName,
            lastName,
            entry.headline,
            entry.location,
            degree,
          ]
        );
        created++;
      }
    } catch {
      skipped++;
    }
  }

  return { created, updated, skipped };
}
