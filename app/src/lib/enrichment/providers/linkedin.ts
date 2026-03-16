// LinkedIn enrichment provider (via browser extension)
// This provider enriches contacts by communicating with the ctox browser extension
// which scrapes profile data directly from LinkedIn pages.

import {
  EnrichmentProvider,
  EnrichmentContact,
  EnrichmentResult,
  EnrichmentField,
} from '../types';

export class LinkedinProvider implements EnrichmentProvider {
  readonly name = 'linkedin';
  readonly displayName = 'LinkedIn (Extension)';
  readonly capabilities = [
    'profile',
    'employment',
    'education',
    'skills',
    'connections',
    'activity',
  ];
  readonly costPerLookupCents = 0;

  async enrich(contact: EnrichmentContact): Promise<EnrichmentResult> {
    if (!contact.linkedinUrl) {
      return {
        providerId: this.name,
        providerName: this.displayName,
        success: false,
        fields: [],
        costCents: 0,
        error: 'LinkedIn profile URL required',
      };
    }

    // The extension enrichment works through a queue/polling model:
    // 1. App creates an enrichment_request record
    // 2. Extension polls for pending requests
    // 3. Extension visits the LinkedIn profile and scrapes data
    // 4. Extension POSTs results back to the app
    // For now, return a pending status — the actual enrichment happens async
    return {
      providerId: this.name,
      providerName: this.displayName,
      success: true,
      fields: [],
      costCents: 0,
      rawResponse: {
        status: 'queued',
        message: 'Enrichment request queued for browser extension',
        linkedinUrl: contact.linkedinUrl,
      },
    };
  }

  estimateCost(): number {
    return 0; // Free — uses extension
  }

  async checkBalance(): Promise<{ available: boolean; remaining?: number }> {
    return { available: true };
  }

  // Called when extension returns scraped data
  static mapExtensionResponse(data: Record<string, unknown>): EnrichmentField[] {
    const fields: EnrichmentField[] = [];

    if (data.headline) {
      fields.push({ field: 'headline', value: data.headline as string, confidence: 1.0 });
    }
    if (data.title || data.currentTitle) {
      fields.push({ field: 'title', value: (data.title || data.currentTitle) as string, confidence: 1.0 });
    }
    if (data.company || data.currentCompany) {
      fields.push({ field: 'current_company', value: (data.company || data.currentCompany) as string, confidence: 1.0 });
    }
    if (data.location) {
      fields.push({ field: 'location', value: data.location as string, confidence: 1.0 });
    }
    if (data.about || data.summary) {
      fields.push({ field: 'about', value: (data.about || data.summary) as string, confidence: 1.0 });
    }
    if (data.connectionCount) {
      fields.push({ field: 'connection_count', value: data.connectionCount as number, confidence: 0.9 });
    }
    if (data.industry) {
      fields.push({ field: 'industry', value: data.industry as string, confidence: 0.9 });
    }
    if (Array.isArray(data.skills) && data.skills.length > 0) {
      fields.push({ field: 'skills', value: (data.skills as string[]).join(', '), confidence: 1.0 });
    }
    if (Array.isArray(data.experience) && data.experience.length > 0) {
      fields.push({ field: 'employment', value: JSON.stringify(data.experience), confidence: 1.0 });
    }
    if (Array.isArray(data.education) && data.education.length > 0) {
      fields.push({ field: 'education', value: JSON.stringify(data.education), confidence: 1.0 });
    }

    return fields;
  }
}
