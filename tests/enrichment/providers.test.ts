// Tests for enrichment providers

import { PdlProvider } from '@/lib/enrichment/providers/pdl';
import { LushaProvider } from '@/lib/enrichment/providers/lusha';
import { TheirStackProvider } from '@/lib/enrichment/providers/theirstack';
import { EnrichmentContact } from '@/lib/enrichment/types';

const testContact: EnrichmentContact = {
  id: 'test-123',
  linkedinUrl: 'https://linkedin.com/in/johndoe',
  firstName: 'John',
  lastName: 'Doe',
  fullName: 'John Doe',
  email: null,
  currentCompany: 'Acme Corp',
  title: 'VP Engineering',
};

describe('PdlProvider', () => {
  const provider = new PdlProvider();

  it('should have correct metadata', () => {
    expect(provider.name).toBe('pdl');
    expect(provider.displayName).toBe('People Data Labs');
    expect(provider.capabilities).toContain('email');
    expect(provider.costPerLookupCents).toBe(10);
  });

  it('should return error when no API key', async () => {
    const result = await provider.enrich(testContact);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key not configured');
    expect(result.costCents).toBe(0);
  });

  it('should estimate cost correctly', () => {
    const cost = provider.estimateCost([testContact, testContact]);
    expect(cost).toBe(20);
  });

  it('should report balance unavailable without API key', async () => {
    const balance = await provider.checkBalance();
    expect(balance.available).toBe(false);
  });
});

describe('LushaProvider', () => {
  const provider = new LushaProvider();

  it('should have correct metadata', () => {
    expect(provider.name).toBe('lusha');
    expect(provider.displayName).toBe('Lusha');
    expect(provider.capabilities).toContain('phone');
    expect(provider.costPerLookupCents).toBe(15);
  });

  it('should return error when no API key', async () => {
    const result = await provider.enrich(testContact);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key not configured');
  });
});

describe('TheirStackProvider', () => {
  const provider = new TheirStackProvider();

  it('should have correct metadata', () => {
    expect(provider.name).toBe('theirstack');
    expect(provider.displayName).toBe('TheirStack');
    expect(provider.capabilities).toContain('technographics');
    expect(provider.costPerLookupCents).toBe(5);
  });

  it('should return error when no API key', async () => {
    const result = await provider.enrich(testContact);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key not configured');
  });

  it('should require company name', async () => {
    const contactNoCompany = { ...testContact, currentCompany: null };
    const provider2 = new TheirStackProvider({ apiKey: 'test-key' });
    const result = await provider2.enrich(contactNoCompany);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Company name required');
  });

  it('should only count contacts with companies for cost', () => {
    const contacts = [
      testContact,
      { ...testContact, currentCompany: null },
      testContact,
    ];
    const cost = provider.estimateCost(contacts);
    expect(cost).toBe(10); // Only 2 have companies
  });
});
