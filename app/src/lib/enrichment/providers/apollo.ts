// Apollo.io enrichment provider (person matching via People API)

import {
  EnrichmentProvider,
  EnrichmentContact,
  EnrichmentResult,
  EnrichmentField,
} from '../types';

export class ApolloProvider implements EnrichmentProvider {
  readonly name = 'apollo';
  readonly displayName = 'Apollo.io';
  readonly capabilities = ['email', 'phone', 'social', 'employment'];
  readonly costPerLookupCents = 8;

  private apiKey: string | null;
  private baseUrl: string;

  constructor(config: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = config.apiKey || process.env.APOLLO_API_KEY || null;
    this.baseUrl = config.baseUrl || 'https://api.apollo.io/api/v1';
  }

  async enrich(contact: EnrichmentContact): Promise<EnrichmentResult> {
    if (!this.apiKey) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'Apollo API key not configured',
      };
    }

    try {
      const body: Record<string, string> = {};
      if (contact.linkedinUrl) body.linkedin_url = contact.linkedinUrl;
      if (contact.email) body.email = contact.email;
      if (contact.firstName) body.first_name = contact.firstName;
      if (contact.lastName) body.last_name = contact.lastName;
      if (contact.currentCompany) body.organization_name = contact.currentCompany;

      const response = await fetch(`${this.baseUrl}/people/match`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return {
          providerId: this.name,
          providerName: this.displayName,
          success: false,
          fields: [],
          costCents: response.status === 404 ? 0 : this.costPerLookupCents,
          error: `Apollo API error: ${response.status}`,
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

  // Apollo can return boolean flags for fields that require a higher tier.
  // Only accept actual string/number values.
  private isRealValue(v: unknown): v is string | number {
    if (typeof v === 'boolean') return false;
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && (v.trim() === '' || v === 'true' || v === 'false')) return false;
    return true;
  }

  private mapResponse(data: Record<string, unknown>): EnrichmentField[] {
    // Apollo wraps person data in a "person" key
    const person = (data.person as Record<string, unknown>) ?? data;
    const fields: EnrichmentField[] = [];

    // Email
    if (this.isRealValue(person.email)) {
      fields.push({ field: 'email', value: String(person.email), confidence: 0.9 });
    }

    // Company
    const org = person.organization as Record<string, unknown> | undefined;
    if (org && this.isRealValue(org.name)) {
      fields.push({ field: 'current_company', value: String(org.name), confidence: 0.9 });
    }

    // Title
    if (this.isRealValue(person.title)) {
      fields.push({ field: 'title', value: String(person.title), confidence: 0.9 });
    }

    // Location (compose from city, state, country)
    const locationParts = [person.city, person.state, person.country]
      .filter((v) => this.isRealValue(v))
      .map(String);
    if (locationParts.length > 0) {
      fields.push({ field: 'location', value: locationParts.join(', '), confidence: 0.8 });
    }

    // Phone
    const phoneNumbers = person.phone_numbers as Array<Record<string, unknown>> | undefined;
    if (phoneNumbers && Array.isArray(phoneNumbers) && phoneNumbers.length > 0) {
      const sanitized = phoneNumbers[0].sanitized_number;
      if (this.isRealValue(sanitized)) {
        fields.push({ field: 'phone', value: String(sanitized), confidence: 0.8 });
      }
    }

    // Headline
    if (this.isRealValue(person.headline)) {
      fields.push({ field: 'headline', value: String(person.headline), confidence: 0.9 });
    }

    // LinkedIn URL
    if (this.isRealValue(person.linkedin_url)) {
      fields.push({ field: 'linkedin_url', value: String(person.linkedin_url), confidence: 0.95 });
    }

    return fields;
  }
}
