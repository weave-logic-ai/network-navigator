// People Data Labs enrichment provider
//
// PDL has two tiers:
// - Person Starter (base): returns true/false flags for premium fields
//   (email, phone, location). Returns actual text for job, company, skills, etc.
// - Person (full): returns actual values for ALL fields.
//   5 free lookups/month on starter. $110/month for 200 full lookups.
//
// Fields gated behind Person tier (return boolean on Starter):
//   work_email, personal_emails, recommended_personal_email,
//   mobile_phone, phone_numbers, emails,
//   location_name, location_locality, location_region, location_geo,
//   location_street_address, location_postal_code,
//   birth_year, birth_date, street_addresses.*

import {
  EnrichmentProvider,
  EnrichmentContact,
  EnrichmentResult,
  EnrichmentField,
} from '../types';

// Fields that return true/false on Person Starter tier instead of actual values
const PREMIUM_GATED_FIELDS = new Set([
  'work_email', 'personal_emails', 'recommended_personal_email',
  'mobile_phone', 'phone_numbers', 'emails',
  'location_name', 'location_locality', 'location_region',
  'location_metro', 'location_country', 'location_continent',
  'location_street_address', 'location_address_line_2',
  'location_postal_code', 'location_geo', 'location_names',
  'birth_year', 'birth_date',
]);

export class PdlProvider implements EnrichmentProvider {
  readonly name = 'pdl';
  readonly displayName = 'People Data Labs';
  readonly capabilities = ['email', 'phone', 'social', 'employment', 'education'];
  readonly costPerLookupCents = 10;

  private apiKey: string | null;
  private baseUrl: string;

  constructor(config: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = config.apiKey || process.env.PDL_API_KEY || null;
    this.baseUrl = config.baseUrl || 'https://api.peopledatalabs.com/v5';
  }

  async enrich(contact: EnrichmentContact): Promise<EnrichmentResult> {
    if (!this.apiKey) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'PDL API key not configured',
      };
    }

    try {
      const params = new URLSearchParams();
      if (contact.linkedinUrl) params.set('profile', contact.linkedinUrl);
      if (contact.email) params.set('email', contact.email);
      if (contact.fullName) params.set('name', contact.fullName);
      if (contact.currentCompany) params.set('company', contact.currentCompany);

      const response = await fetch(`${this.baseUrl}/person/enrich?${params}`, {
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          providerId: this.name,
          providerName: this.displayName,
          success: false,
          fields: [],
          costCents: response.status === 404 ? 0 : this.costPerLookupCents,
          error: `PDL API error: ${response.status}`,
        };
      }

      const data = await response.json();
      const { fields, gatedFields } = this.mapResponse(data);

      return {
        providerId: this.name,
        providerName: this.displayName,
        success: true,
        fields,
        costCents: this.costPerLookupCents,
        rawResponse: { ...data, _gatedFields: gatedFields },
      };
    } catch (error) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  estimateCost(contacts: EnrichmentContact[]): number {
    return contacts.length * this.costPerLookupCents;
  }

  async checkBalance(): Promise<{ available: boolean; remaining?: number }> {
    if (!this.apiKey) return { available: false };
    return { available: true };
  }

  // Check if a PDL field value is a boolean flag (tier-gated, not real data)
  private isGatedFlag(key: string, v: unknown): boolean {
    return PREMIUM_GATED_FIELDS.has(key) && typeof v === 'boolean';
  }

  // PDL returns boolean `true` for fields where data exists but isn't included
  // at your API tier. Only accept actual string/number values.
  private isRealValue(v: unknown): v is string | number {
    if (typeof v === 'boolean') return false;
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && (v.trim() === '' || v === 'true' || v === 'false')) return false;
    return true;
  }

  private mapResponse(response: Record<string, unknown>): { fields: EnrichmentField[]; gatedFields: string[] } {
    // PDL wraps person data in a "data" key: { status: 200, data: { ... } }
    const data = (response.data as Record<string, unknown>) ?? response;
    const fields: EnrichmentField[] = [];

    // Track which fields PDL has data for but are gated behind Person tier
    const gatedFields: string[] = [];
    for (const key of PREMIUM_GATED_FIELDS) {
      if (this.isGatedFlag(key, data[key])) {
        gatedFields.push(key);
      }
    }

    // Email
    if (this.isRealValue(data.work_email)) {
      fields.push({ field: 'email', value: String(data.work_email), confidence: 0.9 });
    } else if (this.isRealValue(data.recommended_personal_email)) {
      fields.push({ field: 'email', value: String(data.recommended_personal_email), confidence: 0.8 });
    } else if (data.personal_emails && Array.isArray(data.personal_emails)) {
      const firstReal = data.personal_emails.find((e: unknown) => this.isRealValue(e));
      if (firstReal) {
        fields.push({ field: 'email', value: String(firstReal), confidence: 0.7 });
      }
    }

    // Phone
    if (this.isRealValue(data.mobile_phone)) {
      fields.push({ field: 'phone', value: String(data.mobile_phone), confidence: 0.8 });
    } else if (data.phone_numbers && Array.isArray(data.phone_numbers) && data.phone_numbers.length > 0) {
      // PDL returns phone_numbers as array of strings (E.164) or objects with number/E164
      const raw = data.phone_numbers[0];
      let phone: string | null = null;
      if (typeof raw === 'string' && this.isRealValue(raw)) {
        phone = raw;
      } else if (typeof raw === 'object' && raw !== null) {
        const obj = raw as Record<string, unknown>;
        const val = obj.number || obj.E164;
        if (this.isRealValue(val)) phone = String(val);
      }
      if (phone) {
        fields.push({ field: 'phone', value: phone, confidence: 0.7 });
      }
    }

    // Job title
    if (this.isRealValue(data.job_title)) {
      fields.push({ field: 'title', value: String(data.job_title), confidence: 0.9 });
    }

    // Company
    if (this.isRealValue(data.job_company_name)) {
      fields.push({ field: 'current_company', value: String(data.job_company_name), confidence: 0.9 });
    }

    // Location
    if (this.isRealValue(data.location_name)) {
      fields.push({ field: 'location', value: String(data.location_name), confidence: 0.8 });
    } else {
      const parts = [data.location_locality, data.location_region, data.location_country]
        .filter((v) => this.isRealValue(v))
        .map(String);
      if (parts.length > 0) {
        fields.push({ field: 'location', value: parts.join(', '), confidence: 0.7 });
      }
    }

    // Industry
    if (this.isRealValue(data.industry)) {
      fields.push({ field: 'industry', value: String(data.industry), confidence: 0.8 });
    } else if (this.isRealValue(data.job_company_industry)) {
      fields.push({ field: 'industry', value: String(data.job_company_industry), confidence: 0.7 });
    }

    // Headline / summary
    if (this.isRealValue(data.headline)) {
      fields.push({ field: 'headline', value: String(data.headline), confidence: 0.9 });
    }
    if (this.isRealValue(data.summary)) {
      fields.push({ field: 'about', value: String(data.summary), confidence: 0.8 });
    }

    // LinkedIn URL (may have a canonical version)
    if (this.isRealValue(data.linkedin_url)) {
      fields.push({ field: 'linkedin_url', value: String(data.linkedin_url), confidence: 0.95 });
    }

    // Skills
    if (data.skills && Array.isArray(data.skills) && data.skills.length > 0) {
      const skillNames = (data.skills as Array<unknown>)
        .map(s => {
          if (typeof s === 'string') return s;
          if (typeof s === 'object' && s !== null && 'name' in s) return String((s as {name: unknown}).name);
          return null;
        })
        .filter((s): s is string => s !== null && s !== '' && s !== 'true');
      if (skillNames.length > 0) {
        fields.push({ field: 'tags', value: skillNames.join(','), confidence: 0.7 });
      }
    }

    // Connections count
    if (this.isRealValue(data.linkedin_connections) && typeof data.linkedin_connections === 'number') {
      fields.push({ field: 'connections_count', value: String(data.linkedin_connections), confidence: 0.9 });
    }

    return { fields, gatedFields };
  }
}
