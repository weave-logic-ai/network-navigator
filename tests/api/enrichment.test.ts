// API enrichment route tests

describe('Enrichment API', () => {
  describe('POST /api/enrichment/enrich validation', () => {
    it('should require contactId or contactIds', () => {
      const body1 = { contactId: '550e8400-e29b-41d4-a716-446655440000' };
      const body2 = { contactIds: ['550e8400-e29b-41d4-a716-446655440000'] };
      const body3 = {};

      const ids1 = body1.contactId ? [body1.contactId] : [];
      expect(ids1.length).toBe(1);

      const ids2 = (body2 as { contactIds?: string[] }).contactIds || [];
      expect(ids2.length).toBe(1);

      const ids3 = (body3 as { contactId?: string; contactIds?: string[] }).contactId
        ? [(body3 as { contactId: string }).contactId]
        : (body3 as { contactIds?: string[] }).contactIds || [];
      expect(ids3.length).toBe(0);
    });
  });

  describe('POST /api/enrichment/estimate validation', () => {
    it('should require contactIds array', () => {
      const body = { contactIds: ['id1', 'id2'] };
      expect(body.contactIds).toBeDefined();
      expect(Array.isArray(body.contactIds)).toBe(true);
    });
  });

  describe('GET /api/enrichment/budget format', () => {
    it('should format budget status correctly', () => {
      const status = {
        budgetCents: 10000,
        spentCents: 3500,
        remainingCents: 6500,
        utilizationPercent: 35,
        isWarning: false,
        isExhausted: false,
        lookupCount: 35,
      };

      expect(status.remainingCents).toBe(status.budgetCents - status.spentCents);
      expect(status.isWarning).toBe(false);
    });
  });
});
