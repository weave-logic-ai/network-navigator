// People Data Labs enrichment provider

import {
  EnrichmentProvider,
  EnrichmentContact,
  EnrichmentResult,
  EnrichmentField,
} from '../types';

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
      const fields = this.mapResponse(data);

      return {
        providerId: this.name,
        providerName: this.displayName,
        success: true,
        fields,
        costCents: this.costPerLookupCents,
        rawResponse: data,
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

  private mapResponse(data: Record<string, unknown>): EnrichmentField[] {
    const fields: EnrichmentField[] = [];

    if (data.work_email) {
      fields.push({ field: 'email', value: data.work_email as string, confidence: 0.9 });
    } else if (data.personal_emails && Array.isArray(data.personal_emails) && data.personal_emails.length > 0) {
      fields.push({ field: 'email', value: data.personal_emails[0], confidence: 0.7 });
    }

    if (data.mobile_phone) {
      fields.push({ field: 'phone', value: data.mobile_phone as string, confidence: 0.8 });
    }

    if (data.job_title) {
      fields.push({ field: 'title', value: data.job_title as string, confidence: 0.9 });
    }

    if (data.job_company_name) {
      fields.push({ field: 'current_company', value: data.job_company_name as string, confidence: 0.9 });
    }

    if (data.location_name) {
      fields.push({ field: 'location', value: data.location_name as string, confidence: 0.8 });
    }

    if (data.industry) {
      fields.push({ field: 'industry', value: data.industry as string, confidence: 0.8 });
    }

    return fields;
  }
}
