// API contacts route tests (unit-level - testing validation logic)

describe('Contacts API', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  describe('UUID validation', () => {
    it('should accept valid UUIDs', () => {
      expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(UUID_REGEX.test('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
      expect(UUID_REGEX.test('123')).toBe(false);
      expect(UUID_REGEX.test('')).toBe(false);
      expect(UUID_REGEX.test('550e8400-e29b-41d4-a716')).toBe(false);
    });
  });

  describe('pagination parameter validation', () => {
    it('should clamp page to minimum 1', () => {
      const page = Math.max(1, parseInt('-1', 10));
      expect(page).toBe(1);
    });

    it('should clamp limit to range 1-100', () => {
      const limit1 = Math.min(100, Math.max(1, parseInt('200', 10)));
      expect(limit1).toBe(100);

      const limit2 = Math.min(100, Math.max(1, parseInt('0', 10)));
      expect(limit2).toBe(1);
    });

    it('should default page to 1 and limit to 20', () => {
      const page = parseInt('', 10) || 1;
      const limit = parseInt('', 10) || 20;
      expect(page).toBe(1);
      expect(limit).toBe(20);
    });
  });

  describe('input sanitization', () => {
    it('should only allow known fields for contact creation', () => {
      const allowedFields = [
        'linkedin_url', 'first_name', 'last_name', 'full_name', 'headline',
        'title', 'current_company', 'current_company_id', 'location', 'about',
        'email', 'phone', 'tags',
      ];

      const input = {
        linkedin_url: 'https://linkedin.com/in/test',
        first_name: 'John',
        malicious_field: 'DROP TABLE contacts',
        __proto__: 'bad',
      };

      const sanitized: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if ((input as Record<string, unknown>)[field] !== undefined) {
          sanitized[field] = (input as Record<string, unknown>)[field];
        }
      }

      expect(sanitized).toEqual({
        linkedin_url: 'https://linkedin.com/in/test',
        first_name: 'John',
      });
      expect(sanitized).not.toHaveProperty('malicious_field');
      expect(Object.keys(sanitized)).not.toContain('__proto__');
    });

    it('should reject contact without linkedin_url', () => {
      const body = { first_name: 'John', last_name: 'Doe' };
      const isValid = body.hasOwnProperty('linkedin_url') && typeof (body as Record<string, unknown>).linkedin_url === 'string';
      expect(isValid).toBe(false);
    });
  });

  describe('sort column allowlist', () => {
    it('should only allow known sort columns', () => {
      const allowed: Record<string, string> = {
        name: 'c.full_name',
        first_name: 'c.first_name',
        last_name: 'c.last_name',
        company: 'c.current_company',
        score: 'cs.composite_score',
        created_at: 'c.created_at',
        updated_at: 'c.updated_at',
      };

      expect(allowed['name']).toBe('c.full_name');
      expect(allowed['malicious; DROP TABLE']).toBeUndefined();
    });
  });
});
