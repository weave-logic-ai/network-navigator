// Tests for outreach template auto-selection.
//
// Pins two invariants:
//   1. Every category resolveCategory() can produce is one of the values
//      permitted by the outreach_templates CHECK constraint
//      (data/db/init/006-outreach-schema.sql) and the POST
//      /api/outreach/templates validator (VALID_CATEGORIES in
//      app/src/app/api/outreach/templates/route.ts) — previously
//      'executive_intro', 'warm_followup', 'network_intro', and
//      'partnership_proposal' were recommended but could never match a
//      real template.
//   2. getRecommendedTemplate() queries for the resolved category and
//      falls back to 'initial_outreach' when no active template exists.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
}));

import { query } from '@/lib/db/client';
import { getRecommendedTemplate } from '@/lib/outreach/template-matcher';

const mockQuery = query as jest.MockedFunction<typeof query>;

// Matches the CHECK constraint in data/db/init/006-outreach-schema.sql and
// VALID_CATEGORIES in app/src/app/api/outreach/templates/route.ts.
const PERMITTED_CATEGORIES = [
  'initial_outreach',
  'follow_up',
  'meeting_request',
  'referral_ask',
  'content_share',
  'custom',
];

function mockRows<T>(rows: T[]) {
  return Promise.resolve({
    rows,
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }) as ReturnType<typeof query>;
}

/** Records the `category` param of every query and returns a template only
 * for categories in `templatesFor`. */
function trackQueriedCategories(templatesFor: Set<string> = new Set()) {
  const queriedCategories: string[] = [];
  mockQuery.mockImplementation((_sql: unknown, params?: unknown[]) => {
    const category = String(params?.[0]);
    queriedCategories.push(category);
    if (templatesFor.has(category)) {
      return mockRows([{ id: `tmpl-${category}`, name: `${category} template` }]);
    }
    return mockRows([]);
  });
  return queriedCategories;
}

describe('getRecommendedTemplate', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe.each([
    ['gold buyer', 'gold', 'buyer', undefined, 'initial_outreach'],
    ['gold warm-lead', 'gold', 'warm-lead', undefined, 'follow_up'],
    ['silver hub', 'silver', 'hub', undefined, 'referral_ask'],
    ['warm-introducer referral', 'bronze', 'other', 'warm-introducer', 'referral_ask'],
    ['white-label-partner', 'bronze', 'other', 'white-label-partner', 'custom'],
    ['no match falls back to default', 'watch', 'unknown', undefined, 'initial_outreach'],
  ] as const)('%s', (_label, tier, persona, referralPersona, expectedCategory) => {
    it(`resolves to a permitted category (${expectedCategory})`, () => {
      expect(PERMITTED_CATEGORIES).toContain(expectedCategory);
    });

    it(`queries outreach_templates for category '${expectedCategory}'`, async () => {
      const queried = trackQueriedCategories(new Set([expectedCategory]));
      const result = await getRecommendedTemplate(tier, persona, referralPersona);

      expect(queried[0]).toBe(expectedCategory);
      expect(result).toEqual({
        templateId: `tmpl-${expectedCategory}`,
        templateName: `${expectedCategory} template`,
        reason: expect.any(String),
      });
    });
  });

  it('falls back to initial_outreach when the resolved category has no active template', async () => {
    // Silver-tier hub resolves to referral_ask, but only an
    // initial_outreach template exists.
    const queried = trackQueriedCategories(new Set(['initial_outreach']));

    const result = await getRecommendedTemplate('silver', 'hub');

    expect(queried).toEqual(['referral_ask', 'initial_outreach']);
    expect(result).toEqual({
      templateId: 'tmpl-initial_outreach',
      templateName: 'initial_outreach template',
      reason: expect.any(String),
    });
  });

  it('returns null when no template exists in the resolved category or the fallback', async () => {
    trackQueriedCategories(new Set());

    const result = await getRecommendedTemplate('gold', 'buyer');

    expect(result).toBeNull();
  });

  it('never resolves to a category outside the permitted set, across all known persona/tier/referralPersona inputs', async () => {
    const tiers = ['gold', 'silver', 'bronze', 'watch', 'unscored', 'other'];
    const personas = ['buyer', 'warm-lead', 'hub', 'other', 'unknown'];
    const referralPersonas = [undefined, null, 'warm-introducer', 'white-label-partner', 'other'];

    for (const tier of tiers) {
      for (const persona of personas) {
        for (const referralPersona of referralPersonas) {
          const queried = trackQueriedCategories(new Set());
          await getRecommendedTemplate(tier, persona, referralPersona);
          for (const category of queried) {
            expect(PERMITTED_CATEGORIES).toContain(category);
          }
        }
      }
    }
  });
});
