// Lusha enrichment provider (verified email/phone)

import {
  EnrichmentProvider,
  EnrichmentContact,
  EnrichmentResult,
  EnrichmentField,
} from '../types';

export class LushaProvider implements EnrichmentProvider {
  readonly name = 'lusha';
  readonly displayName = 'Lusha';
  readonly capabilities = ['email', 'phone', 'company'];
  readonly costPerLookupCents = 15;

  private apiKey: string | null;
  private baseUrl: string;

  constructor(config: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = config.apiKey || process.env.LUSHA_API_KEY || null;
    this.baseUrl = config.baseUrl || 'https://api.lusha.com';
  }

  async enrich(contact: EnrichmentContact): Promise<EnrichmentResult> {
    if (!this.apiKey) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'Lusha API key not configured',
      };
    }

    let requestStarted = false;
    try {
      const body: Record<string, string> = {};
      if (contact.firstName) body.firstName = contact.firstName;
      if (contact.lastName) body.lastName = contact.lastName;
      if (contact.currentCompany) body.company = contact.currentCompany;
      if (contact.linkedinUrl) body.linkedinUrl = contact.linkedinUrl;

      requestStarted = true;
      const response = await fetch(`${this.baseUrl}/person`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'api_key': this.apiKey,
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
          costCents: 0,
          error: `Lusha API error: ${response.status}`,
          errorCode: response.status === 404 ? undefined : 'provider_unknown_charge',
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
        error: requestStarted ? 'Provider request or response failed; charge requires reconciliation'
          : error instanceof Error ? error.message : 'Unknown error',
        errorCode: requestStarted ? 'provider_unknown_charge' : undefined,
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

    const emailData = data.emailAddresses as Array<{ email: string; type: string }> | undefined;
    if (emailData && emailData.length > 0) {
      fields.push({ field: 'email', value: emailData[0].email, confidence: 0.95 });
    }

    const phoneData = data.phoneNumbers as Array<{ internationalNumber: string }> | undefined;
    if (phoneData && phoneData.length > 0) {
      fields.push({ field: 'phone', value: phoneData[0].internationalNumber, confidence: 0.9 });
    }

    if (data.company) {
      const company = data.company as Record<string, unknown>;
      if (company.name) {
        fields.push({ field: 'current_company', value: company.name as string, confidence: 0.9 });
      }
    }

    return fields;
  }
}
