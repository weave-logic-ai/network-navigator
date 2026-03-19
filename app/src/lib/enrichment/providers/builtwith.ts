// BuiltWith enrichment provider (technographics via domain lookup)

import {
  EnrichmentProvider,
  EnrichmentContact,
  EnrichmentResult,
  EnrichmentField,
} from '../types';

export class BuiltWithProvider implements EnrichmentProvider {
  readonly name = 'builtwith';
  readonly displayName = 'BuiltWith';
  readonly capabilities = ['technographics', 'website'];
  readonly costPerLookupCents = 12;

  private apiKey: string | null;
  private baseUrl: string;

  constructor(config: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = config.apiKey || process.env.BUILTWITH_API_KEY || null;
    this.baseUrl = config.baseUrl || 'https://api.builtwith.com/v21';
  }

  async enrich(contact: EnrichmentContact): Promise<EnrichmentResult> {
    if (!this.apiKey) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'BuiltWith API key not configured',
      };
    }

    // BuiltWith requires a domain to look up — derive from company name if possible
    if (!contact.currentCompany) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'Company data required for BuiltWith enrichment',
      };
    }

    try {
      // Attempt to derive domain from company name (simple heuristic)
      const domain = this.deriveDomain(contact.currentCompany);

      const url = `${this.baseUrl}/api.json?KEY=${encodeURIComponent(this.apiKey)}&LOOKUP=${encodeURIComponent(domain)}`;

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
          error: `BuiltWith API error: ${response.status}`,
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

  // Simple heuristic to derive a domain from a company name
  private deriveDomain(company: string): string {
    // If it already looks like a domain, return as-is
    if (company.includes('.') && !company.includes(' ')) {
      return company.toLowerCase();
    }
    // Strip common suffixes and produce a .com domain
    const cleaned = company
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|co|group|holdings|international)\b\.?/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    return `${cleaned}.com`;
  }

  private mapResponse(data: Record<string, unknown>): EnrichmentField[] {
    const fields: EnrichmentField[] = [];

    // BuiltWith returns Results array with technology groups
    const results = data.Results as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(results) || results.length === 0) {
      return fields;
    }

    const techNames: string[] = [];

    for (const result of results) {
      const paths = result.Result as Record<string, unknown> | undefined;
      if (!paths) continue;

      const techSpend = paths.Paths as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(techSpend)) continue;

      for (const path of techSpend) {
        const technologies = path.Technologies as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(technologies)) continue;

        for (const tech of technologies) {
          const name = tech.Name ?? tech.Tag;
          if (this.isRealValue(name)) {
            techNames.push(String(name));
          }
        }
      }
    }

    // Deduplicate and join tech names into tags
    const uniqueTechs = [...new Set(techNames)];
    if (uniqueTechs.length > 0) {
      fields.push({ field: 'tags', value: uniqueTechs.join(','), confidence: 0.8 });
    }

    // Extract domain info if present
    const firstResult = results[0];
    const lookup = firstResult.Lookup as string | undefined;
    if (this.isRealValue(lookup)) {
      fields.push({ field: 'website', value: String(lookup), confidence: 0.9 });
    }

    return fields;
  }
}
