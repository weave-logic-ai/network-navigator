// Crunchbase enrichment provider (company/organization data via Organizations API)

import {
  EnrichmentProvider,
  EnrichmentContact,
  EnrichmentResult,
  EnrichmentField,
} from '../types';

export class CrunchbaseProvider implements EnrichmentProvider {
  readonly name = 'crunchbase';
  readonly displayName = 'Crunchbase';
  readonly capabilities = ['company', 'funding', 'leadership'];
  readonly costPerLookupCents = 20;

  private apiKey: string | null;
  private baseUrl: string;

  constructor(config: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = config.apiKey || process.env.CRUNCHBASE_API_KEY || null;
    this.baseUrl = config.baseUrl || 'https://api.crunchbase.com/api/v4';
  }

  async enrich(contact: EnrichmentContact): Promise<EnrichmentResult> {
    if (!this.apiKey) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'Crunchbase API key not configured',
      };
    }

    // Crunchbase enriches companies, not people — need a company name to look up
    if (!contact.currentCompany) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'Company name required for Crunchbase enrichment',
      };
    }

    try {
      // Convert company name to a permalink slug (lowercase, hyphens)
      const permalink = contact.currentCompany
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const url = `${this.baseUrl}/entities/organizations/${encodeURIComponent(permalink)}?user_key=${encodeURIComponent(this.apiKey)}&field_ids=short_description,num_employees_enum,founded_on,categories,funding_total,last_funding_type,identifier`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return {
          providerId: this.name,
          providerName: this.displayName,
          success: false,
          fields: [],
          costCents: response.status === 404 ? 0 : this.costPerLookupCents,
          error: `Crunchbase API error: ${response.status}`,
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

  // Only accept actual string/number values — reject booleans and empties
  private isRealValue(v: unknown): v is string | number {
    if (typeof v === 'boolean') return false;
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && (v.trim() === '' || v === 'true' || v === 'false')) return false;
    return true;
  }

  private mapResponse(data: Record<string, unknown>): EnrichmentField[] {
    // Crunchbase wraps entity data in properties
    const properties = (data.properties as Record<string, unknown>) ?? data;
    const fields: EnrichmentField[] = [];

    // Company name from identifier
    const identifier = properties.identifier as Record<string, unknown> | undefined;
    if (identifier && this.isRealValue(identifier.value)) {
      fields.push({ field: 'current_company', value: String(identifier.value), confidence: 0.95 });
    }

    // Short description → headline (company description)
    if (this.isRealValue(properties.short_description)) {
      fields.push({ field: 'headline', value: String(properties.short_description), confidence: 0.8 });
    }

    // Industry from categories
    const categories = properties.categories as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(categories) && categories.length > 0) {
      const categoryNames = categories
        .map(c => c.value ?? c.name)
        .filter(v => this.isRealValue(v))
        .map(String);
      if (categoryNames.length > 0) {
        fields.push({ field: 'industry', value: categoryNames[0], confidence: 0.8 });
      }
    }

    // Founded year
    if (this.isRealValue(properties.founded_on)) {
      fields.push({ field: 'founded_on', value: String(properties.founded_on), confidence: 0.9 });
    }

    // Employee count enum
    if (this.isRealValue(properties.num_employees_enum)) {
      fields.push({ field: 'company_size', value: String(properties.num_employees_enum), confidence: 0.8 });
    }

    // Total funding
    const fundingTotal = properties.funding_total as Record<string, unknown> | undefined;
    if (fundingTotal && this.isRealValue(fundingTotal.value_usd)) {
      fields.push({ field: 'total_funding', value: String(fundingTotal.value_usd), confidence: 0.9 });
    } else if (this.isRealValue(properties.funding_total)) {
      fields.push({ field: 'total_funding', value: String(properties.funding_total), confidence: 0.9 });
    }

    // Last funding type
    if (this.isRealValue(properties.last_funding_type)) {
      fields.push({ field: 'last_funding_type', value: String(properties.last_funding_type), confidence: 0.9 });
    }

    return fields;
  }
}
