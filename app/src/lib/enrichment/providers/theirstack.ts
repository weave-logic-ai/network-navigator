// TheirStack enrichment provider (company technographics)

import {
  EnrichmentProvider,
  EnrichmentContact,
  EnrichmentResult,
  EnrichmentField,
} from '../types';

export class TheirStackProvider implements EnrichmentProvider {
  readonly name = 'theirstack';
  readonly displayName = 'TheirStack';
  readonly capabilities = ['technographics', 'company'];
  readonly costPerLookupCents = 5;

  private apiKey: string | null;
  private baseUrl: string;

  constructor(config: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = config.apiKey || process.env.THEIRSTACK_API_KEY || null;
    this.baseUrl = config.baseUrl || 'https://api.theirstack.com/v1';
  }

  async enrich(contact: EnrichmentContact): Promise<EnrichmentResult> {
    if (!this.apiKey) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'TheirStack API key not configured',
      };
    }

    if (!contact.currentCompany) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'Company name required for TheirStack lookup',
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/companies/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_name: contact.currentCompany,
        }),
      });

      if (!response.ok) {
        return {
          providerId: this.name,
          providerName: this.displayName,
          success: false,
          fields: [],
          costCents: response.status === 404 ? 0 : this.costPerLookupCents,
          error: `TheirStack API error: ${response.status}`,
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
    // Only count contacts with company names
    const withCompany = contacts.filter(c => c.currentCompany).length;
    return withCompany * this.costPerLookupCents;
  }

  async checkBalance(): Promise<{ available: boolean; remaining?: number }> {
    if (!this.apiKey) return { available: false };
    return { available: true };
  }

  private mapResponse(data: Record<string, unknown>): EnrichmentField[] {
    const fields: EnrichmentField[] = [];
    const companies = data.data as Array<Record<string, unknown>> | undefined;

    if (companies && companies.length > 0) {
      const company = companies[0];

      if (company.technologies && Array.isArray(company.technologies)) {
        fields.push({
          field: 'technographics',
          value: (company.technologies as string[]).join(', '),
          confidence: 0.85,
        });
      }

      if (company.industry) {
        fields.push({ field: 'industry', value: company.industry as string, confidence: 0.8 });
      }

      if (company.employee_count) {
        fields.push({ field: 'employee_count', value: company.employee_count as number, confidence: 0.7 });
      }

      if (company.website) {
        fields.push({ field: 'website', value: company.website as string, confidence: 0.9 });
      }
    }

    return fields;
  }
}
