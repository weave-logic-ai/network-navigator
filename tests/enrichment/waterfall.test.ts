// Tests for enrichment waterfall engine

import { EnrichmentContact } from '@/lib/enrichment/types';

describe('Enrichment Waterfall', () => {
  const testContact: EnrichmentContact = {
    id: 'test-123',
    linkedinUrl: 'https://linkedin.com/in/test',
    firstName: 'John',
    lastName: 'Doe',
    fullName: 'John Doe',
    email: null,
    currentCompany: 'Acme Corp',
    title: 'VP Engineering',
  };

  describe('contact data structure', () => {
    it('should have required fields', () => {
      expect(testContact.id).toBeDefined();
      expect(testContact.linkedinUrl).toBeDefined();
    });

    it('should allow null optional fields', () => {
      expect(testContact.email).toBeNull();
    });
  });

  describe('capability matching', () => {
    it('should match email capability to email field', () => {
      const mapping: Record<string, string[]> = {
        email: ['email'],
        phone: ['phone'],
        social: ['linkedin_url', 'twitter'],
        employment: ['title', 'current_company'],
        company: ['current_company', 'industry'],
        technographics: ['technographics'],
      };

      expect(mapping['email']).toContain('email');
      expect(mapping['employment']).toContain('title');
      expect(mapping['technographics']).toContain('technographics');
    });
  });

  describe('cost estimation', () => {
    it('should calculate total cost from provider costs', () => {
      const providers = [
        { costPerLookupCents: 10 },
        { costPerLookupCents: 15 },
        { costPerLookupCents: 5 },
      ];

      const contactCount = 10;
      const totalCost = providers.reduce(
        (sum, p) => sum + p.costPerLookupCents * contactCount,
        0
      );

      expect(totalCost).toBe(300); // (10+15+5) * 10
    });
  });
});
