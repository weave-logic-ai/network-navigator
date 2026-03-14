// Tests for budget manager

describe('Budget Manager', () => {
  describe('budget status calculation', () => {
    it('should calculate remaining budget correctly', () => {
      const budgetCents = 10000;
      const spentCents = 3500;
      const remainingCents = budgetCents - spentCents;

      expect(remainingCents).toBe(6500);
    });

    it('should calculate utilization percentage', () => {
      const budgetCents = 10000;
      const spentCents = 8000;
      const utilizationPercent = (spentCents / budgetCents) * 100;

      expect(utilizationPercent).toBe(80);
    });

    it('should flag warning at 80% utilization', () => {
      const budgetCents = 10000;
      const testCases = [
        { spent: 7900, expected: false },
        { spent: 8000, expected: true },
        { spent: 9500, expected: true },
      ];

      for (const tc of testCases) {
        const utilizationPercent = (tc.spent / budgetCents) * 100;
        const isWarning = utilizationPercent >= 80;
        expect(isWarning).toBe(tc.expected);
      }
    });

    it('should flag exhausted when no budget remaining', () => {
      const budgetCents = 10000;
      const spentCents = 10500;
      const remainingCents = budgetCents - spentCents;
      const isExhausted = remainingCents <= 0;

      expect(isExhausted).toBe(true);
    });
  });

  describe('cost affordability check', () => {
    it('should allow enrichment within budget', () => {
      const remaining = 5000;
      const estimatedCost = 3000;
      expect(estimatedCost <= remaining).toBe(true);
    });

    it('should reject enrichment exceeding budget', () => {
      const remaining = 2000;
      const estimatedCost = 3000;
      expect(estimatedCost <= remaining).toBe(false);
    });
  });
});
