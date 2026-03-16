// Contact upsert from parsed profile data
// Inserts or updates contacts based on LinkedIn URL matching
// Uses confidence-based field merging (higher confidence wins)

import { transaction } from '@/lib/db/client';
import type { ProfileParseData } from './types';

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
  // Normalize the LinkedIn URL
  const normalizedUrl = linkedinUrl
    .replace(/\?.*$/, '') // Remove query params
    .replace(/\/$/, ''); // Remove trailing slash

  return transaction(async (client) => {
    // Check if contact exists
    const existing = await client.query<{
      id: string;
      full_name: string;
      headline: string | null;
      location: string | null;
      company: string | null;
      about: string | null;
    }>(
      `SELECT id, full_name, headline, location, company, about
       FROM contacts
       WHERE linkedin_url LIKE $1
       LIMIT 1`,
      [`%${normalizedUrl.replace('https://', '').replace('http://', '')}%`]
    );

    if (existing.rows.length > 0) {
      // Update existing contact
      const contact = existing.rows[0];
      const fieldsUpdated: string[] = [];
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      // Update name if we have a better one
      if (profileData.name && (!contact.full_name || confidence > 0.7)) {
        updates.push(`full_name = $${paramIdx++}`);
        values.push(profileData.name);
        fieldsUpdated.push('full_name');
      }

      // Update headline
      if (profileData.headline && (!contact.headline || confidence > 0.7)) {
        updates.push(`headline = $${paramIdx++}`);
        values.push(profileData.headline);
        fieldsUpdated.push('headline');
      }

      // Update location
      if (profileData.location && (!contact.location || confidence > 0.7)) {
        updates.push(`location = $${paramIdx++}`);
        values.push(profileData.location);
        fieldsUpdated.push('location');
      }

      // Update about
      if (profileData.about && (!contact.about || confidence > 0.7)) {
        updates.push(`about = $${paramIdx++}`);
        values.push(profileData.about);
        fieldsUpdated.push('about');
      }

      // Update company from current experience
      const currentJob = profileData.experience.find((e) => e.isCurrent);
      if (currentJob && (!contact.company || confidence > 0.7)) {
        updates.push(`company = $${paramIdx++}`);
        values.push(currentJob.company);
        fieldsUpdated.push('company');

        updates.push(`title = $${paramIdx++}`);
        values.push(currentJob.title);
        fieldsUpdated.push('title');
      }

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
          [
            contact.id,
            exp.company,
            exp.title,
            exp.startDate,
            exp.endDate,
            exp.isCurrent,
            exp.description,
          ]
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
               start_year = COALESCE(EXCLUDED.start_year, education.start_year),
               end_year = COALESCE(EXCLUDED.end_year, education.end_year),
               updated_at = now()`,
          [
            contact.id,
            edu.school,
            edu.degree,
            edu.fieldOfStudy,
            edu.startYear,
            edu.endYear,
          ]
        );
      }

      return {
        contactId: contact.id,
        isNew: false,
        fieldsUpdated,
      };
    } else {
      // Insert new contact
      const currentJob = profileData.experience.find((e) => e.isCurrent);

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO contacts (
          full_name, headline, location, company, title, about,
          linkedin_url, source, connection_degree
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'extension_capture', '2nd')
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

      // Insert work history
      for (const exp of profileData.experience) {
        await client.query(
          `INSERT INTO work_history (contact_id, company_name, title, start_date, end_date, is_current, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING`,
          [
            contactId,
            exp.company,
            exp.title,
            exp.startDate,
            exp.endDate,
            exp.isCurrent,
            exp.description,
          ]
        );
      }

      // Insert education
      for (const edu of profileData.education) {
        await client.query(
          `INSERT INTO education (contact_id, school, degree, field_of_study, start_year, end_year)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            contactId,
            edu.school,
            edu.degree,
            edu.fieldOfStudy,
            edu.startYear,
            edu.endYear,
          ]
        );
      }

      return {
        contactId,
        isNew: true,
        fieldsUpdated: [
          'full_name',
          'headline',
          'location',
          'company',
          'title',
          'about',
          'linkedin_url',
        ],
      };
    }
  });
}
